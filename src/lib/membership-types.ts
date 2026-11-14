export type MembershipTierView = {
  id: string;
  code: string;
  name: string;
  rank: number;
  description: string;
  color: string;
  active: boolean;
  monthlyEnabled: boolean;
  yearlyEnabled: boolean;
  revision: number;
  versionId: string;
  number: number;
  quota: number;
  percent: number;
  cap: number;
  minimum: number;
  monthlyPrice: number;
  yearlyPrice: number;
  spendThreshold: number;
  birthdayPercent: number;
  birthdayCap: number;
  birthdayMinimum: number;
  birthdayDays: number;
  terms: string;
};
export type MembershipSourceView = {
  id: string;
  source: string;
  tier: string;
  tierId: string;
  rank: number;
  startsAt: string;
  endsAt: string | null;
  revokedAt: string | null;
  reason: string;
};
export type MembershipSummary = {
  enrolled: boolean;
  current: MembershipTierView | null;
  base: MembershipTierView | null;
  expiresAt: string | null;
  spend: number;
  nextTier: MembershipTierView | null;
  limit: number;
  reserved: number;
  consumed: number;
  remaining: number;
  month: string;
  sources: MembershipSourceView[];
  birthDate: string | null;
};
export type MembershipInvoiceView = {
  id: string;
  code: string;
  userId: string;
  cycle: string;
  kind: string;
  status: string;
  amount: number;
  gross: number;
  credit: number;
  startsAt: string;
  endsAt: string;
  expiresAt: string;
  activatedAt: string | null;
  acceptedAt: string | null;
  reason: string;
  createdAt: string;
  tier: MembershipTierView;
  paymentQr?: string;
  accountNumber?: string;
  accountName?: string;
  bank?: string;
  refunds: {
    id: string;
    amount: number;
    reason: string;
    status: string;
    reference: string;
    revokeAccess: boolean;
  }[];
};
export const MEMBERSHIP_SOURCE_LABELS: Record<string, string> = {
  PAID: "Mua gói",
  EARNED: "Tích lũy",
  ADMIN: "Cửa hàng tặng",
  LEGACY: "Hạng được bảo toàn",
};
export const MEMBERSHIP_STATUS_LABELS: Record<string, string> = {
  DRAFT: "Chờ xác nhận",
  PENDING: "Chờ chuyển khoản",
  PAID: "Đã thanh toán",
  REVIEW: "Cần đối soát",
  EXPIRED: "Hết hạn thanh toán",
  CANCELLED: "Đã hủy",
  REFUNDED: "Đã hoàn phí",
  PARTIALLY_REFUNDED: "Hoàn một phần",
};
