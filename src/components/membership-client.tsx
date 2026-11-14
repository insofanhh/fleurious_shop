"use client";
import { PaymentQr } from "./payment-qr";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import {
  ArrowRight,
  Check,
  CalendarDays,
  CreditCard,
  Gift,
  Heart,
  ShieldCheck,
  TicketPercent,
  TrendingUp,
  RefreshCw,
  WifiOff,
} from "lucide-react";
import { BrandMark } from "./brand-mark";
import { Select } from "./ui/select";
import { request, useShop } from "./shop-provider";
import { money, humanDate, dayKey } from "@/lib/time";
import {
  MEMBERSHIP_SOURCE_LABELS,
  MEMBERSHIP_STATUS_LABELS,
  type MembershipInvoiceView,
  type MembershipSummary,
  type MembershipTierView,
} from "@/lib/membership-types";

type Details = {
  summary: MembershipSummary;
  invoices: MembershipInvoiceView[];
  history: {
    id: string;
    action: string;
    createdAt: string;
    detail: Record<string, unknown>;
  }[];
};
const shortDate = (value: string) =>
  new Intl.DateTimeFormat("vi-VN", {
    timeZone: "Asia/Ho_Chi_Minh",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(new Date(value));
const kinds: Record<string, string> = {
  PURCHASE: "Mua gói",
  RENEW: "Gia hạn",
  UPGRADE: "Nâng gói trong kỳ",
  SCHEDULE: "Gói tiếp theo",
};
const historyNames: Record<string, string> = {
  enrolled: "Tham gia Fleurious Circle",
  earned: "Đạt hạng nhờ chi tiêu",
  earned_adjusted: "Điều chỉnh sau hoàn tiền",
  admin_granted: "Nhận hạng từ cửa hàng",
  admin_revoked: "Kết thúc hạng cửa hàng cấp",
  paid_activated: "Kích hoạt gói đã thanh toán",
  legacy_preserved: "Bảo toàn hạng hiện có",
  effective_changed: "Cập nhật hạng áp dụng",
  fee_refunded: "Hoàn phí hội viên",
};

export function CircleCard({
  summary,
  name,
}: {
  summary: MembershipSummary | null;
  name?: string;
}) {
  const tier = summary?.current;
  return (
    <div
      className={`membership-card circle-card ${tier?.code.toLowerCase() ?? "member"}`}
      style={{
        background: tier
          ? `linear-gradient(135deg, ${tier.color}, #4d101b)`
          : undefined,
      }}
    >
      <div>
        <BrandMark />
        <span>FLEURIOUS CIRCLE</span>
      </div>
      <span className="card-tier">{tier?.name ?? "Member"}</span>
      <p>{name ?? "Một chỗ dành riêng cho người yêu hoa."}</p>
      <div>
        <span>
          {summary?.enrolled
            ? `${summary.remaining}/${summary.limit} lượt còn lại`
            : "Tham gia miễn phí"}
        </span>
        <Heart size={22} strokeWidth={1} />
      </div>
      {summary?.enrolled && (
        <small>
          {summary.expiresAt
            ? `Đặc quyền hiện tại đến ${shortDate(summary.expiresAt)}`
            : "Đồng hành cùng những ngày có hoa"}
        </small>
      )}
    </div>
  );
}

export function MembershipPage({ invoiceId }: { invoiceId?: string }) {
  if (invoiceId) return <MembershipInvoicePage id={invoiceId} />;
  return <MembershipOverview />;
}

function MembershipOverview() {
  const {
    user,
    me,
    membershipTiers,
    settings,
    sepayAvailable,
    refresh,
    toast,
    ready,
  } = useShop();
  const [mode, setMode] = useState("AUTO");
  const [cycle, setCycle] = useState<"MONTH" | "YEAR">("MONTH"),
    [accepted, setAccepted] = useState(false),
    [busy, setBusy] = useState("");
  const router = useRouter(),
    summary = me?.membership ?? null;
  async function enroll() {
    setBusy("enroll");
    try {
      await request("membership/enroll", { accepted });
      await refresh();
      toast("Chào mừng bạn đến Fleurious Circle.");
    } catch (e) {
      toast((e as Error).message);
    } finally {
      setBusy("");
    }
  }
  async function buy(tier: MembershipTierView) {
    if (!user) {
      router.push("/auth/login?next=/membership");
      return;
    }
    if (!summary?.enrolled) {
      toast("Tham gia hội viên miễn phí trước khi chọn gói nâng hạng.");
      return;
    }
    setBusy(tier.id);
    try {
      const invoice = await request<MembershipInvoiceView>("membership/quote", {
        tierId: tier.id,
        cycle,
        mode,
        idempotencyKey: crypto.randomUUID(),
      });
      router.push(`/membership/invoices/${invoice.id}`);
    } catch (e) {
      toast((e as Error).message);
    } finally {
      setBusy("");
    }
  }
  const base = membershipTiers.find((t) => t.rank === 0),
    next = summary?.nextTier;
  const progress = next
    ? Math.min(100, ((summary?.spend ?? 0) / next.spendThreshold) * 100)
    : 100;
  return (
    <section className="container section membership-page circle-page">
      <div className="membership-hero circle-hero">
        <div>
          <span className="eyebrow">FLEURIOUS CIRCLE</span>
          <h1>
            Một vòng tròn nhỏ.
            <br />
            <em>Thêm nhiều yêu thương.</em>
          </h1>
          <p>
            Tham gia miễn phí. Mở thêm đặc quyền khi nâng hạng.
            <br />
            Mua một gói, gom những đơn hoa, hoặc đón một món quà từ cửa hàng.
          </p>
          <div className="membership-perks">
            <span>
              <TicketPercent />
              Quyền lợi riêng cho từng hạng
            </span>
            <span>
              <CalendarDays />
              Chọn gói tháng hoặc năm tiết kiệm hơn
            </span>
            <span>
              <Heart />
              Hết lượt vẫn mua theo giá thường
            </span>
          </div>
          {summary?.enrolled ? (
            <Link className="button glass-primary" href="/account/membership">
              Quản lý hội viên <ArrowRight size={17} />
            </Link>
          ) : !user ? (
            <Link
              className="button glass-primary"
              href="/auth/login?next=/membership"
            >
              Bước vào vòng tròn yêu hoa <ArrowRight size={17} />
            </Link>
          ) : (
            <div className="circle-join" id="circle-join">
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={accepted}
                  onChange={(e) => setAccepted(e.target.checked)}
                />
                Tôi đồng ý điều lệ hội viên bên dưới.
              </label>
              <button
                className="button glass-primary"
                disabled={
                  !ready ||
                  !accepted ||
                  !!busy ||
                  !settings.memberEnabled ||
                  !user.verified
                }
                onClick={enroll}
              >
                {busy === "enroll" ? "Đang tham gia…" : "Tham gia miễn phí"}
                <ArrowRight size={17} />
              </button>
              {!user.verified && (
                <p className="small muted">
                  Xác minh email để nhận quyền lợi hội viên.
                </p>
              )}
            </div>
          )}
        </div>
        <CircleCard summary={summary} name={user?.name} />
      </div>
      <div className="circle-paths">
        {[
          {
            Icon: CreditCard,
            title: "Chọn một gói",
            text: "Mua 1 hoặc 12 tháng để dùng hạng cao hơn ngay khi được kích hoạt.",
          },
          {
            Icon: TrendingUp,
            title: "Gom những đơn hoa",
            text: "Tiền hoa hợp lệ được tích lũy để lên hạng, không cần mua gói.",
          },
          {
            Icon: Gift,
            title: "Đón quà từ Fleurious",
            text: "Cửa hàng có thể tặng hạng với thời hạn được ghi rõ trên thẻ.",
          },
        ].map(({ Icon, title, text }) => (
          <div key={title}>
            <Icon size={22} strokeWidth={1.3} />
            <h3>{title}</h3>
            <p>{text}</p>
          </div>
        ))}
      </div>
      <div className="section-heading circle-plans-heading">
        <div>
          <span className="eyebrow">MỘT CHÚT ĐẶC BIỆT HƠN</span>
          <h2>
            Chọn vòng tròn <em>của bạn.</em>
          </h2>
        </div>
        <div
          className="circle-cycle"
          role="group"
          aria-label="Chu kỳ thanh toán"
        >
          <button
            aria-pressed={cycle === "MONTH"}
            onClick={() => setCycle("MONTH")}
          >
            Hàng tháng
          </button>
          <button
            aria-pressed={cycle === "YEAR"}
            onClick={() => setCycle("YEAR")}
          >
            Hàng năm <span>Tiết kiệm hơn</span>
          </button>
        </div>
      </div>
      {summary?.sources.some(
        (s) =>
          s.source === "PAID" && (!s.endsAt || new Date(s.endsAt) > new Date()),
      ) && (
        <label className="circle-plan-mode">
          Thời điểm gói mới
          <Select value={mode} onChange={(e) => setMode(e.target.value)}>
            <option value="AUTO">
              Nâng ngay nếu cùng chu kỳ và đủ điều kiện
            </option>
            <option value="NEXT">Bắt đầu sau các kỳ đã mua</option>
          </Select>
        </label>
      )}
      {!settings.memberEnabled && (
        <p className="notice">
          Cửa hàng tạm dừng nhận đăng ký và mua gói mới. Các quyền hội viên đã
          có vẫn tiếp tục theo thời hạn.
        </p>
      )}
      {!sepayAvailable && (
        <p className="circle-subtle-note">
          <ShieldCheck size={16} />
          Bạn có thể xem các gói. Cửa hàng đang hoàn tất cấu hình SePay trước
          khi nhận thanh toán.
        </p>
      )}
      <div className="circle-plans">
        {membershipTiers
          .filter((t) => t.active)
          .map((tier) => {
            const free = tier.rank === 0,
              price = cycle === "YEAR" ? tier.yearlyPrice : tier.monthlyPrice,
              saving = tier.monthlyPrice * 12 - tier.yearlyPrice;
            const available =
              cycle === "YEAR" ? tier.yearlyEnabled : tier.monthlyEnabled;
            const paid = summary?.sources.some(
              (s) =>
                s.source === "PAID" &&
                s.tierId === tier.id &&
                !s.revokedAt &&
                (!s.endsAt || new Date(s.endsAt) > new Date()),
            );
            const same = summary?.current?.id === tier.id;
            const covered = !!summary?.base && summary.base.rank >= tier.rank;
            return (
              <article
                key={tier.id}
                className={`circle-plan ${tier.rank === 2 ? "circle-plan-featured" : ""}`}
              >
                <div className="circle-plan-top">
                  <span className="eyebrow">{tier.name}</span>
                  {same && <span className="circle-chip">Đang hưởng</span>}
                </div>
                <h3>{tier.name}</h3>
                <p className="circle-plan-description">{tier.description}</p>
                <div className="circle-price">
                  {free ? (
                    <strong>Miễn phí</strong>
                  ) : !available ? (
                    <strong>Chưa mở bán</strong>
                  ) : (
                    <>
                      <strong>{money(price)}</strong>
                      <span>/{cycle === "YEAR" ? "năm" : "tháng"}</span>
                    </>
                  )}
                </div>
                <p className="circle-price-caption">
                  {free
                    ? "Chỉ cần đăng ký và xác minh tài khoản."
                    : !available
                      ? "Bạn có thể chọn chu kỳ khác đang mở bán."
                      : cycle === "YEAR"
                        ? `Thanh toán một lần · tương đương ${money(Math.round(price / 12))}/tháng`
                        : "Thanh toán một lần cho mỗi kỳ. Chủ động gia hạn."}
                </p>
                {!free && available && cycle === "YEAR" && saving > 0 && (
                  <p className="circle-saving">
                    Tiết kiệm {money(saving)} ·{" "}
                    {((saving / (tier.monthlyPrice * 12)) * 100).toLocaleString(
                      "vi-VN",
                      { maximumFractionDigits: 1 },
                    )}
                    % so với 12 tháng
                  </p>
                )}
                <ul className="circle-perks">
                  <li>
                    <Check />
                    Giảm {tier.percent}% tiền hoa, tối đa {money(tier.cap)}/đơn
                  </li>
                  <li>
                    <Check />
                    {tier.quota} đơn ưu đãi mỗi tháng
                  </li>
                  {tier.minimum > 0 && (
                    <li>
                      <Check />
                      Đơn tiền hoa từ {money(tier.minimum)}
                    </li>
                  )}
                  {tier.birthdayPercent > 0 && (
                    <li>
                      <Gift />
                      Quà sinh nhật −{tier.birthdayPercent}%, tối đa{" "}
                      {money(tier.birthdayCap)}
                    </li>
                  )}
                  <li>
                    <Heart />
                    Mua thường khi đã hết lượt
                  </li>
                </ul>
                <div className="circle-plan-footer">
                  {free ? (
                    <a
                      href={
                        summary?.enrolled
                          ? "/account/membership"
                          : user
                            ? "#circle-join"
                            : "/auth/login?next=/membership"
                      }
                      className="button secondary"
                    >
                      {summary?.enrolled
                        ? "Xem thẻ hội viên"
                        : user
                          ? "Tham gia miễn phí"
                          : "Đăng nhập để tham gia"}
                    </a>
                  ) : (
                    <button
                      className={`button ${tier.rank === 2 ? "glass-primary" : "secondary"}`}
                      disabled={
                        !!busy ||
                        !available ||
                        !settings.memberEnabled ||
                        (covered && !paid)
                      }
                      onClick={() => buy(tier)}
                    >
                      {busy === tier.id
                        ? "Đang xem giá…"
                        : covered && !paid
                          ? "Bạn đã có hạng này"
                          : !available
                            ? "Chưa mở bán"
                            : paid
                              ? "Gia hạn gói"
                              : `Chọn ${tier.name}`}
                      <ArrowRight size={15} />
                    </button>
                  )}
                  {!free && (
                    <p>
                      Hoặc đạt {money(tier.spendThreshold)} chi tiêu tiền hoa
                      hợp lệ.
                    </p>
                  )}
                </div>
              </article>
            );
          })}
      </div>
      {summary?.enrolled && (
        <div className="circle-spend">
          <div>
            <span className="eyebrow">NHỮNG ĐƠN HOA ĐƯỢC GHI NHỚ</span>
            <h2>
              {next
                ? `Gần hơn với ${next.name}.`
                : "Cảm ơn bạn đã luôn có chỗ cho hoa."}
            </h2>
            <p>
              Đã tích lũy <strong>{money(summary.spend)}</strong> tiền hoa hợp
              lệ.
              {next
                ? ` Còn ${money(Math.max(0, next.spendThreshold - summary.spend))} để đạt ${next.name}.`
                : " Bạn đã đạt hạng tích lũy cao nhất đang mở."}
            </p>
          </div>
          <div
            className="circle-progress"
            role="progressbar"
            aria-label="Tiến độ chi tiêu lên hạng"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(progress)}
          >
            <span style={{ width: `${progress}%` }} />
          </div>
          <small>
            Đơn đã giao và thu tiền, sau giảm giá và phần hoàn tiền hoa. Phí
            giao và phí hội viên không được cộng.
          </small>
        </div>
      )}
      <div className="circle-faq" id="circle-terms">
        <span className="eyebrow">ĐẶC QUYỀN RÕ RÀNG</span>
        <h2>
          Để mỗi lần gửi hoa <em>thật nhẹ nhàng.</em>
        </h2>
        {[
          [
            "Ba cách lên hạng có cộng dồn không?",
            "Bạn hưởng hạng cao nhất còn hiệu lực. Hạng mua, tích lũy và cửa hàng tặng được lưu riêng; không cộng dồn phần trăm hoặc lượt của nhiều nguồn.",
          ],
          [
            "Lượt được tính và làm mới khi nào?",
            `Một đơn dùng một lượt, dù có nhiều bó hoa. Lượt làm mới ngày 1 theo giờ Hà Nội, không chuyển tháng. Nâng hạng chỉ tăng hạn mức, không reset số đã dùng hoặc đang giữ. Member hiện có ${base?.quota ?? 3} lượt/tháng.`,
          ],
          [
            "Gói tháng/năm có khác kỳ lượt không?",
            "Gói có hiệu lực 1 hoặc 12 tháng từ lúc kích hoạt. Lượt theo tháng dương lịch: gói tháng có thể đi qua hai tháng lịch, gói năm có thể đi qua 13 tháng lịch. Lượt chỉ dùng trong thời gian quyền còn hiệu lực; mua năm không cấp toàn bộ lượt ngay.",
          ],
          [
            "Hết gói trả phí thì sao?",
            "Bạn tiếp tục hưởng hạng tích lũy hoặc quyền cửa hàng cấp còn hiệu lực, tối thiểu là Member. Nếu đã dùng quá hạn mức của hạng nền trong tháng, bạn mua thường cho tới kỳ mới. Đơn đã xác nhận được giữ quyền lợi đã công bố.",
          ],
          [
            "Gia hạn, nâng gói và hạ gói thế nào?",
            "Gia hạn nối tiếp kỳ hiện có. Nâng hạng cùng chu kỳ có thể trả chênh lệch thời gian còn lại; báo giá ghi rõ trước khi thanh toán. Đổi chu kỳ, hạ gói hoặc đã có kỳ tiếp theo được xếp sau thời gian đã mua. Không tự động trích tiền.",
          ],
          [
            "Ưu đãi có dùng cùng mã giữ chuỗi không?",
            "Mỗi đơn chọn một ưu đãi tiền hoa: hội viên hoặc voucher đủ điều kiện. Mua gói hội viên không tạo ngày chuỗi hoặc QR nhận ngày.",
          ],
          [
            "Hoàn tiền được xử lý thế nào?",
            "Liên hệ cửa hàng để được xem xét theo giao dịch và quyền lợi đã sử dụng. Yêu cầu hoàn chỉ hoàn tất sau khi cửa hàng ghi nhận tiền đã hoàn thực tế. Hoàn tiền hoa điều chỉnh chi tiêu tích lũy; quyền mua và quyền cửa hàng cấp được xét độc lập.",
          ],
        ].map(([title, text]) => (
          <details key={title}>
            <summary>{title}</summary>
            <p>{text}</p>
          </details>
        ))}
        <p className="small muted">
          Điều lệ membership-v2 · Hà Nội, UTC+7. Quyền lợi của gói đã thanh toán
          được bảo toàn theo phiên bản lúc mua.
        </p>
      </div>
    </section>
  );
}

function MembershipInvoicePage({ id }: { id: string }) {
  const { user, me, ready, toast, refresh, sepayAvailable, settings } =
    useShop();
  const [invoice, setInvoice] = useState<MembershipInvoiceView | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [accepted, setAccepted] = useState(false),
    [online, setOnline] = useState(true);
  const load = useCallback(async () => {
    try {
      setInvoice(
        await request<MembershipInvoiceView>(`membership/invoices/${id}`),
      );
      setError("");
    } catch (e) {
      setError((e as Error).message);
    }
  }, [id]);
  useEffect(() => {
    if (user) {
      load();
      const timer = setInterval(load, 8000);
      window.addEventListener("fleurious:sync", load);
      return () => {
        clearInterval(timer);
        window.removeEventListener("fleurious:sync", load);
      };
    }
  }, [user?.id, load]);
  useEffect(() => {
    const sync = () => setOnline(navigator.onLine);
    sync();
    window.addEventListener("online", sync);
    window.addEventListener("offline", sync);
    return () => {
      window.removeEventListener("online", sync);
      window.removeEventListener("offline", sync);
    };
  }, []);
  useEffect(() => {
    if (invoice?.status === "PAID") refresh().catch(() => {});
  }, [invoice?.status, refresh]);
  async function act(action: string) {
    setBusy(true);
    try {
      await request(
        `membership/invoices/${id}/${action}`,
        action === "confirm" ? { accepted } : {},
      );
      await load();
      await refresh();
    } catch (e) {
      toast((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  if (ready && !user)
    return (
      <section className="container section">
        <h1>Gói hội viên của bạn.</h1>
        <Link
          className="button"
          href={`/auth/login?next=${encodeURIComponent(`/membership/invoices/${id}`)}`}
        >
          Đăng nhập để xem
        </Link>
      </section>
    );
  if (!invoice)
    return (
      <section className="container section">
        <p role={error ? "alert" : "status"}>
          {error || "Đang mở gói hội viên…"}
        </p>
        <Link href="/membership" className="text-link">
          Về Fleurious Circle
        </Link>
      </section>
    );
  return (
    <section className="container section circle-invoice-page">
      <Link href="/membership" className="text-link">
        ← Fleurious Circle
      </Link>
      <div className="page-heading">
        <span className="eyebrow">{invoice.code}</span>
        <h1>
          {invoice.status === "PAID"
            ? "Thêm một chút đặc biệt."
            : "Một bước tới đặc quyền."}
        </h1>
        <p>
          {kinds[invoice.kind]} {invoice.tier.name} ·{" "}
          {invoice.cycle === "YEAR" ? "Gói năm" : "Gói tháng"}
        </p>
      </div>
      <div className="circle-invoice-layout">
        <article className="circle-invoice-summary">
          <span className="circle-chip">
            {MEMBERSHIP_STATUS_LABELS[invoice.status] ?? invoice.status}
          </span>
          <h2>{invoice.tier.name}</h2>
          <p>
            {invoice.tier.percent}% tiền hoa · tối đa {money(invoice.tier.cap)}
            /đơn · {invoice.tier.quota} lượt/tháng
          </p>
          <dl>
            <div>
              <dt>
                Thời gian {invoice.status === "DRAFT" ? "dự kiến" : "hiệu lực"}
              </dt>
              <dd>
                {humanDate(invoice.startsAt)}
                <br />→ {humanDate(invoice.endsAt)}
              </dd>
            </div>
            <div>
              <dt>Giá trị quyền lợi trong kỳ</dt>
              <dd>{money(invoice.gross)}</dd>
            </div>
            {invoice.credit > 0 && (
              <div>
                <dt>Trừ giá trị gói cũ chưa sử dụng</dt>
                <dd>−{money(invoice.credit)}</dd>
              </div>
            )}
            <div className="circle-total">
              <dt>Số tiền thanh toán</dt>
              <dd>{money(invoice.amount)}</dd>
            </div>
          </dl>
          <p className="small muted">
            Lượt làm mới ngày 1 theo giờ Hà Nội, không reset khi đổi hạng. Ngày
            kích hoạt thực tế được ghi sau xác nhận thanh toán.
          </p>
          {invoice.kind === "SCHEDULE" && (
            <div className="notice">
              Gói này bắt đầu sau thời gian bạn đã mua. Quyền hiện tại tiếp tục
              được giữ.
            </div>
          )}
          {invoice.reason && <p className="notice">{invoice.reason}</p>}
          {["DRAFT", "PENDING"].includes(invoice.status) &&
            me?.membership.current &&
            me.membership.current.rank >= invoice.tier.rank &&
            me.membership.sources.some(
              (s) =>
                s.source !== "PAID" &&
                s.rank >= invoice.tier.rank &&
                new Date(s.startsAt) <= new Date() &&
                (!s.endsAt || new Date(s.endsAt) > new Date()),
            ) && (
              <p className="notice">
                Bạn đang có hạng bằng hoặc cao hơn từ tích lũy/cửa hàng cấp. Gói
                trả phí vẫn chạy theo thời hạn đã mua, kể cả khi trùng quyền
                đang có.
              </p>
            )}
        </article>
        <article className="circle-payment-panel">
          {!online && (
            <p className="notice">
              <WifiOff size={17} />
              Đang offline. Kết nối lại để kiểm tra và thanh toán.
            </p>
          )}
          {invoice.status === "DRAFT" && (
            <>
              <CreditCard size={28} strokeWidth={1.2} />
              <h2>Xem lại một chút.</h2>
              <p>
                Bạn chủ động gia hạn khi hết kỳ. Gói này không tự động trích
                tiền, không phải gói giao hoa định kỳ.
              </p>
              <p>Báo giá được giữ tới {humanDate(invoice.expiresAt)}.</p>
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={accepted}
                  onChange={(e) => setAccepted(e.target.checked)}
                />
                Tôi đã đọc giá, thời hạn và{" "}
                <Link href="/membership#circle-terms">điều lệ hội viên</Link>.
              </label>
              <button
                className="button glass-primary"
                disabled={
                  !accepted ||
                  busy ||
                  !online ||
                  !sepayAvailable ||
                  !settings.memberEnabled
                }
                onClick={() => act("confirm")}
              >
                Tiếp tục thanh toán SePay <ArrowRight size={17} />
              </button>
              {!sepayAvailable && (
                <p className="form-hint">
                  Cửa hàng đang cấu hình SePay. Chưa thể nhận thanh toán gói.
                </p>
              )}
              {!settings.memberEnabled && (
                <p className="form-hint">Cửa hàng tạm dừng nhận mua gói mới.</p>
              )}
            </>
          )}
          {invoice.status === "PENDING" && (
            <>
              {invoice.paymentQr ? (
                <PaymentQr
                  url={invoice.paymentQr}
                  amount={invoice.amount}
                  code={invoice.code}
                  bank={invoice.bank}
                  accountNumber={invoice.accountNumber}
                  accountName={invoice.accountName}
                  expiresAt={invoice.expiresAt}
                  title="Quét QR. Đón đặc quyền."
                />
              ) : (
                <p>Đang chuẩn bị thông tin thanh toán…</p>
              )}
            </>
          )}
          {invoice.status === "PAID" && (
            <>
              <ShieldCheck size={34} />
              <h2>Đặc quyền đã sẵn sàng.</h2>
              <p>
                Thanh toán đã được xác nhận.{" "}
                {new Date(invoice.startsAt) > new Date()
                  ? "Gói sẽ bắt đầu theo lịch bên cạnh."
                  : "Mở thẻ để xem hạng áp dụng và lượt còn lại."}
              </p>
              <Link href="/account/membership" className="button glass-primary">
                Xem thẻ hội viên <ArrowRight size={17} />
              </Link>
            </>
          )}
          {[
            "EXPIRED",
            "CANCELLED",
            "REVIEW",
            "REFUNDED",
            "PARTIALLY_REFUNDED",
          ].includes(invoice.status) && (
            <>
              <h2>{MEMBERSHIP_STATUS_LABELS[invoice.status]}</h2>
              <p>
                {invoice.status === "REVIEW"
                  ? "Cửa hàng sẽ kiểm tra giao dịch. Không chuyển thêm tiền vào mã này."
                  : invoice.status.includes("REFUNDED")
                    ? "Xem lịch sử và hạng còn hiệu lực trong tài khoản."
                    : "Chọn lại gói để nhận báo giá và mã thanh toán mới. Nếu đã chuyển tiền, liên hệ cửa hàng để đối soát."}
              </p>
              <Link href="/account/membership" className="button secondary">
                Quản lý hội viên
              </Link>
            </>
          )}
          <div className="circle-payment-actions">
            <button className="text-link" disabled={busy} onClick={load}>
              <RefreshCw size={15} />
              Kiểm tra trạng thái
            </button>
            {["DRAFT", "PENDING"].includes(invoice.status) && (
              <button
                className="text-link"
                disabled={busy || !online}
                onClick={() => act("cancel")}
              >
                Hủy yêu cầu
              </button>
            )}
          </div>
        </article>
      </div>
    </section>
  );
}

export function AccountMembership() {
  const { user, me, refresh, toast } = useShop();
  const [data, setData] = useState<Details | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    try {
      setData(await request<Details>("membership/me"));
      setError("");
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);
  useEffect(() => {
    if (user) {
      load();
      window.addEventListener("fleurious:sync", load);
      return () => window.removeEventListener("fleurious:sync", load);
    }
  }, [user?.id, load]);
  if (!me) return null;
  const summary = data?.summary ?? me.membership;
  async function birthday(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    try {
      await request(
        "membership/birthday",
        { birthDate: new FormData(e.currentTarget).get("birthDate") },
        "PATCH",
      );
      await refresh();
      await load();
      toast("Đã lưu ngày sinh của bạn.");
    } catch (error) {
      toast((error as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="circle-account">
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <div className="circle-account-top">
        <CircleCard summary={summary} name={user?.name} />
        <div>
          <span className="eyebrow">ĐẶC QUYỀN CỦA BẠN</span>
          <h2>{summary.current?.name ?? "Một lời mời dành cho bạn"}</h2>
          <p>
            {summary.enrolled
              ? `Còn ${summary.remaining}/${summary.limit} lượt · ${summary.reserved} lượt đang giữ.`
              : "Tham gia miễn phí để nhận quyền lợi."}
          </p>
          {summary.expiresAt && (
            <p>Hạng hiện tại đến {humanDate(summary.expiresAt)}.</p>
          )}
          <p>
            Hạng tích lũy được giữ:{" "}
            <strong>{summary.base?.name ?? "Member"}</strong>.
          </p>
          <p>
            Chi tiêu tiền hoa hợp lệ: <strong>{money(summary.spend)}</strong>.
          </p>
          <Link href="/membership" className="button glass-primary">
            {summary.enrolled ? "Xem gói & gia hạn" : "Tham gia hội viên"}
            <ArrowRight size={17} />
          </Link>
        </div>
      </div>
      <div className="circle-account-sections">
        <section className="circle-account-block">
          <Gift size={23} />
          <h3>Một lời chúc đúng ngày.</h3>
          {summary.birthDate ? (
            <p>
              Ngày sinh: {summary.birthDate.split("-").reverse().join("/")}. Quà
              được cấp theo hạng đang hưởng, tối đa một lần mỗi năm. Cần sửa
              thông tin? Liên hệ cửa hàng.
            </p>
          ) : (
            <form onSubmit={birthday} className="form-stack">
              <label>
                Ngày sinh{" "}
                <input
                  type="date"
                  name="birthDate"
                  min="1900-01-01"
                  max={dayKey()}
                  required
                />
              </label>
              <p className="small muted">
                Tùy chọn. Ngày sinh chỉ lưu một lần; quà phụ thuộc quyền lợi
                hạng đang có trong ngày sinh nhật.
              </p>
              <button
                className="button secondary"
                disabled={busy || !summary.enrolled}
              >
                Lưu ngày sinh
              </button>
            </form>
          )}
        </section>
        <section className="circle-account-block">
          <CalendarDays size={23} />
          <h3>Những quyền đang có.</h3>
          {summary.sources.length ? (
            summary.sources.map((s) => (
              <div className="circle-source" key={s.id}>
                <strong>
                  {s.tier}{" "}
                  <span className="small muted">
                    {MEMBERSHIP_SOURCE_LABELS[s.source] ?? s.source}
                  </span>
                </strong>
                <p>
                  {shortDate(s.startsAt)} →{" "}
                  {s.endsAt ? shortDate(s.endsAt) : "Không thời hạn"}
                  {s.endsAt && new Date(s.endsAt) <= new Date()
                    ? " · Đã hết hạn"
                    : new Date(s.startsAt) > new Date()
                      ? " · Sắp bắt đầu"
                      : ""}
                </p>
              </div>
            ))
          ) : (
            <p>
              Member là hạng cơ bản miễn phí. Quyền nâng hạng sẽ xuất hiện tại
              đây.
            </p>
          )}
        </section>
      </div>
      <section className="circle-account-block">
        <h2>Thanh toán & gia hạn.</h2>
        {data?.invoices.length ? (
          <div className="circle-invoice-list">
            {data.invoices.map((i) => (
              <Link key={i.id} href={`/membership/invoices/${i.id}`}>
                <div>
                  <strong>
                    {i.tier.name} · {i.cycle === "YEAR" ? "Năm" : "Tháng"}
                  </strong>
                  <span>
                    {i.code} · {shortDate(i.createdAt)}
                  </span>
                </div>
                <div>
                  <strong>{money(i.amount)}</strong>
                  <span>{MEMBERSHIP_STATUS_LABELS[i.status]}</span>
                </div>
                <ArrowRight size={16} />
              </Link>
            ))}
          </div>
        ) : (
          <p className="muted">Chưa có giao dịch gói hội viên.</p>
        )}
      </section>
      {!!data?.history.length && (
        <details className="circle-account-block">
          <summary>Lịch sử hội viên</summary>
          <div className="circle-history">
            {data.history.map((h) => (
              <div key={h.id}>
                <span>{humanDate(h.createdAt)}</span>
                <strong>
                  {historyNames[h.action] ?? "Cập nhật quyền hội viên"}
                </strong>
              </div>
            ))}
          </div>
        </details>
      )}
    </div>
  );
}
