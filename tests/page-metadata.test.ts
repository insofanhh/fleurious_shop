import test from "node:test";
import assert from "node:assert/strict";
import {
  HOME_SEARCH_TITLE,
  pageTitles,
  publicPageMetadata,
} from "../src/lib/page-metadata";

test("homepage and every public route have a concrete title and matching social title", () => {
  for (const segments of [
    [],
    ...Object.keys(pageTitles).map((p) => [p]),
    ["collections", "sinh-nhat"],
    ["custom-journal"],
  ]) {
    const metadata = publicPageMetadata(segments);
    const title = (metadata.title as { absolute: string }).absolute;
    assert.ok(title.trim().length > 0);
    assert.ok(!title.includes("undefined"));
    assert.equal(metadata.openGraph?.title, title);
    assert.equal(metadata.twitter?.title, title);
  }
  assert.equal(
    (publicPageMetadata([]).title as { absolute: string }).absolute,
    HOME_SEARCH_TITLE,
  );
});
test("product and CMS content keep their actual names, descriptions and safe fallbacks", () => {
  assert.deepEqual(
    publicPageMetadata(["about"], { title: "Chuyện của hoa và Fleurious" })
      .title,
    { absolute: "Chuyện của hoa và Fleurious" },
  );
  const product = publicPageMetadata(["flowers", "burgundy"], {
    title: "Burgundy Whisper",
    description: " Một lời yêu.\n Hoa tươi. ",
  });
  assert.deepEqual(product.title, { absolute: "Burgundy Whisper · Fleurious" });
  assert.equal(product.description, "Một lời yêu. Hoa tươi.");
  assert.deepEqual(
    publicPageMetadata(["about"], { title: "Chuyện của tiệm hoa" }).title,
    { absolute: "Chuyện của tiệm hoa · Fleurious" },
  );
  assert.ok(publicPageMetadata(["privacy"], { title: " " }).title);
});
test("SEO metadata retains noindex for private flows while public pages stay indexable", () => {
  for (const segments of [
    ["account"],
    ["orders", "id"],
    ["checkout"],
    ["favorites"],
    ["membership", "invoices", "id"],
  ])
    assert.deepEqual(publicPageMetadata(segments).robots, {
      index: false,
      follow: false,
    });
  for (const segments of [[], ["about"], ["flowers"], ["membership"]])
    assert.equal(publicPageMetadata(segments).robots, undefined);
});
