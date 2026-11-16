export type ShippingPoint = {
  placeId: string;
  address: string;
  lat: number;
  lng: number;
};
export type AddressSelection = ShippingPoint & { id: string };
export type ShippingPublic = {
  mode: "DISTANCE";
  configured: boolean;
  version: number;
  allowManual: boolean;
};
export type ShippingSnapshot = {
  method: "DISTANCE" | "MANUAL";
  addressDetails?: string;
  freeformAddress?: string;
  origin: ShippingPoint | null;
  destination: ShippingPoint | null;
  distanceMeters: number | null;
  durationSeconds: number | null;
  vehicle: "motorcycle" | "car";
  providerVehicle?: "bike" | "car";
  routingRevision?: string;
  ratePerKm: number | null;
  minimumFee: number;
  maximumFee?: number | null;
  roundingStep: number;
  fee: number;
  policyVersion: number;
  reason?: string;
  actor?: string;
  automaticReference?: {
    quoteId: string;
    fee: number;
    distanceMeters: number | null;
  };
};
export type ShippingQuoteView = {
  id: string;
  fee: number;
  distanceMeters: number | null;
  ratePerKm: number | null;
  expiresAt: string;
  serverNow: string;
};
