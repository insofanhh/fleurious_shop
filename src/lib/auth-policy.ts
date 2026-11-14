export const can = (role: string, area: string) =>
  role === "OWNER" ||
  role === "MANAGER" ||
  (
    {
      FLORIST: ["overview", "orders", "calendar"],
      DELIVERY: ["overview", "orders", "calendar"],
      MARKETING: ["overview", "products", "content", "vouchers", "analytics"],
      ACCOUNTANT: ["overview", "payments", "analytics"],
    } as Record<string, string[]>
  )[role]?.includes(area) === true;
