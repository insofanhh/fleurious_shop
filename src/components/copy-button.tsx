"use client";
import { Copy } from "lucide-react";
import { useShop } from "./shop-provider";
export function CopyButton({
  value,
  label = "mã đơn hàng",
  className = "",
}: {
  value: string;
  label?: string;
  className?: string;
}) {
  const { toast } = useShop();
  return (
    <button
      type="button"
      className={`order-copy-button ${className}`}
      title={`Sao chép ${label}`}
      aria-label={`Sao chép ${label} ${label === "mã đơn hàng" ? value : ""}`.trim()}
      onClick={async (e) => {
        e.stopPropagation();
        try {
          await navigator.clipboard.writeText(value);
          toast(`Đã sao chép ${label}.`);
        } catch {
          toast(
            "Chưa sao chép được. Bạn có thể chọn nội dung để sao chép thủ công.",
          );
        }
      }}
    >
      <Copy size={15} aria-hidden="true" />
    </button>
  );
}
