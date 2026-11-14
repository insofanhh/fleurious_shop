import { z } from "zod";
import { db } from "./db";
import type {Prisma} from "@prisma/client";
export const settingsSchema = z.object({
  shopName: z.string().min(1).max(80),
  phone: z.string().max(30),
  address: z.string().max(200),
  memberEnabled: z.boolean(),
  memberQuota: z.number().int().min(0).max(100),
  memberPercent: z.number().int().min(0).max(50),
  memberCap: z.number().int().min(0).max(1000000),
  bloomSpend: z.number().int().min(0),
  burgundySpend: z.number().int().min(0),
  streakEnabled: z.boolean(),
  qrMaxClaims: z.number().int().min(1).max(10),
  qrHours: z.number().int().min(1).max(168),
  qrTrigger: z.enum(["CONFIRMED", "DELIVERED"]),
  minimumLeadHours: z.number().int().min(0).max(168),
  monthlyThreshold: z.number().int().min(1).max(31),
  monthlyPercent: z.number().int().min(1).max(30),
  consecutiveThreshold: z.number().int().min(2).max(60),
  consecutivePercent: z.number().int().min(1).max(30),
  rewardCap: z.number().int().min(0).max(1000000),
  rewardMinimum: z.number().int().min(0).max(10000000),
  rewardDays: z.number().int().min(1).max(365),
  campaignBudget: z.number().int().min(0),
  campaignName: z.string().min(1).max(100),
  codEnabled: z.boolean(),
  blackoutDates: z.array(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)).max(366),
});
export type ShopSettings = z.infer<typeof settingsSchema>;
export const defaultSettings: ShopSettings = {
  shopName: "Fleurious",
  phone: "024 7300 8899",
  address: "Hà Nội, Việt Nam",
  memberEnabled: true,
  memberQuota: 3,
  memberPercent: 10,
  memberCap: 100000,
  bloomSpend: 2000000,
  burgundySpend: 8000000,
  streakEnabled: true,
  qrMaxClaims: 1,
  qrHours: 72,
  qrTrigger: "CONFIRMED",
  minimumLeadHours: 2,
  monthlyThreshold: 5,
  monthlyPercent: 2,
  consecutiveThreshold: 5,
  consecutivePercent: 5,
  rewardCap: 50000,
  rewardMinimum: 300000,
  rewardDays: 30,
  campaignBudget: 5000000,
  campaignName: "Những ngày có hoa",
  codEnabled: true,
  blackoutDates: [],
};
export async function getSettings(client:Prisma.TransactionClient|typeof db=db) {
  const row = await client.setting.findUnique({ where: { key: "shop" } });
  return settingsSchema.parse({
    ...defaultSettings,
    ...((row?.value as object) ?? {}),
  });
}
