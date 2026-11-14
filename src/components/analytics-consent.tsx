"use client";
import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
const cookie = (name: string) =>
  document.cookie
    .split(";")
    .map((v) => v.trim())
    .find((v) => v.startsWith(`${name}=`))
    ?.slice(name.length + 1);
const last = new Map<string, number>();
export function track(name: string, params: Record<string, unknown> = {}) {
  if (
    typeof document === "undefined" ||
    cookie("fleurious_analytics") !== "yes"
  )
    return;
  const clientId = cookie("fleurious_analytics_id");
  if (!clientId) return;
  const key = `${name}:${JSON.stringify(params)}`;
  if (
    ["page_view", "view_item", "view_item_list"].includes(name) &&
    Date.now() - (last.get(key) ?? 0) < 2000
  )
    return;
  last.set(key, Date.now());
  fetch("/api/analytics/events", {
    method: "POST",
    credentials: "same-origin",
    keepalive: true,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name,
      params: {
        ...params,
        device_type: window.matchMedia("(max-width: 700px)").matches
          ? "mobile"
          : "desktop",
      },
      clientId,
      eventId: crypto.randomUUID(),
    }),
  }).catch(() => {});
}
export function AnalyticsConsent({ enabled }: { enabled: boolean }) {
  const path = usePathname();
  const [choice, setChoice] = useState<string | null>("loading");
  useEffect(() => {
    if (enabled) setChoice(cookie("fleurious_analytics") ?? null);
  }, [enabled]);
  const publicPage =
    !/^\/(admin|account|auth|q|orders|checkout|cart|streak)(\/|$)/.test(path);
  useEffect(() => {
    if (enabled && choice === "yes" && publicPage) track("page_view", { path });
  }, [enabled, choice, path, publicPage]);
  async function choose(value: string) {
    document.cookie = `fleurious_analytics=${value}; Path=/; Max-Age=31536000; SameSite=Lax${location.protocol === "https:" ? "; Secure" : ""}`;
    if (value === "yes" && !cookie("fleurious_analytics_id"))
      document.cookie = `fleurious_analytics_id=${crypto.randomUUID()}; Path=/; Max-Age=31536000; SameSite=Lax${location.protocol === "https:" ? "; Secure" : ""}`;
    if (value === "no")
      await fetch("/api/analytics/optout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      }).catch(() => {});
    setChoice(value);
  }
  if (!enabled) return null;
  return (
    <>
      {choice === null && publicPage && (
        <aside className="analytics-consent" aria-label="Tùy chọn phân tích">
          <strong>Một chút thông tin, trải nghiệm tốt hơn.</strong>
          <p>
            Cho phép đo lượt xem và hành trình mua bằng GA4/PostHog? Không gửi
            địa chỉ, lời thiệp, QR hay nội dung riêng tư. Bạn có thể từ chối mà
            vẫn mua bình thường.
          </p>
          <div>
            <button onClick={() => choose("no")}>Chỉ cần thiết</button>
            <button onClick={() => choose("yes")}>Cho phép phân tích</button>
          </div>
        </aside>
      )}
      {path === "/privacy" && choice !== null && (
        <div className="privacy-analytics-controls">
          <p>
            Phân tích tùy chọn:{" "}
            {choice === "yes" ? "đang cho phép" : "đang tắt"}.
          </p>
          <button
            className="text-link"
            onClick={() => choose(choice === "yes" ? "no" : "yes")}
          >
            {choice === "yes"
              ? "Tắt phân tích và dừng các sự kiện đang chờ"
              : "Cho phép phân tích"}
          </button>
        </div>
      )}
    </>
  );
}
