import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { db } from "./db";
import { atomic } from "./transaction";
import { decrypt, encrypt, equal, token } from "./security";
import { fail } from "./errors";

const settingKey = "sepay_payment";
type Client = typeof db | Prisma.TransactionClient;
type Stored = {
  enabled: boolean;
  bank: string;
  accountNumber: string;
  accountName: string;
  webhookKeyEncrypted: string;
  apiTokenEncrypted: string;
};
export type SepayConfig = {
  enabled: boolean;
  bank: string;
  accountNumber: string;
  accountName: string;
  webhookKey: string;
  apiToken: string;
  configured: boolean;
};
export type SepayAdminView = SepayConfig & {
  version: number;
  webhookUrl: string;
};
function environmentConfig() {
  return {
    enabled: true,
    bank: process.env.SEPAY_BANK ?? "",
    accountNumber: process.env.SEPAY_ACCOUNT_NUMBER ?? "",
    accountName: process.env.SEPAY_ACCOUNT_NAME ?? "",
    webhookKey: process.env.SEPAY_WEBHOOK_KEY ?? "",
    apiToken: process.env.SEPAY_API_TOKEN ?? "",
  };
}
function storedConfig(config: Omit<SepayConfig, "configured">): Stored {
  return {
    enabled: config.enabled,
    bank: config.bank,
    accountNumber: config.accountNumber,
    accountName: config.accountName,
    webhookKeyEncrypted: encrypt(config.webhookKey),
    apiTokenEncrypted: config.apiToken ? encrypt(config.apiToken) : "",
  };
}
export async function getSepayConfig(
  client: Client = db,
): Promise<SepayConfig> {
  const row = await client.setting.findUnique({ where: { key: settingKey } });
  const value = row?.value as Stored | undefined;
  const config = value
    ? {
        enabled: value.enabled,
        bank: value.bank,
        accountNumber: value.accountNumber,
        accountName: value.accountName,
        webhookKey: decrypt(value.webhookKeyEncrypted),
        apiToken: value.apiTokenEncrypted
          ? decrypt(value.apiTokenEncrypted)
          : "",
      }
    : environmentConfig();
  return {
    ...config,
    configured: !!(
      config.enabled &&
      config.bank &&
      config.accountNumber &&
      config.webhookKey
    ),
  };
}
/** Checkout and a destination change must not pass one another before either commits. */
export async function lockSepayConfig(tx: Prisma.TransactionClient) {
  await tx.setting.createMany({
    data: [{ key: "sepay_guard", value: {} }],
    skipDuplicates: true,
  });
  await tx.$queryRaw`SELECT \`key\` FROM Setting WHERE \`key\`='sepay_guard' FOR UPDATE`;
  return getSepayConfig(tx);
}
export function sepayQrUrl(config: SepayConfig, amount: number, code: string) {
  if (!config.configured) return undefined;
  return `https://vietqr.app/img?${new URLSearchParams({ acc: config.accountNumber, bank: config.bank, holder: config.accountName, amount: String(amount), des: code, template: "compact", showinfo: "true" })}`;
}
export async function verifySepayAuthorization(header: string | null) {
  const config = await getSepayConfig();
  if (!config.configured)
    fail(
      "NOT_CONFIGURED",
      "Thanh toán SePay chưa được bật hoặc cấu hình đầy đủ.",
      503,
    );
  if (!equal(header ?? "", `Apikey ${config.webhookKey}`))
    fail("UNAUTHORIZED", "Unauthorized", 401);
}
function requireOwner(actor: { id: string; role: string }) {
  if (actor.role !== "OWNER")
    fail(
      "FORBIDDEN",
      "Chỉ chủ cửa hàng được quản lý tài khoản nhận tiền và khóa SePay.",
      403,
    );
}
async function ensureSettings() {
  const existing = await db.setting.findUnique({ where: { key: settingKey } });
  if (existing) return existing;
  const env = environmentConfig();
  await db.setting.createMany({
    data: [
      {
        key: settingKey,
        value: storedConfig({ ...env, webhookKey: env.webhookKey || token() }),
      },
    ],
    skipDuplicates: true,
  });
  return db.setting.findUniqueOrThrow({ where: { key: settingKey } });
}
export async function getSepayAdminView(actor: {
  id: string;
  role: string;
}): Promise<SepayAdminView> {
  requireOwner(actor);
  await ensureSettings();
  return adminView();
}
async function adminView(): Promise<SepayAdminView> {
  const row = await db.setting.findUniqueOrThrow({
    where: { key: settingKey },
  });
  const config = await getSepayConfig();
  return {
    ...config,
    version: row.version,
    webhookUrl: new URL(
      "/api/payments/sepay/webhook",
      process.env.APP_URL ?? "http://localhost:3000",
    ).href,
  };
}
export const sepaySettingsSchema = z
  .object({
    version: z.number().int().min(1),
    enabled: z.boolean(),
    bank: z
      .string()
      .trim()
      .max(40)
      .regex(
        /^[a-zA-Z0-9]*$/,
        "Nhập mã ngân hàng hoặc BIN, ví dụ VCB, MB, 970436.",
      ),
    accountNumber: z
      .string()
      .trim()
      .max(50)
      .regex(
        /^[a-zA-Z0-9]*$/,
        "Số tài khoản chỉ gồm chữ và số, không có khoảng trắng.",
      ),
    accountName: z.string().trim().max(100),
    apiToken: z
      .string()
      .trim()
      .max(4000)
      .regex(/^[^\r\n]*$/, "Token API không được có ký tự xuống dòng.")
      .default(""),
  })
  .superRefine((value, context) => {
    if (value.enabled)
      for (const field of ["bank", "accountNumber", "accountName"] as const)
        if (!value[field])
          context.addIssue({
            code: "custom",
            path: [field],
            message:
              "Điền đầy đủ ngân hàng, số tài khoản và tên chủ tài khoản để bật SePay.",
          });
  });
