import "dotenv/config";
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
const base = process.env.APP_URL ?? "http://localhost:3000";
async function main() {
  let response = await fetch(`${base}/api/admin/settings`);
  assert.equal(response.status, 401);
  response = await fetch(`${base}/api/auth/login`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: "https://untrusted.example",
    },
    body: JSON.stringify({}),
  });
  assert.equal(response.status, 403);
  const file = readFileSync(".local-access.txt", "utf8");
  const password = file.match(/Mật khẩu cho hai tài khoản: (.+)/)?.[1]?.trim();
  assert.ok(password);
  response = await fetch(`${base}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: base },
    body: JSON.stringify({ email: "admin@fleurious.local", password }),
  });
  assert.equal(response.status, 200);
  const cookie = response.headers.get("set-cookie")!.split(";")[0];
  for (const section of [
    "overview",
    "orders",
    "calendar",
    "products",
    "taxonomies",
    "reviews",
    "inventory",
    "customers",
    "members",
    "streaks",
    "vouchers",
    "delivery",
    "analytics",
    "payments",
    "content",
    "team",
    "settings",
    "jobs",
    "audit",
  ]) {
    const r = await fetch(`${base}/api/admin/${section}`, {
      headers: { cookie },
    });
    assert.equal(r.status, 200, section);
    await r.json();
    console.log(`PASS admin/${section}`);
  }
  for (const path of [
    "/",
    "/flowers",
    "/flowers/burgundy-whisper",
    "/membership",
    "/streak",
    "/auth/login",
    "/manifest.webmanifest",
    "/sw.js",
  ]) {
    const r = await fetch(`${base}${path}`);
    assert.equal(r.status, 200, path);
    console.log(`PASS ${path}`);
  }
  response = await fetch(`${base}/api/membership/tiers`);
  assert.equal(response.status, 200);
  const tiers = await response.json();
  assert.ok(tiers.some((t: { code: string }) => t.code === "Member"));
  for (const t of tiers.filter((t: { rank: number }) => t.rank > 0))
    if (t.monthlyEnabled && t.yearlyEnabled)
      assert.ok(t.yearlyPrice < t.monthlyPrice * 12);
  response = await fetch(`${base}/api/membership/me`, { headers: { cookie } });
  assert.equal(response.status, 200);
  const membership = await response.json();
  assert.ok(membership.summary && Array.isArray(membership.invoices));
  console.log("PASS membership catalog, pricing and private summary");
  response = await fetch(`${base}/api/auth/logout`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: base, cookie },
    body: "{}",
  });
  assert.equal(response.status, 200);
  console.log(
    "HTTP smoke passed; no orders or real bank transactions were created.",
  );
}
main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
