// One-time compatibility repair for this newly created local project: Windows
// MySQL folds names to lowercase, while Linux MySQL preserves model table names.
import "dotenv/config";
import { readFile, readdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { PrismaMariaDb } from "@prisma/adapter-mariadb";
async function main() {
  if (process.env.NODE_ENV === "production")
    throw new Error("Local development only");
  const url = new URL(process.env.DATABASE_URL!);
  if (
    !["localhost", "127.0.0.1"].includes(url.hostname) ||
    url.pathname !== "/fleurious_shop"
  )
    throw new Error("Unexpected local database");
  const schema = await readFile("prisma/schema.prisma", "utf8");
  const names = new Map(
    [...schema.matchAll(/^model (\w+) /gm)].map((m) => [
      m[1].toLowerCase(),
      m[1],
    ]),
  );
  const repairs: { name: string; before: string; after: string }[] = [];
  for (const name of await readdir("prisma/migrations")) {
    if (!/^\d+_/.test(name)) continue;
    const file = `prisma/migrations/${name}/migration.sql`;
    const original = await readFile(file, "utf8");
    const normalized = original.replace(
      /(ALTER TABLE|CREATE TABLE|REFERENCES|ON) `([^`]+)`/g,
      (all, verb, table) =>
        names.has(table.toLowerCase())
          ? `${verb} \`${names.get(table.toLowerCase())}\``
          : all,
    );
    if (normalized !== original) {
      await writeFile(file, normalized);
      const digest = (s: string) =>
        createHash("sha256").update(s).digest("hex");
      repairs.push({
        name,
        before: digest(original),
        after: digest(normalized),
      });
    }
  }
  for (const database of ["fleurious_shop", "fleurious_shop_test"]) {
    const client = new PrismaClient({
      adapter: new PrismaMariaDb({
        host: url.hostname,
        port: Number(url.port || 3306),
        user: decodeURIComponent(url.username),
        password: decodeURIComponent(url.password),
        database,
        connectionLimit: 1,
      }),
    });
    try {
      for (const r of repairs)
        await client.$executeRaw`UPDATE _prisma_migrations SET checksum=${r.after} WHERE migration_name=${r.name} AND checksum=${r.before} AND finished_at IS NOT NULL`;
    } finally {
      await client.$disconnect();
    }
  }
  console.log(
    `Normalized ${repairs.length} migration files for case-sensitive Linux installs.`,
  );
}
main().catch((e) => {
  console.error(e.message);
  process.exitCode = 1;
});
