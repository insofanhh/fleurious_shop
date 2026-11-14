import "dotenv/config";
import test from "node:test";
import assert from "node:assert/strict";
import {
  dayKey,
  monthKey,
  streakStats,
  localInstant,
  shiftDay,
} from "../src/lib/time";
import { encrypt, decrypt } from "../src/lib/security";
import { settingsSchema, defaultSettings } from "../src/lib/settings";
test("Hà Nội changes day and quota month at 17:00 UTC", () => {
  assert.equal(dayKey(new Date("2026-11-30T16:59:59Z")), "2026-11-30");
  assert.equal(dayKey(new Date("2026-11-30T17:00:00Z")), "2026-12-01");
  assert.equal(monthKey(new Date("2026-11-30T17:00:00Z")), "2026-12");
  assert.equal(
    localInstant("2026-12-01").toISOString(),
    "2026-11-30T17:00:00.000Z",
  );
});
test("consecutive days and monthly days are independent", () => {
  assert.deepEqual(
    streakStats(
      ["2026-11-01", "2026-11-02", "2026-11-03", "2026-11-07", "2026-11-09"],
      "2026-11-09",
    ),
    { current: 1, longest: 3, monthly: 5, todayActive: true },
  );
});
test("yesterday's streak is still available to continue today", () => {
  assert.equal(
    streakStats(["2026-11-13", "2026-11-14"], "2026-11-15").current,
    2,
  );
  assert.equal(
    streakStats(["2026-11-13", "2026-11-14"], "2026-11-16").current,
    0,
  );
});
test("streak crosses months, monthly counter does not", () => {
  const result = streakStats(
    ["2026-11-29", "2026-11-30", "2026-12-01"],
    "2026-12-01",
  );
  assert.equal(result.current, 3);
  assert.equal(result.monthly, 1);
  assert.equal(shiftDay("2028-02-28", 1), "2028-02-29");
});
test("encrypted QR tokens round trip and reject tampering", () => {
  const encrypted = encrypt("qr-token-private");
  assert.equal(decrypt(encrypted), "qr-token-private");
  const bytes = Buffer.from(encrypted, "base64url");
  bytes[15] ^= 1;
  assert.throws(() => decrypt(bytes.toString("base64url")));
});
test("admin cannot publish negative quotas or uncapped discounts", () => {
  assert.equal(
    settingsSchema.safeParse({ ...defaultSettings, memberQuota: -1 }).success,
    false,
  );
  assert.equal(
    settingsSchema.safeParse({ ...defaultSettings, memberPercent: 101 })
      .success,
    false,
  );
});
