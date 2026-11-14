import { writeFile } from "node:fs/promises";
import sharp from "sharp";
import { renderCardTemplate } from "../src/lib/flower-card";
import { BRAND_SHARE_IMAGE } from "../src/lib/social-metadata";

async function main() {
  // Reuse the exact logo card artwork, extending its burgundy background for link previews.
  // The centered square also keeps the complete logo visible in square thumbnail crops.
  const card = (await renderCardTemplate("brand")).replace(
    'width="60mm" height="60mm"',
    'x="285" y="0" width="630" height="630"',
  );
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630"><rect width="1200" height="630" fill="#6e1423"/>${card}</svg>`;
  const png = await sharp(Buffer.from(svg))
    .png({ compressionLevel: 9 })
    .toBuffer();
  await writeFile(`public${BRAND_SHARE_IMAGE}`, png);
  console.log(
    `Created ${BRAND_SHARE_IMAGE}: 1200 × 630 PNG (${png.length} bytes)`,
  );
}
main();
