import { readFile, writeFile } from "node:fs/promises";
import { createECDH } from "node:crypto";
import { parse } from "dotenv";
import * as webpush from "web-push";

async function main() {
  const files = process.argv.slice(2);
  if (!files.length) files.push(".env.local");
  const records = await Promise.all(
    files.map(async (file) => {
      const text = await readFile(file, "utf8").catch(
        (error: NodeJS.ErrnoException) => {
          if (error.code === "ENOENT") return "";
          throw error;
        },
      );
      return { file, text, env: parse(text) };
    }),
  );
  const configured = records.filter(
    ({ env }) => env.VAPID_PUBLIC_KEY || env.VAPID_PRIVATE_KEY,
  );
  let keys: { publicKey: string; privateKey: string };
  if (configured.length) {
    const first = configured[0].env;
    if (!first.VAPID_PUBLIC_KEY || !first.VAPID_PRIVATE_KEY)
      throw new Error(
        "Cặp VAPID hiện tại chưa đầy đủ. Khôi phục đủ hai khóa trước khi chạy lại.",
      );
    keys = {
      publicKey: first.VAPID_PUBLIC_KEY,
      privateKey: first.VAPID_PRIVATE_KEY,
    };
    const curve = createECDH("prime256v1");
    curve.setPrivateKey(Buffer.from(keys.privateKey, "base64url"));
    if (
      curve.getPublicKey().toString("base64url") !== keys.publicKey ||
      configured.some(
        ({ env }) =>
          env.VAPID_PUBLIC_KEY !== keys.publicKey ||
          env.VAPID_PRIVATE_KEY !== keys.privateKey,
      )
    )
      throw new Error(
        "Các khóa VAPID không khớp. Không ghi đè để tránh mất đăng ký thiết bị.",
      );
  } else keys = webpush.generateVAPIDKeys();
  const subject =
    configured[0]?.env.VAPID_SUBJECT || "https://fleurious-shop.vercel.app";
  webpush.setVapidDetails(subject, keys.publicKey, keys.privateKey);
  const values = {
    VAPID_PUBLIC_KEY: keys.publicKey,
    VAPID_PRIVATE_KEY: keys.privateKey,
    VAPID_SUBJECT: subject,
  };
  for (const record of records) {
    let text = record.text;
    for (const [name, value] of Object.entries(values)) {
      const line = `${name}=${JSON.stringify(value)}`;
      const pattern = new RegExp(`^${name}=.*$`, "m");
      text = pattern.test(text)
        ? text.replace(pattern, line)
        : `${text.trimEnd()}\n${line}\n`;
    }
    await writeFile(record.file, text, { mode: 0o600 });
  }
  console.log(
    `Đã thiết lập VAPID trong ${files.join(", ")}. Khóa được giữ riêng trong các file env.`,
  );
}
main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
