"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import Link from "next/link";
import {
  Wallet,
  Clock3,
  Truck,
  ArrowUpRight,
  RefreshCw,
  X,
  Search,
} from "lucide-react";
import { request, useShop } from "./shop-provider";
import { Select } from "./ui/select";
import { humanDate, money } from "@/lib/time";
import "./collections.css";

export const collectionFinance = (role: string) =>
  ["OWNER", "MANAGER", "ACCOUNTANT"].includes(role);
type Staff = { id: string; name: string; role: string };
type Debt = {
  id: string;
  kind: string;
  state: string;
  amount: number;
  payerName: string;
  payerPhone: string;
  ownerId: string | null;
  owner?: { name: string } | null;
  note: string;
  dueAt: string;
  nextReminderAt: string;
  lastContactAt: string | null;
  settledAt: string | null;
  events: { id: string; action: string; note: string; createdAt: string }[];
  order: {
    id: string;
    code: string;
    version: number;
    deliveredAt: string | null;
    status: string;
    paymentStatus: string;
  };
};
type CollectionData = {
  totals: { kind: string; amount: number; count: number }[];
  overdue: { amount: number; count: number };
  today: number;
  rows: Debt[];
  count: number;
  page: number;
  staff: Staff[];
  priorityHours: number;
  now: string;
};
function localDateTime(date: Date) {
  return new Date(date.getTime() + 7 * 3600000).toISOString().slice(0, 16);
}
function age(dueAt: string, now: string) {
  const hours = Math.floor((Date.parse(now) - Date.parse(dueAt)) / 3600000);
  if (hours < 0) return "Chưa đến hạn";
  if (!hours) return "Đến hạn · dưới 1 giờ";
  return hours < 24
    ? `Quá hạn ${hours} giờ`
    : `Quá hạn ${Math.floor(hours / 24)} ngày`;
}
export function CollectionDialog({
  title,
  children,
  onClose,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    ref.current?.showModal();
  }, []);
  return (
    <dialog
      ref={ref}
      className="admin-modal collection-dialog"
      aria-label={title}
      onCancel={onClose}
    >
      <div className="modal-heading">
        <h2>{title}</h2>
        <button type="button" aria-label="Đóng" onClick={onClose}>
          <X size={20} />
        </button>
      </div>
      {children}
    </dialog>
  );
}

