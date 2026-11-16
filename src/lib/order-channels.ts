export const orderChannels = {
  WEBSITE: "Website",
  ZALO: "Zalo",
  FACEBOOK: "Facebook",
  INSTAGRAM: "Instagram",
  IN_STORE: "Tại cửa hàng",
  OTHER: "Kênh khác",
} as const;
export type OrderChannel = keyof typeof orderChannels;
export const canCreateOrder = (role: string) =>
  ["OWNER", "MANAGER"].includes(role);
export const initialOrderStages = {
  PENDING: "Chờ xác nhận",
  CONFIRMED: "Chờ chuẩn bị",
  PREPARING: "Đang chuẩn bị",
  READY: "Sẵn sàng giao",
  OUT_FOR_DELIVERY: "Đang giao",
  DELIVERED: "Đã giao thành công",
} as const;
