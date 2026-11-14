"use client";
import { useEffect, useState } from "react";
import {
  Check,
  Copy,
  Eye,
  EyeOff,
  KeyRound,
  Landmark,
  RefreshCw,
} from "lucide-react";
import { request, useShop } from "./shop-provider";
import type { SepayAdminView } from "@/lib/sepay-settings";

function CopyField({
  id,
  label,
  value,
  onChange,
  readOnly = false,
  secret = false,
  required = false,
  placeholder,
  helper,
}: {
  id: string;
  label: string;
  value: string;
  onChange?: (value: string) => void;
  readOnly?: boolean;
  secret?: boolean;
  required?: boolean;
  placeholder?: string;
  helper?: string;
}) {
  const { toast } = useShop();
  const [show, setShow] = useState(false),
    [copied, setCopied] = useState(false);
  useEffect(() => {
    if (copied) {
      const timer = setTimeout(() => setCopied(false), 1800);
      return () => clearTimeout(timer);
    }
  }, [copied]);
  return (
    <div className="sepay-field">
      <label htmlFor={id}>{label}</label>
      <div className="sepay-input-row">
        <input
          id={id}
          name={id}
          value={
            secret && readOnly && !show && value
              ? "••••••••••••••••••••••••••••••••"
              : value
          }
          onChange={(e) => onChange?.(e.target.value)}
          type={secret && !readOnly && !show ? "password" : "text"}
          readOnly={readOnly}
          required={required}
          autoComplete={secret ? "new-password" : "off"}
          data-lpignore="true"
          data-1p-ignore="true"
          spellCheck={false}
          placeholder={placeholder}
          aria-describedby={helper ? `${id}-help` : undefined}
        />
        {secret && (
          <button
            type="button"
            aria-label={`${show ? "Ẩn" : "Hiện"} ${label}`}
            title={`${show ? "Ẩn" : "Hiện"} ${label}`}
            onClick={() => setShow(!show)}
          >
            {show ? <EyeOff size={17} /> : <Eye size={17} />}
          </button>
        )}
        <button
          type="button"
          aria-label={`Sao chép ${label}`}
          title={`Sao chép ${label}`}
          disabled={!value}
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(value);
              setCopied(true);
              toast(`Đã sao chép ${label}.`);
            } catch {
              toast(
                "Không sao chép được. Bạn có thể chọn nội dung trong ô và sao chép thủ công.",
              );
            }
          }}
        >
          {copied ? <Check size={17} /> : <Copy size={17} />}
        </button>
      </div>
      {helper && <small id={`${id}-help`}>{helper}</small>}
    </div>
  );
}
export function SepaySettings({ role }: { role: string }) {
  const { toast, refreshCatalog } = useShop();
  const [config, setConfig] = useState<SepayAdminView | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [rotate, setRotate] = useState(false);
  const [draft, setDraft] = useState({
    enabled: true,
    bank: "",
    accountNumber: "",
    accountName: "",
    apiToken: "",
  });
  function apply(value: SepayAdminView) {
    setConfig(value);
    setDraft({
      enabled: value.enabled,
      bank: value.bank,
      accountNumber: value.accountNumber,
      accountName: value.accountName,
      apiToken: value.apiToken,
    });
    setError("");
  }
  useEffect(() => {
    let cancelled = false;
    if (role === "OWNER")
      request<SepayAdminView>("admin/settings/sepay")
        .then((value) => {
          if (!cancelled) apply(value);
        })
        .catch((e) => {
          if (!cancelled) setError(e.message);
        });
    return () => {
      cancelled = true;
    };
  }, [role]);
  const dirty =
    !!config &&
    (Object.keys(draft) as (keyof typeof draft)[]).some(
      (key) => draft[key] !== config[key],
    );
  return (
    <section className="admin-panel sepay-settings" id="sepay">
      <div className="sepay-panel-heading">
        <div>
          <span className="eyebrow">
            <Landmark size={15} /> THANH TOÁN SEPAY
          </span>
          <h2>Tài khoản nhận thanh toán</h2>
          <p>
            Dùng chung cho đơn hoa và gói hội viên. Thay đổi có hiệu lực ngay
            sau khi lưu.
          </p>
        </div>
        {config && (
          <span
            className={`status-tag ${config.configured ? "sepay-ready" : ""}`}
          >
            {config.configured ? "Đã cấu hình" : "Chưa sẵn sàng"}
          </span>
        )}
      </div>
      {role !== "OWNER" ? (
        <p>
          Chủ cửa hàng quản lý thông tin ngân hàng và khóa xác thực SePay tại
          đây.
        </p>
      ) : !config ? (
        <div role={error ? "alert" : "status"}>
          {error || "Đang mở cấu hình SePay…"}
          {error && (
            <button
              className="text-link"
              onClick={() =>
                request<SepayAdminView>("admin/settings/sepay")
                  .then(apply)
                  .catch((e) => setError(e.message))
              }
            >
              Thử lại
            </button>
          )}
        </div>
      ) : (
        <>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              setError("");
              try {
                apply(
                  await request<SepayAdminView>(
                    "admin/settings/sepay",
                    { ...draft, version: config.version },
                    "PATCH",
                  ),
                );
                await refreshCatalog();
                toast("Đã lưu cấu hình SePay.");
              } catch (e) {
                setError((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            <label className="checkbox-label sepay-enabled">
              <input
                type="checkbox"
                checked={draft.enabled}
                onChange={(e) =>
                  setDraft({ ...draft, enabled: e.target.checked })
                }
              />
              Bật thanh toán chuyển khoản SePay
            </label>
            <div className="two-columns">
              <CopyField
                id="sepay-bank"
                label="Ngân hàng (mã hoặc BIN)"
                value={draft.bank}
                onChange={(bank) => setDraft({ ...draft, bank })}
                required={draft.enabled}
                placeholder="Ví dụ: VCB, MB, 970436"
                helper="Nhập đúng mã ngân hàng đang kết nối trong SePay."
              />
              <CopyField
                id="sepay-account"
                label="Số tài khoản"
                value={draft.accountNumber}
                onChange={(accountNumber) =>
                  setDraft({ ...draft, accountNumber })
                }
                required={draft.enabled}
                placeholder="Số tài khoản nhận tiền"
              />
              <CopyField
                id="sepay-holder"
                label="Tên chủ tài khoản"
                value={draft.accountName}
                onChange={(accountName) => setDraft({ ...draft, accountName })}
                required={draft.enabled}
                placeholder="NGUYEN VAN A"
              />
              <CopyField
                id="sepay-api-token"
                label="Token API đối soát (tùy chọn)"
                value={draft.apiToken}
                onChange={(apiToken) => setDraft({ ...draft, apiToken })}
                secret
                helper="Lấy token từ tài khoản SePay để chạy đối soát tự động. Không phải API Key webhook bên dưới."
              />
            </div>
            {error && (
              <p className="form-error" role="alert">
                {error}
              </p>
            )}
            <div className="sepay-save-row">
              <button className="button" disabled={busy}>
                {busy ? "Đang lưu…" : "Lưu cấu hình SePay"}
                <Check size={16} />
              </button>
              <span className="small muted">
                Phiên bản {config.version} · Chỉ chủ cửa hàng có quyền chỉnh sửa
              </span>
            </div>
          </form>
          <div className="sepay-webhook">
            <div className="sepay-webhook-heading">
              <div>
                <span className="eyebrow">
                  <KeyRound size={15} /> KẾT NỐI WEBHOOK
                </span>
                <h3>Thông tin kết nối</h3>
              </div>
              <span className="status-tag">POST · JSON · API Key</span>
            </div>
            <CopyField
              id="sepay-webhook-url"
              label="URL webhook"
              value={config.webhookUrl}
              readOnly
              helper="Dán URL này vào mục Webhooks của SePay. Khi triển khai, URL phải là tên miền công khai có HTTPS."
            />
            <div className="two-columns">
              <CopyField
                id="sepay-webhook-key"
                label="API Key webhook"
                value={config.webhookKey}
                readOnly
                secret
                helper="Khóa được tạo và lưu tự động. Sao chép vào phương thức xác thực API Key trong SePay."
              />
              <CopyField
                id="sepay-auth-header"
                label="Header Authorization"
                value={`Apikey ${config.webhookKey}`}
                readOnly
                secret
                helper="SePay gửi header này khi gọi webhook."
              />
            </div>
            <ol className="sepay-steps">
              <li>Lưu tài khoản ngân hàng nhận tiền ở trên.</li>
              <li>
                Trong SePay, tạo webhook cho sự kiện{" "}
                <strong>Có tiền vào</strong>, chọn dữ liệu <strong>JSON</strong>
                , xác thực <strong>API Key</strong>; dán URL và khóa tương ứng.
              </li>
              <li>
                Bật gửi lại khi HTTP không thuộc 200–299, rồi dùng tính năng Gửi
                thử của SePay để kiểm tra.
              </li>
            </ol>
            <div className="sepay-key-actions">
              <a
                className="text-link"
                href="https://docs.sepay.vn/tich-hop-webhooks.html"
                target="_blank"
                rel="noreferrer"
              >
                Hướng dẫn kết nối SePay
              </a>
              <button
                type="button"
                className="text-link"
                disabled={busy || dirty}
                title={
                  dirty ? "Lưu các thay đổi trước khi tạo khóa mới" : undefined
                }
                onClick={() => setRotate(!rotate)}
              >
                <RefreshCw size={14} /> Tạo khóa mới
              </button>
            </div>
            {rotate && (
              <div className="sepay-rotate-confirm">
                <p>
                  Tạo khóa mới sẽ vô hiệu khóa cũ. Bạn cần cập nhật khóa mới
                  trong SePay để tiếp tục nhận webhook.
                </p>
                <div>
                  <button
                    type="button"
                    className="button secondary"
                    disabled={busy}
                    onClick={() => setRotate(false)}
                  >
                    Hủy
                  </button>
                  <button
                    type="button"
                    className="button"
                    disabled={busy}
                    onClick={async () => {
                      setBusy(true);
                      try {
                        apply(
                          await request<SepayAdminView>(
                            "admin/settings/sepay/rotate-key",
                            { version: config.version },
                          ),
                        );
                        setRotate(false);
                        toast(
                          "Đã tạo khóa mới. Hãy cập nhật khóa trong SePay.",
                        );
                      } catch (e) {
                        setError((e as Error).message);
                      } finally {
                        setBusy(false);
                      }
                    }}
                  >
                    Tạo khóa và vô hiệu khóa cũ
                  </button>
                </div>
              </div>
            )}
          </div>
        </>
      )}
    </section>
  );
}
