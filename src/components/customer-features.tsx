"use client";
import { stoppedOrderStatuses } from "@/lib/order-workflow";
import { isOrderExpired } from "@/lib/order-expiry";
import { useDeadline } from "./use-deadline";
import { useCheckoutQuote } from "./use-checkout-quote";
import { CardWritingChoice } from "./card-writing-choice";
import { cardWritingLabels, type CardWritingMode } from "@/lib/card-design";
import { PaymentQr } from "./payment-qr";
import { NotificationInbox } from "./notification-center";
import { StreakScanner } from "./streak-scanner";
import { AccountMembership } from "./membership-client";
import { BrandMark } from "./brand-mark";
import { Select } from "./ui/select";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import {
  ArrowRight,
  ArrowUpRight,
  Check,
  ChevronLeft,
  ChevronRight,
  Clock3,
  CreditCard,
  Flame,
  Flower2,
  Gift,
  Heart,
  LogOut,
  MapPin,
  Plus,
  ShieldCheck,
  Sparkles,
  TicketPercent,
  Truck,
  UserRound,
  Bell,
  CalendarDays,
} from "lucide-react";
import { request, useShop } from "./shop-provider";
import { track } from "./analytics-consent";
import { MfaCard } from "./mfa-card";
import { PwaCard } from "./pwa-card";
import { dayKey, humanDate, money, monthKey, shiftDay } from "@/lib/time";
import type { Order } from "@/lib/types";
export const orderStatus: Record<string, string> = {
  PENDING: "Chờ xác nhận",
  CONFIRMED: "Đã xác nhận",
  COMPLETED: "Hoàn thành",
  CANCELLED: "Đã hủy",
  REFUND_PENDING: "Chờ hoàn tiền",
  UNASSIGNED: "Chờ chuẩn bị",
  PREPARING: "Đang chuẩn bị",
  READY: "Sẵn sàng giao",
  OUT_FOR_DELIVERY: "Đang giao",
  DELIVERED: "Đã giao",
  UNPAID: "Chưa thanh toán",
  PAID: "Đã thanh toán",
  REFUNDED: "Đã hoàn tiền",
  PARTIALLY_REFUNDED: "Đã hoàn một phần",
  AVAILABLE: "Có thể dùng",
  RESERVED: "Đang giữ",
  USED: "Đã sử dụng",
  REVOKED: "Đã thu hồi",
  WAITING_BUDGET: "Đã đạt mốc · chờ mở thưởng",
};
function LoginPrompt({ next = "/account" }: { next?: string }) {
  const { ready } = useShop();
  return (
    <div className="empty-state">
      <Flower2 size={42} strokeWidth={1} />
      <h2>
        {ready ? "Một góc nhỏ dành riêng cho bạn." : "Đang mở góc nhỏ của bạn…"}
      </h2>
      <p>Đăng nhập để xem những đơn hoa, quyền lợi và kỷ niệm.</p>
      {ready && (
        <Link
          href={`/auth/login?next=${encodeURIComponent(next)}`}
          className="button"
        >
          Đăng nhập <ArrowRight size={17} />
        </Link>
      )}
    </div>
  );
}
export function AuthPage({ mode }: { mode: string }) {
  const { refresh, toast } = useShop();
  const router = useRouter(),
    params = useSearchParams();
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState(""),
    [devLink, setDevLink] = useState("");
  const register = mode === "register",
    forgot = mode === "forgot",
    verify = mode === "verify",
    reset = mode === "reset";
  const titles = register
    ? ["Bắt đầu một", "ngày có hoa."]
    : forgot
      ? ["Đừng lo,", "mình tìm lại nhé."]
      : verify
        ? ["Một bước nhỏ,", "để gần nhau hơn."]
        : reset
          ? ["Một khởi đầu", "thật an tâm."]
          : ["Chào bạn,", "lại là một ngày đẹp."];
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const fields = Object.fromEntries(new FormData(e.currentTarget));
    try {
      const result = await request<{ message?: string; devLink?: string }>(
        `auth/${register ? "register" : forgot ? "forgot" : verify ? "verify" : reset ? "reset" : "login"}`,
        { ...fields, token: params.get("token") ?? "" },
      );
      if (result.devLink) setDevLink(result.devLink);
      if (forgot || register)
        setMessage(result.message ?? "Kiểm tra email của bạn.");
      else {
        await refresh();
        toast(
          verify
            ? "Đã xác minh email!"
            : reset
              ? "Đã đổi mật khẩu. Vui lòng đăng nhập lại."
              : "Mừng bạn trở lại vườn hoa.",
        );
        const next = params.get("next");
        router.push(
          reset
            ? "/auth/login"
            : next?.startsWith("/") && !next.startsWith("//")
              ? next
              : "/account",
        );
        router.refresh();
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="auth-page container">
      <div className="auth-photo">
        <img
          src="/images/soft.webp"
          alt="Những ngày dịu dàng cùng Fleurious"
          width="800"
          height="1000"
        />
        <span>good things take bloom.</span>
      </div>
      <div className="auth-form-wrap">
        <span className="eyebrow">YOUR LITTLE FLOWER CORNER</span>
        <h1>
          {titles[0]}
          <br />
          <em>{titles[1]}</em>
        </h1>
        <p className="muted">
          {register
            ? "Tạo tài khoản để giữ lại những điều bạn thương."
            : verify
              ? "Xác nhận email để nhận quyền lợi hội viên và ngày có hoa."
              : "Một chút hoa, một chút yêu, và một góc dành riêng cho bạn."}
        </p>
        <form onSubmit={submit} className="form-stack">
          {register && (
            <label>
              Tên của bạn
              <input
                name="name"
                autoComplete="name"
                required
                minLength={2}
                placeholder="Fleurious nên gọi bạn là…"
              />
            </label>
          )}
          {!verify && !reset && (
            <label>
              Email
              <input
                name="email"
                type="email"
                autoComplete="email"
                required
                placeholder="ban@example.com"
              />
            </label>
          )}
          {!forgot && !verify && (
            <label>
              {reset ? "Mật khẩu mới" : "Mật khẩu"}
              <input
                name="password"
                type="password"
                required
                minLength={register || reset ? 10 : 1}
                maxLength={100}
                autoComplete={
                  register || reset ? "new-password" : "current-password"
                }
                placeholder={
                  register || reset ? "Ít nhất 10 ký tự" : "Mật khẩu của bạn"
                }
              />
            </label>
          )}
          {mode === "login" && (
            <label>
              Mã 2FA / dự phòng (nếu đã bật)
              <input
                name="code"
                autoComplete="one-time-code"
                maxLength={30}
                placeholder="Để trống nếu chưa bật 2FA"
              />
            </label>
          )}
          {error && (
            <div className="form-error" role="alert">
              {error}
            </div>
          )}
          {message && (
            <div className="form-success" role="status">
              {message}
            </div>
          )}
          {devLink && (
            <a href={devLink} className="dev-link">
              Môi trường local: mở liên kết xác minh/khôi phục
            </a>
          )}
          <button className="button glass-primary full" disabled={busy}>
            {busy
              ? "Đang xử lý…"
              : register
                ? "Tạo tài khoản"
                : forgot
                  ? "Gửi liên kết khôi phục"
                  : verify
                    ? "Xác minh email"
                    : reset
                      ? "Lưu mật khẩu mới"
                      : "Đăng nhập"}
            <ArrowRight size={17} />
          </button>
        </form>
        {mode === "login" && (
          <div className="auth-links">
            <Link href="/auth/forgot">Quên mật khẩu?</Link>
            <Link
              href={`/auth/register?next=${encodeURIComponent(params.get("next") ?? "/account")}`}
            >
              Tạo tài khoản <ArrowUpRight size={13} />
            </Link>
          </div>
        )}
        {register && (
          <p className="small muted">
            Đã có tài khoản? <Link href="/auth/login">Đăng nhập</Link>
          </p>
        )}
      </div>
    </section>
  );
}
export { MembershipPage } from "./membership-client";
export function StreakPage() {
  const { user, me, settings, ready, rewardRules } = useShop();
  const [month, setMonth] = useState(monthKey()),
    [selected, setSelected] = useState("");
  const stats = me?.stats ?? {
    current: 0,
    monthly: 0,
    longest: 0,
    todayActive: false,
  };
  const year = Number(month.slice(0, 4)),
    mon = Number(month.slice(5));
  const count = new Date(Date.UTC(year, mon, 0)).getUTCDate(),
    offset = (new Date(`${month}-01T12:00:00Z`).getUTCDay() + 6) % 7;
  const selectedDay = me?.days.find((d) => d.day === selected);
  const progress = [
    {
      title: "Ngày liên tiếp",
      value: stats.current,
      target: settings.consecutiveThreshold,
      percent: settings.consecutivePercent,
      Icon: Flame,
    },
    {
      title: "Ngày có hoa tháng này",
      value: stats.monthly,
      target: settings.monthlyThreshold,
      percent: settings.monthlyPercent,
      Icon: Flower2,
    },
  ];
  function changeMonth(n: number) {
    const date = new Date(Date.UTC(year, mon - 1 + n, 1));
    setMonth(date.toISOString().slice(0, 7));
    setSelected("");
  }
  return (
    <section className="container section streak-page">
      <StreakScanner />
      <div className="page-heading">
        <span className="eyebrow">{settings.campaignName.toUpperCase()}</span>
        <h1>
          Mỗi đóa hoa,
          <br />
          <em>một ngày đáng nhớ.</em>
        </h1>
        <p>Quét QR từ một đơn hoa, giữ lại một ngày dịu dàng.</p>
      </div>
      {!user ? (
        <>
          <div className="streak-explainer">
            <Flame size={38} strokeWidth={1} />
            <h2>Gom những ngày có hoa. Mở những món quà nhỏ.</h2>
            <p>
              Ai có QR hợp lệ đều có thể đăng nhập để nhận ngày. Một ngày một
              lần, một kỷ niệm riêng của bạn.
            </p>
          </div>
          <LoginPrompt next="/streak" />
        </>
      ) : (
        <>
          <div className="streak-progress">
            {progress.map(({ title, value, target, percent, Icon }) => (
              <div className="progress-card" key={title}>
                <div>
                  <span>{title}</span>
                  <Icon size={23} />
                </div>
                <strong>
                  {value}
                  <small> / {target} ngày</small>
                </strong>
                <div className="progress-track">
                  <span
                    style={{
                      width: `${Math.min(100, (value / target) * 100)}%`,
                    }}
                  />
                </div>
                <p>
                  {value >= target
                    ? "Đã chạm mốc. Kiểm tra ví ưu đãi của bạn."
                    : `Còn ${target - value} ngày để nhận giảm ${percent}%.`}
                </p>
              </div>
            ))}
          </div>
          <div className="streak-layout">
            <div className="calendar-panel">
              <div className="calendar-heading">
                <h2>
                  Tháng {mon}, {year}
                </h2>
                <div>
                  <button
                    aria-label="Tháng trước"
                    onClick={() => changeMonth(-1)}
                  >
                    <ChevronLeft size={20} />
                  </button>
                  <button
                    aria-label="Tháng này"
                    onClick={() => setMonth(monthKey())}
                  >
                    Hôm nay
                  </button>
                  <button aria-label="Tháng sau" onClick={() => changeMonth(1)}>
                    <ChevronRight size={20} />
                  </button>
                </div>
              </div>
              <div className="photo-calendar">
                {["T2", "T3", "T4", "T5", "T6", "T7", "CN"].map((d) => (
                  <div className="weekday" key={d}>
                    {d}
                  </div>
                ))}
                {Array.from({ length: offset }, (_, i) => (
                  <div key={`blank-${i}`} />
                ))}
                {Array.from({ length: count }, (_, i) => {
                  const day = `${month}-${String(i + 1).padStart(2, "0")}`;
                  const data = me?.days.find((d) => d.day === day);
                  return (
                    <button
                      key={day}
                      className={`calendar-day ${day === dayKey() ? "today" : ""} ${data?.valid ? "active-day" : ""} ${selected === day ? "selected" : ""}`}
                      onClick={() => setSelected(day)}
                      aria-label={`${i + 1} tháng ${mon}${data?.valid ? ", đã có hoa" : ", chưa có hoa"}`}
                    >
                      {data && <img src={data.image} alt="" />}
                      <span>{i + 1}</span>
                      {data?.valid && (
                        <Flame
                          className="day-fire"
                          size={14}
                          fill="currentColor"
                        />
                      )}
                      {data && !data.valid && (
                        <span className="invalid-day">Không tính</span>
                      )}
                    </button>
                  );
                })}
              </div>
              <div className="calendar-legend">
                <span>
                  <span className="legend-dot" />
                  Hôm nay
                </span>
                <span>
                  <Flame size={13} />
                  Đã có hoa
                </span>
                <span>Kỷ lục: {stats.longest} ngày</span>
              </div>
              {selected && (
                <div className="selected-day">
                  {selectedDay && (
                    <img
                      src={selectedDay.image}
                      alt={selectedDay.productName}
                    />
                  )}
                  <div>
                    <strong>
                      {selectedDay?.productName ?? "Một ngày đang chờ hoa"}
                    </strong>
                    <p>
                      {selected.slice(8)} / {selected.slice(5, 7)} /{" "}
                      {selected.slice(0, 4)}
                    </p>
                    {selectedDay && (
                      <small>
                        {selectedDay.valid
                          ? "Đã thêm vào lịch"
                          : "Kỷ niệm còn lại, ngày không tính thưởng"}{" "}
                        · {humanDate(selectedDay.createdAt)}
                      </small>
                    )}
                  </div>
                </div>
              )}
            </div>
            <aside className="streak-aside">
              <Gift size={29} strokeWidth={1.2} />
              <h2>
                Những món quà
                <br />
                đang chờ bạn.
              </h2>
              {progress.map((p) => (
                <div className="milestone" key={p.title}>
                  <span>
                    {p.value >= p.target ? (
                      <Check size={17} />
                    ) : (
                      <Gift size={17} />
                    )}
                  </span>
                  <div>
                    <strong>Giảm {p.percent}%</strong>
                    <p>
                      {p.target} {p.title.toLowerCase()}
                    </p>
                  </div>
                </div>
              ))}
              <p className="small muted">
                Tối đa {money(settings.rewardCap)}, đơn từ{" "}
                {money(settings.rewardMinimum)}. Mỗi mốc tối đa một lần/tháng,
                khi chạm mốc; không cộng dồn ưu đãi tiền hàng.
              </p>
              <Link href="/account/rewards" className="button secondary full">
                Mở ví ưu đãi <ArrowRight size={16} />
              </Link>
              {rewardRules
                .filter(
                  (r) =>
                    (!r.startsOn || dayKey() >= r.startsOn) &&
                    (!r.endsOn || dayKey() <= r.endsOn),
                )
                .map((r) => (
                  <div className="milestone" key={r.id}>
                    <span>
                      <Gift size={17} />
                    </span>
                    <div>
                      <strong>
                        {r.name} · Giảm {r.percent}%
                      </strong>
                      <p>
                        {r.kind === "monthly" ? stats.monthly : stats.current}/
                        {r.threshold} ngày{" "}
                        {r.kind === "monthly" ? "trong tháng" : "liên tiếp"}
                      </p>
                      <p>
                        Tối đa {money(r.cap)} · Tiền hoa áp dụng từ{" "}
                        {money(r.minimum)} ·{" "}
                        {r.productId
                          ? "Chỉ sản phẩm chỉ định"
                          : "Tổng tiền hoa"}{" "}
                        · Dùng trong {r.validDays} ngày
                      </p>
                    </div>
                  </div>
                ))}
            </aside>
          </div>
        </>
      )}
      <details className="how-it-works" open={!user}>
        <summary>Giữ chuỗi được tính thế nào?</summary>
        <div>
          <p>
            <strong>Liên tiếp:</strong> kích hoạt mỗi ngày liền nhau. Bỏ một
            ngày sẽ bắt đầu chuỗi mới; kỷ lục vẫn được giữ.
          </p>
          <p>
            <strong>Tích lũy tháng:</strong> tổng ngày đã kích hoạt, không cần
            liền nhau. Sang tháng mới bắt đầu lại; chuỗi liên tiếp vẫn tiếp tục.
          </p>
          <p>
            Ví dụ có hoa ngày 1, 2, 3, 7, 9: tích lũy 5 ngày, chuỗi tại ngày 9
            là 1, kỷ lục là 3.
          </p>
          <p>
            Mỗi tài khoản tối đa một ngày hợp lệ/ngày. Mỗi QR dùng một lần/tài
            khoản, tối đa {settings.qrMaxClaims} người, trong {settings.qrHours}{" "}
            giờ từ lúc đủ điều kiện. Hoa tặng cũng có thể trở thành kỷ niệm của
            người nhận. Quét khi có mạng; không điền bù ngày.
          </p>
          <p>
            Chương trình có ngân sách giới hạn. Các mốc thưởng, điều kiện và ưu
            đãi đã cấp hiển thị trong lịch/ví. Lịch ảnh là riêng tư.
          </p>
        </div>
      </details>
    </section>
  );
}
export function AccountPage({ section }: { section?: string }) {
  const { user, me, refresh, toast, settings, vapidKey, zones } = useShop();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  if (section === "notifications") return <NotificationInbox />;
  if (!user || !me) return <LoginPrompt />;
  const remaining = Math.max(
    0,
    (me.period?.limit ?? settings.memberQuota) -
      (me.period?.consumed ?? 0) -
      (me.period?.reserved ?? 0),
  );
  async function profile(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    try {
      await request(
        "me/profile",
        Object.fromEntries(new FormData(e.currentTarget)),
        "PATCH",
      );
      await refresh();
      toast("Đã lưu thông tin của bạn.");
    } catch (e) {
      toast((e as Error).message);
    }
  }
  return (
    <section className="container section account-page">
      <div className="account-greeting">
        <div>
          <span className="eyebrow">GÓC NHỎ CỦA BẠN</span>
          <h1>
            Chào {user.name.split(" ").at(-1)},<br />
            <em>hôm nay có hoa chưa?</em>
          </h1>
        </div>
        <button
          className="text-link"
          onClick={async () => {
            await request("auth/logout", {});
            await refresh();
            router.push("/");
          }}
        >
          <LogOut size={16} />
          Đăng xuất
        </button>
      </div>
      <nav className="account-tabs">
        {[
          ["/account", "Tổng quan"],
          ["/account/orders", "Đơn hoa"],
          ["/account/membership", "Hội viên"],
          ["/account/rewards", "Ví ưu đãi"],
          ["/account/profile", "Hồ sơ"],
          ["/account/addresses", "Địa chỉ"],
        ].map(([href, name]) => (
          <Link
            key={href}
            href={href}
            className={
              (section ? href.endsWith(`/${section}`) : href === "/account")
                ? "active"
                : ""
            }
          >
            {name}
          </Link>
        ))}
      </nav>
      {!section && (
        <>
          <div className="account-cards">
            <div className="member-dashboard-card">
              <BrandMark />
              <span>FLEURIOUS CIRCLE</span>
              <h2>
                {user.memberSince ? user.tier : "Một lời mời dành cho bạn"}
              </h2>
              <p>
                {user.memberSince
                  ? `Còn ${remaining}/${me.period?.limit ?? settings.memberQuota} lượt ưu đãi tháng này`
                  : "Tham gia miễn phí để nhận ưu đãi mỗi tháng."}
              </p>
              {me.membership.expiresAt && (
                <p>
                  Đặc quyền đến {humanDate(me.membership.expiresAt)} · Hạng tích
                  lũy: {me.membership.base?.name}.
                </p>
              )}
              <Link href="/account/membership">
                {user.memberSince ? "Xem quyền lợi" : "Tham gia hội viên"}{" "}
                <ArrowUpRight size={16} />
              </Link>
            </div>
            <Link className="account-streak-card" href="/streak">
              <Flame size={29} />
              <span>NHỮNG NGÀY CÓ HOA</span>
              <h2>
                {me.stats.current} <small>ngày liên tiếp</small>
              </h2>
              <p>
                {me.stats.monthly} ngày có hoa trong tháng · Kỷ lục{" "}
                {me.stats.longest}
              </p>
              <span className="text-link">
                Mở lịch ảnh <ArrowUpRight size={16} />
              </span>
            </Link>
          </div>
          {!user.verified && (
            <div className="notice">
              Tài khoản chưa xác minh. Mở liên kết trong email đăng ký để dùng
              hội viên và giữ chuỗi.
            </div>
          )}
          <div className="section-heading">
            <h2>
              Những đơn hoa <em>gần đây.</em>
            </h2>
            <Link className="text-link" href="/account/orders">
              Xem tất cả <ArrowRight size={17} />
            </Link>
          </div>
          <OrderList orders={me.orders.slice(0, 3)} />
          {user.role !== "CUSTOMER" && (
            <Link href="/admin" className="button secondary">
              Mở quản trị cửa hàng <ArrowUpRight size={17} />
            </Link>
          )}
        </>
      )}
      {section === "orders" && <OrderList orders={me.orders} />}
      {section === "rewards" && (
        <>
          <div className="section-heading">
            <h2>
              Những món quà <em>dành cho bạn.</em>
            </h2>
          </div>
          {me.rewards.length ? (
            <div className="reward-grid">
              {me.rewards.map((r) => (
                <article className="reward-card" key={r.id}>
                  <TicketPercent size={29} strokeWidth={1.2} />
                  <span className="status-tag">
                    {r.status !== "WAITING_BUDGET" &&
                    r.expiresAt < new Date().toISOString()
                      ? "Hết hạn"
                      : (orderStatus[r.status] ?? r.status)}
                  </span>
                  <h3>{r.title}</h3>
                  <p>
                    Tối đa {money(r.cap)} · Đơn từ {money(r.minimum)}
                  </p>
                  <p className="small">
                    {r.status === "WAITING_BUDGET"
                      ? "Thời hạn bắt đầu khi cửa hàng mở thưởng."
                      : `Dùng trước ${humanDate(r.expiresAt)}`}
                  </p>
                  <Link href="/flowers" className="text-link">
                    Chọn một bó hoa <ArrowUpRight size={16} />
                  </Link>
                </article>
              ))}
            </div>
          ) : (
            <div className="empty-state">
              <Gift size={38} />
              <h2>Những món quà đang đợi một mùa hoa.</h2>
              <Link className="text-link" href="/streak">
                Xem mốc thưởng <ArrowRight size={16} />
              </Link>
            </div>
          )}
        </>
      )}
      {section === "membership" && <AccountMembership />}
      {section === "profile" && (
        <form className="form-stack narrow-form" onSubmit={profile}>
          <label>
            Tên của bạn
            <input
              name="name"
              defaultValue={user.name}
              required
              minLength={2}
            />
          </label>
          <label>
            Email
            <input value={user.email} disabled />
          </label>
          <label>
            Điện thoại
            <input name="phone" defaultValue={user.phone} maxLength={20} />
          </label>
          <button className="button">
            Lưu thông tin <Check size={16} />
          </button>
        </form>
      )}
      {section === "profile" && (
        <>
          <MfaCard />
          <PwaCard />
        </>
      )}
      {section === "addresses" && (
        <div className="two-columns">
          <div>
            {me.addresses.map((a) => (
              <div className="address-card" key={a.id}>
                <MapPin size={19} />
                <div>
                  <strong>{a.name}</strong>
                  <p>{a.phone}</p>
                  <p>{a.address}</p>
                  <button
                    className="text-link"
                    onClick={async () => {
                      await request(`me/addresses/${a.id}`, {}, "DELETE");
                      await refresh();
                    }}
                  >
                    Xóa địa chỉ
                  </button>
                </div>
              </div>
            ))}
          </div>
          <form
            className="form-stack"
            onSubmit={async (e) => {
              e.preventDefault();
              const form = e.currentTarget;
              setBusy(true);
              try {
                await request(
                  "me/addresses",
                  Object.fromEntries(new FormData(form)),
                );
                form.reset();
                await refresh();
                toast("Đã lưu địa chỉ.");
              } catch (e) {
                toast((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            <h2>Thêm một nơi nhận hoa.</h2>
            <label>
              Người nhận
              <input name="name" required />
            </label>
            <label>
              Điện thoại
              <input name="phone" required minLength={10} />
            </label>
            <label>
              Địa chỉ
              <input name="address" required minLength={8} />
            </label>
            <label>
              Khu vực
              <Select name="zoneId">
                {zones.map((z) => (
                  <option key={z.id} value={z.id}>
                    {z.name}
                  </option>
                ))}
              </Select>
            </label>
            <button className="button" disabled={busy}>
              Lưu địa chỉ <Plus size={16} />
            </button>
          </form>
        </div>
      )}
    </section>
  );
}
function OrderList({ orders }: { orders: Order[] }) {
  return orders.length ? (
    <div className="customer-orders">
      {orders.map((o) => (
        <div className="customer-order-wrap" key={o.id}>
          <Link href={`/orders/${o.id}`} className="customer-order">
            <img
              src={o.items[0]?.image}
              alt={o.items[0]?.name ?? "Hoa"}
              width="85"
              height="100"
            />
            <div>
              <span className="small muted">{o.code}</span>
              <h3>{o.items.map((i) => i.name).join(", ")}</h3>
              <p>
                {o.deliveryDay} · {o.slotLabel}
              </p>
              <span className="status-tag">
                {isOrderExpired(o)
                  ? "Hết hạn"
                  : orderStatus[
                      o.status === "PENDING" ||
                      stoppedOrderStatuses.includes(o.status)
                        ? o.status
                        : o.fulfillment
                    ]}
              </span>
            </div>
            <strong>{money(o.total)}</strong>
            <ArrowUpRight size={19} />
          </Link>
          {isOrderExpired(o) && (
            <Link
              className="button secondary reorder-list-button"
              href={`/checkout?reorder=${o.id}`}
            >
              Đặt lại <ArrowRight size={15} />
            </Link>
          )}
        </div>
      ))}
    </div>
  ) : (
    <div className="empty-state">
      <Flower2 size={36} />
      <h2>Một bó hoa đầu tiên đang đợi bạn.</h2>
      <Link href="/flowers" className="text-link">
        Khám phá vườn hoa <ArrowRight size={16} />
      </Link>
    </div>
  );
}
export function CheckoutPage() {
  const {
    cart,
    products,
    zones,
    slots,
    user,
    me,
    settings,
    sepayAvailable,
    clearCart,
    refresh,
    toast,
    ready,
    mergeCart,
  } = useShop();
  const router = useRouter();
  const reorderId = useSearchParams().get("reorder");
  type ReorderResult = {
    items: { variantId: string; quantity: number }[];
    notices: string[];
    code: string;
    draft: Pick<
      Order,
      | "buyerName"
      | "buyerEmail"
      | "recipientName"
      | "recipientPhone"
      | "address"
      | "cardMessage"
      | "cardWritingMode"
      | "note"
    > & { zoneId: string };
  };
  const [reorder, setReorder] = useState<ReorderResult | null>(null);
  const [reorderLoading, setReorderLoading] = useState(!!reorderId);
  const [reorderError, setReorderError] = useState("");
  const [cardWritingMode, setCardWritingMode] =
    useState<CardWritingMode>("AUTO");
  useEffect(() => {
    if (cart.length) track("begin_checkout", { items: cart });
  }, [cart]);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [discountChoice, setDiscountChoice] = useState("none"),
    [payment, setPayment] = useState(sepayAvailable ? "SEPAY" : "COD"),
    [zoneId, setZone] = useState(zones[0]?.id ?? ""),
    [deliveryDay, setDeliveryDay] = useState(shiftDay(dayKey(), 1)),
    [slotId, setSlotId] = useState(slots[0]?.id ?? ""),
    [voucher, setVoucher] = useState("");
  useEffect(() => {
    if (!reorderId || !ready) return;
    let active = true;
    setReorderLoading(true);
    request<ReorderResult>(
      `orders/${encodeURIComponent(reorderId)}/reorder`,
      {},
    )
      .then((result) => {
        if (!active) return;
        mergeCart(result.items);
        setReorder(result);
        setCardWritingMode(result.draft.cardWritingMode ?? "AUTO");
        if (zones.some((z) => z.id === result.draft.zoneId))
          setZone(result.draft.zoneId);
        setReorderError("");
        // The prepared draft lives only in this checkout; reloads must not append the same order again.
        router.replace("/checkout", { scroll: false });
      })
      .catch((e) => {
        if (active) setReorderError((e as Error).message);
      })
      .finally(() => {
        if (active) setReorderLoading(false);
      });
    return () => {
      active = false;
    };
  }, [reorderId, ready, mergeCart, router]);
  const [idempotencyKey] = useState(() =>
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-fleurious-order-draft`,
  );
  const subtotal = cart.reduce((s, i) => {
    const v = products
      .flatMap((p) => p.variants)
      .find((v) => v.id === i.variantId);
    return s + (v?.price ?? 0) * i.quantity;
  }, 0);
  const fee = zones.find((z) => z.id === zoneId)?.fee ?? 0;
  const remaining = Math.max(
    0,
    (me?.period?.limit ?? settings.memberQuota) -
      (me?.period?.consumed ?? 0) -
      (me?.period?.reserved ?? 0),
  );
  const {
    quote: quoted,
    error: quoteError,
    checking,
    needsVoucher,
    refreshQuote,
  } = useCheckoutQuote(
    {
      items: cart,
      zoneId,
      deliveryDay,
      slotId,
      paymentMethod: payment as "SEPAY" | "COD",
      useMember: discountChoice === "member",
      rewardId: discountChoice.startsWith("reward:")
        ? discountChoice.slice(7)
        : undefined,
      voucherCode: discountChoice === "voucher" ? voucher.trim() : undefined,
    },
    ready && cart.length > 0 && !reorderLoading && !reorderError,
    JSON.stringify([
      user?.id,
      me?.membership.current,
      me?.period,
      me?.rewards,
      subtotal,
      fee,
      settings.codEnabled,
      sepayAvailable,
    ]),
  );
  function payload(form: HTMLFormElement) {
    return {
      ...Object.fromEntries(new FormData(form)),
      items: cart,
      zoneId,
      deliveryDay,
      slotId,
      paymentMethod: payment,
      useMember: discountChoice === "member",
      rewardId: discountChoice.startsWith("reward:")
        ? discountChoice.slice(7)
        : undefined,
      voucherCode: discountChoice === "voucher" ? voucher.trim() : undefined,
      idempotencyKey,
      expectedTotal: quoted?.total,
      cardWritingMode,
    };
  }
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy || checking || !quoted) return;
    setBusy(true);
    setError("");
    try {
      const result = await request<{ id: string }>(
        "orders",
        payload(e.currentTarget),
      );
      clearCart();
      await refresh();
      router.push(`/orders/${result.id}`);
    } catch (e) {
      setError((e as Error).message);
      refreshQuote();
    } finally {
      setBusy(false);
    }
  }
  if (reorderLoading)
    return (
      <div className="page-loading">Đang kiểm tra hoa và chuẩn bị đơn mới…</div>
    );
  if (reorderError)
    return (
      <div className="empty-state">
        <h2>{reorderError}</h2>
        <Link href="/flowers" className="button">
          Chọn hoa
        </Link>
      </div>
    );
  if (!cart.length)
    return (
      <div className="empty-state">
        <h1>
          {reorder
            ? "Hoa trong đơn cũ hiện không còn đủ hàng."
            : "Giỏ hoa đang trống."}
        </h1>
        {reorder?.notices.map((n) => (
          <p key={n}>{n}</p>
        ))}
        <Link href="/flowers" className="button">
          Chọn một bó hoa
        </Link>
      </div>
    );
  return (
    <section className="container section checkout-page">
      <div className="page-heading">
        <span className="eyebrow">MỘT CHÚT NỮA, HOA SẼ LÊN ĐƯỜNG</span>
        <h1>
          Gửi đi một <em>lời thương.</em>
        </h1>
      </div>
      <form
        key={reorder?.code ?? "new-order"}
        className="checkout-layout"
        onSubmit={submit}
        onChange={() => setError("")}
      >
        <div className="checkout-form form-stack">
          {reorder && (
            <div className="notice">
              <strong>Đặt lại từ đơn {reorder.code}</strong>
              <p>
                Hoa đã được thêm vào giỏ hiện tại. Vui lòng chọn lại lịch giao
                và ưu đãi. Tổng tiền sẽ được tính lại tự động.
              </p>
              {reorder.notices.map((n) => (
                <p key={n}>{n}</p>
              ))}
            </div>
          )}
          {!user && (
            <p className="notice">
              Bạn có thể đặt không cần tài khoản.{" "}
              <Link href="/auth/login?next=/checkout">Đăng nhập</Link> để dùng
              ưu đãi hội viên và lưu đơn.
            </p>
          )}
          <h2>
            <UserRound size={21} />
            01. Người gửi lời thương
          </h2>
          <div className="two-columns">
            <label>
              Tên của bạn
              <input
                name="buyerName"
                defaultValue={reorder?.draft.buyerName ?? user?.name}
                required
                minLength={2}
                autoComplete="name"
              />
            </label>
            <label>
              Email nhận xác nhận
              <input
                name="buyerEmail"
                type="email"
                defaultValue={reorder?.draft.buyerEmail || user?.email}
                required
                autoComplete="email"
              />
            </label>
          </div>
          <h2>
            <MapPin size={21} />
            02. Hoa sẽ tới đâu?
          </h2>
          <div className="two-columns">
            <label>
              Tên người nhận
              <input
                name="recipientName"
                defaultValue={reorder?.draft.recipientName}
                required
                minLength={2}
              />
            </label>
            <label>
              Điện thoại người nhận
              <input
                name="recipientPhone"
                defaultValue={reorder?.draft.recipientPhone}
                type="tel"
                required
                pattern="(\+84|0)[0-9]{9,10}"
              />
            </label>
          </div>
          <label>
            Địa chỉ chi tiết
            <input
              name="address"
              defaultValue={reorder?.draft.address}
              placeholder="Số nhà, đường, phường…"
              required
              minLength={8}
            />
          </label>
          <label>
            Khu vực giao
            <Select value={zoneId} onChange={(e) => setZone(e.target.value)}>
              {zones.map((z) => (
                <option value={z.id} key={z.id}>
                  {z.name} · {money(z.fee)}
                </option>
              ))}
            </Select>
          </label>
          <div className="two-columns">
            <label>
              Ngày giao
              <input
                name="deliveryDay"
                type="date"
                min={dayKey()}
                max={shiftDay(dayKey(), 60)}
                value={deliveryDay}
                onChange={(e) => setDeliveryDay(e.target.value)}
                required
              />
            </label>
            <label>
              Khung giờ · Hà Nội
              <Select
                name="slotId"
                value={slotId}
                onChange={(e) => setSlotId(e.target.value)}
              >
                {slots.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.label}
                  </option>
                ))}
              </Select>
            </label>
          </div>
          <CardWritingChoice
            value={cardWritingMode}
            onChange={setCardWritingMode}
          />
          <label>
            {cardWritingMode === "HANDWRITTEN"
              ? "Lời nhắn cần viết tay (nếu có)"
              : "Lời nhắn trên thiệp"}
            <textarea
              name="cardMessage"
              defaultValue={reorder?.draft.cardMessage}
              rows={3}
              maxLength={500}
              placeholder={
                cardWritingMode === "HANDWRITTEN"
                  ? "Để lại lời nhắn để cửa hàng viết tay, hoặc để trống nếu bạn muốn tự viết."
                  : "Có những điều, để hoa nói thay…"
              }
            />
          </label>
          <label>
            Ghi chú cho florist
            <textarea
              name="note"
              defaultValue={reorder?.draft.note}
              rows={2}
              maxLength={500}
              placeholder="Yêu cầu đặc biệt, lưu ý khi giao…"
            />
          </label>
          <h2>
            <Gift size={21} />
            03. Một chút đặc quyền
          </h2>
          <label>
            Chọn ưu đãi
            <Select
              value={discountChoice}
              onChange={(e) => setDiscountChoice(e.target.value)}
            >
              <option value="none">Giá thường · giữ lượt cho dịp khác</option>
              {user?.memberSince && me?.membership.current && (
                <option
                  value="member"
                  disabled={
                    remaining <= 0 ||
                    subtotal < (me.membership.current?.minimum ?? 0)
                  }
                >
                  {me?.membership.current?.name ?? "Hội viên"} −
                  {me?.membership.current?.percent ?? settings.memberPercent}% ·
                  còn {remaining} lượt
                  {(me.membership.current?.minimum ?? 0) > 0
                    ? ` · từ ${money(me.membership.current!.minimum)}`
                    : ""}
                </option>
              )}
              {me?.rewards
                .filter(
                  (r) =>
                    r.status === "AVAILABLE" &&
                    new Date(r.expiresAt) > new Date(),
                )
                .map((r) => (
                  <option key={r.id} value={`reward:${r.id}`}>
                    {r.title}
                  </option>
                ))}
              <option value="voucher">Tôi có mã ưu đãi</option>
            </Select>
          </label>
          {discountChoice === "voucher" && (
            <label>
              Mã ưu đãi
              <input
                value={voucher}
                maxLength={40}
                autoComplete="off"
                onChange={(e) => setVoucher(e.target.value.toUpperCase())}
              />
            </label>
          )}
          <p className="small muted">
            Mỗi đơn áp dụng một ưu đãi tiền hàng.{" "}
            {discountChoice === "member"
              ? "Đơn này sử dụng 1 lượt hội viên."
              : "Không sử dụng lượt hội viên."}
          </p>
          <div
            className={`checkout-quote-feedback ${quoteError ? "error" : quoted ? "success" : ""}`}
            role={quoteError ? "alert" : "status"}
            aria-live="polite"
          >
            {checking
              ? "Đang tính tổng tiền và kiểm tra ưu đãi…"
              : needsVoucher
                ? "Nhập mã ưu đãi để hệ thống kiểm tra tự động."
                : quoteError ||
                  (quoted
                    ? quoted.discount > 0
                      ? `Đã áp dụng ${quoted.discountLabel}. Bạn tiết kiệm ${money(quoted.discount)}.`
                      : "Đã cập nhật tổng tiền theo giá thường."
                    : "")}
          </div>
          <h2>
            <CreditCard size={21} />
            04. Thanh toán
          </h2>
          <div className="payment-options">
            <label className={payment === "SEPAY" ? "selected" : ""}>
              <input
                type="radio"
                checked={payment === "SEPAY"}
                onChange={() => setPayment("SEPAY")}
                disabled={!sepayAvailable}
              />
              <div>
                <strong>Chuyển khoản QR · SePay</strong>
                <p>
                  {sepayAvailable
                    ? "Tự xác nhận khi nhận đúng tiền và nội dung."
                    : "Cửa hàng đang cấu hình tài khoản SePay."}
                </p>
              </div>
              <CreditCard size={21} />
            </label>
            {settings.codEnabled && (
              <label className={payment === "COD" ? "selected" : ""}>
                <input
                  type="radio"
                  checked={payment === "COD"}
                  onChange={() => setPayment("COD")}
                />
                <div>
                  <strong>Thanh toán khi nhận hoa</strong>
                  <p>Cửa hàng liên hệ xác nhận trước khi chuẩn bị.</p>
                </div>
                <Truck size={21} />
              </label>
            )}
          </div>
          {error && (
            <div className="form-error" role="alert">
              {error}
            </div>
          )}
        </div>
        <aside className="order-summary" aria-busy={checking}>
          <span className="eyebrow">BÓ HOA VÀ MỘT TẤM LÒNG</span>
          <h2>Đơn hoa của bạn.</h2>
          {cart.map((i) => {
            const p = products.find((p) =>
              p.variants.some((v) => v.id === i.variantId),
            );
            const v = p?.variants.find((v) => v.id === i.variantId);
            return p && v ? (
              <div className="summary-item" key={i.variantId}>
                <img src={p.image} alt={p.name} width="62" height="78" />
                <div>
                  <strong>{p.name}</strong>
                  <small>
                    {v.name} × {i.quantity}
                  </small>
                  <span>{money(v.price * i.quantity)}</span>
                </div>
              </div>
            ) : null;
          })}
          <div className="summary-line">
            <span>Tiền hoa</span>
            <strong>{money(quoted?.subtotal ?? subtotal)}</strong>
          </div>
          <div className="summary-line">
            <span>Giao hoa</span>
            <strong>{money(quoted?.deliveryFee ?? fee)}</strong>
          </div>
          {quoted?.discount ? (
            <div className="summary-line discount">
              <span>{quoted.discountLabel}</span>
              <strong>−{money(quoted.discount)}</strong>
            </div>
          ) : null}
          <div className="summary-line total">
            <span>
              {checking
                ? "Đang tính tổng tiền…"
                : quoted
                  ? "Tổng thanh toán"
                  : "Tạm tính trước ưu đãi"}
            </span>
            <strong>{money(quoted?.total ?? subtotal + fee)}</strong>
          </div>
          <button
            className="button glass-primary full"
            disabled={
              busy ||
              checking ||
              !quoted ||
              (!sepayAvailable && !settings.codEnabled)
            }
          >
            {busy
              ? "Đang gửi đơn…"
              : checking
                ? "Đang kiểm tra…"
                : "Xác nhận gửi hoa"}
            <ArrowRight size={18} />
          </button>
          <p className="small muted">
            Bằng việc đặt đơn, bạn đồng ý{" "}
            <Link href="/delivery">chính sách giao</Link> và{" "}
            <Link href="/returns">đổi trả</Link>. Giá, tồn và slot được kiểm tra
            lại khi tạo đơn.
          </p>
        </aside>
      </form>
    </section>
  );
}
export function OrderPage({ id }: { id?: string }) {
  const { toast } = useShop();
  const [order, setOrder] = useState<Order | null>(null),
    [error, setError] = useState("");
  const seconds = useDeadline(order?.expiresAt, order?.serverNow);
  useEffect(() => {
    if (!id) return;
    const load = () =>
      request<Order>(`orders/${id}`)
        .then(setOrder)
        .catch((e) => setError(e.message));
    load();
    const timer = setInterval(load, 15000);
    window.addEventListener("fleurious:sync", load);
    return () => {
      clearInterval(timer);
      window.removeEventListener("fleurious:sync", load);
    };
  }, [id]);
  if (error)
    return (
      <div className="empty-state">
        <h2>{error}</h2>
        <Link href="/account/orders" className="button">
          Đơn của bạn
        </Link>
      </div>
    );
  if (!order) return <div className="page-loading">Đang mở đơn hoa…</div>;
  const expired = isOrderExpired(
    order,
    seconds === 0 ? Date.parse(order.expiresAt) : Number.NEGATIVE_INFINITY,
  );
  return (
    <section className="container section order-detail-page">
      <div className="page-heading">
        <span className="eyebrow">CẢM ƠN BẠN ĐÃ GỬI MỘT LỜI THƯƠNG</span>
        <h1>
          Một bó hoa,
          <br />
          <em>đang được nâng niu.</em>
        </h1>
        <p>
          {order.code} · {humanDate(order.createdAt)}
        </p>
      </div>
      <div className="checkout-layout">
        <div>
          <div className="order-status-banner">
            <Truck size={26} />
            <div>
              <strong>
                {expired
                  ? order.paymentMethod === "SEPAY"
                    ? "Hết hạn thanh toán"
                    : "Hết hạn xác nhận"
                  : orderStatus[
                      order.status === "PENDING" ||
                      stoppedOrderStatuses.includes(order.status)
                        ? order.status
                        : order.fulfillment
                    ]}
              </strong>
              <p>
                {orderStatus[order.paymentStatus]} ·{" "}
                {order.paymentMethod === "SEPAY" ? "SePay" : "COD"}
              </p>
            </div>
          </div>
          {expired && (
            <div className="order-expired-notice">
              <div>
                <strong>Đơn đã hết thời gian giữ hoa.</strong>
                <p>
                  Đặt lại để kiểm tra giá, tồn kho và chọn lịch giao mới. Vui
                  lòng không chuyển tiền theo QR cũ.
                </p>
              </div>
              <Link href={`/checkout?reorder=${order.id}`} className="button">
                Đặt lại <ArrowRight size={16} />
              </Link>
            </div>
          )}
          <div className="detail-block">
            <h2>Gửi tới một người thương.</h2>
            <p>
              <strong>{order.recipientName}</strong> · {order.recipientPhone}
            </p>
            <p>{order.address}</p>
            <p>
              <CalendarDays size={16} /> {order.deliveryDay} · {order.slotLabel}{" "}
              · Hà Nội
            </p>
            {order.cardMessage && (
              <blockquote>“{order.cardMessage}”</blockquote>
            )}
            <p className="small muted">
              {cardWritingLabels[order.cardWritingMode ?? "AUTO"]}
            </p>
          </div>
          <div className="detail-block">
            <h2>Hành trình của hoa.</h2>
            <ol className="order-timeline">
              {order.history?.map((h) => (
                <li key={h.id}>
                  <span />
                  <div>
                    <strong>{h.text}</strong>
                    <p>{humanDate(h.createdAt)}</p>
                  </div>
                </li>
              ))}
            </ol>
          </div>
          {order.paymentQr && !expired && (
            <PaymentQr
              url={order.paymentQr}
              amount={order.total}
              code={order.code}
              bank={order.bank}
              accountNumber={order.accountNumber}
              accountName={order.accountName}
              expiresAt={order.expiresAt}
              serverNow={order.serverNow}
            />
          )}
        </div>
        <aside>
          <div className="order-summary">
            <h2>Những đóa hoa bạn chọn.</h2>
            {order.items.map((i) => (
              <div className="summary-item" key={i.id}>
                <img src={i.image} alt={i.name} width="62" height="78" />
                <div>
                  <strong>{i.name}</strong>
                  <small>
                    {i.variantName} × {i.quantity}
                  </small>
                  <span>{money(i.price * i.quantity)}</span>
                </div>
              </div>
            ))}
            <div className="summary-line">
              <span>Tiền hoa</span>
              <strong>{money(order.subtotal)}</strong>
            </div>
            <div className="summary-line">
              <span>Ưu đãi</span>
              <strong>−{money(order.discount)}</strong>
            </div>
            <div className="summary-line">
              <span>Giao hoa</span>
              <strong>{money(order.deliveryFee)}</strong>
            </div>
            <div className="summary-line total">
              <span>Tổng tiền</span>
              <strong>{money(order.total)}</strong>
            </div>
          </div>
        </aside>
      </div>
    </section>
  );
}
export function QrPage({ token }: { token: string }) {
  const { user, refresh, toast } = useShop();
  const router = useRouter();
  const [data, setData] = useState<{
      image: string;
      name: string;
      eligibleAt: string | null;
      expiresAt: string | null;
      revoked: boolean;
      remaining: number;
    } | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    request<typeof data>("qr/preview", { token })
      .then(setData)
      .catch((e) => setError(e.message));
  }, [token]);
  async function claim() {
    setBusy(true);
    try {
      const result = await request<{ alreadyClaimed?: boolean }>("qr/claim", {
        token,
      });
      if (!result.alreadyClaimed) track("qr_claim_succeeded");
      await refresh();
      toast(
        result.alreadyClaimed
          ? "Bạn đã lưu ngày từ QR này rồi."
          : "Đã thêm một ngày dịu dàng vào lịch hoa!",
      );
      router.push("/streak");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="container section qr-landing">
      <span className="eyebrow">AI ĐÓ VỪA GỬI BẠN MỘT CHÚT DỊU DÀNG</span>
      <h1>
        Một đóa hoa.
        <br />
        <em>Một ngày để nhớ.</em>
      </h1>
      {data && (
        <>
          <img
            className="qr-bouquet"
            src={data.image}
            alt={data.name}
            width="500"
            height="600"
          />
          <h2>{data.name}</h2>
          <p>Thêm ảnh hoa vào lịch hôm nay và tiến gần một món quà nhỏ.</p>
          <p className="small muted">
            {data.eligibleAt
              ? `${data.remaining} lượt còn lại · Hạn ${humanDate(data.expiresAt!)}`
              : "Đang chờ đơn hàng đủ điều kiện kích hoạt."}
          </p>
          {user ? (
            <>
              <p className="small">
                Nhận vào tài khoản <strong>{user.name}</strong>
              </p>
              <button
                className="button"
                disabled={
                  busy ||
                  data.revoked ||
                  data.remaining < 1 ||
                  !data.eligibleAt ||
                  new Date(data.expiresAt!) < new Date()
                }
                onClick={claim}
              >
                {busy ? "Đang thêm ngày…" : "Thêm hoa vào hôm nay"}
                <Flame size={18} />
              </button>
            </>
          ) : (
            <Link
              className="button"
              href={`/auth/login?next=${encodeURIComponent(`/q/${token}`)}`}
            >
              Đăng nhập để nhận ngày <ArrowRight size={17} />
            </Link>
          )}
        </>
      )}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <p className="small muted">
        Mỗi tài khoản một ngày hợp lệ/ngày. Ngày tính theo giờ Hà Nội.
      </p>
    </section>
  );
}
