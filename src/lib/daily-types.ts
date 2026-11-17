import { z } from "zod";

const amount = z.number().int().min(0).max(10000000);
export const dailyPolicySchema = z
  .object({
    enabled: z.boolean().default(false),
    pricingMode: z.enum(["BUDGET", "PRODUCT"]).default("BUDGET"),
    name: z.string().trim().min(1).max(80).default("Fleurious Daily"),
    slogan: z.string().trim().max(150).default("Mỗi ngày, một lời thương."),
    budgets: z
      .array(
        z.object({
          code: z.string().regex(/^[a-z0-9-]{1,30}$/),
          name: z.string().min(1).max(80),
          price: amount.min(1000),
        }),
      )
      .min(1)
      .max(8),
    tiers: z
      .array(
        z.object({
          count: z.number().int().min(1).max(31),
          percent: z.number().int().min(0).max(50),
          shipPercent: z.number().int().min(0).max(100),
          shipCap: amount,
          freeMeters: z.number().int().min(0).max(100000),
          outsideSupport: amount,
        }),
      )
      .max(10),
    leadHours: z.number().int().min(2).max(720).default(48),
    horizonDays: z.number().int().min(31).max(180).default(90),
    cutoffHour: z.number().int().min(0).max(23).default(18),
    messageCutoffHour: z.number().int().min(0).max(23).default(18),
    holdMinutes: z.number().int().min(5).max(60).default(15),
    graceDays: z.number().int().min(1).max(60).default(15),
    capacityPerDay: z.number().int().min(1).max(500).default(10),
    repeatWindow: z.number().int().min(0).max(31).default(7),
    campaignBudget: amount.default(10000000),
    packingCost: amount.default(0),
    minimumMargin: amount.default(0),
    blackoutDates: z
      .array(z.string().regex(/^\d{4}-\d{2}-\d{2}$/))
      .max(366)
      .default([]),
    messages: z
      .array(
        z.object({
          theme: z.string().trim().min(1).max(40),
          text: z.string().trim().min(1).max(800),
        }),
      )
      .min(31)
      .max(300),
    terms: z.string().trim().min(20).max(5000),
  })
  .superRefine((p, ctx) => {
    if (
      new Set(p.budgets.map((b) => b.code)).size !== p.budgets.length ||
      new Set(p.tiers.map((t) => t.count)).size !== p.tiers.length
    )
      ctx.addIssue({
        code: "custom",
        message: "Mã ngân sách và mốc số lượt không được trùng.",
      });
    for (const b of p.pricingMode === "PRODUCT" ? [] : p.budgets) {
      let previous = 0;
      for (let n = 1; n <= 31; n++) {
        const t = [...p.tiers]
          .sort((a, b) => b.count - a.count)
          .find((t) => n >= t.count);
        const total = Math.round(
          (b.price * n * (100 - (t?.percent ?? 0))) / 100,
        );
        if (total < previous)
          ctx.addIssue({
            code: "custom",
            message: `Mốc giảm làm tổng tiền ${n} lượt thấp hơn ${n - 1} lượt (${b.name}).`,
          });
        previous = total;
      }
    }
  });