export function CollectionsPanel({
  role,
  initialQuery = "",
}: {
  role: string;
  initialQuery?: string;
}) {
  const [data, setData] = useState<CollectionData | null>(null);
  const [error, setError] = useState("");
  const [group, setGroup] = useState("ALL"),
    [query, setQuery] = useState(initialQuery),
    [page, setPage] = useState(1);
  const [selection, setSelection] = useState<{
    debt: Debt;
    mode: "payment" | "remit" | "followup";
  } | null>(null);
  const requestId = useRef(0);
  const load = useCallback(async () => {
    const id = ++requestId.current;
    try {
      const result = await request<CollectionData>(
        `admin/receivables?group=${group}&page=${page}&q=${encodeURIComponent(query)}`,
      );
      if (id === requestId.current) {
        setData(result);
        setError("");
      }
    } catch (e) {
      if (id === requestId.current) setError((e as Error).message);
    }
  }, [group, page, query]);
  useEffect(() => {
    const timer = setTimeout(load, 250);
    const interval = setInterval(load, 60000);
    window.addEventListener("fleurious:sync", load);
    return () => {
      ++requestId.current;
      clearTimeout(timer);
      clearInterval(interval);
      window.removeEventListener("fleurious:sync", load);
    };
  }, [load]);
  if (!collectionFinance(role)) return null;
  const sum = data?.totals.reduce((s, t) => s + t.amount, 0) ?? 0;
  return (
    <section className="admin-panel collections-panel" aria-label="COD cần thu">
      <div className="panel-heading">
        <div>
          <h2>COD cần thu</h2>
          <p>Toàn bộ khoản còn phải thu · Giờ Hà Nội</p>
        </div>
        <button
          className="icon-button"
          aria-label="Làm mới công nợ"
          onClick={load}
        >
          <RefreshCw size={17} />
        </button>
      </div>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {!data ? (
        <p role="status">Đang tổng hợp công nợ…</p>
      ) : (
        <>
          <div className="collection-kpis">
            <button
              onClick={() => {
                setGroup("ALL");
                setPage(1);
              }}
            >
              <Wallet size={18} />
              <span>
                Tổng còn phải thu<strong>{money(sum)}</strong>
                <small>
                  {data.totals.reduce((s, t) => s + t.count, 0)} khoản
                </small>
              </span>
            </button>
            {[
              {
                kind: "CUSTOMER",
                label: "Khách chưa thanh toán",
                Icon: Clock3,
              },
              { kind: "SHIPPER", label: "Chờ shipper bàn giao", Icon: Truck },
            ].map(({ kind, label, Icon }) => {
              const total = data.totals.find((t) => t.kind === kind);
              return (
                <button
                  key={kind}
                  onClick={() => {
                    setGroup(kind);
                    setPage(1);
                  }}
                >
                  <Icon size={18} />
                  <span>
                    {label}
                    <strong>{money(total?.amount ?? 0)}</strong>
                    <small>{total?.count ?? 0} khoản</small>
                  </span>
                </button>
              );
            })}
            <button
              onClick={() => {
                setGroup("TODAY");
                setPage(1);
              }}
            >
              <Clock3 size={18} />
              <span>
                Cần theo dõi hôm nay<strong>{data.today} khoản</strong>
                <small>Quá hạn: {money(data.overdue.amount)}</small>
              </span>
            </button>
          </div>
          <div className="collection-filters">
            <label>
              <span className="sr-only">Lọc khoản phải thu</span>
              <Select
                value={group}
                onChange={(e) => {
                  setGroup(e.target.value);
                  setPage(1);
                }}
              >
                <option value="ALL">Tất cả khoản cần thu</option>
                <option value="CUSTOMER">Khách chưa trả</option>
                <option value="SHIPPER">Chờ shipper bàn giao</option>
                <option value="OVERDUE">Quá hạn</option>
                <option value="TODAY">Hẹn / nhắc hôm nay</option>
              </Select>
            </label>
            <label className="search-field">
              <Search size={16} />
              <input
                aria-label="Tìm công nợ"
                value={query}
                placeholder="Mã đơn, người thanh toán, điện thoại…"
                onChange={(e) => {
                  setQuery(e.target.value);
                  setPage(1);
                }}
              />
            </label>
          </div>
          {!data.rows.length ? (
            <p className="collection-empty">Không có khoản phải thu phù hợp.</p>
          ) : (
            <div className="collection-list">
              {data.rows.map((debt) => (
                <article className="collection-item" key={debt.id}>
                  <div className="collection-person">
                    {role === "ACCOUNTANT" ? (
                      <button
                        className="text-link"
                        onClick={() => setSelection({ debt, mode: "followup" })}
                      >
                        {debt.order.code} <ArrowUpRight size={13} />
                      </button>
                    ) : (
                      <Link
                        href={`/admin/orders?q=${encodeURIComponent(debt.order.code)}`}
                      >
                        {debt.order.code} <ArrowUpRight size={13} />
                      </Link>
                    )}
                    <strong>{debt.payerName}</strong>
                    <small>
                      {debt.payerPhone ||
                        "Chưa có số điện thoại người thanh toán"}
                    </small>
                    <small>
                      Giao:{" "}
                      {debt.order.deliveredAt
                        ? humanDate(debt.order.deliveredAt)
                        : "Chưa xác minh thời điểm"}
                    </small>
                  </div>
                  <div className="collection-amount">
                    <strong>{money(debt.amount)}</strong>
                    <span
                      className={`status-tag ${Date.parse(data.now) - Date.parse(debt.dueAt) >= data.priorityHours * 3600000 ? "collection-urgent" : ""}`}
                    >
                      {age(debt.dueAt, data.now)}
                    </span>
                    <small>
                      {debt.kind === "SHIPPER"
                        ? "Chờ bàn giao tiền thu hộ"
                        : "Khách chưa thanh toán"}
                    </small>
                  </div>
                  <div className="collection-followup">
                    <span>{debt.owner?.name ?? "Chưa phân công thu"}</span>
                    <small>Nhắc: {humanDate(debt.nextReminderAt)}</small>
                    {debt.kind === "CUSTOMER" &&
                      debt.events.some(
                        (e) => e.action === "COLLECTION_REPORTED",
                      ) && (
                        <small className="collection-report">
                          Shipper báo đã thu · Chờ xác minh
                        </small>
                      )}
                    {debt.note && <small>{debt.note}</small>}
                    {debt.lastContactAt && (
                      <small>Đã liên hệ: {humanDate(debt.lastContactAt)}</small>
                    )}
                  </div>
                  <div className="collection-actions">
                    <button
                      className="button small"
                      onClick={() =>
                        setSelection({
                          debt,
                          mode: debt.kind === "SHIPPER" ? "remit" : "payment",
                        })
                      }
                    >
                      {debt.kind === "SHIPPER"
                        ? "Nhận bàn giao"
                        : "Xác nhận thu"}
                    </button>
                    <button
                      className="text-link"
                      onClick={() => setSelection({ debt, mode: "followup" })}
                    >
                      Theo dõi / Hẹn thu
                    </button>
                  </div>
                </article>
              ))}
            </div>
          )}
          <div className="collection-pagination">
            <small>
              {data.count} khoản · Trang {page}/
              {Math.max(1, Math.ceil(data.count / 12))}
            </small>
            <div>
              <button
                className="text-link"
                disabled={page <= 1}
                onClick={() => setPage((p) => p - 1)}
              >
                Trước
              </button>
              <button
                className="text-link"
                disabled={page * 12 >= data.count}
                onClick={() => setPage((p) => p + 1)}
              >
                Sau
              </button>
            </div>
          </div>
          {selection && (
            <CollectionEditor
              key={`${selection.debt.id}:${selection.mode}`}
              {...selection}
              staff={data.staff}
              onClose={() => setSelection(null)}
              onSaved={async () => {
                setSelection(null);
                await load();
                window.dispatchEvent(new Event("fleurious:sync"));
              }}
            />
          )}
        </>
      )}
    </section>
  );
}

