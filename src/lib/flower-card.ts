import { readFile } from "node:fs/promises";
import path from "node:path";
import * as fontkit from "fontkit";
import QRCode from "qrcode";
import sharp from "sharp";
import { BRAND_OUTLINE, BRAND_VIEW_BOX } from "./brand";

import { CARD_DPI, CARD_SIZES, type CardWritingMode } from "./card-design";

export const CARD = {
  ...CARD_SIZES.front,
  qrSize: 34,
  quietZone: 4,
  dpi: CARD_DPI,
} as const;
export type FlowerCard = {
  code: string;
  buyerName: string;
  recipientName: string;
  message: string;
  qrUrl: string;
  writingMode?: CardWritingMode;
};
export type CardFace = "front" | "back";
export type CardTemplate = "blank" | "brand";
type Fonts = { sans: fontkit.Font; serif: fontkit.Font; italic: fontkit.Font };
let fontsPromise: Promise<Fonts> | undefined;
function fonts() {
  return (fontsPromise ??= (async () => {
    const load = async (name: string) =>
      fontkit.create(
        await readFile(path.join(process.cwd(), "public/fonts", name)),
      ) as fontkit.Font;
    const [sans, serif, italic] = await Promise.all([
      load("BeVietnamPro-Regular.ttf"),
      load("Lora-Regular.ttf"),
      load("Lora-Italic.ttf"),
    ]);
    return { sans, serif, italic };
  })());
}
const wine = "#6e1423",
  cream = "#f4eade",
  ink = "#54232b";
