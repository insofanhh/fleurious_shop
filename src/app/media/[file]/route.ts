import { readFile } from "node:fs/promises";
import path from "node:path";
import { db } from "@/lib/db";
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ file: string }> },
) {
  const { file } = await params;
  if (!/^[a-f0-9-]{36}\.webp$/.test(file))
    return new Response("Not found", { status: 404 });
  try {
    const bytes =
      process.env.VERCEL === "1"
        ? (await db.mediaAsset.findUniqueOrThrow({ where: { id: file } })).data
        : await readFile(path.join(process.cwd(), "storage", "uploads", file));
    return new Response(bytes, {
      headers: {
        "Content-Type": "image/webp",
        "Cache-Control": "public, max-age=31536000, immutable",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    return new Response("Not found", { status: 404 });
  }
}
