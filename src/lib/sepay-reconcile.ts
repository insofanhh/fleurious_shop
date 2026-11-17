import { getSepayConfig } from "./sepay-settings";
import { z } from "zod";
import { formatInTimeZone } from "date-fns-tz";
import { db } from "./db";
import { atomic } from "./transaction";
import { receiveSepay } from "./commerce";
import { TIMEZONE } from "./time";
import { token } from "./security";

const transactionSchema = z.object({
  id: z.string().min(1).max(100),
  account_number: z.string(),
  transfer_type: z.enum(["in", "out"]),
  amount_in: z.number().int().nonnegative(),
  transaction_content: z.string().default(""),
  reference_number: z.string().nullish(),
  code: z.string().nullish(),
});
const responseSchema = z.object({
  status: z.literal("success"),
  data: z.array(transactionSchema),
  meta: z.object({ pagination: z.object({ has_more: z.boolean() }) }),
});
type Checkpoint = {
  lastComplete?: string;
  from?: string;
  until?: string;
  page?: number;
  leasedUntil?: string;
  owner?: string;
};

/** Optional read-only SePay v2 reconciliation. All activation still uses the authenticated payment pipeline. */
export async function reconcileSepay(
  options: {
    accessToken?: string;
    fetcher?: typeof fetch;
    delayMs?: number;
  } = {},
) {
  const config = await getSepayConfig();
  const accessToken = options.accessToken ?? config.apiToken;
  if (!config.configured || !accessToken)
    return { configured: false, processed: 0 };
  const owner = token();
  const checkpoint = await atomic(async (tx) => {
    await tx.setting.upsert({
      where: { key: "sepay_reconcile" },
      create: { key: "sepay_reconcile", value: {} },
      update: {},
    });
    await tx.$queryRaw`SELECT \`key\` FROM Setting WHERE \`key\`='sepay_reconcile' FOR UPDATE`;
    const row = await tx.setting.findUniqueOrThrow({
        where: { key: "sepay_reconcile" },
      }),
      old = row.value as Checkpoint;
    if (old.leasedUntil && new Date(old.leasedUntil) > new Date()) return null;
    const now = new Date();
    const state: Checkpoint = {
      ...old,
      from:
        old.from ??
        new Date(
          old.lastComplete
            ? new Date(old.lastComplete).getTime() - 15 * 60000
            : now.getTime() - 86400000,
        ).toISOString(),
      until: old.until ?? now.toISOString(),
      page: old.page ?? 1,
      owner,
      leasedUntil: new Date(now.getTime() + 5 * 60000).toISOString(),
    };
    await tx.setting.update({
      where: { key: "sepay_reconcile" },
      data: { value: state },
    });
    return state;
  });
  if (!checkpoint) return { configured: true, busy: true, processed: 0 };
  let processed = 0;
  try {
    for (let batch = 0; batch < 20; batch++) {
      const params = new URLSearchParams({
        transaction_date_from: formatInTimeZone(
          new Date(checkpoint.from!),
          TIMEZONE,
          "yyyy-MM-dd HH:mm:ss",
        ),
        transaction_date_to: formatInTimeZone(
          new Date(checkpoint.until!),
          TIMEZONE,
          "yyyy-MM-dd HH:mm:ss",
        ),
        transfer_type: "in",
        transaction_date_sort: "asc",
        per_page: "100",
        page: String(checkpoint.page),
        timestamp_format: "iso8601",
      });
      const response = await (options.fetcher ?? fetch)(
        `https://userapi.sepay.vn/v2/transactions?${params}`,
        {
          headers: { authorization: `Bearer ${accessToken}` },
          cache: "no-store",
          signal: AbortSignal.timeout(10000),
        },
      );
      if (!response.ok)
        throw new Error(
          `SePay reconciliation HTTP ${response.status}; sẽ thử lại theo job.`,
        );
      const parsed = responseSchema.parse(await response.json());
      for (const t of parsed.data) {
        if (
          t.account_number !== config.accountNumber ||
          t.transfer_type !== "in" ||
          !t.amount_in ||
          !/\bFL[RMD][A-F0-9]{12}\b/.test(
            `${t.code ?? ""} ${t.transaction_content}`.toUpperCase(),
          )
        )
          continue;
        // Existing v1 records predate the alias hash. Avoid replaying a known bank reference.
        const legacy = t.reference_number
          ? await db.payment.findFirst({
              where: {
                reference: t.reference_number,
                amount: t.amount_in,
                identityHash: null,
              },
            })
          : null;
        if (legacy) continue;
        await receiveSepay({
          id: t.id,
          accountNumber: t.account_number,
          transferType: "in",
          transferAmount: t.amount_in,
          content: t.transaction_content,
          code: t.code,
          referenceCode: t.reference_number ?? undefined,
        });
        processed++;
      }
      if (!parsed.meta.pagination.has_more) {
        await atomic(async (tx) => {
          await tx.$queryRaw`SELECT \`key\` FROM Setting WHERE \`key\`='sepay_reconcile' FOR UPDATE`;
          const row = await tx.setting.findUniqueOrThrow({
            where: { key: "sepay_reconcile" },
          });
          if ((row.value as Checkpoint).owner === owner)
            await tx.setting.update({
              where: { key: "sepay_reconcile" },
              data: { value: { lastComplete: checkpoint.until! } },
            });
        });
        return { configured: true, processed, complete: true };
      }
      checkpoint.page = (checkpoint.page ?? 1) + 1;
      await atomic(async (tx) => {
        await tx.$queryRaw`SELECT \`key\` FROM Setting WHERE \`key\`='sepay_reconcile' FOR UPDATE`;
        const row = await tx.setting.findUniqueOrThrow({
          where: { key: "sepay_reconcile" },
        });
        if ((row.value as Checkpoint).owner !== owner)
          throw new Error("SePay reconciliation lease changed");
        await tx.setting.update({
          where: { key: "sepay_reconcile" },
          data: { value: checkpoint },
        });
      });
      if ((options.delayMs ?? 400) > 0)
        await new Promise((resolve) =>
          setTimeout(resolve, options.delayMs ?? 400),
        );
    }
    return { configured: true, processed, complete: false };
  } finally {
    await atomic(async (tx) => {
      await tx.$queryRaw`SELECT \`key\` FROM Setting WHERE \`key\`='sepay_reconcile' FOR UPDATE`;
      const row = await tx.setting.findUniqueOrThrow({
        where: { key: "sepay_reconcile" },
      });
      const state = row.value as Checkpoint;
      if (state.owner === owner)
        await tx.setting.update({
          where: { key: "sepay_reconcile" },
          data: { value: { ...state, leasedUntil: new Date(0).toISOString() } },
        });
    });
  }
}