function CollectionEditor({
  debt,
  mode,
  staff,
  onClose,
  onSaved,
}: {
  debt: Debt;
  mode: "payment" | "remit" | "followup";
  staff: Staff[];
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [destination, setDestination] = useState("SHOP");
  const { toast } = useShop();
  return (
    <CollectionDialog
      title={
        mode === "followup"
          ? "Theo dõi & hẹn thu"
          : mode === "remit"
            ? "Nhận tiền shipper bàn giao"
            : "Xác nhận thu đủ tiền"
      }
      onClose={onClose}
    >
      <form
        className="form-stack"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError("");
          const form = new FormData(e.currentTarget);
          try {
            const payload =
              mode === "followup"
                ? {
                    version: debt.order.version,
                    note: form.get("note"),
                    ownerId: form.get("ownerId") || null,
                    payerName: form.get("payerName"),
                    payerPhone: form.get("payerPhone"),
                    contacted: form.has("contacted"),
                    nextReminderAt: new Date(
                      `${form.get("nextReminderAt")}:00+07:00`,
                    ).toISOString(),
                  }
                : {
                    version: debt.order.version,
                    reference: form.get("reference"),
                    reason: form.get("reason"),
                    destination,
                    collectorId: form.get("collectorId") || undefined,
                  };
            await request(
              `admin/receivables/${debt.order.id}${mode === "followup" ? "" : `/${mode}`}`,
              payload,
              "PATCH",
            );
            toast("Đã cập nhật khoản phải thu.");
            await onSaved();
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <p>
          <strong>{debt.order.code}</strong> · {debt.payerName}
        </p>
        <div className="admin-notice">
          {mode === "followup" ? (
            "Hẹn nhắc lại không thay đổi hạn thu và số tiền còn nợ."
          ) : (
            <>
              Xác nhận đủ <strong>{money(debt.amount)}</strong>. Thao tác lưu
              phiếu thu và nhật ký.
            </>
          )}
        </div>
        {mode === "followup" ? (
          <>
            <div className="two-columns">
              <label>
                Người thanh toán
                <input
                  name="payerName"
                  defaultValue={debt.payerName}
                  readOnly={debt.kind === "SHIPPER"}
                  required
                  maxLength={100}
                />
              </label>
              <label>
                Điện thoại người thanh toán
                <input
                  name="payerPhone"
                  defaultValue={debt.payerPhone}
                  readOnly={debt.kind === "SHIPPER"}
                  maxLength={30}
                  type="tel"
                />
              </label>
            </div>
            <label>
              Người phụ trách
              <Select name="ownerId" defaultValue={debt.ownerId ?? ""}>
                <option value="">Chưa phân công</option>
                {staff
                  .filter((s) => collectionFinance(s.role))
                  .map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
              </Select>
            </label>
            <label>
              Nhắc tiếp theo · Giờ Hà Nội
              <input
                type="datetime-local"
                name="nextReminderAt"
                required
                defaultValue={localDateTime(
                  new Date(
                    Math.max(
                      Date.parse(debt.nextReminderAt),
                      Date.now() + 3600000,
                    ),
                  ),
                )}
              />
            </label>
            <label>
              Ghi chú / lời hẹn
              <textarea
                name="note"
                required
                minLength={4}
                maxLength={300}
                defaultValue={debt.note}
              />
            </label>
            <label className="checkbox-label">
              <input name="contacted" type="checkbox" />
              Đã liên hệ người thanh toán
            </label>
          </>
        ) : (
          <>
            {mode === "payment" && (
              <label>
                Tiền được nhận tại
                <Select
                  value={destination}
                  onChange={(e) => setDestination(e.target.value)}
                >
                  <option value="SHOP">Cửa hàng đã nhận đủ</option>
                  <option value="SHIPPER">
                    Shipper đã thu hộ, chưa bàn giao
                  </option>
                </Select>
              </label>
            )}
            {mode === "payment" && destination === "SHIPPER" && (
              <label>
                Người đã thu hộ
                <Select name="collectorId" required defaultValue="">
                  <option value="" disabled>
                    Chọn người thu hộ
                  </option>
                  {staff
                    .filter((s) =>
                      ["OWNER", "MANAGER", "DELIVERY"].includes(s.role),
                    )
                    .map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                </Select>
                <small>
                  Khách hết nợ; khoản này chuyển sang chờ shipper bàn giao.
                </small>
              </label>
            )}
            <label>
              Mã giao dịch / phiếu thu
              <input name="reference" required minLength={4} maxLength={100} />
            </label>
            <label>
              Ghi chú xác minh
              <textarea name="reason" required minLength={4} maxLength={300} />
            </label>
          </>
        )}
        {error && (
          <p className="form-error" role="alert">
            {error} Nếu đơn đã thay đổi, đóng cửa sổ và mở lại.
          </p>
        )}
        <button className="button" disabled={busy}>
          {busy ? "Đang lưu…" : "Xác nhận & lưu"}
        </button>
        {!!debt.events.length && (
          <details>
            <summary>Lịch sử thu & theo dõi</summary>
            <ul className="collection-history">
              {debt.events.map((event) => (
                <li key={event.id}>
                  <small>{humanDate(event.createdAt)}</small>
                  <p>{event.note}</p>
                </li>
              ))}
            </ul>
          </details>
        )}
      </form>
    </CollectionDialog>
  );
}

export function DeliveryDialog({
  order,
  role,
  onClose,
  onSaved,
}: {
  order: {
    id: string;
    code: string;
    version: number;
    total: number;
    paymentStatus: string;
  };
  role: string;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const [collection, setCollection] = useState("UNPAID"),
    [staff, setStaff] = useState<Staff[]>([]);
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const unpaid = ["UNPAID", "PENDING"].includes(order.paymentStatus);
  useEffect(() => {
    if (role !== "DELIVERY")
      request<Staff[]>("admin/orders/staff")
        .then(setStaff)
        .catch(() => {});
  }, [role]);
  return (
    <CollectionDialog title="Xác nhận giao hoa" onClose={onClose}>
      <form
        className="form-stack"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError("");
          const form = new FormData(e.currentTarget);
          try {
            await request(
              `admin/orders/${order.id}/deliver`,
              {
                version: order.version,
                collection,
                reference: form.get("reference") ?? "",
                reason: form.get("reason") ?? "",
                collectorId: form.get("collectorId") || undefined,
              },
              "PATCH",
            );
            await onSaved();
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <p>
          <strong>{order.code}</strong> · {money(order.total)}
        </p>
        {unpaid ? (
          <label>
            Thu tiền khi giao
            <Select
              value={collection}
              onChange={(e) => setCollection(e.target.value)}
            >
              <option value="UNPAID">Đã giao, khách chưa thanh toán</option>
              {role === "DELIVERY" && (
                <option value="SHIPPER_REPORT">
                  Tôi đã thu hộ · Gửi xác minh
                </option>
              )}
              {role !== "DELIVERY" && (
                <>
                  <option value="SHOP">Cửa hàng đã nhận đủ tiền</option>
                  <option value="SHIPPER">
                    Shipper đã thu hộ, chưa bàn giao
                  </option>
                </>
              )}
            </Select>
          </label>
        ) : (
          <p className="admin-notice">Đơn đã được xác nhận thanh toán.</p>
        )}
        {unpaid && role === "DELIVERY" && (
          <p className="small">
            Báo cáo thu hộ được lưu để kế toán hoặc quản lý xác minh, chưa tự
            đánh dấu đã thanh toán.
          </p>
        )}
        {collection === "SHIPPER" && (
          <label>
            Người thu hộ
            <Select name="collectorId" required defaultValue="">
              <option value="" disabled>
                Chọn người thu hộ
              </option>
              {staff
                .filter((s) =>
                  ["OWNER", "MANAGER", "DELIVERY"].includes(s.role),
                )
                .map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
            </Select>
          </label>
        )}
        {collection !== "UNPAID" && (
          <>
            <label>
              Mã giao dịch / phiếu thu
              <input name="reference" required minLength={4} maxLength={100} />
            </label>
            <label>
              Ghi chú xác minh
              <textarea name="reason" required minLength={4} maxLength={300} />
            </label>
          </>
        )}
        {error && (
          <p role="alert" className="form-error">
            {error}
          </p>
        )}
        <button className="button" disabled={busy}>
          {busy ? "Đang xác nhận…" : "Xác nhận giao thành công"}
        </button>
      </form>
    </CollectionDialog>
  );
}

export function CollectionOrderDetails({ orderId }: { orderId: string }) {
  const [data, setData] = useState<{
    code: string;
    paymentStatus: string;
    receivable: Omit<Debt, "order"> | null;
    receipt: {
      amount: number;
      reference: string;
      destination: string;
      receivedAt: string;
      remittedAt: string | null;
      remittanceReference: string;
      collector: { name: string } | null;
    } | null;
  } | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let alive = true;
    const load = () =>
      request<NonNullable<typeof data>>(`admin/receivables/${orderId}`)
        .then((result) => {
          if (alive) {
            setData(result);
            setError("");
          }
        })
        .catch((e) => {
          if (alive) setError(e.message);
        });
    load();
    window.addEventListener("fleurious:sync", load);
    return () => {
      alive = false;
      window.removeEventListener("fleurious:sync", load);
    };
  }, [orderId]);
  return (
    <div className="detail-action-field collection-order-detail">
      <h4>Thu tiền & công nợ</h4>
      {error ? (
        <p className="form-error">{error}</p>
      ) : !data ? (
        <small>Đang tải phiếu thu…</small>
      ) : (
        <>
          {data.receivable?.state === "OPEN" ? (
            <>
              <p>
                <strong>{money(data.receivable.amount)}</strong> ·{" "}
                {data.receivable.kind === "SHIPPER"
                  ? "Chờ shipper bàn giao"
                  : "Khách chưa thanh toán"}
              </p>
              <small>Hạn thu: {humanDate(data.receivable.dueAt)}</small>
              <br />
              <small>
                Nhắc tiếp: {humanDate(data.receivable.nextReminderAt)}
              </small>
              <p>
                <Link
                  className="text-link"
                  href={`/admin/overview?collection=${encodeURIComponent(data.code)}`}
                >
                  Theo dõi / Thu tiền tại Tổng quan →
                </Link>
              </p>
            </>
          ) : (
            <p>
              {data.receipt
                ? "Đã thu và đối soát đủ tiền."
                : ["PAID", "PARTIALLY_REFUNDED", "REFUNDED"].includes(
                      data.paymentStatus,
                    )
                  ? "Đã thanh toán theo dữ liệu hiện có; chưa có phiếu thu COD mới."
                  : "Chưa phát sinh khoản phải thu sau giao hàng."}
            </p>
          )}
          {data.receipt && (
            <p className="small">
              Phiếu {data.receipt.reference} · {money(data.receipt.amount)} ·{" "}
              {humanDate(data.receipt.receivedAt)}
              {data.receipt.collector && (
                <> · Thu hộ: {data.receipt.collector.name}</>
              )}
              {data.receipt.destination === "SHIPPER" &&
                data.receipt.remittedAt && (
                  <>
                    {" "}
                    · Bàn giao: {humanDate(data.receipt.remittedAt)} ·{" "}
                    {data.receipt.remittanceReference}
                  </>
                )}
            </p>
          )}
          {!!data.receivable?.events.length && (
            <details>
              <summary>Lịch sử thu & theo dõi</summary>
              <ul className="collection-history">
                {data.receivable.events.map((event) => (
                  <li key={event.id}>
                    <small>{humanDate(event.createdAt)}</small>
                    <p>{event.note}</p>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </>
      )}
    </div>
  );
}
