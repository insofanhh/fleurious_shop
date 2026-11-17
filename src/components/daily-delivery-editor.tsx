"use client";
import { useEffect, useId, useRef, useState } from "react";
import { CalendarDays, Flower2, Pause, X } from "lucide-react";
import { request, useShop } from "./shop-provider";
import { Select } from "./ui/select";
import { money } from "@/lib/time";
import type { DailyPublic } from "@/lib/daily-types";
import type { DailyPlanData } from "./daily-client";

type Delivery = DailyPlanData["deliveries"][number];
type Editor = "flower" | "schedule";
const titles = {
  flower: "Đổi mẫu hoa",
  schedule: "Đổi lịch nhận hoa",
};

export function DailyDeliveryEditor({
  delivery,
  plan,
  pool,
  admin,
  locked,
  onUpdated,
}: {
  delivery: Delivery;
  plan: DailyPlanData;
  pool: DailyPublic | null;
  admin: boolean;
  locked: boolean;
  onUpdated: () => Promise<void>;
}) {
  const { toast } = useShop();
  const [editor, setEditor] = useState<Editor | null>(null),
    [version, setVersion] = useState(delivery.version),
    [offering, setOffering] = useState(""),
    [day, setDay] = useState(""),
    [slot, setSlot] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const dialog = useRef<HTMLDialogElement>(null),
    changeKey = useRef(""),
    titleId = useId();
  const flowerLocked = locked && !(admin && !delivery.orderId);
  const stale = delivery.version !== version;
  const unavailable = editor === "flower" ? flowerLocked : locked;
  const offerings =
    pool?.offerings.filter(
      (o) =>
        o.active &&
        (plan.pricingMode === "PRODUCT" || o.budgetCode === plan.budgetCode),
    ) ?? [];

  useEffect(() => {
    if (!editor) return;
    if (!dialog.current?.open) dialog.current?.showModal();
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = overflow;
    };
  }, [editor]);

  function reset() {
    setVersion(delivery.version);
    setOffering(delivery.offeringId ?? "");
    setDay(delivery.day);
    setSlot(delivery.slotId);
    setError("");
    changeKey.current = crypto.randomUUID();
  }
  function open(kind: Editor) {
    reset();
    setEditor(kind);
  }
  function close() {
    if (busy) return;
    dialog.current?.close();
    setEditor(null);
  }
  async function save(pause = false) {
    if (busy || stale || unavailable || !editor) return;
    setBusy(true);
    setError("");
    try {
      const body = pause
        ? { pause: true }
        : editor === "flower"
          ? {
              offeringId: offering,
              approve: admin,
              idempotencyKey: changeKey.current,
            }
          : { day, slotId: slot };
      const result = await request<{ invoiceId?: string }>(
        `${admin ? "admin/daily" : "daily/plans"}/${plan.id}/deliveries/${delivery.id}`,
        { version, ...body },
        "PATCH",
      );
      await onUpdated();
      dialog.current?.close();
      setEditor(null);
      toast(
        result.invoiceId
          ? "Đã tạo yêu cầu nâng mẫu. Thanh toán phụ thu để xác nhận mẫu mới."
          : "Đã cập nhật lịch hoa.",
      );
    } catch (e) {
      setError((e as Error).message);
      // Refresh the live version without overwriting the open form's draft.
      await onUpdated().catch(() => {});
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <div className="daily-delivery-edit-actions">
        <button
          type="button"
          className="button secondary"
          disabled={flowerLocked}
          onClick={() => open("flower")}
        >
          <Flower2 size={15} /> {admin ? "Đổi / duyệt mẫu hoa" : "Đổi mẫu hoa"}
        </button>
        <button
          type="button"
          className="button secondary"
          disabled={locked}
          onClick={() => open("schedule")}
        >
          <CalendarDays size={15} /> Đổi ngày / khung giao
        </button>
      </div>
      {editor && (
        <dialog
          ref={dialog}
          className="admin-modal daily-delivery-modal"
          aria-labelledby={titleId}
          onClose={() => setEditor(null)}
          onCancel={(e) => {
            e.preventDefault();
            close();
          }}
        >
          <div className="modal-heading">
            <div>
              <span className="eyebrow">
                HOA NGÀY {delivery.day.split("-").reverse().join("/")}
              </span>
              <h2 id={titleId}>{titles[editor]}</h2>
            </div>
            <button
              type="button"
              aria-label="Đóng chỉnh sửa"
              disabled={busy}
              onClick={close}
            >
              <X size={20} />
            </button>
          </div>
          <form
            className="form-stack"
            onSubmit={(e) => {
              e.preventDefault();
              void save();
            }}
          >
            {stale && (
              <div className="notice" role="alert">
                Lượt giao vừa được cập nhật. Tải nội dung mới trước khi sửa.
                <button
                  type="button"
                  className="text-link"
                  disabled={busy}
                  onClick={reset}
                >
                  Tải nội dung mới
                </button>
              </div>
            )}
            {unavailable && (
              <p className="notice" role="alert">
                Đã qua hạn chỉnh sửa hoặc lượt giao đang được xử lý. Liên hệ cửa
                hàng để được hỗ trợ.
              </p>
            )}
            <fieldset
              disabled={busy || stale || unavailable}
              className="daily-delivery-edit-fields"
            >
              {editor === "flower" && (
                <>
                  <label>
                    Mẫu hoa
                    <Select
                      aria-label="Mẫu hoa"
                      disabled={busy || stale || unavailable}
                      value={offering}
                      onChange={(e) => setOffering(e.target.value)}
                    >
                      {!offerings.some((o) => o.id === offering) && (
                        <option value={offering} disabled>
                          {delivery.selectionSnapshot?.name ?? "Chọn mẫu hoa"} ·
                          mẫu hiện tại
                        </option>
                      )}
                      {offerings.map((o) => (
                        <option value={o.id} key={o.id}>
                          {o.name} · {o.variantName} · {money(o.price)}/bó
                        </option>
                      ))}
                    </Select>
                  </label>
                  <p className="small muted">
                    Mẫu có giá cao hơn sẽ tạo khoản phụ thu. Mẫu hiện tại được
                    giữ đến khi thanh toán thành công; đổi sang mẫu rẻ hơn cần
                    cửa hàng hỗ trợ.
                  </p>
                </>
              )}
              {editor === "schedule" && (
                <div className="daily-form-row">
                  <label>
                    Đổi ngày
                    <input
                      type="date"
                      required
                      value={day}
                      onChange={(e) => setDay(e.target.value)}
                    />
                  </label>
                  <label>
                    Khung giao
                    <Select
                      aria-label="Khung giao"
                      disabled={busy || stale || unavailable}
                      value={slot}
                      onChange={(e) => setSlot(e.target.value)}
                    >
                      {!plan.slots.some((s) => s.id === slot) && (
                        <option value={slot} disabled>
                          {delivery.slotLabel}
                        </option>
                      )}
                      {plan.slots.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.label}
                        </option>
                      ))}
                    </Select>
                  </label>
                </div>
              )}
            </fieldset>
            {error && (
              <p className="form-error" role="alert">
                {error}
              </p>
            )}
            <div className="daily-wizard-actions">
              <button
                type="button"
                className="button secondary"
                disabled={busy}
                onClick={close}
              >
                Đóng
              </button>
              <button
                className="button glass-primary"
                disabled={
                  busy ||
                  stale ||
                  unavailable ||
                  (editor === "flower" &&
                    !offerings.some((o) => o.id === offering))
                }
              >
                {busy
                  ? "Đang lưu…"
                  : editor === "flower"
                    ? admin
                      ? "Duyệt mẫu này"
                      : "Đổi mẫu / xem phụ thu"
                    : "Lưu lịch nhận"}
              </button>
            </div>
            {editor === "schedule" && (
              <button
                type="button"
                className="text-link daily-delivery-pause"
                disabled={busy || stale || unavailable}
                onClick={() => void save(true)}
              >
                <Pause size={15} /> Chọn ngày bù sau
              </button>
            )}
          </form>
        </dialog>
      )}
    </>
  );
}
