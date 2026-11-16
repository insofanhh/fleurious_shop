"use client";
import { useCallback, useEffect, useState } from "react";
import { request } from "./shop-provider";
import type { ShippingQuoteView } from "@/lib/shipping-types";
export function useShippingQuote(
  locationId: string | undefined,
  enabled: boolean,
  version: number,
) {
  const [revision, setRevision] = useState(0),
    [result, setResult] = useState<{
      key: string;
      quote?: ShippingQuoteView;
      error?: string;
    } | null>(null);
  const key = JSON.stringify([locationId, version, revision]);
  const refresh = useCallback(() => setRevision((value) => value + 1), []);
  useEffect(() => {
    if (!enabled || !locationId) return;
    let alive = true;
    const timer = setTimeout(() => {
      request<ShippingQuoteView>("shipping/quote", { locationId })
        .then((quote) => {
          if (alive) setResult({ key, quote });
        })
        .catch((e) => {
          if (alive) setResult({ key, error: e.message });
        });
    }, 200);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [key, enabled, locationId]);
  const current = enabled && locationId && result?.key === key ? result : null;
  useEffect(() => {
    const quote = current?.quote;
    if (!quote) return;
    const remaining = Date.parse(quote.expiresAt) - Date.parse(quote.serverNow);
    const timer = setTimeout(refresh, Math.max(1000, remaining - 1000));
    return () => clearTimeout(timer);
  }, [current?.quote, refresh]);
  useEffect(() => {
    if (!enabled) return;
    window.addEventListener("focus", refresh);
    window.addEventListener("fleurious:shipping-refresh", refresh);
    return () => {
      window.removeEventListener("focus", refresh);
      window.removeEventListener("fleurious:shipping-refresh", refresh);
    };
  }, [enabled, refresh]);
  return {
    quote: current?.quote ?? null,
    error: current?.error ?? "",
    checking: !!(enabled && locationId && !current),
    refresh,
  };
}
