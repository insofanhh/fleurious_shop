import { mkdir, writeFile } from "node:fs/promises";
import {
  flowerCardPng,
  renderFlowerCard,
  cardTemplatePng,
  renderCardTemplate,
  type FlowerCard,
} from "../src/lib/flower-card";
async function main() {
  const card: FlowerCard = {
    code: "FLRDEMO20261114",
    buyerName: "An Nhiên",
    recipientName: "Anh Hà",
    message: "Hôm nay mừng em lên sếp.\nChúc em luôn có những ngày nở hoa!",
    qrUrl: `https://fleurious.example/q/${"a".repeat(64)}`,
  };
  await mkdir("output/cards", { recursive: true });
  for (const [name, side, writingMode] of [
    ["message", "front", "AUTO"],
    ["handwritten", "front", "HANDWRITTEN"],
    ["streak-qr", "back", "AUTO"],
  ] as const) {
    const data = { ...card, writingMode };
    await writeFile(
      `output/cards/fleurious-${name}.png`,
      await flowerCardPng(data, side),
    );
    await writeFile(
      `output/cards/fleurious-${name}.svg`,
      await renderFlowerCard(data, side),
    );
  }
  for (const kind of ["blank", "brand"] as const) {
    await writeFile(
      `output/cards/fleurious-${kind}.png`,
      await cardTemplatePng(kind),
    );
    await writeFile(
      `output/cards/fleurious-${kind}.svg`,
      await renderCardTemplate(kind),
    );
  }
  console.log("Rendered 5 PNG and 5 SVG card samples in output/cards");
}
main();
