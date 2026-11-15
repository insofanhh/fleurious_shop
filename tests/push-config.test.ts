import test from "node:test";
import assert from "node:assert/strict";
import * as webpush from "web-push";
import { getPushConfig, getPushPublicKey } from "../src/lib/push-config";

test("client sees a public key only for a complete matching VAPID pair", (t) => {
  const names = [
    "VAPID_PUBLIC_KEY",
    "VAPID_PRIVATE_KEY",
    "VAPID_SUBJECT",
  ] as const;
  const previous = names.map((name) => process.env[name]);
  t.after(() =>
    names.forEach((name, i) => {
      if (previous[i] === undefined) delete process.env[name];
      else process.env[name] = previous[i];
    }),
  );
  const keys = webpush.generateVAPIDKeys();
  process.env.VAPID_PUBLIC_KEY = keys.publicKey;
  delete process.env.VAPID_PRIVATE_KEY;
  assert.equal(getPushConfig(), null);
  assert.equal(getPushPublicKey(), "");
  process.env.VAPID_PRIVATE_KEY = webpush.generateVAPIDKeys().privateKey;
  assert.equal(getPushConfig(), null);
  process.env.VAPID_PRIVATE_KEY = keys.privateKey;
  process.env.VAPID_SUBJECT = "https://fleurious-shop.vercel.app";
  assert.equal(getPushPublicKey(), keys.publicKey);
  const config = getPushConfig()!;
  webpush.setVapidDetails(config.subject, config.publicKey, config.privateKey);
  const headers = webpush.getVapidHeaders(
    "https://web.push.apple.com",
    config.subject,
    config.publicKey,
    config.privateKey,
    "aes128gcm",
  );
  assert.ok(headers.Authorization);
});
