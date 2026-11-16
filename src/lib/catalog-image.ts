import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { put } from "@vercel/blob";
import { fail } from "./errors";

export const MAX_IMAGE_BYTES = 4 * 1024 * 1024;
export const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"];
export async function optimizeCatalogImage(bytes: Uint8Array, type: string) {
  if (!IMAGE_TYPES.includes(type))
    fail("INVALID_IMAGE", "Chọn ảnh JPG, PNG hoặc WebP.");
  if (bytes.byteLength > MAX_IMAGE_BYTES)
    fail("FILE_TOO_LARGE", "Ảnh tối đa 4 MB.", 413);
  if (!bytes.byteLength) fail("INVALID_IMAGE", "Ảnh đang trống.");
  try {
    const image = sharp(Buffer.from(bytes), { limitInputPixels: 40000000 });
    const meta = await image.metadata();
    if (!["jpeg", "png", "webp"].includes(meta.format ?? ""))
      throw new Error("Unsupported image");
    return await image
      .rotate()
      .resize({ width: 1600, withoutEnlargement: true })
      .webp({ quality: 85 })
      .toBuffer();
  } catch {
    fail(
      "INVALID_IMAGE",
      "Không đọc được ảnh. Chọn ảnh JPG, PNG hoặc WebP hợp lệ, tối đa 40 megapixel.",
    );
  }
}
export async function storeCatalogImage(buffer: Buffer) {
  const token = process.env.BLOB_READ_WRITE_TOKEN?.trim();
  if (!token)
    fail(
      "BLOB_UNAVAILABLE",
      "Chưa kết nối kho ảnh Vercel Blob. Kiểm tra BLOB_READ_WRITE_TOKEN trong môi trường chạy.",
      503,
    );
  const blob = await put(`images/${randomUUID()}.webp`, buffer, {
    token,
    access: "public",
    contentType: "image/webp",
    addRandomSuffix: false,
    cacheControlMaxAge: 31536000,
  });
  return blob;
}
