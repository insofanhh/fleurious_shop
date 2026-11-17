"use client";
import { useEffect, useState } from "react";
import {
  LoaderCircle,
  MessageCircle,
  PencilLine,
  RefreshCw,
  Save,
  X,
} from "lucide-react";
import { request, useShop } from "./shop-provider";
import { dailyLockAt } from "@/lib/daily-pricing";
import type { DailyPolicy } from "@/lib/daily-types";
import type { DailyPlanData } from "./daily-client";

export function DailyDeliveryMessage({
  delivery,
  planId,
  policy,
  admin,
  editable,
  onUpdated,
}: {
  delivery: DailyPlanData["deliveries"][number];
  planId: string;
  policy: DailyPolicy;
  admin: boolean;
  editable: boolean;
  onUpdated: () => Promise<void>;
}) {
  const { toast } = useShop();
  const [draft, setDraft] = useState<{
      message: string;
      version: number;
    } | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const locked =
    !editable ||
    dailyLockAt(delivery.day, policy, true).getTime() <= Date.now() ||
    (!!delivery.order && delivery.order.fulfillment !== "UNASSIGNED");
  const stale = !!draft && draft.version !== delivery.version;
  useEffect(() => {
    if (!editable) {
      setDraft(null);
      setError("");
    }
  }, [editable]);
  function start() {
    setDraft({ message: delivery.message, version: delivery.version });
    setError("");
  }
  function cancel() {
    if (busy) return;
    setDraft(null);
    setError("");
  }
  async function save() {
    if (!draft || busy || locked || stale) return;
    setBusy(true);
    setError("");
    try {
      await request(
        `${admin ? "admin/daily" : "daily/plans"}/${planId}/deliveries/${delivery.id}`,
        { version: draft.version, message: draft.message },
        "PATCH",
      );
      await onUpdated();
      setDraft(null);
      toast("Đã lưu lời thương.");
    } catch (e) {
      setError((e as Error).message);
      await onUpdated().catch(() => {});
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="daily-delivery-message">
      <div className="daily-delivery-message-heading">
        <span className="daily-delivery-message-label">
          <MessageCircle size={15} aria-hidden="true" />
          Lời thương
        </span>
        {editable && (
          <div className="daily-message-actions">
            {draft ? (
              <>
                <button
                  type="button"
                  className="daily-message-action save"
                  aria-label="Lưu lời thương"
                  title="Lưu lời thương"
                  disabled={busy || locked || stale}
                  onClick={() => void save()}
                >
                  {busy ? (
                    <LoaderCircle size={16} className="daily-message-saving" />
                  ) : (
                    <Save size={16} />
                  )}
                </button>
                <button
                  type="button"
                  className="daily-message-action"
                  aria-label="Hủy sửa lời thương"
                  title="Hủy chỉnh sửa"
                  disabled={busy}
                  onClick={cancel}
                >
                  <X size={16} />
                </button>
              </>
            ) : (
              <button
                type="button"
                className="daily-message-action"
                aria-label="Sửa lời thương"
                title={
                  locked
                    ? "Thiệp đã chốt, không thể chỉnh sửa"
                    : "Sửa lời thương"
                }
                disabled={locked}
                onClick={start}
              >
                <PencilLine size={16} />
              </button>
            )}
          </div>
        )}
      </div>
      {draft ? (
        <>
          {stale && (
            <div className="daily-delivery-message-notice" role="alert">
              <span>
                Lời thương hoặc lượt giao vừa thay đổi. Tải nội dung mới trước
                khi lưu.
              </span>
              <button
                type="button"
                className="daily-message-action"
                aria-label="Tải lời thương mới"
                title="Tải nội dung mới"
                disabled={busy}
                onClick={start}
              >
                <RefreshCw size={15} />
              </button>
            </div>
          )}
          {locked && (
            <p className="small muted" role="status">
              Thiệp đã chốt, không thể chỉnh sửa lời thương.
            </p>
          )}
          <textarea
            aria-label="Lời thương"
            autoFocus
            rows={4}
            maxLength={800}
            value={draft.message}
            disabled={busy || locked}
            onChange={(e) => setDraft({ ...draft, message: e.target.value })}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                e.preventDefault();
                cancel();
              } else if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                e.preventDefault();
                void save();
              }
            }}
          />
          <div
            className="daily-delivery-message-count"
            role={busy ? "status" : undefined}
          >
            {busy ? "Đang lưu…" : `${draft.message.length}/800`}
          </div>
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
        </>
      ) : (
        <p className="preserve-lines">
          {delivery.message || "Chưa có lời nhắn."}
        </p>
      )}
    </div>
  );
}
