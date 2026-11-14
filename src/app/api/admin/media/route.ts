import { NextRequest } from "next/server";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { currentUser, can } from "@/lib/auth";
import { fail, handle, json, rateLimit } from "@/lib/api";
import { db } from "@/lib/db";
export async function POST(request: NextRequest) {
  return handle(async () => {
    if (
      request.headers.get("origin") !==
      new URL(process.env.APP_URL ?? request.url).origin
    )
      fail("INVALID_ORIGIN", "Yêu cầu không hợp lệ.", 403);
    const user = await currentUser();
    if (!user || !can(user.role, "products"))
      fail("FORBIDDEN", "Không có quyền tải ảnh.", 403);
    await rateLimit(`upload:${user.id}`, 10, 60);
    if (Number(request.headers.get("content-length") ?? 0) > 6 * 1024 * 1024)
      fail("FILE_TOO_LARGE", "Ảnh tối đa 5 MB.", 413);
    const form = await request.formData();
    const file = form.get("file");
    if (
      !(file instanceof File) ||
      file.size > 5 * 1024 * 1024 ||
      !["image/jpeg", "image/png", "image/webp"].includes(file.type)
    )
      fail("INVALID_IMAGE", "Chọn ảnh JPG, PNG hoặc WebP, tối đa 5 MB.");
    const buffer = await sharp(Buffer.from(await file.arrayBuffer()), {
      limitInputPixels: 40000000,
    })
      .rotate()
      .resize({ width: 1600, withoutEnlargement: true })
      .webp({ quality: 85 })
      .toBuffer();
    const name = `${randomUUID()}.webp`;
    if (process.env.VERCEL === "1") {
      await db.mediaAsset.create({ data: { id: name, data: buffer } });
    } else {
      const directory = path.join(process.cwd(), "storage", "uploads");
      await mkdir(directory, { recursive: true });
      await writeFile(path.join(directory, name), buffer);
    }
    await dbAudit(user.id, name);
    return json({ url: `/media/${name}` }, 201);
  });
}
async function dbAudit(actorId: string, name: string) {
  const { db } = await import("@/lib/db");
  await db.audit.create({
    data: { actorId, action: "media.upload", entityId: name, detail: {} },
  });
}
