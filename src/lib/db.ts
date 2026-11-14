import { PrismaClient } from "@prisma/client";
import { PrismaMariaDb } from "@prisma/adapter-mariadb";
const globalDb = globalThis as unknown as { prisma?: PrismaClient };
const url = new URL(
  process.env.DATABASE_URL ?? "mysql://root:@127.0.0.1:3306/fleurious_shop",
);
const adapter = new PrismaMariaDb({
  host: url.hostname,
  port: Number(url.port || 3306),
  user: decodeURIComponent(url.username),
  password: decodeURIComponent(url.password),
  database: url.pathname.slice(1),
  connectionLimit: 5,
  timezone: "+00:00",
  ...(url.searchParams.get("sslaccept") === "strict" ||
  url.hostname.endsWith(".tidbcloud.com")
    ? { ssl: { rejectUnauthorized: true } }
    : {}),
});
export const db = globalDb.prisma ?? new PrismaClient({ adapter });
if (process.env.NODE_ENV !== "production") globalDb.prisma = db;
