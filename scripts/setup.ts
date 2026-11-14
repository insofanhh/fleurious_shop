import { existsSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
if (!existsSync(".env")) {
  const secret = () => randomBytes(32).toString("hex");
  writeFileSync(
    ".env",
    `DATABASE_URL="mysql://root:@127.0.0.1:3306/fleurious_shop"\nAPP_URL="http://localhost:3000"\nSESSION_SECRET="${secret()}"\nCRON_SECRET="${secret()}"\nSEPAY_WEBHOOK_KEY=""\nSEPAY_ACCOUNT_NUMBER=""\nSEPAY_BANK=""\nSEPAY_ACCOUNT_NAME=""\nREDIS_URL="redis://127.0.0.1:6379"\n`,
  );
  console.log(
    "Đã tạo .env với secret riêng. Điền thông tin SePay trước khi mở thanh toán.",
  );
} else console.log("Giữ nguyên .env hiện có.");
