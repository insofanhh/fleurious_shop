"use client";
import { useEffect, useState } from "react";
import { request, useShop } from "./shop-provider";
export function ProductVisibility({
  id,
  name,
  active,
  onSaved,
}: {
  id: string;
  name: string;
  active: boolean;
  onSaved: () => Promise<void>;
}) {
  const { toast } = useShop();
  const [value, setValue] = useState(active),
    [busy, setBusy] = useState(false);
  useEffect(() => setValue(active), [active]);
  return (
    <button
      type="button"
      role="switch"
      aria-checked={value}
      aria-label={`Hiển thị ${name}`}
      className="product-visibility"
      data-active={value}
      disabled={busy}
      onClick={async () => {
        if (busy) return;
        const next = !value;
        let saved = false;
        setValue(next);
        setBusy(true);
        try {
          await request(
            `admin/products/${id}/visibility`,
            { active: next },
            "PATCH",
          );
          saved = true;
          setValue(next);
          await onSaved();
          toast(
            next
              ? "Đã hiển thị sản phẩm trên cửa hàng."
              : "Đã ẩn sản phẩm khỏi cửa hàng.",
          );
        } catch (e) {
          if (!saved) {
            setValue(value);
            toast((e as Error).message);
          } else
            toast(
              "Đã lưu trạng thái. Tải lại trang để đồng bộ danh sách mới nhất.",
            );
        } finally {
          setBusy(false);
        }
      }}
    >
      <span className="product-visibility-track" aria-hidden="true">
        <span />
      </span>
      <span>{value ? "Đang hiển thị" : "Đã ẩn"}</span>
    </button>
  );
}
