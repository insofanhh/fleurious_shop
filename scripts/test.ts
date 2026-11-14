import "dotenv/config";
import { spawnSync } from "node:child_process";
import { PrismaClient } from "@prisma/client";
import { PrismaMariaDb } from "@prisma/adapter-mariadb";
async function main() {
  const url = new URL(
    process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL!,
  );
  if (!process.env.TEST_DATABASE_URL) url.pathname = `${url.pathname}_test`;
  const name = url.pathname.slice(1);
  if (!/^[a-zA-Z0-9_]+_test$/.test(name))
    throw new Error("Tests chỉ được phép dùng database có hậu tố _test.");
  const admin = new PrismaClient({
    adapter: new PrismaMariaDb({
      host: url.hostname,
      port: Number(url.port || 3306),
      user: decodeURIComponent(url.username),
      password: decodeURIComponent(url.password),
      database: "information_schema",
      connectionLimit: 1,
    }),
  });
  await admin.$executeRawUnsafe(
    `CREATE DATABASE IF NOT EXISTS \`${name}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,
  );
  await admin.$disconnect();
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    DATABASE_URL: url.toString(),
    NODE_ENV: "test",
  };
  for (const args of [
    ["node_modules/prisma/build/index.js", "migrate", "deploy"],
    [
      "--import",
      "tsx",
      "--test",
      "--test-concurrency=1",
      "--test-timeout=60000",
      "tests/rules.test.ts",
      "tests/commerce.test.ts",
      "tests/membership.test.ts",
      "tests/notifications.test.ts",
      "tests/sepay-settings.test.ts",
      "tests/flower-card.test.ts",
      "tests/cloud-schedule.test.ts",
    ],
  ]) {
    const result = spawnSync(process.execPath, args, { stdio: "inherit", env });
    if (result.status !== 0) process.exit(result.status ?? 1);
  }
}
main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