function width(text: string, font: fontkit.Font, size: number) {
  return (
    (font.layout(text).positions.reduce((sum, pos) => sum + pos.xAdvance, 0) *
      size) /
    font.unitsPerEm
  );
}
function wrap(
  text: string,
  font: fontkit.Font,
  size: number,
  maxWidth: number,
) {
  const lines: string[] = [];
  for (const paragraph of text.replace(/\r\n/g, "\n").split("\n")) {
    if (!paragraph.trim()) {
      lines.push("");
      continue;
    }
    let line = "";
    for (const word of paragraph.trim().split(/\s+/)) {
      if (width(line ? `${line} ${word}` : word, font, size) <= maxWidth) {
        line = line ? `${line} ${word}` : word;
        continue;
      }
      if (line) {
        lines.push(line);
        line = "";
      }
      for (const char of word) {
        if (line && width(line + char, font, size) > maxWidth) {
          lines.push(line);
          line = "";
        }
        line += char;
      }
    }
    if (line) lines.push(line);
  }
  return lines;
}
// Outline typography so previews and exported images retain Vietnamese glyphs without installed fonts.
function lettering(
  text: string,
  font: fontkit.Font,
  size: number,
  x: number,
  y: number,
  color: string,
  align: "left" | "center" | "right" = "left",
) {
  const run = font.layout(text),
    scale = size / font.unitsPerEm;
  const advance = run.positions.reduce((sum, p) => sum + p.xAdvance, 0) * scale;
  let cursor =
    align === "center" ? x - advance / 2 : align === "right" ? x - advance : x;
  return run.glyphs
    .map((glyph, i) => {
      const pos = run.positions[i];
      const svg = `<path transform="translate(${cursor + pos.xOffset * scale} ${y - pos.yOffset * scale}) scale(${scale} ${-scale})" fill="${color}" d="${glyph.path.toSVG()}"/>`;
      cursor += pos.xAdvance * scale;
      return svg;
    })
    .join("");
}
function block(
  text: string,
  font: fontkit.Font,
  maxSize: number,
  minSize: number,
  x: number,
  y: number,
  maxWidth: number,
  maxHeight: number,
  color: string,
  align: "left" | "center" | "right" = "left",
) {
  let size = maxSize,
    lines = wrap(text, font, size, maxWidth);
  while (size > minSize && lines.length * size * 1.5 > maxHeight) {
    size = Math.max(minSize, size - 0.1);
    lines = wrap(text, font, size, maxWidth);
  }
  if (lines.length * size * 1.5 > maxHeight)
    lines = wrap(text.replace(/\s+/g, " "), font, size, maxWidth);
  // Full text is retained: long messages are fitted rather than silently truncated.
  while (lines.length * size * 1.5 > maxHeight && size > 1.7) {
    size -= 0.05;
    lines = wrap(text.replace(/\s+/g, " "), font, size, maxWidth);
  }
  return lines
    .map((line, i) =>
      lettering(line, font, size, x, y + i * size * 1.5, color, align),
    )
    .join("");
}
function mark(
  x: number,
  y: number,
  w: number,
  h: number,
  color: string,
  opacity = 1,
) {
  return `<svg x="${x}" y="${y}" width="${w}" height="${h}" viewBox="${BRAND_VIEW_BOX}" opacity="${opacity}"><path d="${BRAND_OUTLINE}" fill="${color}" fill-rule="evenodd"/></svg>`;
}
function qr(url: string, x: number, y: number) {
  const matrix = QRCode.create(url, { errorCorrectionLevel: "M" }).modules;
  const count = matrix.size + CARD.quietZone * 2,
    unit = CARD.qrSize / count;
  let modules = "";
  for (let row = 0; row < matrix.size; row++)
    for (let col = 0; col < matrix.size; col++)
      if (matrix.get(row, col))
        modules += `<rect x="${(col + CARD.quietZone) * unit}" y="${(row + CARD.quietZone) * unit}" width="${unit + 0.002}" height="${unit + 0.002}"/>`;
  return `<g transform="translate(${x} ${y})"><rect width="${CARD.qrSize}" height="${CARD.qrSize}" fill="#ffffff"/><g fill="#29191d" shape-rendering="crispEdges">${modules}</g></g>`;
}
function svgDocument(
  kind: keyof typeof CARD_SIZES,
  title: string,
  body: string,
) {
  const { width: w, height: h } = CARD_SIZES[kind];
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}mm" height="${h}mm" viewBox="0 0 ${w} ${h}"><title>${title}</title>${body}</svg>`;
}
function renderLetterCard(f: Fonts, card?: FlowerCard) {
  const handwritten = !card || card.writingMode === "HANDWRITTEN";
  return svgDocument(
    card ? "front" : "blank",
    !card
      ? "Fleurious · Phôi thiệp viết tay"
      : handwritten
        ? "Fleurious · Thiệp viết tay"
        : "Fleurious · Thiệp lời nhắn",
    `
    <rect width="74" height="105" fill="${cream}"/>
    <path d="M0 0H74V24C51 28 21 19 0 25Z" fill="${wine}"/>
    ${mark(9, 7, 5, 7, cream)}${lettering("fleurious.", f.serif, 6, 16, 13, cream)}
    ${lettering("MỘT LỜI THƯƠNG, GỬI BẰNG HOA", f.sans, 1.85, 37, 30, wine, "center")}
    ${block(card ? `Gửi ${card.recipientName || "người thương"},` : "Gửi", f.italic, 5, 3, 9, 39, 56, 8, wine, "left")}
    ${handwritten ? "" : `<path d="M30 44H44" stroke="#bd9486" stroke-width=".25"/>${block(card.message.trim() || "Mong những đóa hoa này mang đến bạn một ngày thật dịu dàng.", f.serif, 3.35, 2.45, 37, 51, 54, 32, ink, "center")}`}
    ${lettering("THƯƠNG GỬI TỪ", f.sans, 1.75, 65, 88, wine, "right")}
    ${card ? block(card.buyerName, f.italic, 3.7, 2.5, 65, 93, 54, 7, wine, "right") : ""}
    <path d="M9 100H65" stroke="#cdb3a1" stroke-width=".2"/>
  `,
  );
}
export async function renderFlowerCard(card: FlowerCard, side: CardFace) {
  const f = await fonts();
  if (side === "back") {
    return svgDocument(
      "back",
      "Fleurious · Card QR giữ chuỗi",
      `
      <rect width="90" height="50" fill="${cream}"/>
      <rect width="47" height="50" fill="${wine}"/>
      ${mark(6, 6, 4.5, 6.5, cream)}
      ${lettering("fleurious.", f.serif, 4.7, 12, 11.8, cream)}
      ${lettering("“Giữ lại một", f.serif, 4, 6.5, 27, cream)}
      ${lettering("ngày có hoa.”", f.italic, 4, 6.5, 34, cream)}
      ${qr(card.qrUrl, 51, 8)}
      ${lettering("Quét mã giữ chuỗi & nhận ưu đãi", f.sans, 1.8, 86, 46, wine, "right")}
    `,
    );
  }
  return renderLetterCard(f, card);
}
export async function renderCardTemplate(kind: CardTemplate) {
  const f = await fonts();
  if (kind === "brand") {
    const logoX = (60 - (7.5 + 2 + width("fleurious.", f.serif, 7.6))) / 2;
    return svgDocument(
      "brand",
      "Fleurious · Card thương hiệu",
      `
    <rect width="60" height="60" fill="${wine}"/>
    ${mark(logoX, 23, 7.5, 10.5, cream)}${lettering("fleurious.", f.serif, 7.6, logoX + 9.5, 31, cream)}
  `,
    );
  }
  return renderLetterCard(f);
}
async function png(svg: string, kind: keyof typeof CARD_SIZES) {
  const { width, height } = CARD_SIZES[kind];
  const w = Math.round((width / 25.4) * CARD_DPI),
    h = Math.round((height / 25.4) * CARD_DPI);
  const raster = svg.replace(
    `width="${width}mm" height="${height}mm"`,
    `width="${w}px" height="${h}px"`,
  );
  return sharp(Buffer.from(raster), { density: 72 })
    .withMetadata({ density: CARD_DPI })
    .png()
    .toBuffer();
}
export async function flowerCardPng(card: FlowerCard, side: CardFace) {
  return png(await renderFlowerCard(card, side), side);
}
export async function cardTemplatePng(kind: CardTemplate) {
  return png(await renderCardTemplate(kind), kind);
}
