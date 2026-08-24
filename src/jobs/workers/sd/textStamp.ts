// Sharp text renderer.
//
// ⚠️ READ THIS BEFORE CHANGING HOW TEXT IS DRAWN.
//
// Text is rendered by converting glyphs to SVG <path> outlines with opentype.js,
// NOT by emitting SVG <text> with a font-family.
//
// Why: Sharp renders SVG through librsvg, which delegates ALL font lookup to
// fontconfig — meaning it can only use fonts INSTALLED ON THE MACHINE. An
// @font-face rule with an embedded base64 data URI is parsed and silently
// discarded. The previous implementation did exactly that, which produced two
// different failures from one bug:
//
//   • locally (Windows): fontconfig substituted an arbitrary installed system
//     font, so text appeared — but never in the comic's actual uploaded font.
//   • in production (node:22-bookworm-slim): the image ships with ZERO fonts,
//     so there was nothing to substitute and dialogue rendered blank.
//
// Neither case errored. Sharp treats an unresolvable font as empty output and
// reports success, so blank pages sailed through to SD_READY.
//
// Converting to paths removes fontconfig from the picture entirely: a <path> is
// pure geometry and renders identically on every machine, with no fonts
// installed anywhere. It also gives us real glyph metrics, so wrapping and
// auto-shrink are measured rather than estimated.

import sharp, { type OverlayOptions } from "sharp";
import opentype from "opentype.js";
import { downloadFileToBuffer, getKeyFromPublicUrl } from "../../../lib/r2.js";
import { logger } from "../../../lib/logger.js";
import { ValidationError } from "../../../utils/errors.js";
import { substituteTokens } from "./tokens.js";
import { MIN_FONT_SIZE } from "../../../config/generation.js";
import type {
  Page,
  Bubble,
  Font,
  PronounKey,
} from "../../../generated/prisma/client.js";

type BubbleWithFont = Bubble & { font: Font | null };

type StampTextParams = {
  page: Page;
  bubbles: BubbleWithFont[];
  childName: string;
  pronounKey: PronounKey;
};

/**
 * Extra leading applied on top of the font's OWN natural line height
 * (ascender − descender). Unlike the old flat 1.2 × font-size, this respects
 * fonts that are naturally tall or tight, so line spacing looks consistent
 * across different uploaded fonts.
 */
const LINE_HEIGHT_FACTOR = 1.15;

/** Decimal places kept in emitted SVG path data. 2 is visually lossless at print size. */
const PATH_PRECISION = 2;

// ============================================================
// FONT LOADING
// ============================================================

/**
 * Node Buffers are views into a larger pooled ArrayBuffer, so passing
 * `buffer.buffer` straight to opentype.js would hand it unrelated memory.
 * Slice to this view's exact bounds.
 */
function toArrayBuffer(buffer: Buffer): ArrayBuffer {
  return buffer.buffer.slice(
    buffer.byteOffset,
    buffer.byteOffset + buffer.byteLength,
  ) as ArrayBuffer;
}

/**
 * Parse a downloaded font file into an opentype.js Font.
 *
 * Throws with an actionable message rather than letting a raw parser error
 * surface — the admin who uploaded the file is the one who has to fix it.
 *
 * Supports TTF, OTF and WOFF. WOFF2 is NOT supported (it needs a Brotli
 * decompressor opentype.js does not bundle) even though the upload validator
 * currently accepts the extension.
 */
function parseFont(fontBuffer: Buffer, fontName: string, fontKey: string): opentype.Font {
  try {
    return opentype.parse(toArrayBuffer(fontBuffer));
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);

    if (fontKey.endsWith(".woff2") || detail.includes("WOFF2")) {
      throw new ValidationError(
        `Font "${fontName}" (${fontKey}) is WOFF2, which cannot be used for page rendering. ` +
          `Re-upload this font as .ttf or .otf.`,
      );
    }

    throw new ValidationError(
      `Font "${fontName}" (${fontKey}) could not be parsed and cannot be used for page rendering. ` +
        `Re-upload a valid .ttf or .otf file. Parser said: ${detail}`,
    );
  }
}

