// will hold the Sharp text renderer

import sharp, { type OverlayOptions } from "sharp";
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
 * Break a string into lines that each fit within `maxCharsPerLine`.
 * Splits on whitespace only — words are never split mid-character.
 * A single word longer than the limit goes onto its own line and overflows.
 */

function wrapText(text: string, maxCharsPerLine: number): string[] {
  if (maxCharsPerLine < 1) return [text]; // guard against pathological input

  const words = text.split(/\s+/); // split on any whitespace
  const lines: string[] = [];
  let current = "";

  for (const word of words) {
    // would adding this word push us past the limit
    const candidate = current ? `${current} ${word}` : word;

    if (candidate.length <= maxCharsPerLine) {
      current = candidate;
    } else {
      // Push what we have, start a new line with this word
      if (current) lines.push(current);
      current = word;
    }
  }

  // Don't forget the last line
  if (current) lines.push(current);

  return lines;

}


type FittedText = {
  fontSizePx: number;
  lines: string[];
};

/**
 * Try progressively smaller font sizes until wrapped text fits inside the box.
 * Returns the largest size that works, along with the wrapped lines at that size.
 * Never shrinks below MIN_FONT_SIZE_PX — if it hits that floor and still doesn't
 * fit, returns text at the floor size (will visually overflow) and logs a warning.
 */
function fitTextToBox(
  text: string,
  boxWidth: number,
  boxHeight: number,
  initialFontSizePx: number,
  artworkHeight: number, // used to compute the pixel floor
): FittedText {
  const minFontSizePx = MIN_FONT_SIZE * artworkHeight;
  const lineHeightFactor = 1.2; // 20% extra between lines

  let fontSizePx = initialFontSizePx;

  while (fontSizePx >= minFontSizePx) {
    // Rough char width — good enough for MVP. See notes below.
    const avgCharWidthPx = fontSizePx * 0.6;
    const maxCharsPerLine = Math.max(1, Math.floor(boxWidth / avgCharWidthPx));

    const lines = wrapText(text, maxCharsPerLine);
    const totalHeightPx = lines.length * fontSizePx * lineHeightFactor;

    if (totalHeightPx <= boxHeight) {
      return { fontSizePx, lines };
    }

    // Text doesn't fit — try one pixel smaller
    fontSizePx -= 1;
  }

  // Hit the floor and still doesn't fit. Return anyway, warn about it.
  logger.warn(
    { text: text.substring(0, 40), boxWidth, boxHeight, minFontSizePx },
    "Text does not fit in bubble even at minimum font size — will overflow",
  );

  const avgCharWidthPx = minFontSizePx * 0.6;
  const maxCharsPerLine = Math.max(1, Math.floor(boxWidth / avgCharWidthPx));
  return {
    fontSizePx: minFontSizePx,
    lines: wrapText(text, maxCharsPerLine),
  };
}


/**
 * Escape characters that have special meaning in XML/SVG.
 * Without this, dialogue like "You & me" produces broken SVG that Sharp
 * silently fails to render.
 */
function escapeXml(s: string): string {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

type BubbleSvgInputs = {
  widthPx: number;
  heightPx: number;
  lines: string[];
  fontSizePx: number;
  fontFamily: string;
  fontBase64: string;
  fontFormat: "truetype" | "opentype";
};


function buildBubbleSvg(inputs: BubbleSvgInputs): string {
  const { widthPx, heightPx, lines, fontSizePx, fontFamily, fontBase64, fontFormat } = inputs;
  const lineHeightPx = fontSizePx * 1.2;

  // Total vertical space the text will occupy
  const totalTextHeightPx = lines.length * lineHeightPx;
  // Vertical position of the FIRST line's baseline, so text is centered
  const firstLineY = (heightPx - totalTextHeightPx) / 2 + fontSizePx;

  const textLines = lines
    .map((line, index) => {
      const dy = index === 0 ? 0 : lineHeightPx;
      return `<tspan x="${widthPx / 2}" dy="${dy}">${escapeXml(line)}</tspan>`;
    })
    .join("");

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${widthPx}" height="${heightPx}" viewBox="0 0 ${widthPx} ${heightPx}">
    <defs>
      <style>
        @font-face {
          font-family: "${fontFamily}";
          src: url(data:font/${fontFormat};base64,${fontBase64});
        }
        .txt {
          font-family: "${fontFamily}", sans-serif;
          font-size: ${fontSizePx}px;
          fill: black;
          text-anchor: middle;
        }
      </style>
    </defs>
    <text x="${widthPx / 2}" y="${firstLineY}" class="txt">
      ${textLines}
    </text>
  </svg>`;
}


function detectFontFormat(key: string): "truetype" | "opentype" {
  // The R2 key ends with .ttf, .otf, .woff, or .woff2 (validator enforces this)
  if (key.endsWith(".otf")) return "opentype";
  return "truetype";
}

/**
 * Stamp personalized dialogue onto a page's artwork.
 *
 * Downloads the artwork and every font referenced by the page's bubbles,
 * substitutes tokens ({name}, {pronoun_*}) with real values, fits and wraps
 * text to each bubble, then composites all bubble SVGs onto the artwork in
 * one Sharp operation.
 *
 * Returns the resulting PNG buffer. Does NOT upload — Part E does that.
 */


export async function stampTextOnPage(params: StampTextParams): Promise<Buffer> {
    const { page, bubbles, childName, pronounKey } = params;

    // --- Guard the invariants Part E should have already checked, but defense in depth ---
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

  // --- Download every font referenced, cached by key ---
  const fontCache = new Map<string, string>(); // key -> base64

  for (const bubble of bubbles) {
    if (!bubble.font) continue; // bubble has no font — will fall back to sans-serif
    if (fontCache.has(bubble.font.fileUrl)) continue; // already downloaded

    const fontBuffer = await downloadFileToBuffer("private", bubble.font.fileUrl);
    fontCache.set(bubble.font.fileUrl, fontBuffer.toString("base64"));
  }

  // --- Build a composite entry per bubble ---
  const composites: OverlayOptions[] = [];

  for(const bubble of bubbles) {
    // 1. Substitute tokens
    const finalText = substituteTokens(bubble.dialogue, childName, pronounKey);

    // 2. Convert normalized coords to pixels
    const xPx = Math.round(bubble.x * page.artworkWidth);
    const yPx = Math.round(bubble.y * page.artworkHeight);
    const widthPx = Math.round(bubble.width * page.artworkWidth);
    const heightPx = Math.round(bubble.height * page.artworkHeight);
    const initialFontSizePx = bubble.fontSize * page.artworkHeight;

    // 3. Fit text into the bubble
    const { fontSizePx, lines } = fitTextToBox(
      finalText,
      widthPx,
      heightPx,
      initialFontSizePx,
      page.artworkHeight,
    );

    // 4. Prepare font info (or fallback if bubble has no font)
    const fontBase64 = bubble.font ? fontCache.get(bubble.font.fileUrl)! : "";
    const fontFamily = bubble.font?.name ?? "sans-serif";
    const fontFormat = bubble.font
      ? detectFontFormat(bubble.font.fileUrl)
      : "truetype";

    // 5. Build the SVG
    const svg = buildBubbleSvg({
      widthPx,
      heightPx,
      lines,
      fontSizePx,
      fontFamily,
      fontBase64,
      fontFormat,
    });

    composites.push({
      input: Buffer.from(svg),
      top: yPx,
      left: xPx,
    });
  }

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
    },
    "Text stamped onto page",
  );

  return stampedBuffer;
}


