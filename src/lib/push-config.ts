import { createECDH } from "node:crypto";

/** Expose a public key only when its matching server key is also configured. */
export function getPushConfig() {
  const publicKey = process.env.VAPID_PUBLIC_KEY?.trim();
  const privateKey = process.env.VAPID_PRIVATE_KEY?.trim();
  if (!publicKey || !privateKey) return null;
  try {
    const key = createECDH("prime256v1");
    key.setPrivateKey(Buffer.from(privateKey, "base64url"));
    if (key.getPublicKey().toString("base64url") !== publicKey) return null;
    return {
      publicKey,
      privateKey,
      subject:
        process.env.VAPID_SUBJECT?.trim() ||
        process.env.APP_URL ||
        "https://fleurious-shop.vercel.app",
    };
  } catch {
    return null;
  }
}

export function getPushPublicKey() {
  return getPushConfig()?.publicKey ?? "";
}
