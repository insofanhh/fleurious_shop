"use client";
import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { ShieldCheck } from "lucide-react";
import { request, useShop } from "./shop-provider";
export function MfaCard() {
  const { toast } = useShop();
  const [enabled, setEnabled] = useState(false),
    [setup, setSetup] = useState<{ uri: string; secret: string } | null>(null),
    [image, setImage] = useState(""),
    [codes, setCodes] = useState<string[]>([]),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    request<{ enabled: boolean }>("me/2fa")
      .then((r) => setEnabled(r.enabled))
      .catch(() => {});
  }, []);
  useEffect(() => {
    if (setup)
      QRCode.toDataURL(setup.uri, { width: 240, margin: 2 }).then(setImage);
  }, [setup]);
  return (
    <section className="admin-panel narrow-form" style={{ marginTop: 35 }}>
      <h2
        style={{ fontSize: 25, display: "flex", alignItems: "center", gap: 12 }}
      >
        <ShieldCheck size={24} />
        Xác thực hai bước
      </h2>
      <p className="small muted">
        {enabled
          ? "Đã bật. Đăng nhập cần mã từ ứng dụng xác thực hoặc mã dự phòng."
          : "Thêm một lớp bảo vệ bằng ứng dụng Authenticator. Nên bật cho mọi tài khoản quản trị."}
      </p>
      {codes.length > 0 && (
        <div className="notice">
          <strong>Lưu mã dự phòng ở nơi riêng tư. Chỉ hiển thị một lần.</strong>
          <pre style={{ whiteSpace: "pre-wrap", fontSize: 12 }}>
            {codes.join("\n")}
          </pre>
          <p>Mỗi mã dùng một lần nếu không có ứng dụng xác thực.</p>
          <button className="text-link" onClick={() => setCodes([])}>
            Tôi đã lưu mã an toàn
          </button>
        </div>
      )}
      {!enabled && !setup && (
        <form
          className="form-stack"
          onSubmit={async (e) => {
            e.preventDefault();
            const password = new FormData(e.currentTarget).get("password");
            setBusy(true);
            try {
              setSetup(await request("me/2fa/setup", { password }));
            } catch (e) {
              toast((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <label>
            Xác nhận mật khẩu
            <input
              name="password"
              type="password"
              autoComplete="current-password"
              required
            />
          </label>
          <button className="button secondary" disabled={busy}>
            Bắt đầu bật 2FA
          </button>
        </form>
      )}
      {!enabled && setup && (
        <>
          <img
            src={image || undefined}
            alt="QR cài đặt Authenticator"
            width="240"
            height="240"
          />
          <p className="small preserve-lines">
            Hoặc nhập khóa: <code>{setup.secret}</code>
          </p>
          <form
            className="form-stack"
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              try {
                const result = await request<{ recoveryCodes: string[] }>(
                  "me/2fa/enable",
                  { code: new FormData(e.currentTarget).get("code") },
                );
                setCodes(result.recoveryCodes);
                setEnabled(true);
                setSetup(null);
                toast("Đã bật 2FA và thu hồi các phiên đăng nhập khác.");
              } catch (e) {
                toast((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            <label>
              Mã 6 số từ ứng dụng
              <input
                name="code"
                inputMode="numeric"
                pattern="[0-9]{6}"
                autoComplete="one-time-code"
                required
              />
            </label>
            <button className="button" disabled={busy}>
              Xác nhận bật 2FA
            </button>
          </form>
        </>
      )}
      {enabled && (
        <details style={{ marginTop: 20 }}>
          <summary>Tắt xác thực hai bước</summary>
          <form
            className="form-stack"
            style={{ marginTop: 20 }}
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              try {
                await request(
                  "me/2fa/disable",
                  Object.fromEntries(new FormData(e.currentTarget)),
                );
                setEnabled(false);
                setCodes([]);
                toast("Đã tắt xác thực hai bước.");
              } catch (e) {
                toast((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            <label>
              Mật khẩu
              <input
                type="password"
                name="password"
                autoComplete="current-password"
                required
              />
            </label>
            <label>
              Mã 2FA hoặc mã dự phòng
              <input name="code" autoComplete="one-time-code" required />
            </label>
            <button className="button secondary" disabled={busy}>
              Tắt 2FA
            </button>
          </form>
        </details>
      )}
    </section>
  );
}
