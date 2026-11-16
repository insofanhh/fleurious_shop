"use client";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { Plus, Trash2, X } from "lucide-react";
import { request, useShop } from "./shop-provider";
import { AddressAutocomplete } from "./ui/address-autocomplete";
import { ShippingSummary } from "./shipping-summary";
import { useShippingQuote } from "./use-shipping-quote";
import type { AddressSelection } from "@/lib/shipping-types";
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
  onSaved: (order: {
    id: string;
    code: string;
    paymentMethod: string;
    paymentStatus: string;
  }) => Promise<void>;
}) {
  const { products, slots, sepayAvailable, settings, shipping } = useShop();
  const [deliveryAddress, setDeliveryAddress] = useState(""),
    [deliveryPoint, setDeliveryPoint] = useState<AddressSelection | null>(null),
    [addressDetails, setAddressDetails] = useState("");
  const [manualShipping, setManualShipping] = useState(false),
    [manualFee, setManualFee] = useState(""),
    [shippingReason, setShippingReason] = useState("");
  const ship = useShippingQuote(
    deliveryPoint?.id,
    !manualShipping,
    shipping?.version ?? 0,
  );
  const referenceQuote = useRef<{
    id: string;
    locationId: string;
    version: number;
  } | null>(null);
  useEffect(() => {
    if (ship.quote && deliveryPoint)
      referenceQuote.current = {
        id: ship.quote.id,
        locationId: deliveryPoint.id,
        version: shipping?.version ?? 0,
      };
  }, [ship.quote, deliveryPoint, shipping?.version]);
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
  const [quoteError, setQuoteError] = useState("");
  const [quotePending, setQuotePending] = useState(false);
  const [formVersion, setFormVersion] = useState(0);
  const quoteEpoch = useRef(0);
  const [paymentHours, setPaymentHours] = useState(
    String(settings.manualPaymentHours || 24),
  );
  const [noPaymentLimit, setNoPaymentLimit] = useState(
    settings.manualPaymentHours === 0,
  );
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
      zoneId: null,
      address: deliveryAddress,
      locationId: deliveryPoint?.id,
      shippingQuoteId:
        ship.quote?.id ??
        (manualShipping &&
        referenceQuote.current?.locationId === deliveryPoint?.id &&
        referenceQuote.current?.version === shipping?.version
          ? referenceQuote.current?.id
          : undefined),
      addressDetails,
      manualShipping: manualShipping
        ? { fee: Number(manualFee), reason: shippingReason }
        : undefined,
      deliveryDay: String(form.get("deliveryDay") ?? ""),
      slotId: String(form.get("slotId") ?? ""),
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
      paymentTermMinutes: noPaymentLimit
        ? null
        : Math.round(Number(paymentHours) * 60),
    };
  }
  useEffect(() => {
    const epoch = ++quoteEpoch.current;
    setQuoted(null);
    setQuoteError("");
    const input = payload();
    if (
      !input.items.length ||
      input.items.some(
        (i) => !i.variantId || !Number.isInteger(i.quantity) || i.quantity < 1,
      ) ||
      (!manualShipping && !ship.quote) ||
      (manualShipping &&
        (manualFee === "" ||
          shippingReason.trim().length < 4 ||
          !deliveryAddress.trim())) ||
      !input.deliveryDay ||
      !input.slotId ||
      (discount === "voucher" && !input.voucherCode?.trim())
    ) {
      setQuotePending(false);
      return;
    }
    setQuotePending(true);
    const timer = setTimeout(async () => {
      try {
        const result = await request<Quote>("admin/orders/quote", input);
        if (quoteEpoch.current === epoch) {
          setQuoted(result);
          setQuoteError("");
        }
      } catch (e) {
        if (quoteEpoch.current === epoch) {
          setQuoted(null);
          setQuoteError((e as Error).message);
        }
      } finally {
        if (quoteEpoch.current === epoch) setQuotePending(false);
      }
    }, 350);
    return () => {
      clearTimeout(timer);
      ++quoteEpoch.current;
    };
  }, [
    items,
    customerId,
    method,
    stage,
    discount,
    formVersion,
    manualShipping,
    manualFee,
    shippingReason,
    deliveryAddress,
    deliveryPoint,
    addressDetails,
    ship.quote,
    shipping?.version,
  ]);
  async function save(e: FormEvent) {
    e.preventDefault();
    if (!quoted || busy) return;
    setBusy(true);
    setError("");
    try {
      const order = await request<{
        id: string;
        code: string;
        paymentMethod: string;
        paymentStatus: string;
      }>("admin/orders", payload());
      await onSaved(order);
    } catch (e) {
      setError((e as Error).message);
      ++quoteEpoch.current;
      setQuoted(null);
      setFormVersion((v) => v + 1);
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
        onChange={() => {
          ++quoteEpoch.current;
          setQuoted(null);
          setFormVersion((v) => v + 1);
        }}
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
              <Select
                aria-label="Trạng thái ban đầu"
                value={stage}
                onChange={(e) => setStage(e.target.value)}
              >
                {Object.entries(initialOrderStages).map(([id, label]) => (
                  <option key={id} value={id}>
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
            <AddressAutocomplete
              label="Địa chỉ giao hoa"
              value={deliveryAddress}
              onChange={setDeliveryAddress}
              selection={deliveryPoint}
              onSelect={setDeliveryPoint}
              enabled={!!shipping?.configured}
              requireSelection={!manualShipping}
            />
            <label>
              Căn hộ/tầng/cổng vào/hướng dẫn thêm
              <input
                name="addressDetails"
                value={addressDetails}
                maxLength={200}
                onChange={(event) => setAddressDetails(event.target.value)}
              />
            </label>
            {shipping?.allowManual && (
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={manualShipping}
                  onChange={(event) => setManualShipping(event.target.checked)}
                />
                Phí giao theo thỏa thuận
              </label>
            )}
            {manualShipping ? (
              <div className="two-columns">
                <label>
                  Phí giao thỏa thuận (VNĐ)
                  <input
                    aria-label="Phí giao thỏa thuận"
                    type="number"
                    min="0"
                    max="100000000"
                    step="1"
                    required
                    value={manualFee}
                    onChange={(event) => setManualFee(event.target.value)}
                  />
                </label>
                <label>
                  Lý do / nội dung thỏa thuận
                  <input
                    required
                    minLength={4}
                    maxLength={300}
                    value={shippingReason}
                    onChange={(event) => setShippingReason(event.target.value)}
                  />
                </label>
              </div>
            ) : (
              <ShippingSummary
                quote={ship.quote}
                checking={ship.checking}
                error={ship.error}
                onRetry={ship.refresh}
              />
            )}
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
                aria-label="Ưu đãi đơn hàng"
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
            {method === "SEPAY" && payment === "UNPAID" && (
              <div className="admin-payment-terms">
                <label className="checkbox-label">
                  <input
                    type="checkbox"
                    checked={noPaymentLimit}
                    onChange={(e) => setNoPaymentLimit(e.target.checked)}
                  />
                  Không giới hạn thời gian thanh toán
                </label>
                {!noPaymentLimit && (
                  <label>
                    Hạn thanh toán sau khi tạo đơn (giờ)
                    <input
                      aria-label="Hạn thanh toán (giờ)"
                      type="number"
                      min="0.25"
                      max="720"
                      step="0.25"
                      required
                      value={paymentHours}
                      onChange={(e) => setPaymentHours(e.target.value)}
                    />
                  </label>
                )}
                <p className="small muted">
                  Hết hạn sẽ dừng xác nhận tự động và cần đối soát nếu khách
                  chuyển muộn. Đơn tạo thủ công không tự hủy; cửa hàng chủ động
                  quản lý hàng đang giữ.
                </p>
              </div>
            )}
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
              Có thể chọn mọi giai đoạn xử lý khi tạo đơn. Giao hàng và thanh
              toán được theo dõi riêng; QR chuyển khoản hiển thị sau khi tạo đơn
              SePay chưa thu tiền.
            </p>
          </section>
        </fieldset>
        <div className="admin-create-summary" aria-live="polite">
          {quotePending ? (
            <p role="status">Đang kiểm tra tổng tiền và ưu đãi…</p>
          ) : quoteError ? (
            <p className="form-error" role="alert">
              {quoteError}
            </p>
          ) : quoted ? (
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
            <p>
              Chọn hoa, kích cỡ, địa điểm nhận và lịch giao để tự động tính tổng
              tiền.
            </p>
          )}
        </div>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <div className="admin-create-actions">
          <button className="button" disabled={busy || quotePending || !quoted}>
            {busy ? "Đang xử lý…" : "Tạo đơn"}
          </button>
        </div>
      </form>
    </dialog>
  );
}
