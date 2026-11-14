import { mkdir, writeFile } from "node:fs/promises";
const assets: Record<string, string> = {
  roses: "photo-1525310072745-f49212b5ac6d",
  white: "photo-1490750967868-88aa4486c946",
  pink: "photo-1563241527-3004b7be0ffd",
  yellow: "photo-1470509037663-253afd7f0f51",
  soft: "photo-1457089328109-e5d9bd499191",
  lilac: "photo-1468327768560-75b778cbb551",
  garden: "photo-1462275646964-a0e3386b89fa",
  wishes: "photo-1520763185298-1b434c919102",
};
async function main() {
  await mkdir("public/images", { recursive: true });
  for (const [name, id] of Object.entries(assets)) {
    const response = await fetch(
      `https://images.unsplash.com/${id}?auto=format&fit=crop&w=1200&q=85&fm=webp`,
    );
    if (!response.ok) throw new Error(`${name}: ${response.status}`);
    await writeFile(
      `public/images/${name}.webp`,
      Buffer.from(await response.arrayBuffer()),
    );
    console.log(`Downloaded ${name}`);
  }
}
main();
