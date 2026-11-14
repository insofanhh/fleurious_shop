"use client";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import Link from "next/link";
import {
  CreditCard,
  Gift,
  Plus,
  Search,
  Users,
  X,
  ArrowUpRight,
  ShieldCheck,
} from "lucide-react";
import { request, useShop } from "./shop-provider";
import { Select } from "./ui/select";
import { money, humanDate } from "@/lib/time";
import {
  MEMBERSHIP_SOURCE_LABELS,
  MEMBERSHIP_STATUS_LABELS,
  type MembershipSummary,
  type MembershipTierView,
  type MembershipInvoiceView,
} from "@/lib/membership-types";

type MemberRow = {
  id: string;
  name: string;
  email: string;
  phone: string;
  membership: MembershipSummary;
  disabled: boolean;
};
type Grant = {
  id: string;
  source: string;
  tier: string;
  startsAt: string;
  endsAt: string | null;
  revokedAt: string | null;
  reason: string;
  actorId: string | null;
};
type Details = {
  summary: MembershipSummary;
  grants: Grant[];
  history: { id: string; action: string; createdAt: string }[];
  invoices: MembershipInvoiceView[];
};
type AdminData = {
  tiers: MembershipTierView[];
  members: MemberRow[];
  total: number;
  page: number;
  pages: number;
  invoices: MembershipInvoiceView[];
  payments: {
    id: string;
    amount: number;
    providerId: string;
    reference: string;
    reason: string;
    membershipInvoiceId: string | null;
  }[];
  refunds: {
    id: string;
    amount: number;
    reason: string;
    revokeAccess: boolean;
    invoice: { code: string; userId: string };
  }[];
  stats: {
    members: number;
    revenue: number;
    paidInvoices: number;
    activePaid: number;
  };
};
const localInput = (date = new Date()) =>
  new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Ho_Chi_Minh",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  })
    .format(date)
    .replace(" ", "T");
const fromLocal = (value: string) =>
  new Date(`${value}:00+07:00`).toISOString();

function Dialog({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    ref.current?.showModal();
  }, []);
  return (
    <dialog
      className="admin-modal circle-admin-dialog"
      ref={ref}
      onCancel={onClose}
      onClose={onClose}
    >
      <div className="modal-heading">
        <h2>{title}</h2>
        <button aria-label="Đóng" onClick={onClose}>
          <X size={21} />
        </button>
      </div>
      {children}
    </dialog>
  );
}

