export const taxonomyLabels = {
  CATEGORY: "Danh mục",
  SIZE: "Size",
  OCCASION: "Dịp tặng",
  COLOR: "Màu hoa",
  COLLECTION: "Bộ sưu tập",
} as const;
export type TaxonomyKind = keyof typeof taxonomyLabels;
export type CatalogueTaxonomy = {
  id: string;
  kind: string;
  name: string;
  slug: string;
  active: boolean;
};
export function catalogueSlug(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[đĐ]/g, "d")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 150)
    .replace(/-+$/g, "");
}
export function taxonomyOptions(
  items: CatalogueTaxonomy[],
  kind: TaxonomyKind,
  legacy: string[],
  current = "",
) {
  const hidden = new Set(
    items.filter((t) => t.kind === kind && !t.active).map((t) => t.name),
  );
  return [
    ...new Set([
      ...items.filter((t) => t.kind === kind && t.active).map((t) => t.name),
      ...legacy.filter((name) => name && !hidden.has(name)),
      ...(current ? [current] : []),
    ]),
  ];
}
