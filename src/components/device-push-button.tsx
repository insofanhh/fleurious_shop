"use client";
import { useEffect, useState } from "react";
import { Bell, BellRing } from "lucide-react";
import { request, useShop } from "./shop-provider";
import {
  devicePushError,
  enableDevicePush,
  getDevicePushSupport,
  pushSubscriptionMatches,
  type PushSupport,
} from "@/lib/push-client";

export function DevicePushButton() {
  const { user, vapidKey, toast } = useShop();
  const [support, setSupport] = useState<PushSupport | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [showHelp, setShowHelp] = useState(false);
  useEffect(() => {
    let active = true;
    const inspect = async () => {
      const next = getDevicePushSupport(vapidKey);
      setSupport(next);
      setEnabled(false);
      if (next.kind !== "ready" || Notification.permission !== "granted")
        return;
      try {
        const registration = await navigator.serviceWorker.getRegistration("/");
        const subscription = await registration?.pushManager.getSubscription();
        if (
          !active ||
          !subscription ||
          !pushSubscriptionMatches(subscription, vapidKey)
        )
          return;
        // Reconnect an existing device to the currently signed-in account.
        await request("me/push", subscription.toJSON());
        if (active) {
          setEnabled(true);
          setError("");
        }
      } catch {
        if (active)
          setError(
            "Chưa đồng bộ được thiết bị. Nhấn bật thông báo để thử lại.",
          );
      }
    };
    void inspect();
    window.addEventListener("focus", inspect);
    return () => {
      active = false;
      window.removeEventListener("focus", inspect);
    };
  }, [user?.id, vapidKey]);

  async function push() {
    if (support?.kind === "install") {
      setShowHelp(true);
      return;
    }
    if (busy || enabled) return;
    setBusy(true);
    setError("");
    try {
      const subscription = await enableDevicePush(vapidKey);
      await request("me/push", subscription.toJSON());
      setEnabled(true);
      toast("Đã bật thông báo trên thiết bị này.");
    } catch (e) {
      setError(devicePushError(e));
    } finally {
      setSupport(getDevicePushSupport(vapidKey));
      setBusy(false);
    }
  }
  const blocked = support && !["ready", "install"].includes(support.kind);
  return (
    <div className="device-push-control">
      <button
        type="button"
        className="button secondary"
        disabled={!support || busy || enabled || !!blocked}
        aria-describedby="device-push-status"
        onClick={push}
      >
        {enabled ? <BellRing size={17} /> : <Bell size={17} />}
        {busy
          ? "Đang bật thông báo…"
          : enabled
            ? "Đã bật trên thiết bị này"
            : support?.kind === "install"
              ? "Hướng dẫn bật trên iPhone"
              : support?.kind === "denied"
                ? "Quyền thông báo đang bị tắt"
                : blocked
                  ? "Thông báo thiết bị chưa sẵn sàng"
                  : "Bật thông báo thiết bị"}
      </button>
      <p id="device-push-status" className="device-push-hint" role="status">
        {error ||
          (enabled
            ? "Thiết bị này sẽ nhận cập nhật đơn hoa và ưu đãi."
            : support?.kind === "install" && !showHelp
              ? "Cài Fleurious lên Màn hình chính để nhận thông báo trên iPhone/iPad."
              : support?.message)}
      </p>
    </div>
  );
}
