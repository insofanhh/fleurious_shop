/** QR claims are printed by staff, never distributed by the customer's order API. */
export function customerOrder<
  T extends {
    guestHash?: unknown;
    idempotencyKey?: unknown;
    qr?: unknown;
    createdBy?: unknown;
  },
>(order: T) {
  const { guestHash, idempotencyKey, qr, createdBy, ...safe } = order;
  return safe;
}
