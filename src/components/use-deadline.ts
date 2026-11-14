"use client";
import { useEffect, useState } from "react";
import { deadlineSeconds } from "@/lib/order-expiry";

export function useDeadline(expiresAt?: string, serverNow?: string) {
  const [seconds, setSeconds] = useState<number | null>(null);
  useEffect(() => {
    if (!expiresAt) {
      setSeconds(null);
      return;
    }
    const receivedAt = Date.now();
    const serverTime = serverNow ? Date.parse(serverNow) : receivedAt;
    const update = () =>
      setSeconds(
        deadlineSeconds(
          expiresAt,
          (Number.isFinite(serverTime) ? serverTime : receivedAt) +
            Date.now() -
            receivedAt,
        ),
      );
    update();
    const timer = setInterval(update, 1000);
    window.addEventListener("focus", update);
    document.addEventListener("visibilitychange", update);
    return () => {
      clearInterval(timer);
      window.removeEventListener("focus", update);
      document.removeEventListener("visibilitychange", update);
    };
  }, [expiresAt, serverNow]);
  return seconds;
}
