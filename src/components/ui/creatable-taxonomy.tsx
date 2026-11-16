"use client";
import { useId, useState } from "react";
import { Plus, Check, X } from "lucide-react";
import { Select } from "./select";
import { request } from "../shop-provider";
import {
  catalogueSlug,
  taxonomyLabels,
  type TaxonomyKind,
  type CatalogueTaxonomy,
} from "@/lib/catalogue";

export function CreatableTaxonomy({
  kind,
  value,
  onChange,
  options,
  onCreated,
  label,
  disabled,
  onBusyChange,
}: {
  kind: TaxonomyKind;
  value: string;
  onChange: (value: string) => void;
  options: string[];
  onCreated: (item: CatalogueTaxonomy) => void;
  label?: string;
  disabled?: boolean;
  onBusyChange?: (busy: boolean) => void;
}) {
  const id = useId(),
    title = taxonomyLabels[kind];
  const [adding, setAdding] = useState(false),
    [name, setName] = useState("");
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function create() {
    if (busy || !name.trim()) return;
    const slug = catalogueSlug(name);
    if (!slug) {
      setError("Tên cần có chữ hoặc số.");
      return;
    }
    setBusy(true);
    onBusyChange?.(true);
    setError("");
    try {
      const item = await request<CatalogueTaxonomy>("admin/taxonomies", {
        kind,
        name: name.trim(),
        slug: `${kind.toLowerCase()}-${slug}`,
        description: "",
        image: "",
        productIds: [],
        active: true,
      });
      onCreated(item);
      onChange(item.name);
      setAdding(false);
      setName("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
      onBusyChange?.(false);
    }
  }
  return (
    <div className="creatable-taxonomy">
      <label htmlFor={id}>{label ?? title}</label>
      <Select
        id={id}
        value={value}
        required
        disabled={disabled || busy}
        onChange={(e) => onChange(e.target.value)}
      >
        <option value="">Chọn {title.toLocaleLowerCase("vi")}</option>
        {options.map((name) => (
          <option key={name} value={name}>
            {name}
          </option>
        ))}
      </Select>
      {!adding ? (
        <button
          type="button"
          className="text-link catalog-add-link"
          disabled={disabled}
          onClick={() => setAdding(true)}
        >
          <Plus size={14} /> Thêm {title.toLocaleLowerCase("vi")} mới
        </button>
      ) : (
        <div
          className="catalog-inline-create"
          role="group"
          aria-label={`Thêm ${title.toLocaleLowerCase("vi")} mới`}
        >
          <label htmlFor={`${id}-new`}>
            Tên {title.toLocaleLowerCase("vi")} mới
          </label>
          <input
            id={`${id}-new`}
            value={name}
            maxLength={100}
            autoFocus
            disabled={busy}
            placeholder={
              kind === "SIZE" ? "Ví dụ: Nhỏ xinh, L, XL…" : "Nhập tên…"
            }
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void create();
              }
            }}
          />
          <div className="catalog-inline-actions">
            <button
              type="button"
              className="button secondary"
              onClick={create}
              disabled={busy || !name.trim()}
            >
              <Check size={14} /> {busy ? "Đang thêm…" : "Thêm & chọn"}
            </button>
            <button
              type="button"
              className="text-link"
              disabled={busy}
              onClick={() => {
                setAdding(false);
                setError("");
              }}
            >
              <X size={14} /> Hủy
            </button>
          </div>
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
