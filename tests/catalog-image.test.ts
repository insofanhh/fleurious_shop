import test from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import {
  optimizeCatalogImage,
  storeCatalogImage,
  MAX_IMAGE_BYTES,
} from "../src/lib/catalog-image";
test("uploads become WebP, retain their aspect ratio and strip metadata", async () => {
  const source = await sharp({
    create: { width: 2400, height: 3000, channels: 3, background: "#6e1423" },
  })
    .jpeg()
    .toBuffer();
  const result = await optimizeCatalogImage(source, "image/jpeg"),
    meta = await sharp(result).metadata();
  assert.equal(meta.format, "webp");
  assert.equal(meta.width, 1600);
  assert.equal(meta.height, 2000);
  assert.equal(meta.exif, undefined);
});
test("invalid or oversized images fail before reaching Blob storage", async () => {
  await assert.rejects(
    () => optimizeCatalogImage(Buffer.from("not an image"), "image/jpeg"),
    { code: "INVALID_IMAGE" },
  );
  await assert.rejects(
    () => optimizeCatalogImage(Buffer.from("<svg/>"), "image/svg+xml"),
    { code: "INVALID_IMAGE" },
  );
  await assert.rejects(
    () => optimizeCatalogImage(Buffer.alloc(MAX_IMAGE_BYTES + 1), "image/png"),
    { code: "FILE_TOO_LARGE" },
  );
});
test("missing Blob configuration never silently writes images to another backend", async (t) => {
  const previous = process.env.BLOB_READ_WRITE_TOKEN;
  delete process.env.BLOB_READ_WRITE_TOKEN;
  t.after(() => {
    if (previous === undefined) delete process.env.BLOB_READ_WRITE_TOKEN;
    else process.env.BLOB_READ_WRITE_TOKEN = previous;
  });
  await assert.rejects(() => storeCatalogImage(Buffer.from("sample")), {
    code: "BLOB_UNAVAILABLE",
  });
});
