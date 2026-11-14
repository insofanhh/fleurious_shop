"use client";
import { useCallback, useEffect, useState } from "react";
import type { CheckoutQuoteInput } from "@/lib/commerce";
import { request } from "./shop-provider";

type Quote = {
  subtotal: number;
  discount: number;
  deliveryFee: number;
  total: number;
  discountLabel: string;
};
type Result = { key: string; quote?: Quote; error?: string };

export function useCheckoutQuote(
  input: CheckoutQuoteInput,
  enabled: boolean,
  contextKey: string,
) {
  const [revision, setRevision] = useState(0);
  const [result, setResult] = useState<Result | null>(null);
  const refreshQuote = useCallback(() => setRevision((n) => n + 1), []);
  const body = JSON.stringify(input);
  const key = JSON.stringify([body, contextKey, revision]);
  const needsVoucher =
    input.voucherCode !== undefined && !input.voucherCode.trim();

  useEffect(() => {
    if (!enabled || needsVoucher) return;
    let active = true;
    setResult(null);
    const timer = setTimeout(() => {
      request<Quote>("checkout/quote", JSON.parse(body))
        .then((quote) => {
          if (active) setResult({ key, quote });
        })
        .catch((e) => {
          if (active) setResult({ key, error: (e as Error).message });
        });
    }, 350);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [body, key, enabled, needsVoucher]);

  useEffect(() => {
    if (!enabled) return;
    window.addEventListener("focus", refreshQuote);
    window.addEventListener("fleurious:sync", refreshQuote);
    return () => {
      window.removeEventListener("focus", refreshQuote);
      window.removeEventListener("fleurious:sync", refreshQuote);
    };
  }, [enabled, refreshQuote]);

  // Hide an old response immediately on render, including the debounce window.
  const current =
    enabled && !needsVoucher && result?.key === key ? result : null;
  return {
    quote: current?.quote ?? null,
    error: current?.error ?? "",
    checking: enabled && !needsVoucher && !current,
    needsVoucher,
    refreshQuote,
  };
}
