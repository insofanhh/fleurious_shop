import * as OTPAuth from "otpauth";
import { randomBytes } from "node:crypto";
import { encrypt, decrypt, hash, equal } from "./security";
import { db } from "./db";
import { atomic } from "./commerce";
function authenticator(secret: string, email = "account") {
  return new OTPAuth.TOTP({
    issuer: "Fleurious",
    label: email,
    algorithm: "SHA1",
    digits: 6,
    period: 30,
    secret: OTPAuth.Secret.fromBase32(secret),
  });
}
export function setupMfa(email: string) {
  const secret = new OTPAuth.Secret({ size: 20 }).base32;
  return {
    secret,
    encrypted: encrypt(secret),
    uri: authenticator(secret, email).toString(),
  };
}
export function validOtp(encrypted: string, code: string) {
  return authenticator(decrypt(encrypted)).validate({ token: code, window: 1 });
}
export function recoveryCodes() {
  const codes = Array.from({ length: 8 }, () =>
    randomBytes(6).toString("hex").toUpperCase(),
  );
  return { codes, hashes: codes.map(hash) };
}
export async function verifyMfa(userId: string, code: string) {
  return atomic(async (tx) => {
    await tx.$queryRaw`SELECT id FROM User WHERE id=${userId} FOR UPDATE`;
    const user = await tx.user.findUniqueOrThrow({ where: { id: userId } });
    if (!user.totpEnabled || !user.totpSecretEncrypted) return false;
    if (/^\d{6}$/.test(code)) {
      const delta = validOtp(user.totpSecretEncrypted, code);
      if (delta === null) return false;
      const step = Math.floor(Date.now() / 30000) + delta;
      if (step <= user.totpLastStep) return false;
      await tx.user.update({
        where: { id: userId },
        data: { totpLastStep: step },
      });
      return true;
    }
    const hashes = (user.recoveryHashes as string[] | null) ?? [];
    const candidate = hash(code.trim().toUpperCase());
    const index = hashes.findIndex((v) => equal(v, candidate));
    if (index < 0) return false;
    await tx.user.update({
      where: { id: userId },
      data: { recoveryHashes: hashes.filter((_, i) => i !== index) },
    });
    return true;
  });
}
