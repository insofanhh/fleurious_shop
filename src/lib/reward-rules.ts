import { z } from "zod";
import { db } from "./db";
export const rewardRuleSchema = z
  .object({
    id: z.string().min(1).max(80),
    name: z.string().min(2).max(100),
    kind: z.enum(["monthly", "consecutive"]),
    threshold: z.number().int().min(1).max(366),
    percent: z.number().int().min(1).max(50),
    cap: z.number().int().min(1000).max(1000000),
    minimum: z.number().int().min(0).max(10000000),
    validDays: z.number().int().min(1).max(365),
    productId: z.string().nullable(),
    active: z.boolean(),
    startsOn: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .nullable()
      .default(null),
    endsOn: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .nullable()
      .default(null),
  })
  .refine((v) => !v.startsOn || !v.endsOn || v.startsOn <= v.endsOn, {
    message: "Ngày kết thúc phải sau ngày bắt đầu",
  });
export type RewardRule = z.infer<typeof rewardRuleSchema>;
export const rulesSchema = z.array(rewardRuleSchema).max(20);
export async function getRewardRules() {
  const row = await db.setting.findUnique({ where: { key: "streak_rules" } });
  return {
    rules: rulesSchema.parse(row?.value ?? []),
    version: row?.version ?? 1,
  };
}
