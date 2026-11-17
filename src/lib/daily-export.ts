import type { User } from "@prisma/client";
import { db } from "./db";
import { fail } from "./errors";
import { dailyDay } from "./daily-pricing";
import type { DailyOfferingView } from "./daily-types";
export async function dailyPreparationCsv(
  actor: Pick<User, "id" | "role">,
  day: string,
) {
  if (!["OWNER", "MANAGER", "FLORIST"].includes(actor.role))
    fail(
      "FORBIDDEN",
      "Chỉ nhân viên chuẩn bị được xuất nội dung thiệp và phiếu việc.",
      403,
    );
  dailyDay(day);
  const rows = await db.dailyDelivery.findMany({
    where: {
      day,
      state: { in: ["SCHEDULED", "ATTENTION", "MATERIALIZED"] },
      plan: { state: "ACTIVE" },
    },
    include: {
      plan: true,
      order: { select: { code: true, fulfillment: true } },
    },
    orderBy: [{ startHour: "asc" }, { id: "asc" }],
  });
  const cell = (value: unknown) => {
    let text = String(value ?? "");
    if (/^[=+\-@\t\r]/.test(text)) text = "'" + text;
    return '"' + text.replaceAll('"', '""') + '"';
  };
  const lines: unknown[][] = [
    [
      "Ngày",
      "Khung giao",
      "Gói Daily",
      "Mã đơn",
      "Mẫu hoa",
      "Size",
      "Số bó",
      "Người nhận",
      "Điện thoại",
      "Địa chỉ",
      "Người gửi",
      "Cách viết thiệp",
      "Lời nhắn",
      "Duyệt mẫu",
      "Ghi chú xử lý",
    ],
  ];
  for (const d of rows) {
    const s = d.selectionSnapshot as DailyOfferingView | null;
    lines.push([
      d.day,
      d.slotLabel,
      d.plan.code,
      d.order?.code ?? "Chưa sinh đơn",
      s?.name,
      s?.variantName,
      1,
      d.plan.recipientName,
      d.plan.recipientPhone,
      d.plan.address,
      d.plan.senderName,
      d.writingMode === "HANDWRITTEN"
        ? "Viết tay - để trống bản in"
        : "In tự động",
      d.message,
      d.approved ? "Đã duyệt" : "Cần duyệt",
      d.issue,
    ]);
  }
  return "\uFEFF" + lines.map((row) => row.map(cell).join(",")).join("\r\n");
}
