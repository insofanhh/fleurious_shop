import nodemailer from "nodemailer";
export async function sendAuthMail(email: string, link: string, kind: string) {
  if (!process.env.SMTP_HOST) {
    if (process.env.NODE_ENV === "production")
      throw new Error("SMTP chưa được cấu hình");
    return link;
  }
  const transport = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT ?? 587),
    secure: process.env.SMTP_PORT === "465",
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD },
  });
  await transport.sendMail({
    from: process.env.SMTP_FROM,
    to: email,
    subject:
      kind === "verify"
        ? "Xác minh tài khoản Fleurious"
        : "Đặt lại mật khẩu Fleurious",
    text: `Mở liên kết để tiếp tục: ${link}\nNếu bạn không yêu cầu, hãy bỏ qua email này.`,
  });
  return undefined;
}
