/** QR claims are printed by staff, never distributed by the customer's order API. */
export function customerOrder<
  T extends {
    guestHash?: unknown;
    idempotencyKey?: unknown;
    qr?: unknown;
    createdBy?: unknown;
    receipt?: unknown;
    receivable?: unknown;
    shippingQuoteId?: unknown;
    shippingSnapshot?: unknown;
  },
>(order: T) {
  const {
    guestHash,
    idempotencyKey,
    qr,
    createdBy,
    receipt,
    receivable,
    shippingQuoteId,
    shippingSnapshot,
    ...safe
  } = order;
  if (
    shippingSnapshot &&
    typeof shippingSnapshot === "object" &&
    !Array.isArray(shippingSnapshot)
  ) {
    const { actor, automaticReference, ...shipping } =
      shippingSnapshot as Record<string, unknown>;
    let reference: Record<string, unknown> | undefined;
    if (
      automaticReference &&
      typeof automaticReference === "object" &&
      !Array.isArray(automaticReference)
    ) {
      const { quoteId, ...publicReference } = automaticReference as Record<
        string,
        unknown
      >;
      reference = publicReference;
    }
    const snapshot: Record<string, unknown> = {
      ...shipping,
      ...(reference ? { automaticReference: reference } : {}),
    };
    return { ...safe, shippingSnapshot: snapshot };
  }
  return {
    ...safe,
    ...(shippingSnapshot === undefined ? {} : { shippingSnapshot: null }),
  };
}
