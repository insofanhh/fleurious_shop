import { isStandalonePwa } from "./pwa-display";

export type PushSupport = {
  kind:
    | "ready"
    | "install"
    | "denied"
    | "unsupported"
    | "unconfigured"
    | "insecure";
  message: string;
};

export function getDevicePushSupport(publicKey: string): PushSupport {
  if (typeof window === "undefined")
    return {
      kind: "unsupported",
      message: "Hãy mở Fleurious trên trình duyệt của thiết bị.",
    };
  if (!window.isSecureContext)
    return {
      kind: "insecure",
      message: "Mở Fleurious bằng đường dẫn HTTPS để bật thông báo thiết bị.",
    };
  const ios =
    /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  if (ios && !isStandalonePwa())
    return {
      kind: "install",
      message:
        "Trên iPhone/iPad, chọn Chia sẻ → Thêm vào Màn hình chính. Sau đó mở Fleurious từ biểu tượng vừa thêm và bật thông báo. Cần iOS/iPadOS 16.4 trở lên.",
    };
  if (
    !("Notification" in window) ||
    !("serviceWorker" in navigator) ||
    (!("PushManager" in window) &&
      !(
        typeof ServiceWorkerRegistration !== "undefined" &&
        "pushManager" in ServiceWorkerRegistration.prototype
      ))
  )
    return {
      kind: "unsupported",
      message:
        "Trình duyệt này chưa hỗ trợ thông báo đẩy. Hãy cập nhật trình duyệt hoặc hệ điều hành. Bạn vẫn xem được thông báo tại đây.",
    };
  if (!publicKey)
    return {
      kind: "unconfigured",
      message:
        "Cửa hàng chưa hoàn tất thiết lập thông báo thiết bị. Bạn vẫn nhận được cập nhật trong mục Thông báo.",
    };
  if (Notification.permission === "denied")
    return {
      kind: "denied",
      message: ios
        ? "Quyền thông báo đang bị tắt. Mở Cài đặt → Thông báo → Fleurious, bật Cho phép thông báo rồi quay lại đây."
        : "Quyền thông báo đang bị chặn. Mở cài đặt quyền của trang Fleurious trong trình duyệt, cho phép Thông báo rồi quay lại đây.",
    };
  return {
    kind: "ready",
    message:
      "Nhận cập nhật đơn hoa và ưu đãi ngay cả khi bạn không mở Fleurious.",
  };
}

export function pushKeyBytes(publicKey: string): Uint8Array<ArrayBuffer> {
  const base64 = publicKey.replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, "="));
  const bytes = Uint8Array.from(raw, (c) => c.charCodeAt(0));
  if (bytes.length !== 65 || bytes[0] !== 4)
    throw new Error(
      "Cấu hình thông báo thiết bị chưa hợp lệ. Vui lòng liên hệ cửa hàng.",
    );
  return bytes;
}

export function pushSubscriptionMatches(
  subscription: PushSubscription,
  key: string,
) {
  const existing = subscription.options.applicationServerKey;
  if (!existing) return true;
  const expected = pushKeyBytes(key),
    actual = new Uint8Array(existing);
  return (
    actual.length === expected.length &&
    actual.every((value, i) => value === expected[i])
  );
}

async function readyRegistration() {
  const existing = await navigator.serviceWorker.getRegistration("/");
  if (!existing)
    await navigator.serviceWorker.register("/sw.js", { scope: "/" });
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      navigator.serviceWorker.ready,
      new Promise<never>((_, reject) => {
        timeout = setTimeout(
          () =>
            reject(
              new Error(
                "Chưa thể khởi động thông báo. Hãy tải lại trang rồi thử lại.",
              ),
            ),
          15000,
        );
      }),
    ]);
  } finally {
    clearTimeout(timeout);
  }
}

/** Call directly from a tap: iOS must see the permission request before any await. */
export async function enableDevicePush(publicKey: string) {
  const support = getDevicePushSupport(publicKey);
  if (support.kind !== "ready") throw new Error(support.message);
  const applicationServerKey = pushKeyBytes(publicKey);
  const permission =
    Notification.permission === "granted"
      ? "granted"
      : await Notification.requestPermission();
  if (permission !== "granted")
    throw new Error(
      permission === "denied"
        ? "Bạn đã từ chối quyền thông báo. Có thể bật lại trong cài đặt của thiết bị hoặc trình duyệt."
        : "Chưa bật thông báo. Nhấn bật lại và chọn Cho phép để nhận cập nhật.",
    );
  const registration = await readyRegistration();
  let subscription = await registration.pushManager.getSubscription();
  if (subscription && !pushSubscriptionMatches(subscription, publicKey)) {
    await subscription.unsubscribe();
    subscription = null;
  }
  return (
    subscription ??
    registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey,
    })
  );
}

export function devicePushError(error: unknown) {
  const name = (error as { name?: string })?.name;
  if (name === "NotAllowedError")
    return "Thiết bị chưa cho phép thông báo. Kiểm tra quyền Thông báo của Fleurious trong cài đặt rồi thử lại.";
  if (name === "AbortError" || name === "NetworkError")
    return "Chưa kết nối được dịch vụ thông báo. Kiểm tra mạng rồi thử lại.";
  return error instanceof Error
    ? error.message
    : "Chưa thể bật thông báo. Vui lòng thử lại.";
}