export async function saveSepaySettings(
  actor: { id: string; role: string },
  raw: unknown,
) {
  requireOwner(actor);
  const input = sepaySettingsSchema.parse(raw);
  await ensureSettings();
  await atomic(async (tx) => {
    await lockSepayConfig(tx);
    await tx.$queryRaw`SELECT \`key\` FROM Setting WHERE \`key\`='sepay_payment' FOR UPDATE`;
    const row = await tx.setting.findUniqueOrThrow({
      where: { key: settingKey },
    });
    if (row.version !== input.version)
      fail(
        "CONFLICT",
        "Cấu hình SePay đã thay đổi. Tải lại trước khi lưu.",
        409,
      );
    const previous = await getSepayConfig(tx);
    // Avoid rerouting bank transfers for already issued, unexpired payment requests.
    const destinationChanged =
      previous.bank !== input.bank ||
      previous.accountNumber !== input.accountNumber ||
      (previous.enabled && !input.enabled);
    if (previous.configured && destinationChanged) {
      const now = new Date();
      const pending =
        (await tx.order.count({
          where: {
            paymentMethod: "SEPAY",
            paymentStatus: { in: ["UNPAID", "PENDING"] },
            status: { not: "CANCELLED" },
            OR: [{ manualPayment: true }, { expiresAt: { gt: now } }],
          },
        })) +
        (await tx.membershipInvoice.count({
          where: { status: "PENDING", expiresAt: { gt: now } },
        })) +
        (await tx.dailyInvoice.count({
          where: { state: "PENDING", expiresAt: { gt: now } },
        }));
      if (pending)
        fail(
          "PAYMENTS_PENDING",
          `Còn ${pending} yêu cầu SePay đang chờ thanh toán. Xử lý hoặc chờ hết hạn trước khi đổi tài khoản / tắt SePay.`,
          409,
        );
    }
    const next = storedConfig({ ...input, webhookKey: previous.webhookKey });
    await tx.setting.update({
      where: { key: settingKey },
      data: { value: next, version: { increment: 1 } },
    });
    if (destinationChanged) {
      const reconcile = await tx.setting.findUnique({
        where: { key: "sepay_reconcile" },
      });
      const lease = (reconcile?.value as { leasedUntil?: string } | undefined)
        ?.leasedUntil;
      if (lease && new Date(lease) > new Date())
        fail(
          "RECONCILE_BUSY",
          "Đối soát SePay đang chạy. Vui lòng đợi tác vụ hoàn tất trước khi đổi tài khoản.",
          409,
        );
      await tx.setting.deleteMany({ where: { key: "sepay_reconcile" } });
    }
    await tx.audit.create({
      data: {
        actorId: actor.id,
        action: "settings.sepay.updated",
        entityId: settingKey,
        detail: {
          enabled: input.enabled,
          bank: input.bank,
          accountEnding: input.accountNumber.slice(-4),
          apiTokenChanged: previous.apiToken !== input.apiToken,
        },
      },
    });
    await tx.outbox.create({
      data: { event: "settings.payment_changed", payload: {} },
    });
  });
  return adminView();
}
export async function rotateSepayWebhookKey(
  actor: { id: string; role: string },
  version: number,
) {
  requireOwner(actor);
  await atomic(async (tx) => {
    await tx.$queryRaw`SELECT \`key\` FROM Setting WHERE \`key\`='sepay_payment' FOR UPDATE`;
    const row = await tx.setting.findUniqueOrThrow({
      where: { key: settingKey },
    });
    if (row.version !== version)
      fail(
        "CONFLICT",
        "Cấu hình đã thay đổi. Tải lại trước khi tạo khóa mới.",
        409,
      );
    const stored = row.value as Stored;
    await tx.setting.update({
      where: { key: settingKey },
      data: {
        value: { ...stored, webhookKeyEncrypted: encrypt(token()) },
        version: { increment: 1 },
      },
    });
    await tx.audit.create({
      data: {
        actorId: actor.id,
        action: "settings.sepay.key_rotated",
        entityId: settingKey,
        detail: {},
      },
    });
  });
  return adminView();
}