/**
 * Fail loudly when the font has no glyph for a character we're about to draw.
 *
 * Glyph index 0 is `.notdef`. Many fonts draw `.notdef` as an empty outline
 * (invisible) or a hollow box (tofu) — both of which would silently produce a
 * wrong page rather than an error, which is precisely the failure mode this
 * whole module was rewritten to eliminate. Whitespace is exempt: it legitimately
 * has no visible outline.
 */
function assertGlyphCoverage(font: opentype.Font, text: string, fontName: string): void {
  const missing = new Set<string>();

  for (const char of text) {
    if (/\s/.test(char)) continue;
    if (font.charToGlyphIndex(char) === 0) missing.add(char);
  }

  if (missing.size > 0) {
    const chars = [...missing].join(" ");
    throw new ValidationError(
      `Font "${fontName}" has no glyphs for: ${chars}. ` +
        `The dialogue (or the child's name) uses characters this font does not contain — ` +
        `they would render as blank or as empty boxes. Use a font that covers this text.`,
    );
  }
}

// ============================================================
// MEASUREMENT (real font metrics — no estimation)
// ============================================================

/** Advance width of `text` in pixels at `fontSizePx`, kerning included. */
function measureWidth(font: opentype.Font, text: string, fontSizePx: number): number {
  return font.getAdvanceWidth(text, fontSizePx);
}

type LineMetrics = {
  /** Distance between consecutive baselines. */
  lineHeightPx: number;
  /** Baseline-to-top-of-ascenders. */
  ascenderPx: number;
  /** Leading added on top of the font's natural line height. */
  leadingPx: number;
};

function lineMetrics(font: opentype.Font, fontSizePx: number): LineMetrics {
  const scale = fontSizePx / font.unitsPerEm;
  const ascenderPx = font.ascender * scale;
  // descender is negative in font units, so subtracting it adds height.
  const naturalLineHeightPx = ascenderPx - font.descender * scale;
  const lineHeightPx = naturalLineHeightPx * LINE_HEIGHT_FACTOR;

  return {
    lineHeightPx,
    ascenderPx,
    leadingPx: lineHeightPx - naturalLineHeightPx,
  };
}

/**
 * Greedy word wrap against a real pixel width.
 *
 * Splits on whitespace only — words are never broken mid-character. A single
 * word wider than `maxWidthPx` goes on its own line and overflows; the caller's
 * shrink loop is what actually resolves that.
 */
function wrapText(
  font: opentype.Font,
  text: string,
  maxWidthPx: number,
  fontSizePx: number,
): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];

  const lines: string[] = [];
  let current = "";

  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;

    if (measureWidth(font, candidate, fontSizePx) <= maxWidthPx) {
      current = candidate;
    } else {
      if (current) lines.push(current);
      current = word;
    }
  }

  if (current) lines.push(current);

  return lines;
}

type FittedText = {
  fontSizePx: number;
  lines: string[];
};

/**
 * Find the largest font size at which the wrapped text fits the bubble on BOTH
 * axes, never going below the MIN_FONT_SIZE floor.
 *
 * The width check is new: the old estimator assumed wrapping alone guaranteed a
 * fit, which is untrue for a single long word (a long child's name, most
 * obviously). Measuring real advance widths means an unbreakable word now drives
 * the shrink instead of silently spilling out of the bubble.
 *
 * If it hits the floor and still doesn't fit, it returns text at the floor size
 * and logs a warning — overflowing is better than dropping a page.
 */
