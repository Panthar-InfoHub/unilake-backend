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
//
// ─────────────────────────────────────────────────────────────────────────────
//
// ⚠️ SECOND THING TO KNOW: not every valid font can be SHAPED by opentype.js.
//
// Asking opentype.js to measure or draw a string runs its text-shaping engine
// first, which applies the font's OpenType feature tables (ligatures, glyph
// composition, and so on). That engine implements only a subset of the ways
// those tables can legally be encoded, and when it meets an encoding it does
// not implement it THROWS instead of skipping the rule.
//
// A real font uploaded in production did exactly that:
//   "substitutionType : 62 lookupType: 6 - substFormat: 2 is not yet supported"
// It crashed every page it appeared on, three BullMQ attempts each, because a
// deterministic library gap cannot be retried away. The font itself was fine —
// it parsed cleanly and contained every glyph the dialogue needed. Only the
// shaping step failed.
//
// There is no option to disable this. The composition feature is switched on
// unconditionally inside the library and queried under the "default" script,
// so no combination of render options avoids it.
//
// So: we probe each font ONCE at load time and, if shaping throws, fall back to
// laying the text out one glyph at a time (see layoutUnshaped). The fallback
// gives up ligatures and contextual substitution for that one font — invisible
// for Latin comic dialogue — and keeps kerning, metrics and everything else.
// A page renders slightly plainer instead of not rendering at all.

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
  TextAlign,
  TextVerticalAlign,
  TextCase,
} from "../../../generated/prisma/client.js";

type BubbleWithFont = Bubble & { font: Font | null };

/**
 * A parsed font plus what we learned about how it can safely be rendered.
 *
 * `canShape` is decided ONCE, at load time (see detectShapingSupport), and every
 * measure and draw call downstream reads that flag rather than discovering the
 * answer for itself. Keeping the decision in one place is what guarantees
 * measuring and drawing stay in lockstep: a line measured with the shaper is
 * always drawn with the shaper, and a line measured without it is always drawn
 * without it. If those two ever disagreed, every line would be centred against
 * a width that doesn't match the glyphs actually painted.
 */
type LoadedFont = {
  font: opentype.Font;
  /** Display name, for error messages. */
  name: string;
  /** False when this font's own feature tables crash opentype.js's shaper. */
  canShape: boolean;
};

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
 * Text used to probe whether a font can be shaped.
 *
 * Its CONTENT is deliberately unimportant. opentype.js opens a composition
 * context for the whole string whenever it is longer than one character, and
 * the crash happens while it walks the font's lookup tables — before it ever
 * compares them against the characters. So any two-character string is a
 * complete test, and a font that shapes this shapes anything.
 *
 * A short mixed string is used anyway rather than the bare minimum, so the
 * probe stays meaningful if a future opentype.js makes the context check
 * character-dependent.
 */
const SHAPING_PROBE_TEXT = "AVa fi 1.";

/** Font size for the probe. Irrelevant to the outcome — shaping is size-independent. */
const SHAPING_PROBE_SIZE_PX = 100;

/**
 * Decide once whether this font can go through opentype.js's shaper.
 *
 * Called exactly once per font per job, straight after parsing, so the cost is
 * one measurement rather than one try/catch per line per candidate font size —
 * fitTextToBox alone would otherwise run this hundreds of times per bubble.
 *
 * Returns false rather than throwing: a font that cannot be shaped is still
 * perfectly usable through layoutUnshaped, so this is a routing decision, not
 * an error. It is logged at warn level because it is worth knowing which font
 * is degraded and why, without failing the job.
 */
function detectShapingSupport(
  font: opentype.Font,
  fontName: string,
  fontKey: string,
): boolean {
  try {
    font.getAdvanceWidth(SHAPING_PROBE_TEXT, SHAPING_PROBE_SIZE_PX);
    return true;
  } catch (err) {
    logger.warn(
      {
        fontName,
        fontKey,
        err: err instanceof Error ? err.message : String(err),
      },
      "Font cannot be shaped by opentype.js — falling back to per-glyph layout. " +
        "Ligatures and contextual substitution are skipped for this font; " +
        "kerning, metrics and glyph shapes are unaffected.",
    );
    return false;
  }
}

