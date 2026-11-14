import "dotenv/config";
import { z } from "zod";
import { hash } from "bcryptjs";
import { db } from "../src/lib/db";
async function main() {
  const email = z.email().parse(process.env.ADMIN_EMAIL).toLowerCase();
  const password = z
    .string()
    .min(12)
    .refine((v) => Buffer.byteLength(v) <= 72)
    .parse(process.env.ADMIN_PASSWORD);
  await db.user.upsert({
    where: { email },
    create: {
      email,
      name: "Fleurious Owner",
      passwordHash: await hash(password, 12),
      verified: true,
      role: "OWNER",
    },
    update: {
      role: "OWNER",
      verified: true,
      passwordHash: await hash(password, 12),
      disabled: false,
    },
  });
  console.log(
    "Đã tạo/cập nhật Owner. Đăng nhập và bật 2FA trong Hồ sơ. Xóa ADMIN_PASSWORD khỏi môi trường sau khi dùng.",
  );
}
main()
  .catch(() => {
    console.error("Cần ADMIN_EMAIL hợp lệ và ADMIN_PASSWORD 12–72 byte.");
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