function fitTextToBox(
  font: opentype.Font,
  text: string,
  boxWidthPx: number,
  boxHeightPx: number,
  initialFontSizePx: number,
  artworkHeight: number,
): FittedText {
  const minFontSizePx = Math.max(1, MIN_FONT_SIZE * artworkHeight);

  const fits = (fontSizePx: number): string[] | null => {
    const lines = wrapText(font, text, boxWidthPx, fontSizePx);
    if (lines.length === 0) return null;

    const widestLinePx = Math.max(
      ...lines.map((line) => measureWidth(font, line, fontSizePx)),
    );
    const totalHeightPx = lines.length * lineMetrics(font, fontSizePx).lineHeightPx;

    return widestLinePx <= boxWidthPx && totalHeightPx <= boxHeightPx ? lines : null;
  };

  for (
    let fontSizePx = Math.floor(initialFontSizePx);
    fontSizePx >= minFontSizePx;
    fontSizePx -= 1
  ) {
    const lines = fits(fontSizePx);
    if (lines) return { fontSizePx, lines };
  }

  logger.warn(
    {
      text: text.substring(0, 40),
      boxWidthPx,
      boxHeightPx,
      minFontSizePx,
    },
    "Text does not fit in bubble even at minimum font size — will overflow",
  );

  return {
    fontSizePx: minFontSizePx,
    lines: wrapText(font, text, boxWidthPx, minFontSizePx),
  };
}

// ============================================================
// SVG GENERATION (glyph outlines — no <text>, no fonts required)
// ============================================================

type BubbleSvgInputs = {
  widthPx: number;
  heightPx: number;
  lines: string[];
  fontSizePx: number;
  font: opentype.Font;
  /** Bubble.fontColor — a validated 6-digit hex string, e.g. "#1a1a1a". */
  fill: string;
};

/**
 * Render the wrapped lines as a single <path> of glyph outlines, centred both
 * horizontally and vertically inside the bubble box.
 *
 * There is no <text>, no font-family and no @font-face here by design — the
 * output depends on nothing installed on the host. Note also that no
 * user-supplied string reaches the SVG any more: path data is pure numbers and
 * `fill` is a hex colour the Zod schema has already matched against
 * /^#[0-9a-f]{6}$/ — neither can carry a quote or an angle bracket, so the
 * XML-escaping hazard that used to require escapeXml() is gone entirely.
 */
function buildBubbleSvg(inputs: BubbleSvgInputs): string {
  const { widthPx, heightPx, lines, fontSizePx, font, fill } = inputs;
  const { lineHeightPx, ascenderPx, leadingPx } = lineMetrics(font, fontSizePx);

  // Centre the block of lines vertically, then drop to the first baseline.
  const blockHeightPx = lines.length * lineHeightPx;
  const blockTopPx = (heightPx - blockHeightPx) / 2;
  const firstBaselineY = blockTopPx + leadingPx / 2 + ascenderPx;

  // Each line is centred on its own measured width — <path> has no text-anchor.
  const pathData = lines
    .map((line, index) => {
      const lineWidthPx = measureWidth(font, line, fontSizePx);
      const x = (widthPx - lineWidthPx) / 2;
      const baselineY = firstBaselineY + index * lineHeightPx;

      return font.getPath(line, x, baselineY, fontSizePx).toPathData(PATH_PRECISION);
    })
    .join(" ");

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${widthPx}" height="${heightPx}" viewBox="0 0 ${widthPx} ${heightPx}"><path d="${pathData}" fill="${fill}"/></svg>`;
}

// ============================================================
// ENTRY POINT
// ============================================================

/**
 * Stamp personalized dialogue onto a page's artwork.
 *
 * Downloads the artwork and every font referenced by the page's bubbles,
 * substitutes tokens ({name}, {pronoun_*}) with real values, fits and wraps text
 * to each bubble using real glyph metrics, converts it to outlines, then
 * composites every bubble onto the artwork in one Sharp operation.
 *
 * Returns the resulting PNG buffer. Does NOT upload — the worker does that.
 *
 * Throws (rather than rendering a blank bubble) when a bubble has dialogue but
 * no font assigned, when a font file cannot be parsed, or when the font lacks
 * glyphs for the text. All three used to produce a silently blank page.
 */