/**
 * Lay out `text` one glyph at a time, without the shaper.
 *
 * This is a deliberate re-implementation of opentype.js's own forEachGlyph with
 * exactly one line changed: where the library calls stringToGlyphs() — the call
 * that runs the shaper and can throw — this maps each character directly through
 * charToGlyph(). The rest (the unitsPerEm scale, advance accumulation, kerning
 * between adjacent pairs) mirrors the library's arithmetic exactly, so geometry
 * is identical for any font whose shaping would not have altered the glyph run.
 *
 * Kerning survives. font.getKerningValue() reads GPOS kerning with a fallback to
 * the legacy `kern` table; that is glyph POSITIONING, which never goes through
 * the substitution machinery that throws. Only ligatures and contextual
 * substitution are lost.
 *
 * Iterating with a spread walks whole code points rather than UTF-16 halves, so
 * characters outside the basic plane map to one glyph instead of two broken ones.
 *
 * Returns the total advance width, and invokes `onGlyph` for each glyph with its
 * pen offset relative to the start of the run — so the same walk serves both
 * measuring (ignore the callback) and drawing (use it).
 */
function layoutUnshaped(
  font: opentype.Font,
  text: string,
  fontSizePx: number,
  onGlyph?: (glyph: opentype.Glyph, penXPx: number) => void,
): number {
  const scale = fontSizePx / font.unitsPerEm;
  const glyphs = [...text].map((char) => font.charToGlyph(char));

  let penXPx = 0;

  for (let index = 0; index < glyphs.length; index += 1) {
    const glyph = glyphs[index]!;

    onGlyph?.(glyph, penXPx);

    // Matches the library: a glyph with no advanceWidth contributes nothing.
    if (glyph.advanceWidth) penXPx += glyph.advanceWidth * scale;

    const next = glyphs[index + 1];
    if (next) penXPx += font.getKerningValue(glyph, next) * scale;
  }

  return penXPx;
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

/**
 * Advance width of `text` in pixels at `fontSizePx`, kerning included.
 *
 * Routes on `canShape` so that measurement always matches what buildLinePathData
 * will actually paint — see the note on LoadedFont.
 */
/**
 * Apply a bubble's casing to its fully-substituted dialogue.
 *
 * Deliberately locale-independent (`toUpperCase`, not `toLocaleUpperCase`): the
 * server has no notion of the reader's locale, and a locale-aware transform
 * would make the same comic render differently depending on the host's
 * environment — the exact class of "works locally, wrong in the container" bug
 * this module was rewritten to eliminate.
 */
function applyTextCase(text: string, textCase: TextCase): string {
  switch (textCase) {
    case "UPPERCASE":
      return text.toUpperCase();
    case "LOWERCASE":
      return text.toLowerCase();
    case "AS_TYPED":
    default:
      return text;
  }
}

function measureWidth(loaded: LoadedFont, text: string, fontSizePx: number): number {
  return loaded.canShape
    ? loaded.font.getAdvanceWidth(text, fontSizePx)
    : layoutUnshaped(loaded.font, text, fontSizePx);
}

/**
 * SVG path data for one line of text, with its left edge at `xPx` and its
 * baseline at `baselineYPx`.
 *
 * The shaped and unshaped branches produce the same kind of output — absolute
 * glyph outlines in artwork coordinates — so the caller does not care which ran.
 * Concatenating per-glyph path data is valid SVG and matches how buildBubbleSvg
 * already joins the per-line results.
 */
function buildLinePathData(
  loaded: LoadedFont,
  line: string,
  xPx: number,
  baselineYPx: number,
  fontSizePx: number,
): string {
  if (loaded.canShape) {
    return loaded.font
      .getPath(line, xPx, baselineYPx, fontSizePx)
      .toPathData(PATH_PRECISION);
  }

  const glyphPaths: string[] = [];

  layoutUnshaped(loaded.font, line, fontSizePx, (glyph, penXPx) => {
    glyphPaths.push(
      glyph
        // Passing the font hands the glyph its own default render options, the
        // same ones Font.getPath would have applied on the shaped path.
        .getPath(xPx + penXPx, baselineYPx, fontSizePx, undefined, loaded.font)
        .toPathData(PATH_PRECISION),
    );
  });

  return glyphPaths.join(" ");
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
  loaded: LoadedFont,
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

    if (measureWidth(loaded, candidate, fontSizePx) <= maxWidthPx) {
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
  /**
   * True when the shrink loop found a size that genuinely fits the box on both
   * axes. False when it exhausted the range and fell back to the floor size,
   * meaning the text is expected to overflow.
   *
   * Purely diagnostic — the caller renders either way. It exists so the layout
   * log below can distinguish "this fitted at 113px" from "nothing fitted, so
   * here is the floor", which are very different situations that otherwise look
   * identical in the output.
   */
  fitted: boolean;
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
  loaded: LoadedFont,
  text: string,
  boxWidthPx: number,
  boxHeightPx: number,
  initialFontSizePx: number,
  artworkHeight: number,
): FittedText {
  const minFontSizePx = Math.max(1, MIN_FONT_SIZE * artworkHeight);

  const fits = (fontSizePx: number): string[] | null => {
    const lines = wrapText(loaded, text, boxWidthPx, fontSizePx);
    if (lines.length === 0) return null;

    const widestLinePx = Math.max(
      ...lines.map((line) => measureWidth(loaded, line, fontSizePx)),
    );
    const totalHeightPx =
      lines.length * lineMetrics(loaded.font, fontSizePx).lineHeightPx;

    return widestLinePx <= boxWidthPx && totalHeightPx <= boxHeightPx ? lines : null;
  };

  for (
    let fontSizePx = Math.floor(initialFontSizePx);
    fontSizePx >= minFontSizePx;
    fontSizePx -= 1
  ) {
    const lines = fits(fontSizePx);
    if (lines) return { fontSizePx, lines, fitted: true };
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
    lines: wrapText(loaded, text, boxWidthPx, minFontSizePx),
    fitted: false,
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
  loaded: LoadedFont;
  /** Bubble.fontColor — a validated 6-digit hex string, e.g. "#1a1a1a". */
  fill: string;
  /** Bubble.textAlign — horizontal placement of each line within the box. */
  align: TextAlign;
  /** Bubble.textVerticalAlign — placement of the whole line block in the box. */
  verticalAlign: TextVerticalAlign;
};

/**
 * Render the wrapped lines as a single <path> of glyph outlines, placed inside
 * the bubble box according to the bubble's horizontal and vertical alignment.
 *
 * There is no <text>, no font-family and no @font-face here by design — the
 * output depends on nothing installed on the host. Note also that no
 * user-supplied string reaches the SVG any more: path data is pure numbers and
 * `fill` is a hex colour the Zod schema has already matched against
 * /^#[0-9a-f]{6}$/ — neither can carry a quote or an angle bracket, so the
 * XML-escaping hazard that used to require escapeXml() is gone entirely.
 */
function buildBubbleSvg(inputs: BubbleSvgInputs): string {
  const {
    widthPx,
    heightPx,
    lines,
    fontSizePx,
    loaded,
    fill,
    align,
    verticalAlign,
  } = inputs;
  const { lineHeightPx, ascenderPx, leadingPx } = lineMetrics(
    loaded.font,
    fontSizePx,
  );

  // Place the block of lines vertically, then drop to the first baseline.
  // MIDDLE reproduces the old unconditional behaviour exactly.
  const blockHeightPx = lines.length * lineHeightPx;
  const blockTopPx =
    verticalAlign === "TOP"
      ? 0
      : verticalAlign === "BOTTOM"
        ? heightPx - blockHeightPx
        : (heightPx - blockHeightPx) / 2;
  const firstBaselineY = blockTopPx + leadingPx / 2 + ascenderPx;

  // Each line is placed on its own measured width — <path> has no text-anchor,
  // so horizontal alignment is arithmetic we do per line rather than an
  // attribute. Doing it per line (not once for the widest) is what gives a
  // left-aligned paragraph a straight left edge.
  const pathData = lines
    .map((line, index) => {
      const lineWidthPx = measureWidth(loaded, line, fontSizePx);
      const x =
        align === "LEFT"
          ? 0
          : align === "RIGHT"
            ? widthPx - lineWidthPx
            : (widthPx - lineWidthPx) / 2;
      const baselineY = firstBaselineY + index * lineHeightPx;

      return buildLinePathData(loaded, line, x, baselineY, fontSizePx);
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
  const fontCache = new Map<string, LoadedFont>();

  for (const bubble of bubbles) {
    if (!bubble.font) continue;
    if (fontCache.has(bubble.font.fileUrl)) continue;

    const fontBuffer = await downloadFileToBuffer("private", bubble.font.fileUrl);
    const font = parseFont(fontBuffer, bubble.font.name, bubble.font.fileUrl);

    // Probe for shaper compatibility here, once, while we hold the font — not
    // lazily at the first measurement. fitTextToBox measures the same font
    // hundreds of times per bubble, and this answer never changes.
    fontCache.set(bubble.font.fileUrl, {
      font,
      name: bubble.font.name,
      canShape: detectShapingSupport(font, bubble.font.name, bubble.font.fileUrl),
    });
  }

  // --- Build a composite entry per bubble ---
  const composites: OverlayOptions[] = [];

  for (const bubble of bubbles) {
    // 1. Substitute tokens, then apply the bubble's casing.
    //
    // Order matters and this is the only correct place for it. Everything
    // downstream — the glyph-coverage guard, the width measurements that drive
    // wrapping, and the shrink loop that fits the text to its box — has to see
    // the exact characters that will be drawn. Casing anywhere later would
    // verify and measure one string while painting another.
    //
    // The transform covers the substituted child name too: "keep this bubble in
    // caps" means the whole line, not everything except the name.
    const finalText = applyTextCase(
      substituteTokens(bubble.dialogue, childName, pronounKey).trim(),
      bubble.textCase,
    );

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

    const loaded = fontCache.get(bubble.font.fileUrl)!;

    // Coverage is checked against the character map, which is exactly what the
    // unshaped path renders from — so this guard stays accurate on both routes.
    assertGlyphCoverage(loaded.font, finalText, bubble.font.name);

    // 3. Convert normalized coords to pixels
    const xPx = Math.round(bubble.x * page.artworkWidth);
    const yPx = Math.round(bubble.y * page.artworkHeight);
    const widthPx = Math.round(bubble.width * page.artworkWidth);
    const heightPx = Math.round(bubble.height * page.artworkHeight);
    const initialFontSizePx = bubble.fontSize * page.artworkHeight;

    // 4. Fit text into the bubble using real metrics
    const { fontSizePx, lines, fitted } = fitTextToBox(
      loaded,
      finalText,
      widthPx,
      heightPx,
      initialFontSizePx,
      page.artworkHeight,
    );

    if (lines.length === 0) continue;

    // --- Layout diagnostics ---
    //
    // Every number the renderer actually decided with, in one line. This exists
    // because a bubble that renders wrong gives you only an image to work from,
    // and reverse-engineering these values by measuring pixels is slow and
    // ambiguous — two different causes (a box too narrow vs. a measurement that
    // under-reports) produce the same looking output.
    //
    // The three that matter most when text comes out truncated:
    //   fitted            false means nothing fitted and this is the floor size
    //   overflowPx        > 0 means the text is wider than its own SVG canvas,
    //                     and buildBubbleSvg will clip whatever spills past it
    //   artworkWidth/Height  the DB's idea of the artwork size; every box and
    //                     font-size number below is derived from these, so if
    //                     they disagree with the real file everything downstream
    //                     is wrong in a way no other log would reveal.
    const measuredWidthPx = Math.max(
      ...lines.map((line) => measureWidth(loaded, line, fontSizePx)),
    );
    const blockHeightPx = lines.length * lineMetrics(loaded.font, fontSizePx).lineHeightPx;

    // Deliberately `info`, not `debug`: the logger runs at level "info" whenever
    // NODE_ENV is production (see lib/logger.ts), so a debug line here would be
    // invisible in exactly the environment where a bad render is most expensive
    // to reproduce. One line per bubble is a fair price for that. Drop it to
    // debug once bubble geometry is no longer under investigation.
    logger.info(
      {
        pageId: page.id,
        bubbleId: bubble.id,
        fontName: bubble.font.name,
        canShape: loaded.canShape,

        // What we are drawing
        text: finalText.slice(0, 60),
        textLength: finalText.length,
        lines,

        // The DB's artwork dimensions — everything below is derived from these
        artworkWidth: page.artworkWidth,
        artworkHeight: page.artworkHeight,

        // Stored bubble geometry (normalized 0–1)
        bubble: {
          x: bubble.x,
          y: bubble.y,
          width: bubble.width,
          height: bubble.height,
          fontSize: bubble.fontSize,
        },

        // Placement and casing. Logged because they change both what is drawn
        // and how wide it measures — UPPERCASE in particular runs wider and can
        // push measuredWidthPx past boxWidthPx, which is the clip condition.
        textAlign: bubble.textAlign,
        textVerticalAlign: bubble.textVerticalAlign,
        textCase: bubble.textCase,

        // Resolved pixel geometry — boxWidthPx IS the SVG canvas width
        xPx,
        yPx,
        boxWidthPx: widthPx,
        boxHeightPx: heightPx,

        // Sizing decision
        initialFontSizePx,
        chosenFontSizePx: fontSizePx,
        fitted,

        // The comparison that decides whether anything gets clipped
        measuredWidthPx: Math.round(measuredWidthPx),
        overflowPx: Math.round(measuredWidthPx - widthPx),
        blockHeightPx: Math.round(blockHeightPx),
        verticalOverflowPx: Math.round(blockHeightPx - heightPx),
      },
      "Bubble layout resolved",
    );

    // 5. Build the SVG (glyph outlines)
    const svg = buildBubbleSvg({
      widthPx,
      heightPx,
      lines,
      fontSizePx,
      loaded,
      fill: bubble.fontColor,
      align: bubble.textAlign,
      verticalAlign: bubble.textVerticalAlign,
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
      // Names of any fonts rendered without shaping. Empty on a normal page.
      // Non-empty means those fonts lost ligatures — the page is correct but
      // plainer, and this is the breadcrumb that says which font to replace.
      unshapedFonts: [...fontCache.values()]
        .filter((entry) => !entry.canShape)
        .map((entry) => entry.name),
      bubblesStamped: composites.length,
    },
    "Text stamped onto page",
  );

  return stampedBuffer;
}
