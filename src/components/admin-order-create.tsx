"use client";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { Plus, Trash2, X } from "lucide-react";
import { request, useShop } from "./shop-provider";
import { Select } from "./ui/select";
import { initialOrderStages, orderChannels } from "@/lib/order-channels";
import { dayKey, money, shiftDay } from "@/lib/time";
import { CardWritingChoice } from "./card-writing-choice";
import type { CardWritingMode } from "@/lib/card-design";

type Customer = {
  id: string;
  name: string;
  email: string;
  phone: string;
  memberSince: string | null;
};
type Quote = {
  subtotal: number;
  discount: number;
  deliveryFee: number;
  total: number;
  discountLabel: string;
};
export function AdminOrderCreate({
  onClose,
  onSaved,
}: {
  onClose: () => void;
  onSaved: (order: { id: string; code: string }) => Promise<void>;
}) {
  const { products, zones, slots, sepayAvailable, settings } = useShop();
  const dialog = useRef<HTMLDialogElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const [key] = useState(() => crypto.randomUUID());
  const [items, setItems] = useState([
    { productId: "", variantId: "", quantity: "1" },
  ]);
  const [search, setSearch] = useState("");
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [customerId, setCustomerId] = useState("");
  const [method, setMethod] = useState(sepayAvailable ? "SEPAY" : "COD");
  const [payment, setPayment] = useState("UNPAID");
  const [stage, setStage] = useState("PENDING");
  const [discount, setDiscount] = useState("none");
  const [quoted, setQuoted] = useState<Quote | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [cardWritingMode, setCardWritingMode] =
    useState<CardWritingMode>("AUTO");
  const selected = customers.find((c) => c.id === customerId);
  useEffect(() => {
    dialog.current?.showModal();
  }, []);
  useEffect(() => {
    let active = true;
    const timer = setTimeout(
      () =>
        request<Customer[]>(
          `admin/orders/customers?q=${encodeURIComponent(search)}`,
        )
          .then((rows) => {
            if (active)
              setCustomers((previous) => {
                const picked = previous.find((c) => c.id === customerId);
                return picked && !rows.some((c) => c.id === picked.id)
                  ? [picked, ...rows]
                  : rows;
              });
          })
          .catch((e) => {
            if (active) setError((e as Error).message);
          }),
      200,
    );
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [search, customerId]);
  useEffect(() => {
    if (payment !== "PAID" && (method === "SEPAY" || stage === "DELIVERED"))
      setStage("PENDING");
  }, [method, payment, stage]);
  useEffect(() => {
    if (stage === "DELIVERED" && formRef.current) {
      (
        formRef.current.elements.namedItem("deliveryDay") as HTMLInputElement
      ).value = dayKey();
      setQuoted(null);
    }
  }, [stage]);
  function payload() {
    const form = new FormData(formRef.current!);
    return {
      ...Object.fromEntries(form),
      customerId: customerId || undefined,
      items: items.map((i) => ({
        variantId: i.variantId,
        quantity: Number(i.quantity),
      })),
      paymentMethod: method,
      initialStage: stage,
      initialPayment: payment,
      useMember: discount === "member",
      voucherCode:
        discount === "voucher" ? String(form.get("voucherCode")) : undefined,
      idempotencyKey: key,
      expectedTotal: quoted?.total,
      cardWritingMode,
    };
  }
  async function check() {
    if (!formRef.current?.reportValidity()) return;
    setBusy(true);
    setError("");
    try {
      setQuoted(await request<Quote>("admin/orders/quote", payload()));
    } catch (e) {
      setQuoted(null);
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function save(e: FormEvent) {
    e.preventDefault();
    if (!quoted || busy) return;
    setBusy(true);
    setError("");
    try {
      const order = await request<{ id: string; code: string }>(
        "admin/orders",
        payload(),
      );
      await onSaved(order);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <dialog
      className="admin-modal admin-order-create"
      aria-labelledby="admin-create-order-title"
      ref={dialog}
      onCancel={(e) => {
        if (busy) e.preventDefault();
        else onClose();
      }}
    >
      <div className="modal-heading">
        <div>
          <span className="eyebrow">FLEURIOUS · ĐƠN TỪ KÊNH KHÁC</span>
          <h2 id="admin-create-order-title">Tạo một đơn hoa.</h2>
        </div>
        <button
          type="button"
          aria-label="Đóng"
          disabled={busy}
          onClick={onClose}
        >
          <X size={21} />
        </button>
      </div>
      <form
        ref={formRef}
        className="form-stack"
        onSubmit={save}
        onChange={() => setQuoted(null)}
      >
        <fieldset disabled={busy}>
          <div className="two-columns">
            <label>
              Kênh đặt hàng
              <Select name="source" defaultValue="IN_STORE">
                {Object.entries(orderChannels)
                  .filter(([id]) => id !== "WEBSITE")
                  .map(([id, label]) => (
                    <option key={id} value={id}>
                      {label}
                    </option>
                  ))}
              </Select>
            </label>
            <label>
              Trạng thái ban đầu
              <Select value={stage} onChange={(e) => setStage(e.target.value)}>
                {Object.entries(initialOrderStages).map(([id, label]) => (
                  <option
                    key={id}
                    value={id}
                    disabled={
                      payment !== "PAID" &&
                      (id === "DELIVERED" ||
                        (method === "SEPAY" && id !== "PENDING"))
                    }
                  >
                    {label}
                  </option>
                ))}
              </Select>
            </label>
          </div>
          <section className="admin-create-section">
            <h3>Hoa trong đơn</h3>
            {items.map((item, index) => {
              const product = products.find((p) => p.id === item.productId);
              const variant = product?.variants.find(
                (v) => v.id === item.variantId,
              );
              return (
                <div className="admin-create-item" key={index}>
                  <label className="admin-create-flower">
                    Hoa · lựa chọn {index + 1}
                    <Select
                      aria-label={`Hoa ${index + 1}`}
                      value={item.productId}
                      onChange={(e) => {
                        setItems((list) =>
                          list.map((v, i) =>
                            i === index
                              ? {
                                  ...v,
                                  productId: e.target.value,
                                  variantId: "",
                                  quantity: "1",
                                }
                              : v,
                          ),
                        );
                        setQuoted(null);
                      }}
                      required
                    >
                      <option value="">Chọn hoa</option>
                      {products.map((p) => (
                        <option
                          key={p.id}
                          value={p.id}
                          disabled={
                            !p.variants.some(
                              (v) =>
                                v.stock - v.reserved > 0 &&
                                !items.some(
                                  (other, i) =>
                                    i !== index && other.variantId === v.id,
                                ),
                            )
                          }
                        >
                          {p.name}
                        </option>
                      ))}
                    </Select>
                  </label>
                  <label>
                    Kích cỡ
                    <Select
                      aria-label={`Kích cỡ hoa ${index + 1}`}
                      value={item.variantId}
                      disabled={!product}
                      onChange={(e) => {
                        setItems((list) =>
                          list.map((v, i) =>
                            i === index
                              ? { ...v, variantId: e.target.value }
                              : v,
                          ),
                        );
                        setQuoted(null);
                      }}
                      required
                    >
                      <option value="">
                        {product ? "Chọn kích cỡ" : "Chọn hoa trước"}
                      </option>
                      {product?.variants.map((v) => (
                        <option
                          key={v.id}
                          value={v.id}
                          disabled={
                            v.stock - v.reserved <= 0 ||
                            items.some(
                              (other, i) =>
                                i !== index && other.variantId === v.id,
                            )
                          }
                        >
                          {v.name} · {money(v.price)} · còn{" "}
                          {Math.max(0, v.stock - v.reserved)}
                        </option>
                      ))}
                    </Select>
                  </label>
                  <label>
                    Số lượng
                    <input
                      aria-label={`Số lượng hoa ${index + 1}`}
                      type="number"
                      min={1}
                      max={Math.min(
                        20,
                        Math.max(
                          1,
                          (variant?.stock ?? 20) - (variant?.reserved ?? 0),
                        ),
                      )}
                      step={1}
                      required
                      value={item.quantity}
                      onChange={(e) =>
                        setItems((list) =>
                          list.map((v, i) =>
                            i === index
                              ? { ...v, quantity: e.target.value }
                              : v,
                          ),
                        )
                      }
                    />
                  </label>
                  <button
                    className="admin-create-remove"
                    type="button"
                    aria-label={`Xóa hoa ${index + 1}`}
                    disabled={items.length === 1}
                    onClick={() => {
                      setItems((list) => list.filter((_, i) => i !== index));
                      setQuoted(null);
                    }}
                  >
                    <Trash2 size={17} />
                  </button>
                </div>
              );
            })}
            <button
              className="text-link"
              type="button"
              disabled={items.length >= 30}
              onClick={() => {
                setItems((list) => [
                  ...list,
                  { productId: "", variantId: "", quantity: "1" },
                ]);
                setQuoted(null);
              }}
            >
              <Plus size={15} /> Thêm hoa
            </button>
          </section>
          <section className="admin-create-section">
            <h3>Khách mua & người nhận</h3>
            <div className="admin-customer-picker">
              <label>
                Tìm tài khoản khách hàng
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Tên, email hoặc số điện thoại"
                  autoComplete="off"
                />
              </label>
              <label>
                Gắn đơn với tài khoản
                <Select
                  value={customerId}
                  onChange={(e) => {
                    const c = customers.find((c) => c.id === e.target.value);
                    setCustomerId(e.target.value);
                    setDiscount("none");
                    setQuoted(null);
                    const form = formRef.current!;
                    (
                      form.elements.namedItem("buyerName") as HTMLInputElement
                    ).value = c?.name ?? "";
                    (
                      form.elements.namedItem("buyerEmail") as HTMLInputElement
                    ).value = c?.email ?? "";
                  }}
                >
                  <option value="">Khách chưa có tài khoản</option>
                  {customers.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name} · {c.email}
                    </option>
                  ))}
                </Select>
              </label>
            </div>
            <p className="small muted">
              Chọn tài khoản để đơn xuất hiện trong hồ sơ khách và tính chi tiêu
              hội viên. Khách lẻ không cần email.
            </p>
            <div className="two-columns">
              <label>
                Tên người mua
                <input
                  name="buyerName"
                  required
                  minLength={2}
                  maxLength={100}
                />
              </label>
              <label>
                Email người mua (nếu có)
                <input name="buyerEmail" type="email" maxLength={200} />
              </label>
            </div>
            <div className="two-columns">
              <label>
                Tên người nhận
                <input
                  name="recipientName"
                  required
                  minLength={2}
                  maxLength={100}
                />
              </label>
              <label>
                Điện thoại người nhận
                <input
                  name="recipientPhone"
                  type="tel"
                  required
                  pattern="(\+84|0)[0-9]{9,10}"
                  placeholder="09xxxxxxxx"
                />
              </label>
            </div>
            <label>
              Địa chỉ giao hoa
              <input name="address" required minLength={8} maxLength={300} />
            </label>
            <label>
              Khu vực giao
              <Select name="zoneId" required defaultValue={zones[0]?.id ?? ""}>
                {zones.map((z) => (
                  <option key={z.id} value={z.id}>
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
                  required
                  min={dayKey()}
                  max={shiftDay(dayKey(), 60)}
                  defaultValue={shiftDay(dayKey(), 1)}
                />
              </label>
              <label>
                Khung giờ · Hà Nội
                <Select
                  name="slotId"
                  required
                  defaultValue={slots[0]?.id ?? ""}
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
              <textarea name="cardMessage" rows={2} maxLength={500} />
            </label>
            <label>
              Ghi chú đơn / thông tin trao đổi tại kênh bán
              <textarea name="note" rows={2} maxLength={500} />
            </label>
          </section>
          <section className="admin-create-section">
            <h3>Ưu đãi & thanh toán</h3>
            <label>
              Ưu đãi
              <Select
                value={discount}
                onChange={(e) => setDiscount(e.target.value)}
              >
                <option value="none">Giá thường</option>
                <option value="member" disabled={!selected?.memberSince}>
                  Quyền lợi hội viên của khách
                </option>
                <option value="voucher">Mã giảm giá</option>
              </Select>
            </label>
            {discount === "voucher" && (
              <label>
                Mã giảm giá
                <input name="voucherCode" maxLength={40} required />
              </label>
            )}
            <div className="two-columns">
              <label>
                Phương thức
                <Select
                  value={method}
                  onChange={(e) => setMethod(e.target.value)}
                >
                  <option value="SEPAY" disabled={!sepayAvailable}>
                    Chuyển khoản · SePay
                  </option>
                  <option value="COD" disabled={!settings.codEnabled}>
                    Tiền mặt / khi nhận hoa
                  </option>
                </Select>
              </label>
              <label>
                Thanh toán
                <Select
                  value={payment}
                  onChange={(e) => setPayment(e.target.value)}
                >
                  <option value="UNPAID">Chưa thu tiền</option>
                  <option value="PAID">Đã thu đủ tiền</option>
                </Select>
              </label>
            </div>
            {payment === "PAID" && (
              <div className="admin-create-proof">
                <p className="small">
                  Chỉ đánh dấu khi đã thực nhận đủ tổng tiền. Thông tin được lưu
                  vào nhật ký đối soát.
                </p>
                <label>
                  Mã giao dịch / phiếu thu
                  <input
                    name="paymentReference"
                    required
                    minLength={4}
                    maxLength={100}
                  />
                </label>
                <label>
                  Ghi chú xác minh thu tiền
                  <textarea
                    name="paymentReason"
                    required
                    minLength={4}
                    maxLength={300}
                    rows={2}
                  />
                </label>
              </div>
            )}
            <p className="small muted">
              Đơn SePay chưa thu tiền chờ xác nhận trong 15 phút. Đơn tiền mặt
              có thể chuẩn bị trước; trạng thái Đã giao cần xác nhận đã thu đủ
              tiền.
            </p>
          </section>
        </fieldset>
        <div className="admin-create-summary" aria-live="polite">
          {quoted ? (
            <>
              <span>
                Tiền hoa <b>{money(quoted.subtotal)}</b>
              </span>
              <span>
                Ưu đãi{quoted.discountLabel ? ` · ${quoted.discountLabel}` : ""}{" "}
                <b>−{money(quoted.discount)}</b>
              </span>
              <span>
                Giao hoa <b>{money(quoted.deliveryFee)}</b>
              </span>
              <strong>
                Tổng thanh toán <b>{money(quoted.total)}</b>
              </strong>
            </>
          ) : (
            <p>Chọn hoa và điền thông tin, sau đó kiểm tra tổng tiền.</p>
          )}
        </div>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <div className="admin-create-actions">
          <button
            className="button secondary"
            type="button"
            disabled={busy}
            onClick={check}
          >
            {busy ? "Đang xử lý…" : "Kiểm tra tổng tiền"}
          </button>
          <button className="button" disabled={busy || !quoted}>
            {busy ? "Đang xử lý…" : "Tạo đơn"}
          </button>
        </div>
      </form>
    </dialog>
  );
}
