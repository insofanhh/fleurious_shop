"use client";
import { X } from "lucide-react";
import { CreatableTaxonomy } from "./creatable-taxonomy";
import type { CatalogueTaxonomy, TaxonomyKind } from "@/lib/catalogue";

export function MultiTaxonomy({
  kind,
  values,
  onChange,
  options,
  onCreated,
  onBusyChange,
  disabled,
}: {
  kind: TaxonomyKind;
  values: string[];
  onChange: (values: string[]) => void;
  options: string[];
  onCreated: (item: CatalogueTaxonomy) => void;
  onBusyChange: (busy: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <div className="catalog-multi-taxonomy">
      <CreatableTaxonomy
        kind={kind}
        value=""
        required={false}
        onChange={(name) => {
          if (name && !values.includes(name)) onChange([...values, name]);
        }}
        options={options.filter((name) => !values.includes(name))}
        onCreated={onCreated}
        onBusyChange={onBusyChange}
        disabled={disabled}
      />
      <div className="catalog-taxonomy-values" aria-label="Các mục đã chọn">
        {values.map((name) => (
          <button
            key={name}
            type="button"
            disabled={disabled}
            aria-label={`Bỏ ${name}`}
            onClick={() => onChange(values.filter((v) => v !== name))}
          >
            {name}
            <X size={12} />
          </button>
        ))}
      </div>
      <small className="muted">
        Có thể chọn nhiều mục
        {!values.length ? " · cần chọn ít nhất một mục" : ""}.
      </small>
    </div>
  );
}
