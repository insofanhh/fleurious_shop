import sharp from "sharp";
import { mkdir, writeFile } from "node:fs/promises";
import { BRAND_OUTLINE, BRAND_VIEW_BOX } from "../src/lib/brand";

const silhouette = `<path fill="#f4eade" fill-rule="evenodd" d="${BRAND_OUTLINE}"/>`;
const icon = (maskable = false) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><rect width="512" height="512" rx="${maskable ? 0 : 104}" fill="#6e1423"/><svg x="${maskable ? 119 : 94}" y="${maskable ? 66 : 40}" width="${maskable ? 274 : 324}" height="${maskable ? 380 : 432}" viewBox="${BRAND_VIEW_BOX}">${silhouette}</svg></svg>`;

async function main() {
  await mkdir("public/icons", { recursive: true });
  await writeFile(
    "public/logo.svg",
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${BRAND_VIEW_BOX}"><path fill="#6e1423" fill-rule="evenodd" d="${BRAND_OUTLINE}"/></svg>`,
  );
  await writeFile("public/icon.svg", icon());
  for (const [name, size, maskable] of [
    ["icon-192.png", 192, false],
    ["icon-512.png", 512, false],
    ["maskable-512.png", 512, true],
    ["apple-touch-icon.png", 180, true],
    ["favicon-32.png", 32, false],
  ] as const) {
    await sharp(Buffer.from(icon(maskable)))
      .resize(size, size)
      .png()
      .toFile(`public/icons/${name}`);
  }
  const png = await sharp(Buffer.from(icon())).resize(32, 32).png().toBuffer();
  const header = Buffer.alloc(22);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(1, 4);
  header[6] = 32;
  header[7] = 32;
  header.writeUInt16LE(1, 10);
  header.writeUInt16LE(32, 12);
  header.writeUInt32LE(png.length, 14);
  header.writeUInt32LE(22, 18);
  await writeFile("public/favicon.ico", Buffer.concat([header, png]));
  console.log("Generated Fleurious logo, favicon, Apple and PWA icons.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