export function MembershipAdmin({
  initial,
  role,
  onSaved,
}: {
  initial: AdminData;
  role: string;
  onSaved: () => Promise<void>;
}) {
  const { toast, refreshCatalog, user } = useShop();
  const [data, setData] = useState(initial),
    [tab, setTab] = useState("members"),
    [query, setQuery] = useState(""),
    [tierFilter, setTierFilter] = useState(""),
    [sourceFilter, setSourceFilter] = useState(""),
    [expiry, setExpiry] = useState(""),
    [page, setPage] = useState(1),
    [loading, setLoading] = useState(false),
    [error, setError] = useState("");
  const [editing, setEditing] = useState<MembershipTierView | "new" | null>(
      null,
    ),
    [selected, setSelected] = useState<MemberRow | null>(null),
    [details, setDetails] = useState<Details | null>(null),
    [invoice, setInvoice] = useState<MembershipInvoiceView | null>(null),
    [busy, setBusy] = useState(false),
    [reviewPayment, setReviewPayment] = useState<
      AdminData["payments"][number] | null
    >(null),
    [completing, setCompleting] = useState<AdminData["refunds"][number] | null>(
      null,
    );
  useEffect(() => setData(initial), [initial]);
  const load = useCallback(async () => {
    setLoading(true);
    try {
      setData(
        await request<AdminData>(
          `admin/members?${new URLSearchParams({ q: query, tier: tierFilter, source: sourceFilter, expiry, page: String(page) })}`,
        ),
      );
      setError("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [query, tierFilter, sourceFilter, expiry, page]);
  useEffect(() => {
    const timer = setTimeout(load, 250);
    return () => clearTimeout(timer);
  }, [load]);
  async function saved() {
    await load();
    await refreshCatalog();
    await onSaved();
  }
  async function openMember(member: MemberRow) {
    setSelected(member);
    setDetails(null);
    try {
      setDetails(
        await request<Details>(`admin/members/customers/${member.id}`),
      );
    } catch (e) {
      toast((e as Error).message);
      setSelected(null);
    }
  }
  async function mutate(url: string, payload: unknown, method = "POST") {
    setBusy(true);
    try {
      await request(url, payload, method);
      await saved();
      toast("Đã lưu thay đổi hội viên.");
      return true;
    } catch (e) {
      toast((e as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  }
  async function revoke(grant: Grant) {
    const reason = window.prompt(
      "Lý do thu hồi quyền cửa hàng đã cấp (ít nhất 4 ký tự):",
    );
    if (!reason) return;
    if (await mutate(`admin/members/grants/${grant.id}`, { reason }, "DELETE"))
      setDetails(
        await request<Details>(`admin/members/customers/${selected!.id}`),
      );
  }
  const nextRank = Math.max(...data.tiers.map((t) => t.rank)) + 1;
  return (
    <div className="circle-admin">
      <div className="admin-kpis">
        {[
          { Icon: Users, label: "Hội viên", value: data.stats.members },
          {
            Icon: CreditCard,
            label: "Phí hội viên nhận ròng",
            value: money(data.stats.revenue),
          },
          {
            Icon: ShieldCheck,
            label: "Gói trả phí đang chạy",
            value: data.stats.activePaid,
          },
          {
            Icon: Gift,
            label: "Hóa đơn đã kích hoạt",
            value: data.stats.paidInvoices,
          },
        ].map(({ Icon, label, value }) => (
          <div className="kpi-card" key={label}>
            <div>
              <span>{label}</span>
              <Icon size={19} />
            </div>
            <strong>{value}</strong>
            <small>Không gồm doanh thu bán hoa</small>
          </div>
        ))}
      </div>
      <div className="admin-notice">
        Hạng cao nhất còn hiệu lực được áp dụng. Mua gói, tích lũy và cửa hàng
        cấp dùng chung lượt tháng; không reset khi đổi hạng.{" "}
        <Link href="/membership" target="_blank">
          Xem trang khách <ArrowUpRight size={13} />
        </Link>
      </div>
      <nav className="circle-admin-tabs" aria-label="Quản lý hội viên">
        {[
          ["members", "Hội viên"],
          ["tiers", "Hạng & quyền lợi"],
          ["invoices", "Giao dịch gói"],
          ["review", `Đối soát (${data.payments.length})`],
          ["refunds", `Chờ hoàn (${data.refunds.length})`],
        ].map(([key, label]) => (
          <button
            key={key}
            className={tab === key ? "active" : ""}
            onClick={() => setTab(key)}
          >
            {label}
          </button>
        ))}
      </nav>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {tab === "members" && (
        <>
          <div className="circle-admin-filters">
            <div className="search-field">
              <Search size={15} />
              <input
                aria-label="Tìm hội viên"
                placeholder="Tên, email, điện thoại…"
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setPage(1);
                }}
              />
            </div>
            <Select
              aria-label="Lọc hạng"
              value={tierFilter}
              onChange={(e) => {
                setTierFilter(e.target.value);
                setPage(1);
              }}
            >
              <option value="">Mọi hạng</option>
              {data.tiers.map((t) => (
                <option value={t.id} key={t.id}>
                  {t.name}
                </option>
              ))}
            </Select>
            <Select
              aria-label="Lọc nguồn hạng"
              value={sourceFilter}
              onChange={(e) => {
                setSourceFilter(e.target.value);
                setPage(1);
              }}
            >
              <option value="">Mọi nguồn</option>
              {Object.entries(MEMBERSHIP_SOURCE_LABELS).map(([key, label]) => (
                <option key={key} value={key}>
                  {label}
                </option>
              ))}
            </Select>
            <Select
              aria-label="Lọc thời hạn"
              value={expiry}
              onChange={(e) => {
                setExpiry(e.target.value);
                setPage(1);
              }}
            >
              <option value="">Mọi thời hạn</option>
              <option value="soon">Sắp hết hạng trong 7 ngày</option>
              <option value="expired">Từng có gói đã hết hạn</option>
            </Select>
          </div>
          <div className="circle-admin-table" aria-busy={loading}>
            <table>
              <thead>
                <tr>
                  <th>Hội viên</th>
                  <th>Hạng áp dụng</th>
                  <th>Chi tiêu hợp lệ</th>
                  <th>Lượt tháng</th>
                  <th>Thời hạn</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {data.members.map((m) => (
                  <tr key={m.id}>
                    <td>
                      <strong>{m.name}</strong>
                      <small>{m.email}</small>
                      {m.disabled && <small>Đã khóa tài khoản</small>}
                    </td>
                    <td>
                      {m.membership.current?.name ?? "Chưa khả dụng"}
                      <small>
                        Tích lũy: {m.membership.base?.name ?? "Member"}
                      </small>
                    </td>
                    <td>{money(m.membership.spend)}</td>
                    <td>
                      {m.membership.remaining}/{m.membership.limit}
                      <small>
                        {m.membership.consumed} đã dùng ·{" "}
                        {m.membership.reserved} đang giữ
                      </small>
                    </td>
                    <td>
                      {m.membership.expiresAt
                        ? humanDate(m.membership.expiresAt)
                        : "Không thời hạn"}
                    </td>
                    <td>
                      <button
                        className="table-link"
                        onClick={() => openMember(m)}
                      >
                        Xem & cấp hạng
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!data.members.length && (
              <p className="circle-admin-empty">Không có hội viên phù hợp.</p>
            )}
          </div>
          <div className="circle-admin-pagination">
            <span>
              {data.total} hội viên · Trang {data.page}/{data.pages}
            </span>
            <button
              disabled={page <= 1 || loading}
              onClick={() => setPage((p) => p - 1)}
            >
              Trước
            </button>
            <button
              disabled={page >= data.pages || loading}
              onClick={() => setPage((p) => p + 1)}
            >
              Tiếp
            </button>
          </div>
        </>
      )}
      {tab === "tiers" && (
        <>
          <div className="panel-heading">
            <div>
              <h2>Hạng & quyền lợi</h2>
              <p className="small muted">
                Giá/quyền lợi mới áp dụng lần mua mới. Gói đã thanh toán giữ
                phiên bản đã mua; quyền miễn phí đổi từ kỳ chưa mở.
              </p>
            </div>
            {role === "OWNER" && (
              <button
                className="button glass-primary"
                onClick={() => setEditing("new")}
              >
                <Plus size={16} />
                Thêm hạng
              </button>
            )}
          </div>
          <div className="circle-admin-tier-grid">
            {data.tiers.map((t) => (
              <article key={t.id}>
                <span className="circle-chip">
                  Phiên bản {t.number} · {t.active ? "Hoạt động" : "Đã lưu trữ"}
                </span>
                <h3>{t.name}</h3>
                <p>{t.description}</p>
                <dl>
                  <div>
                    <dt>Giá tháng / năm</dt>
                    <dd>
                      {money(t.monthlyPrice)} / {money(t.yearlyPrice)}
                    </dd>
                  </div>
                  <div>
                    <dt>Quyền lợi</dt>
                    <dd>
                      {t.quota} lượt · {t.percent}% · trần {money(t.cap)}
                    </dd>
                  </div>
                  <div>
                    <dt>Ngưỡng lên hạng</dt>
                    <dd>
                      {t.rank ? money(t.spendThreshold) : "Đăng ký miễn phí"}
                    </dd>
                  </div>
                  <div>
                    <dt>Quà sinh nhật</dt>
                    <dd>
                      {t.birthdayPercent
                        ? `${t.birthdayPercent}% · trần ${money(t.birthdayCap)}`
                        : "Không cấu hình"}
                    </dd>
                  </div>
                </dl>
                {role === "OWNER" && (
                  <button
                    className="button secondary"
                    onClick={() => setEditing(t)}
                  >
                    Chỉnh sửa & công bố
                  </button>
                )}
              </article>
            ))}
          </div>
        </>
      )}
      {tab === "invoices" && (
        <>
          <div className="search-field circle-admin-search">
            <Search size={15} />
            <input
              aria-label="Tìm hóa đơn hội viên"
              placeholder="Mã hóa đơn hoặc thông tin khách…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          <p className="small muted">
            100 hóa đơn gần nhất khớp tìm kiếm. Hóa đơn báo giá chưa xác nhận
            không tính doanh thu.
          </p>
          <div className="circle-admin-table">
            <table>
              <thead>
                <tr>
                  <th>Hóa đơn</th>
                  <th>Gói</th>
                  <th>Tiền thu</th>
                  <th>Trạng thái</th>
                  <th>Hiệu lực</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {data.invoices.map((i) => (
                  <tr key={i.id}>
                    <td>
                      {i.code}
                      <small>{humanDate(i.createdAt)}</small>
                    </td>
                    <td>
                      {i.tier.name}
                      <small>{i.cycle === "YEAR" ? "Năm" : "Tháng"}</small>
                    </td>
                    <td>
                      {money(i.amount)}
                      {i.credit > 0 && (
                        <small>Đã trừ {money(i.credit)} giá trị kỳ cũ</small>
                      )}
                    </td>
                    <td>{MEMBERSHIP_STATUS_LABELS[i.status]}</td>
                    <td>
                      {humanDate(i.startsAt)}
                      <small>→ {humanDate(i.endsAt)}</small>
                    </td>
                    <td>
                      <button
                        className="table-link"
                        onClick={() => setInvoice(i)}
                      >
                        Chi tiết / hoàn phí
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!data.invoices.length && (
              <p className="circle-admin-empty">
                Chưa có hóa đơn gói hội viên.
              </p>
            )}
          </div>
        </>
      )}
      {tab === "review" && (
        <>
          <p className="small muted">
            Chỉ ghép một giao dịch đúng số tiền với hóa đơn khách đã đồng ý.
            Lịch gói thay đổi sẽ yêu cầu đối soát riêng.
          </p>
          <div className="circle-admin-table">
            <table>
              <thead>
                <tr>
                  <th>Giao dịch SePay</th>
                  <th>Số tiền</th>
                  <th>Lý do</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {data.payments.map((p) => (
                  <tr key={p.id}>
                    <td>
                      {p.providerId}
                      <small>{p.reference}</small>
                    </td>
                    <td>{money(p.amount)}</td>
                    <td>{p.reason}</td>
                    <td>
                      <button
                        className="table-link"
                        onClick={() => setReviewPayment(p)}
                      >
                        Đối soát
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!data.payments.length && (
              <p className="circle-admin-empty">
                Không có giao dịch cần đối soát.
              </p>
            )}
          </div>
        </>
      )}
      {tab === "refunds" && (
        <>
          <div className="admin-notice">
            Thực hiện hoàn tiền qua ngân hàng trước, sau đó nhập mã tham chiếu
            để ghi nhận hoàn tất. Tạo yêu cầu chưa thu hồi quyền lợi.
          </div>
          <div className="circle-admin-table">
            <table>
              <thead>
                <tr>
                  <th>Hóa đơn</th>
                  <th>Số tiền</th>
                  <th>Lý do</th>
                  <th>Quyền lợi</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {data.refunds.map((r) => (
                  <tr key={r.id}>
                    <td>{r.invoice.code}</td>
                    <td>{money(r.amount)}</td>
                    <td>{r.reason}</td>
                    <td>
                      {r.revokeAccess
                        ? "Thu hồi khi hoàn tất"
                        : "Thu hồi nếu hoàn toàn bộ"}
                    </td>
                    <td>
                      <button
                        className="table-link"
                        onClick={() => setCompleting(r)}
                      >
                        Ghi nhận đã hoàn
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!data.refunds.length && (
              <p className="circle-admin-empty">
                Không có yêu cầu hoàn phí đang chờ.
              </p>
            )}
          </div>
        </>
      )}
      {editing && (
        <Dialog
          title={
            editing === "new" ? "Thêm một hạng mới" : "Chỉnh hạng hội viên"
          }
          onClose={() => setEditing(null)}
        >
          <TierForm
            initial={editing === "new" ? null : editing}
            nextRank={nextRank}
            busy={busy}
            onSubmit={async (tier) => {
              if (
                await mutate(
                  `admin/members/tiers${editing !== "new" ? `/${editing.id}` : ""}`,
                  {
                    tier,
                    revision: editing !== "new" ? editing.revision : undefined,
                  },
                  editing !== "new" ? "PATCH" : "POST",
                )
              )
                setEditing(null);
            }}
          />
        </Dialog>
      )}
      {selected && (
        <Dialog
          title={`Hội viên · ${selected.name}`}
          onClose={() => {
            setSelected(null);
            setDetails(null);
          }}
        >
          {!details ? (
            <p>Đang mở lịch sử hội viên…</p>
          ) : (
            <>
              <div className="circle-admin-member-info">
                <strong>
                  {details.summary.current?.name ?? "Chưa khả dụng"}
                </strong>
                <span>Hạng tích lũy: {details.summary.base?.name}</span>
                <span>
                  {details.summary.remaining}/{details.summary.limit} lượt còn
                  lại · {money(details.summary.spend)} chi tiêu
                </span>
              </div>
              <h3>Cấp hạng từ cửa hàng</h3>
              <GrantForm
                key={details.grants.length}
                tiers={data.tiers}
                summary={details.summary}
                owner={role === "OWNER"}
                busy={busy}
                onSubmit={async (payload) => {
                  if (
                    await mutate(
                      `admin/members/customers/${selected.id}/grants`,
                      payload,
                    )
                  )
                    setDetails(
                      await request<Details>(
                        `admin/members/customers/${selected.id}`,
                      ),
                    );
                }}
              />
              <h3>Lịch sử quyền được cấp</h3>
              <div className="circle-admin-grants">
                {details.grants.map((g) => (
                  <div key={g.id}>
                    <strong>
                      {g.tier} · {MEMBERSHIP_SOURCE_LABELS[g.source]}
                    </strong>
                    <p>
                      {humanDate(g.startsAt)} →{" "}
                      {g.endsAt ? humanDate(g.endsAt) : "Không thời hạn"}
                    </p>
                    <p>{g.reason}</p>
                    {g.revokedAt ? (
                      <small>Đã thu hồi {humanDate(g.revokedAt)}</small>
                    ) : (
                      g.source === "ADMIN" &&
                      (role === "OWNER" || g.actorId === user?.id) && (
                        <button
                          className="text-link"
                          disabled={busy}
                          onClick={() => revoke(g)}
                        >
                          Thu hồi quyền này
                        </button>
                      )
                    )}
                  </div>
                ))}
              </div>
              {!!details.history.length && (
                <details className="circle-admin-history">
                  <summary>Nhật ký hội viên ({details.history.length})</summary>
                  {details.history.map((h) => (
                    <p key={h.id}>
                      {humanDate(h.createdAt)} · {h.action}
                    </p>
                  ))}
                </details>
              )}
            </>
          )}
        </Dialog>
      )}
      {invoice && (
        <Dialog
          title={`Gói hội viên · ${invoice.code}`}
          onClose={() => setInvoice(null)}
        >
          <div className="circle-admin-member-info">
            <strong>
              {invoice.tier.name} · {invoice.cycle === "YEAR" ? "Năm" : "Tháng"}
            </strong>
            <span>
              {MEMBERSHIP_STATUS_LABELS[invoice.status]} ·{" "}
              {money(invoice.amount)}
            </span>
            <span>
              {humanDate(invoice.startsAt)} → {humanDate(invoice.endsAt)}
            </span>
            <Link href={`/membership/invoices/${invoice.id}`} target="_blank">
              Mở trang hóa đơn
            </Link>
          </div>
          {invoice.reason && <p className="notice">{invoice.reason}</p>}
          {["PAID", "PARTIALLY_REFUNDED"].includes(invoice.status) && (
            <form
              className="form-stack"
              onSubmit={async (e) => {
                e.preventDefault();
                const f = new FormData(e.currentTarget);
                if (
                  await mutate(`admin/members/invoices/${invoice.id}/refunds`, {
                    amount: Number(f.get("amount")),
                    reason: String(f.get("reason")),
                    revokeAccess: f.has("revokeAccess"),
                  })
                )
                  setInvoice(null);
              }}
            >
              <h3>Đề nghị hoàn phí</h3>
              <label>
                Số tiền hoàn (VND)
                <input
                  name="amount"
                  type="number"
                  min="1"
                  max={
                    invoice.amount -
                    invoice.refunds.reduce((s, r) => s + r.amount, 0)
                  }
                  required
                />
              </label>
              <label>
                Lý do
                <input name="reason" minLength={4} maxLength={400} required />
              </label>
              <label className="checkbox-label">
                <input type="checkbox" name="revokeAccess" />
                Thu hồi quyền của hóa đơn khi hoàn tất, kể cả hoàn một phần
              </label>
              <p className="small muted">
                Hoàn toàn bộ luôn kết thúc quyền của hóa đơn này. Các nguồn hạng
                khác vẫn giữ nguyên.
              </p>
              <button className="button" disabled={busy}>
                Tạo yêu cầu hoàn phí
              </button>
            </form>
          )}
          {invoice.refunds.map((r) => (
            <p key={r.id}>
              {money(r.amount)} ·{" "}
              {r.status === "COMPLETED" ? "Đã hoàn" : "Chờ hoàn"} · {r.reason}{" "}
              {r.reference}
            </p>
          ))}
        </Dialog>
      )}
      {reviewPayment && (
        <Dialog
          title="Đối soát giao dịch hội viên"
          onClose={() => setReviewPayment(null)}
        >
          <p>
            {reviewPayment.providerId} · {money(reviewPayment.amount)}
          </p>
          <form
            className="form-stack"
            onSubmit={async (e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              if (
                await mutate(
                  `admin/members/payments/${reviewPayment.id}/match`,
                  {
                    invoiceId: String(f.get("invoiceId")),
                    reason: String(f.get("reason")),
                    accepted: f.has("accepted"),
                  },
                )
              )
                setReviewPayment(null);
            }}
          >
            <label>
              Hóa đơn đã được khách xác nhận
              <Select name="invoiceId" required>
                <option value="">Chọn hóa đơn đúng số tiền</option>
                {data.invoices
                  .filter(
                    (i) =>
                      i.acceptedAt &&
                      ["REVIEW", "EXPIRED", "CANCELLED", "PENDING"].includes(
                        i.status,
                      ) &&
                      i.amount === reviewPayment.amount,
                  )
                  .map((i) => (
                    <option value={i.id} key={i.id}>
                      {i.code} · {i.tier.name} · {money(i.amount)}
                    </option>
                  ))}
              </Select>
            </label>
            <label>
              Lý do đối soát
              <input name="reason" minLength={4} required />
            </label>
            <label className="checkbox-label">
              <input type="checkbox" name="accepted" required />
              Tôi đã đối chiếu đúng giao dịch, người mua và hóa đơn
            </label>
            <button className="button" disabled={busy}>
              Ghép giao dịch & kích hoạt
            </button>
          </form>
        </Dialog>
      )}
      {completing && (
        <Dialog
          title="Ghi nhận hoàn phí đã thực hiện"
          onClose={() => setCompleting(null)}
        >
          <p>
            {completing.invoice.code} · {money(completing.amount)}
          </p>
          <form
            className="form-stack"
            onSubmit={async (e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              if (
                await mutate(
                  `admin/members/refunds/${completing.id}`,
                  { reference: String(f.get("reference")) },
                  "PATCH",
                )
              )
                setCompleting(null);
            }}
          >
            <label>
              Mã giao dịch hoàn tiền
              <input name="reference" minLength={4} maxLength={100} required />
            </label>
            <label className="checkbox-label">
              <input type="checkbox" required />
              Đã thực hiện hoàn tiền thực tế và kiểm tra mã đối soát
            </label>
            <button className="button" disabled={busy}>
              Ghi nhận hoàn tất
            </button>
          </form>
        </Dialog>
      )}
    </div>
  );
}

function TierForm({
  initial,
  nextRank,
  busy,
  onSubmit,
}: {
  initial: MembershipTierView | null;
  nextRank: number;
  busy: boolean;
  onSubmit: (data: unknown) => void;
}) {
  const [form, setForm] = useState<Record<string, any>>(
    initial ?? {
      code: "",
      name: "",
      rank: nextRank,
      description: "",
      color: "#6e1423",
      active: true,
      monthlyEnabled: true,
      yearlyEnabled: true,
      quota: 10,
      percent: 18,
      cap: 200000,
      minimum: 0,
      monthlyPrice: 199000,
      yearlyPrice: 1990000,
      spendThreshold: 15000000,
      birthdayPercent: 20,
      birthdayCap: 200000,
      birthdayMinimum: 300000,
      birthdayDays: 30,
    },
  );
  const set = (key: string, value: unknown) =>
    setForm((f) => ({ ...f, [key]: value }));
  return (
    <form
      className="form-stack"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit(form);
      }}
    >
      <p className="small muted">
        Công bố tạo phiên bản mới; gói đã thanh toán giữ quyền lợi cũ. Mã và thứ
        tự hạng đã công bố không được sửa.
      </p>
      <div className="form-grid">
        <label>
          Mã hạng
          <input
            value={form.code}
            readOnly={!!initial}
            onChange={(e) => set("code", e.target.value)}
            pattern="[A-Za-z][A-Za-z0-9_-]{1,39}"
            required
          />
        </label>
        <label>
          Tên hiển thị
          <input
            value={form.name}
            onChange={(e) => set("name", e.target.value)}
            required
            minLength={2}
            maxLength={80}
          />
        </label>
        <label>
          Thứ tự hạng
          <input
            type="number"
            min="0"
            max="99"
            readOnly={!!initial}
            value={form.rank}
            onChange={(e) =>
              set("rank", e.target.value === "" ? "" : Number(e.target.value))
            }
            required
          />
        </label>
        <label>
          Màu thẻ
          <Select
            value={form.color}
            onChange={(e) => set("color", e.target.value)}
          >
            <option value="#6e1423">Cellar Burgundy</option>
            <option value="#8c4350">Rose Burgundy</option>
            <option value="#4d101b">Deep Burgundy</option>
            <option value="#796660">Warm Taupe</option>
          </Select>
        </label>
      </div>
      <label>
        Mô tả
        <textarea
          value={form.description}
          onChange={(e) => set("description", e.target.value)}
          maxLength={400}
        />
      </label>
      <div className="form-grid">
        {[
          ["quota", "N đơn ưu đãi / tháng", 100],
          ["percent", "Giảm tiền hoa (%)", 50],
          ["cap", "Trần giảm / đơn (VND)", 1000000],
          ["minimum", "Đơn tiền hoa tối thiểu (VND)", 10000000],
          ["monthlyPrice", "Giá gói tháng (VND)", 10000000],
          ["yearlyPrice", "Giá gói năm (VND)", 100000000],
          ["spendThreshold", "Chi tiêu đạt hạng (VND)", 1000000000],
          ["birthdayPercent", "Quà sinh nhật (%)", 30],
          ["birthdayCap", "Trần quà sinh nhật (VND)", 1000000],
          ["birthdayMinimum", "Đơn tối thiểu cho quà sinh nhật", 10000000],
          ["birthdayDays", "Hạn quà sinh nhật (ngày)", 365],
        ].map(([key, label, max]) => (
          <label key={String(key)}>
            {label}
            <input
              type="number"
              min={key === "birthdayDays" ? 1 : 0}
              max={Number(max)}
              value={form[String(key)]}
              onChange={(e) =>
                set(
                  String(key),
                  e.target.value === "" ? "" : Number(e.target.value),
                )
              }
              required
            />
          </label>
        ))}
      </div>
      {form.monthlyPrice > 0 && form.yearlyPrice !== "" && (
        <p className="circle-saving">
          Giá năm tiết kiệm {money(form.monthlyPrice * 12 - form.yearlyPrice)}{" "}
          so với 12 tháng.
        </p>
      )}
      {[
        ["active", "Hạng hoạt động"],
        ["monthlyEnabled", "Mở bán gói tháng"],
        ["yearlyEnabled", "Mở bán gói năm"],
      ].map(([key, label]) => (
        <label className="checkbox-label" key={key}>
          <input
            type="checkbox"
            checked={form[key]}
            disabled={form.rank === 0}
            onChange={(e) => set(key, e.target.checked)}
          />
          {label}
        </label>
      ))}
      <button className="button glass-primary" disabled={busy}>
        {busy ? "Đang công bố…" : "Công bố phiên bản mới"}
      </button>
    </form>
  );
}

function GrantForm({
  tiers,
  summary,
  owner,
  busy,
  onSubmit,
}: {
  tiers: MembershipTierView[];
  summary: MembershipSummary;
  owner: boolean;
  busy: boolean;
  onSubmit: (payload: unknown) => void;
}) {
  const requestKey = useRef(crypto.randomUUID());
  const available = tiers.filter((t) => t.active && t.rank > 0),
    [tierId, setTierId] = useState(available[0]?.id ?? ""),
    [permanent, setPermanent] = useState(false);
  const tier = available.find((t) => t.id === tierId),
    higher = !!tier && tier.rank > (summary.current?.rank ?? 0),
    remaining = Math.max(
      0,
      (higher ? tier!.quota : summary.limit) -
        summary.consumed -
        summary.reserved,
    );
  return (
    <form
      className="form-stack"
      onSubmit={(e: FormEvent<HTMLFormElement>) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        onSubmit({
          tierId,
          startsAt: fromLocal(String(f.get("startsAt"))),
          endsAt: permanent ? null : fromLocal(String(f.get("endsAt"))),
          reason: String(f.get("reason")),
          notify: f.has("notify"),
          accepted: f.has("accepted"),
          idempotencyKey: requestKey.current,
        });
      }}
    >
      <label>
        Hạng muốn cấp
        <Select value={tierId} onChange={(e) => setTierId(e.target.value)}>
          {available.map((t) => (
            <option value={t.id} key={t.id}>
              {t.name}
            </option>
          ))}
        </Select>
      </label>
      <div className="form-grid">
        <label>
          Bắt đầu · Hà Nội
          <input
            type="datetime-local"
            name="startsAt"
            defaultValue={localInput()}
            required
          />
        </label>
        {!permanent && (
          <label>
            Kết thúc · Hà Nội
            <input
              type="datetime-local"
              name="endsAt"
              defaultValue={localInput(new Date(Date.now() + 30 * 86400000))}
              required
            />
          </label>
        )}
      </div>
      {owner && (
        <label className="checkbox-label">
          <input
            type="checkbox"
            checked={permanent}
            onChange={(e) => setPermanent(e.target.checked)}
          />
          Cấp không thời hạn
        </label>
      )}
      <label>
        Lý do cấp hạng
        <textarea name="reason" required minLength={4} maxLength={400} />
      </label>
      <div className="admin-notice">
        Nếu hiệu lực ngay: {summary.current?.name ?? "Member"} →{" "}
        {higher ? tier?.name : summary.current?.name}, còn {remaining} lượt.
        Không reset {summary.consumed} lượt đã dùng và {summary.reserved} lượt
        đang giữ.
        {!higher && " Hạng đang dùng bằng hoặc cao hơn nên chưa thay đổi."} Nếu
        chọn ngày tương lai, thay đổi bắt đầu từ ngày đó.
      </div>
      <label className="checkbox-label">
        <input type="checkbox" name="notify" defaultChecked />
        Thông báo trong tài khoản khách
      </label>
      <label className="checkbox-label">
        <input type="checkbox" name="accepted" required />
        Đã kiểm tra hạng, thời hạn và lý do cấp
      </label>
      <button className="button" disabled={busy || !tierId}>
        Cấp hạng
      </button>
    </form>
  );
}