export type DailyPolicy = z.infer<typeof dailyPolicySchema>;
const wishes = [
  "Chúc {recipient} một ngày thật dịu dàng.",
  "Một chút hoa, một chút bình yên gửi đến {recipient}.",
  "Mong hôm nay có nhiều điều khiến bạn mỉm cười.",
  "Chúc bạn tìm thấy niềm vui trong những điều nhỏ bé.",
  "Một lời thương thay cho lời chào buổi sáng.",
  "Mong ngày mới của bạn nhẹ nhàng như một cánh hoa.",
  "Chúc bạn luôn có đủ năng lượng cho những điều mình yêu.",
  "Gửi bạn một khoảng nghỉ thật êm giữa ngày bận rộn.",
  "Hôm nay hãy dành một chút yêu thương cho chính mình nhé.",
  "Chúc những dự định của bạn nở hoa đúng lúc.",
  "Một bó hoa nhỏ, một lời nhớ thật nhiều.",
  "Mong bạn gặp những người tử tế trong hôm nay.",
  "Chúc bạn có một ngày rực rỡ theo cách của riêng mình.",
  "Gửi {recipient} một chút màu sắc cho ngày mới.",
  "Mong những điều đẹp đẽ tìm đến bạn thật tự nhiên.",
  "Chúc bạn đủ bình tâm để tận hưởng hôm nay.",
  "Một lời cảm ơn vì bạn luôn là chính mình.",
  "Mong ngày dài của bạn có nhiều khoảnh khắc dễ thương.",
  "Chúc bạn vững tin vào con đường mình đã chọn.",
  "Gửi bạn một cái ôm bằng những cánh hoa.",
  "Mong hôm nay bạn có thêm một lý do để vui.",
  "Chúc những cuộc hẹn hôm nay đều mang lại niềm vui.",
  "Một chút tươi mới dành riêng cho góc nhỏ của bạn.",
  "Mong bạn luôn có những điều đáng để mong chờ.",
  "Chúc {recipient} một ngày tràn đầy cảm hứng.",
  "Gửi lời chúc bình an cùng hương hoa rất nhẹ.",
  "Mong bạn nhớ rằng mình luôn xứng đáng được yêu thương.",
  "Chúc bạn có thời gian cho những người mình quý.",
  "Một ngày mới, thêm một lời thương từ {sender}.",
  "Mong hành trình của bạn luôn có những ngày nở hoa.",
  "Cảm ơn {recipient} vì đã làm những ngày bình thường đẹp hơn.",
];
export const defaultDailyPolicy: DailyPolicy = dailyPolicySchema.parse({
  pricingMode: "PRODUCT",
  budgets: [{ code: "mini", name: "Daily Mini", price: 70000 }],
  tiers: [
    {
      count: 10,
      percent: 5,
      shipPercent: 30,
      shipCap: 20000,
      freeMeters: 0,
      outsideSupport: 0,
    },
    {
      count: 20,
      percent: 8,
      shipPercent: 50,
      shipCap: 20000,
      freeMeters: 0,
      outsideSupport: 0,
    },
    {
      count: 30,
      percent: 10,
      shipPercent: 0,
      shipCap: 0,
      freeMeters: 3000,
      outsideSupport: 15000,
    },
  ],
  messages: wishes.map((text) => ({ theme: "Dịu dàng", text })),
  terms:
    "Thanh toán một lần cho lịch đã chọn, không tự gia hạn. Đổi ngày, mẫu hoa và lời nhắn trước hạn hiển thị của từng lượt. Có thể yêu cầu hoàn phần chưa chuẩn bị theo số tiền thực trả; phần đã chuẩn bị cần cửa hàng hỗ trợ. Giá gói không cộng dồn ưu đãi hội viên/voucher khác. QR giữ chuỗi mở sau giao thành công.",
});
export const dailyStateLabels: Record<string, string> = {
  PENDING_PAYMENT: "Chờ thanh toán",
  ACTIVE: "Đang đồng hành",
  PAUSED: "Tạm nghỉ",
  COMPLETED: "Hoàn thành",
  CLOSING: "Đang kết thúc",
  CANCELLED: "Đã kết thúc",
  EXPIRED: "Hết hạn thanh toán",
  SCHEDULED: "Đã hẹn",
  UNSCHEDULED: "Chờ xếp lịch bù",
  MATERIALIZED: "Đang thực hiện",
  FULFILLED: "Đã giao",
  ATTENTION: "Cần cửa hàng hỗ trợ",
  REFUND_PENDING: "Chờ hoàn tiền",
  REFUNDED: "Đã hoàn tiền",
  PENDING: "Chờ xử lý",
  PAID: "Đã thanh toán",
  REVIEW: "Cần đối soát",
};
export type DailyOfferingView = {
  id: string;
  variantId: string;
  budgetCode: string;
  name: string;
  description: string;
  tags: string[];
  premium: number;
  price: number;
  cost?: number;
  capacity?: number;
  active: boolean;
  image: string;
  productId: string;
  productName: string;
  color: string;
  variantName: string;
};
export type DailyPublic = {
  policy: DailyPolicy;
  version: number;
  offerings: DailyOfferingView[];
  slots: {
    id: string;
    label: string;
    startHour: number;
    endHour: number;
    capacity?: number;
  }[];
  today: string;
  serverNow: string;
};
