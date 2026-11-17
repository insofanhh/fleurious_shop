"use client";
import { useEffect, useState } from "react";
import { Check, Plus, RefreshCw, X } from "lucide-react";
import { request, useShop } from "./shop-provider";
import { ImageUpload } from "./ui/image-upload";
import { CreatableTaxonomy } from "./ui/creatable-taxonomy";
import { MultiTaxonomy } from "./ui/multi-taxonomy";
import { useAutoSlug } from "./ui/use-auto-slug";
import {
  taxonomyOptions,
  isDailyCategory,
  type CatalogueTaxonomy,
  type TaxonomyKind,
} from "@/lib/catalogue";
import type { Product } from "@/lib/types";

type VariantDraft = {
  id?: string;
  clientKey?: string;
  name: string;
  sku: string;
  price: string | number;
  stock: string | number;
  reserved?: number;
};
const newSku = () => `FL-${Date.now()}-${crypto.randomUUID().slice(0, 6)}`;
export function ProductEditor({
  initial,
  onSave,
  busy,
}: {
  initial: Partial<Product> & { daily?: boolean; dailyConfigured?: boolean };
  onSave: (data: Record<string, unknown>) => Promise<void>;
  busy: boolean;
}) {
  const { taxonomies, products, refreshCatalog } = useShop();
  const [registry, setRegistry] = useState<CatalogueTaxonomy[]>(taxonomies);
  const [registryError, setRegistryError] = useState("");
  const [creating, setCreating] = useState(0);
  const creatingChanged = (value: boolean) =>
    setCreating((n) => Math.max(0, n + (value ? 1 : -1)));
  const slug = useAutoSlug(initial.name, initial.slug, !!initial.id);
  const [image, setImage] = useState(initial.image ?? ""),
    [uploading, setUploading] = useState(false);
  const [categories, setCategories] = useState(
    initial.categories ??
      [
        initial.category ??
          taxonomies.find((t) => t.kind === "CATEGORY")?.name ??
          "",
      ].filter(Boolean),
  );
  const [occasions, setOccasions] = useState(
    initial.occasions ?? [
      initial.occasion ??
        taxonomies.find((t) => t.kind === "OCCASION")?.name ??
        "Sinh nhật",
    ],
  );
  const [colors, setColors] = useState(
    initial.colors ?? [
      initial.color ?? taxonomies.find((t) => t.kind === "COLOR")?.name ?? "Đỏ",
    ],
  );
  const daily = categories.some(isDailyCategory);
  const needsDailySize = daily && !initial.dailyConfigured;
  const [variants, setVariants] = useState<VariantDraft[]>(() =>
    (
      initial.variants ?? [
        {
          name: taxonomies.find((t) => t.kind === "SIZE")?.name ?? "Vừa xinh",
          sku: newSku(),
          price: 500000,
          stock: 20,
        },
      ]
    ).map((v) => ({ ...v, clientKey: crypto.randomUUID() })),
  );
  useEffect(() => {
    let active = true;
    request<CatalogueTaxonomy[]>("admin/taxonomies")
      .then((items) => {
        if (active) setRegistry(items);
      })
      .catch(() => {
        if (active)
          setRegistryError(
            "Chưa tải được danh mục mới nhất. Hãy đóng và mở lại form trước khi lưu.",
          );
      });
    return () => {
      active = false;
    };
  }, []);
  const options = (kind: TaxonomyKind, current = "") =>
    taxonomyOptions(
      registry,
      kind,
      kind === "SIZE"
        ? products.flatMap((p) => p.variants.map((v) => v.name))
        : products.flatMap((p) =>
            kind === "CATEGORY"
              ? (p.categories ?? [p.category])
              : kind === "OCCASION"
                ? (p.occasions ?? [p.occasion])
                : (p.colors ?? [p.color]),
          ),
      current,
    );
  const created = (item: CatalogueTaxonomy) => {
    setRegistry((items) => [...items.filter((t) => t.id !== item.id), item]);
    void refreshCatalog().catch(() => {});
  };
  const updateVariant = (
    index: number,
    key: keyof VariantDraft,
    value: string,
  ) =>
    setVariants((items) =>
      items.map((v, i) => (i === index ? { ...v, [key]: value } : v)),
    );
  return (
    <form
      className="form-stack product-editor"
      onSubmit={(e) => {
        e.preventDefault();
        const form = new FormData(e.currentTarget);
        void onSave({
          name: slug.name.trim(),
          slug: slug.slug,
          subtitle: form.get("subtitle"),
          description: form.get("description"),
          image,
          categories,
          occasions,
          colors,
          badge: form.get("badge"),
          active: form.has("active"),
          featured: form.has("featured"),
          variants: variants.map((v) => ({
            id: v.id,
            name: v.name,
            sku: v.sku,
            price: Number(v.price),
            stock: Number(v.stock),
          })),
        });
      }}
    >
      {registryError && (
        <p className="form-error" role="alert">
          {registryError}
        </p>
      )}
      <div className="two-columns">
        <label>
          Tên sản phẩm
          <input
            name="name"
            value={slug.name}
            onChange={(e) => slug.changeName(e.target.value)}
            required
            minLength={2}
            maxLength={120}
          />
        </label>
        <div className="catalog-slug-field">
          <label>
            Slug
            <input
              name="slug"
              value={slug.slug}
              onChange={(e) => slug.changeSlug(e.target.value)}
              required
              maxLength={150}
              pattern="[a-z0-9]+(-[a-z0-9]+)*"
            />
          </label>
          <button type="button" className="text-link" onClick={slug.resetSlug}>
            <RefreshCw size={13} /> Tạo lại từ tên
          </button>
        </div>
        <label className="catalog-full-width">
          Lời giới thiệu
          <input
            name="subtitle"
            defaultValue={initial.subtitle ?? ""}
            maxLength={200}
          />
        </label>
        <label className="catalog-full-width">
          Mô tả
          <textarea
            name="description"
            rows={4}
            defaultValue={initial.description ?? ""}
            maxLength={5000}
          />
        </label>
        <div className="catalog-full-width">
          <ImageUpload
            value={image}
            onChange={setImage}
            label="Ảnh sản phẩm"
            required
            onBusyChange={setUploading}
          />
        </div>
        <MultiTaxonomy
          kind="CATEGORY"
          values={categories}
          onChange={(values) => {
            setCategories(values);
            if (
              values.some(isDailyCategory) &&
              !initial.dailyConfigured &&
              !variants.some((v) => v.name === "Vừa xinh") &&
              variants.length < 10
            )
              setVariants((items) => [
                ...items,
                {
                  clientKey: crypto.randomUUID(),
                  name: "Vừa xinh",
                  sku: newSku(),
                  price: "",
                  stock: "",
                },
              ]);
          }}
          options={[...new Set([...options("CATEGORY"), ...categories])]}
          onCreated={created}
          onBusyChange={creatingChanged}
          disabled={busy}
        />
        <MultiTaxonomy
          kind="OCCASION"
          values={occasions}
          onChange={setOccasions}
          options={[...new Set([...options("OCCASION"), ...occasions])]}
          onCreated={created}
          onBusyChange={creatingChanged}
          disabled={busy}
        />
        <MultiTaxonomy
          kind="COLOR"
          values={colors}
          onChange={setColors}
          options={[...new Set([...options("COLOR"), ...colors])]}
          onCreated={created}
          onBusyChange={creatingChanged}
          disabled={busy}
        />
        <label>
          Nhãn
          <input
            name="badge"
            defaultValue={initial.badge ?? ""}
            maxLength={30}
            placeholder="Ví dụ: Mới, Hoa theo mùa…"
          />
        </label>
      </div>
      <div className="catalog-checkboxes">
        <label className="checkbox-label">
          <input
            type="checkbox"
            name="featured"
            defaultChecked={initial.featured ?? false}
          />{" "}
          Sản phẩm nổi bật
        </label>
        <label className="checkbox-label">
          <input
            type="checkbox"
            name="active"
            defaultChecked={initial.active ?? true}
          />{" "}
          Hiển thị trên cửa hàng
        </label>
      </div>
      {needsDailySize && (
        <p className="small muted">
          Danh mục Hoa mỗi ngày tự thêm sản phẩm vào Bộ hoa Daily với size Vừa
          xinh. Giá mỗi lượt Daily lấy từ giá size này ở bên dưới.
        </p>
      )}
      {initial.dailyConfigured && (
        <p className="small muted">
          {daily
            ? "Sản phẩm thuộc Bộ hoa Daily. Giá lấy theo size được chọn trong mẫu; lịch đã mua giữ nguyên giá."
            : "Bỏ danh mục Hoa mỗi ngày sẽ ẩn mẫu khỏi Bộ hoa Daily; lịch đã đặt vẫn được giữ lại."}
        </p>
      )}
      <div className="catalog-section-heading">
        <h3>Size, giá & tồn kho</h3>
        <span>Chọn size từ danh mục dùng chung.</span>
      </div>
      {variants.map((variant, index) => (
        <div
          key={variant.id ?? variant.clientKey}
          className="catalog-variant-card"
        >
          <div className="two-columns">
            <CreatableTaxonomy
              kind="SIZE"
              value={variant.name}
              onChange={(value) => updateVariant(index, "name", value)}
              options={options("SIZE", variant.name)}
              onCreated={created}
              onBusyChange={creatingChanged}
              label={`Size ${index + 1}`}
              disabled={busy || (needsDailySize && variant.name === "Vừa xinh")}
            />
            <label>
              SKU
              <input
                value={variant.sku}
                onChange={(e) => updateVariant(index, "sku", e.target.value)}
                required
                maxLength={100}
              />
            </label>
            <label>
              Giá (VND)
              <input
                type="number"
                value={variant.price}
                onChange={(e) => updateVariant(index, "price", e.target.value)}
                required
                min={1000}
                max={100000000}
                step={1}
              />
            </label>
            <label>
              Tồn kho · {variant.reserved ?? 0} đang giữ
              <input
                type="number"
                value={variant.stock}
                onChange={(e) => updateVariant(index, "stock", e.target.value)}
                required
                min={variant.reserved ?? 0}
                step={1}
              />
            </label>
          </div>
          {!variant.id &&
            variants.length > 1 &&
            !(needsDailySize && variant.name === "Vừa xinh") && (
              <button
                className="text-link"
                type="button"
                onClick={() =>
                  setVariants((items) => items.filter((_, i) => i !== index))
                }
              >
                <X size={14} /> Bỏ size này
              </button>
            )}
        </div>
      ))}
      <button
        type="button"
        className="text-link"
        disabled={variants.length >= 10 || busy}
        onClick={() =>
          setVariants((items) => [
            ...items,
            {
              clientKey: crypto.randomUUID(),
              name:
                options("SIZE").find(
                  (name) => !items.some((v) => v.name === name),
                ) ?? "",
              sku: newSku(),
              price: 500000,
              stock: 10,
            },
          ])
        }
      >
        <Plus size={16} /> Thêm size cho sản phẩm
      </button>
      <button
        className="button glass-primary"
        disabled={
          busy ||
          uploading ||
          creating > 0 ||
          !!registryError ||
          !categories.length ||
          !occasions.length ||
          !colors.length
        }
      >
        {busy ? "Đang lưu…" : "Lưu sản phẩm"}
        <Check size={16} />
      </button>
    </form>
  );
}
