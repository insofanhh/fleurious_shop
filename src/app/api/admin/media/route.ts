import { NextRequest } from "next/server";
import {
  optimizeCatalogImage,
  storeCatalogImage,
  MAX_IMAGE_BYTES,
  IMAGE_TYPES,
} from "@/lib/catalog-image";
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
    if (Number(request.headers.get("content-length") ?? 0) > 4.4 * 1024 * 1024)
      fail("FILE_TOO_LARGE", "Ảnh tối đa 4 MB.", 413);
    if (!request.headers.get("content-type")?.startsWith("multipart/form-data"))
      fail("INVALID_CONTENT_TYPE", "Chọn một ảnh để tải lên.", 415);
    const reader = request.body?.getReader();
    if (!reader) fail("INVALID_IMAGE", "Chưa có ảnh để tải lên.");
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 4.4 * 1024 * 1024) {
        await reader.cancel();
        fail("FILE_TOO_LARGE", "Ảnh tối đa 4 MB.", 413);
      }
      chunks.push(value);
    }
    const form = await new Request(request.url, {
      method: "POST",
      headers: { "Content-Type": request.headers.get("content-type")! },
      body: Buffer.concat(chunks),
    }).formData();
    const file = form.get("file");
    if (
      !(file instanceof File) ||
      file.size > MAX_IMAGE_BYTES ||
      !IMAGE_TYPES.includes(file.type)
    )
      fail("INVALID_IMAGE", "Chọn ảnh JPG, PNG hoặc WebP, tối đa 4 MB.");
    const buffer = await optimizeCatalogImage(
      new Uint8Array(await file.arrayBuffer()),
      file.type,
    );
    const blob = await storeCatalogImage(buffer);
    await dbAudit(user.id, blob.pathname);
    return json({ url: blob.url, size: buffer.length }, 201);
  });
}
async function dbAudit(actorId: string, name: string) {
  const { db } = await import("@/lib/db");
  await db.audit.create({
    data: { actorId, action: "media.upload", entityId: name, detail: {} },
  });
}
