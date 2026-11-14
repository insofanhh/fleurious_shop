import { parse } from "dotenv";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import mariadb from "mariadb";

async function main() {
  if (!process.argv.includes("--copy"))
    throw new Error(
      "Pass --copy to copy a local snapshot into an EMPTY TiDB database.",
    );
  const local = parse(await readFile(".env"));
  const remote = parse(await readFile(".env.deploy.local"));
  const sourceUrl = new URL(local.DATABASE_URL);
  const targetUrl = new URL(remote.DATABASE_URL);
  if (
    !["localhost", "127.0.0.1"].includes(sourceUrl.hostname) ||
    !targetUrl.hostname.endsWith(".tidbcloud.com")
  )
    throw new Error("Expected local MySQL source and TiDB Cloud destination.");
  const connect = (url: URL, ssl: boolean) =>
    mariadb.createConnection({
      host: url.hostname,
      port: Number(url.port || 3306),
      user: decodeURIComponent(url.username),
      password: decodeURIComponent(url.password),
      database: url.pathname.slice(1),
      timezone: "+00:00",
      dateStrings: true,
      autoJsonMap: false,
      ...(ssl ? { ssl: { rejectUnauthorized: true } } : {}),
    });
  const source = await connect(sourceUrl, false),
    target = await connect(targetUrl, true);
  const quote = (s: string) => {
    if (!/^[a-zA-Z0-9_]+$/.test(s))
      throw new Error("Unexpected SQL identifier");
    return `\`${s}\``;
  };
  try {
    const all = await source.query("SHOW TABLES");
    const tables = all
      .map((r: Record<string, string>) => Object.values(r)[0])
      .filter((t: string) => t !== "_prisma_migrations");
    for (const table of tables) {
      const [row] = await target.query(
        `SELECT COUNT(*) AS n FROM ${quote(table)}`,
      );
      if (Number(row.n) !== 0)
        throw new Error(
          `Destination table ${table} is not empty; refusing to overwrite.`,
        );
    }
    await source.query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ");
    await source.query("START TRANSACTION WITH CONSISTENT SNAPSHOT");
    const snapshot: { table: string; columns: string[]; rows: unknown[][] }[] =
      [];
    for (const table of tables) {
      const rows = await source.query({
        sql: `SELECT * FROM ${quote(table)}`,
        rowsAsArray: true,
      });
      snapshot.push({
        table,
        columns: rows.meta.map((c: { name(): string }) => c.name()),
        rows: Array.from(rows, (row: unknown[]) =>
          row.map((value) =>
            value !== null &&
            typeof value === "object" &&
            !Buffer.isBuffer(value)
              ? JSON.stringify(value)
              : value,
          ),
        ),
      });
    }
    await source.commit();
    await mkdir("backups", { recursive: true });
    const file = `backups/local-to-tidb-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
    await writeFile(
      file,
      JSON.stringify(snapshot, (_, value) =>
        typeof value === "bigint" ? { bigint: value.toString() } : value,
      ),
    );
    console.log(`Local consistent snapshot saved to ${file}`);
    await target.query("SET FOREIGN_KEY_CHECKS = 0");
    await target.beginTransaction();
    try {
      for (const table of snapshot) {
        for (let offset = 0; offset < table.rows.length; offset += 50) {
          const batch = table.rows.slice(offset, offset + 50);
          const placeholder = `(${table.columns.map(() => "?").join(",")})`;
          await target.query(
            `INSERT INTO ${quote(table.table)} (${table.columns.map(quote).join(",")}) VALUES ${batch.map(() => placeholder).join(",")}`,
            batch.flat(),
          );
        }
      }
      await target.commit();
    } catch (error) {
      await target.rollback();
      throw error;
    } finally {
      await target.query("SET FOREIGN_KEY_CHECKS = 1");
    }
    let records = 0;
    for (const table of snapshot) {
      const [row] = await target.query(
        `SELECT COUNT(*) AS n FROM ${quote(table.table)}`,
      );
      if (Number(row.n) !== table.rows.length)
        throw new Error(`Count mismatch: ${table.table}`);
      records += table.rows.length;
    }
    console.log(
      `Verified ${records} records across ${snapshot.length} tables; source database unchanged.`,
    );
  } finally {
    await source.end();
    await target.end();
  }
}
main().catch((e) => {
  console.error(e instanceof Error ? e.message : "Migration failed");
  process.exitCode = 1;
});