export async function stampTextOnPage(params: StampTextParams): Promise<Buffer> {
  const { page, bubbles, childName, pronounKey } = params;

  // --- Guard the invariants the worker should have already checked, but defense in depth ---
  if (!page.artworkUrl || !page.artworkWidth || !page.artworkHeight) {
    throw new ValidationError(
      `Page ${page.id} is missing artwork or artwork dimensions — cannot stamp text.`,
    );
  }

  // --- Download artwork ---
  const artworkKey = getKeyFromPublicUrl(page.artworkUrl);
  const artworkBuffer = await downloadFileToBuffer("public", artworkKey);

  logger.debug(
    { pageId: page.id, bubbleCount: bubbles.length },
    "Starting text stamp",
  );

  // --- No bubbles? Nothing to stamp. Return artwork as-is. ---
  if (bubbles.length === 0) return artworkBuffer;

  // --- Download and parse every font referenced, cached by key ---
  //
  // Parsed once per page and reused across bubbles sharing a font. This cache is
  // deliberately function-scoped (not module-level) — see the note in
  // PROJECT_CONTEXT: fonts are re-fetched per job by design.
  const fontCache = new Map<string, opentype.Font>();

  for (const bubble of bubbles) {
    if (!bubble.font) continue;
    if (fontCache.has(bubble.font.fileUrl)) continue;

    const fontBuffer = await downloadFileToBuffer("private", bubble.font.fileUrl);
    fontCache.set(
      bubble.font.fileUrl,
      parseFont(fontBuffer, bubble.font.name, bubble.font.fileUrl),
    );
  }

  // --- Build a composite entry per bubble ---
  const composites: OverlayOptions[] = [];

  for (const bubble of bubbles) {
    // 1. Substitute tokens
    const finalText = substituteTokens(bubble.dialogue, childName, pronounKey).trim();

    // Nothing to draw. A whitespace-only bubble is not an error — skip it.
    if (finalText.length === 0) continue;

    // 2. Resolve the font.
    //
    // Fail loud. There is no fallback font available: relying on a system font
    // is exactly the bug this module was rewritten to remove, and in the
    // production container there is no system font to fall back to at all.
    // Silently skipping would ship a printed book with missing dialogue.
    if (!bubble.font) {
      throw new ValidationError(
        `Bubble ${bubble.id} on page ${page.id} has dialogue but no font assigned. ` +
          `Assign a font to this bubble in the admin panel — there is no fallback font.`,
      );
    }

    const font = fontCache.get(bubble.font.fileUrl)!;
    assertGlyphCoverage(font, finalText, bubble.font.name);

    // 3. Convert normalized coords to pixels
    const xPx = Math.round(bubble.x * page.artworkWidth);
    const yPx = Math.round(bubble.y * page.artworkHeight);
    const widthPx = Math.round(bubble.width * page.artworkWidth);
    const heightPx = Math.round(bubble.height * page.artworkHeight);
    const initialFontSizePx = bubble.fontSize * page.artworkHeight;

    // 4. Fit text into the bubble using real metrics
    const { fontSizePx, lines } = fitTextToBox(
      font,
      finalText,
      widthPx,
      heightPx,
      initialFontSizePx,
      page.artworkHeight,
    );

    if (lines.length === 0) continue;

    // 5. Build the SVG (glyph outlines)
    const svg = buildBubbleSvg({
      widthPx,
      heightPx,
      lines,
      fontSizePx,
      font,
      fill: bubble.fontColor,
    });

    composites.push({
      input: Buffer.from(svg),
      top: yPx,
      left: xPx,
    });
  }

  // Every bubble was empty — skip the re-encode and hand back the original.
  if (composites.length === 0) return artworkBuffer;

  // --- Composite everything onto the artwork in one call ---
  //
  // compressionLevel 9 + adaptive filtering = smaller output, lossless.
  // Sharp's default is level 6 which produces significantly larger files
  // than the source PNG. Level 9 is slower to encode but produces the
  // smallest lossless PNG. This is the version stored in R2 and shown to
  // the user — quality is not compromised, only file size.
  const stampedBuffer = await sharp(artworkBuffer)
    .composite(composites)
    .png({ compressionLevel: 9, adaptiveFiltering: true })
    .toBuffer();

  logger.info(
    {
      pageId: page.id,
      bubbleCount: bubbles.length,
      fontsLoaded: fontCache.size,
      bubblesStamped: composites.length,
    },
    "Text stamped onto page",
  );

  return stampedBuffer;
}
