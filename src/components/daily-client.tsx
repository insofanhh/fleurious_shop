"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowRight,
  CalendarDays,
  Flower2,
  Heart,
  MessageCircle,
  Truck,
  Check,
  ChevronLeft,
  RefreshCw,
  X,
  Clock3,
  MapPin,
  UserRound,
} from "lucide-react";
import { request, useShop } from "./shop-provider";
import { Select } from "./ui/select";
import { AddressAutocomplete } from "./ui/address-autocomplete";
import { useShippingQuote } from "./use-shipping-quote";
import { CardWritingChoice } from "./card-writing-choice";
import { PaymentQr } from "./payment-qr";
import { DailyCalendar, shiftMonth } from "./daily-calendar";
import { DailyReviewMessage } from "./daily-review-message";
import { DailyPaymentConfirm } from "./daily-payment-confirm";
import { DailyDeliveryEditor } from "./daily-delivery-editor";
import { DailyDeliveryMessage } from "./daily-delivery-message";
import { DailyFlowerPicker } from "./daily-flower-picker";
import {
  DailyPlanCardContent,
  DailyPlanStatus,
  dailyDateRange,
} from "./daily-plan-summary";
import {
  dailyStateLabels,
  type DailyPublic,
  type DailyPolicy,
} from "@/lib/daily-types";
import { calendarMonthDays } from "@/lib/daily-pricing";
import { dayKey, monthKey, money, humanDate, shiftDay } from "@/lib/time";
import type { AddressSelection } from "@/lib/shipping-types";
import type { dailyPlanView, quoteDaily, listDaily } from "@/lib/daily";
type Serialized<T> = T extends Date
  ? string
  : T extends (infer U)[]
    ? Serialized<U>[]
    : T extends object
      ? { [K in keyof T]: Serialized<T[K]> }
      : T;
export type DailyPlanData = Serialized<
  Awaited<ReturnType<typeof dailyPlanView>>
>;
type Quote = Serialized<Awaited<ReturnType<typeof quoteDaily>>>;
type PlanList = Serialized<Awaited<ReturnType<typeof listDaily>>>;
type DayDraft = {
  day: string;
  slotId: string;
  offeringId?: string;
  autoSelected?: boolean;
  message?: string;
  writingMode: "AUTO" | "HANDWRITTEN";
};
function useDailyPublic() {
  const [data, setData] = useState<DailyPublic | null>(null),
    [error, setError] = useState("");
  const load = useCallback(() => {
    setError("");
    request<DailyPublic>("daily/config")
      .then(setData)
      .catch((e) => setError(e.message));
  }, []);
  useEffect(load, [load]);
  return { data, error, load };
}
function DailyError({ error, retry }: { error: string; retry: () => void }) {
  return (
    <div className="notice" role="alert">
      {error}
      <button className="text-link" onClick={retry}>
        Thử lại <RefreshCw size={15} />
      </button>
    </div>
  );
}
export function DailyPage({ create = false }: { create?: boolean }) {
  const { data, error, load } = useDailyPublic();
  if (error)
    return (
      <section className="container section">
        <DailyError error={error} retry={load} />
      </section>
    );
  if (!data)
    return (
      <div className="page-loading" role="status">
        Đang mở những ngày có hoa…
      </div>
    );
  if (create) return <DailyWizard data={data} reload={load} />;
  const startingPrice = data.offerings.length
    ? Math.min(...data.offerings.map((o) => o.price))
    : null;
  const slogan = (
    data.policy.slogan.trim() || "Mỗi ngày, một lời thương."
  ).split(",");
  return (
    <div className="daily-page">
      <section className="container section daily-hero">
        <div>
          <span className="eyebrow">{data.policy.name.toUpperCase()}</span>
          <h1>
            {slogan[0]}
            {slogan.length > 1 && (
              <>
                ,<br />
                <em>{slogan.slice(1).join(",").trim()}</em>
              </>
            )}
          </h1>
          <p>
            Hẹn một lần cho những ngày bạn muốn có hoa. Chọn từng ngày hoặc cả
            tháng, để mỗi bó hoa mang một lời nhắn riêng.
          </p>
          <div className="daily-hero-actions">
            <Link href="/daily/create" className="button glass-primary">
              Hẹn lịch hoa <ArrowRight size={18} />
            </Link>
            <Link href="/account/daily" className="text-link">
              Lịch hoa của tôi
            </Link>
          </div>
          <span className="daily-price">
            {startingPrice !== null ? (
              <>
                Từ <strong>{money(startingPrice)}</strong>/bó
              </>
            ) : (
              "Giá theo bó hoa được chọn"
            )}{" "}
            · Ưu đãi theo số lượt
          </span>
          {!data.policy.enabled && (
            <p className="small muted">
              Cửa hàng đang chuẩn bị lịch và bộ hoa Daily. Bạn có thể xem cách
              hoạt động trước khi mở bán.
            </p>
          )}
        </div>
        <div className="daily-hero-art">
          {data.offerings[0] ? (
            <img
              src={data.offerings[0].image}
              alt={data.offerings[0].name}
              width="600"
              height="680"
            />
          ) : (
            <Flower2 size={160} strokeWidth={0.6} />
          )}
          <div className="daily-art-note">
            <Heart size={18} />
            <span>
              Một bó hoa nhỏ.
              <br />
              Thêm một ngày đáng nhớ.
            </span>
          </div>
        </div>
      </section>
      <section className="container daily-benefits">
        {[
          {
            Icon: CalendarDays,
            title: "Theo lịch của bạn",
            text: "10, 20, 30 lượt hoặc các ngày bạn tự chọn.",
          },
          {
            Icon: Flower2,
            title: "Tự chọn hoặc bất ngờ",
            text: "Chọn bó yêu thích hoặc để Fleurious gợi ý cho từng ngày.",
          },
          {
            Icon: MessageCircle,
            title: "Lời thương mỗi ngày",
            text: "Viết riêng từng thiệp, sửa trước hạn chốt.",
          },
          {
            Icon: Truck,
            title: "Ship có ưu đãi",
            text: "Tính rõ theo địa chỉ và gói bạn chọn.",
          },
        ].map(({ Icon, title, text }) => (
          <article key={title}>
            <Icon size={25} strokeWidth={1.2} />
            <h3>{title}</h3>
            <p>{text}</p>
          </article>
        ))}
      </section>
      <section className="container section">
        <div className="section-heading">
          <h2>
            Một lịch hẹn.
            <br />
            <em>Nhiều ngày nở hoa.</em>
          </h2>
          <p>Thanh toán một lần. Chủ động mua lại khi bạn muốn tiếp tục.</p>
        </div>
        <div className="daily-tier-grid">
          {data.policy.tiers.map((t) => (
            <article className="daily-tier" key={t.count}>
              <span className="eyebrow">TỪ {t.count} LƯỢT</span>
              <h3>
                {startingPrice !== null
                  ? money(Math.round((startingPrice * (100 - t.percent)) / 100))
                  : "Theo bó đã chọn"}
                <small>/bó</small>
              </h3>
              <p>Giảm {t.percent}% tiền hoa cơ bản.</p>
              <p>
                {t.freeMeters
                  ? `Miễn ship trong ${(t.freeMeters / 1000).toLocaleString("vi-VN")} km; ngoài phạm vi hỗ trợ tối đa ${money(t.outsideSupport)}/lượt.`
                  : `Giảm ${t.shipPercent}% ship, tối đa ${money(t.shipCap)}/lượt.`}
              </p>
              <Link href="/daily/create" className="text-link">
                Chọn ngày nhận <ArrowRight size={16} />
              </Link>
            </article>
          ))}
        </div>
        <details className="daily-terms">
          <summary>Đổi lịch, tạm nghỉ và điều kiện của gói</summary>
          <p className="preserve-lines">{data.policy.terms}</p>
          <p>
            Mỗi tháng được tính đúng số ngày có thể giao. Các mốc ưu đãi dựa
            trên số lượt đã chọn.
          </p>
        </details>
      </section>
    </div>
  );
}
function DailyWizard({
  data,
  reload,
}: {
  data: DailyPublic;
  reload: () => void;
}) {
  const { user, ready, toast, shipping } = useShop(),
    router = useRouter();
  const [step, setStep] = useState(0),
    [month, setMonth] = useState(monthKey()),
    [days, setDays] = useState<DayDraft[]>([]),
    [slotId, setSlot] = useState(data.slots[0]?.id ?? ""),
    [mode, setMode] = useState<"AUTO" | "SELF">("AUTO"),
    [address, setAddress] = useState(""),
    [point, setPoint] = useState<AddressSelection | null>(null),
    [details, setDetails] = useState(""),
    [recipient, setRecipient] = useState(""),
    [phone, setPhone] = useState(""),
    [sender, setSender] = useState(""),
    [theme, setTheme] = useState(data.policy.messages[0]?.theme ?? "Dịu dàng"),
    [messageDay, setMessageDay] = useState(""),
    [avoid, setAvoid] = useState<string[]>([]),
    [surprise, setSurprise] = useState(false),
    [accepted, setAccepted] = useState(false),
    [editingMessages, setEditingMessages] = useState<string[]>([]),
    [busy, setBusy] = useState(false),
    [availability, setAvailability] = useState<
      { day: string; slots: { id: string; available: boolean }[] }[] | null
    >(null),
    [availabilityError, setAvailabilityError] = useState(""),
    [availabilityRevision, setAvailabilityRevision] = useState(0);
  const [quoted, setQuoted] = useState<{
      key: string;
      quote?: Quote;
      error?: string;
    } | null>(null),
    [lastQuote, setLastQuote] = useState<{
      contentKey: string;
      displayKey: string;
      quote: Quote;
    } | null>(null),
    draftLoaded = useRef<string | null>(null),
    createKey = useRef("");
  const onEditingMessage = useCallback((day: string, editing: boolean) => {
    setEditingMessages((current) =>
      editing
        ? current.includes(day)
          ? current
          : [...current, day]
        : current.filter((d) => d !== day),
    );
  }, []);
  const applyFlowerAssignments = useCallback(
    (
      assignments: { day: string; offeringId: string }[],
      allowedIds: string[],
    ) => {
      const byDay = new Map(assignments.map((d) => [d.day, d.offeringId]));
      setDays((current) =>
        current.map((d) => {
          const id = byDay.get(d.day);
          if (
            !id ||
            (d.offeringId &&
              !d.autoSelected &&
              allowedIds.includes(d.offeringId))
          )
            return d;
          return { ...d, offeringId: id, autoSelected: true };
        }),
      );
    },
    [],
  );
  useEffect(() => {
    if (!user || draftLoaded.current === user.id) return;
    draftLoaded.current = user.id;
    setRecipient(user.name);
    setPhone(user.phone);
    setSender(user.name);
    try {
      const raw = sessionStorage.getItem(`daily-draft:${user.id}`);
      if (raw) {
        const draft = JSON.parse(raw);
        if (Date.now() - draft.savedAt < 86400000) {
          setDays(draft.days ?? []);
          setMode(draft.mode === "SELF" ? "SELF" : "AUTO");
        }
      }
    } catch {}
  }, [user]);
  useEffect(() => {
    if (!user || draftLoaded.current !== user.id) return;
    const t = setTimeout(
      () =>
        sessionStorage.setItem(
          `daily-draft:${user.id}`,
          JSON.stringify({ days, mode, savedAt: Date.now() }),
        ),
      500,
    );
    return () => clearTimeout(t);
  }, [days, mode, user?.id]);
  useEffect(() => {
    let active = true;
    setAvailability(null);
    setAvailabilityError("");
    const list = calendarMonthDays(month);
    request<typeof availability>(
      `daily/availability?from=${list[0]}&to=${list.at(-1)}`,
    )
      .then((v) => {
        if (active) setAvailability(v);
      })
      .catch((e) => {
        if (active) setAvailabilityError(e.message);
      });
    return () => {
      active = false;
    };
  }, [month, data.version, availabilityRevision]);
  const ship = useShippingQuote(point?.id, !!point, shipping?.version ?? 0);
  const payload = useMemo(
    () => ({
      budgetCode: "catalog",
      mode,
      days: [...days].sort((a, b) => a.day.localeCompare(b.day)),
      preferences: { colors: [], avoidTags: avoid, style: "", surprise },
      theme,
      shippingQuoteId: ship.quote?.id ?? "",
      locationId: point?.id ?? "",
      addressDetails: details,
      recipientName: recipient || "Người nhận",
      recipientPhone: phone,
      senderName: sender || user?.name || "Bạn",
      expectedVersion: data.version,
    }),
    [
      mode,
      days,
      avoid,
      surprise,
      theme,
      ship.quote?.id,
      point?.id,
      details,
      recipient,
      phone,
      sender,
      user?.name,
      data.version,
    ],
  );
  const quoteKey = JSON.stringify([
      user?.id,
      shipping?.version ?? 0,
      ship.revision,
      payload,
    ]),
    // A renewed shipping token must not remove an unchanged schedule from the screen.
    contentKey = JSON.stringify({
      ...payload,
      shippingQuoteId: undefined,
      shippingPolicyVersion: shipping?.version ?? 0,
      userId: user?.id,
    }),
    // Message-only edits keep the same cards visible while the new quote is checked.
    displayKey = JSON.stringify({
      ...payload,
      days: payload.days.map(({ message: _message, ...d }) => d),
      shippingQuoteId: undefined,
      shippingPolicyVersion: shipping?.version ?? 0,
      userId: user?.id,
    }),
    canQuote = !!(
      user &&
      ship.quote &&
      days.length &&
      days.every((d) => d.offeringId) &&
      data.policy.enabled
    );
  useEffect(() => {
    if (!canQuote) return;
    let alive = true;
    const t = setTimeout(
      () =>
        request<Quote>("daily/quote", payload)
          .then((quote) => {
            if (alive) {
              if (
                lastQuote &&
                (lastQuote.contentKey !== contentKey ||
                  lastQuote.quote.total !== quote.total ||
                  lastQuote.quote.days.some(
                    (d, i) => d.selection.id !== quote.days[i]?.selection.id,
                  ))
              )
                setAccepted(false);
              setLastQuote({ contentKey, displayKey, quote });
              setQuoted({ key: quoteKey, quote });
            }
          })
          .catch((e) => {
            if (alive) setQuoted({ key: quoteKey, error: e.message });
          }),
      350,
    );
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [quoteKey, canQuote]);
  const current = quoted?.key === quoteKey ? quoted : null,
    freshQuote = canQuote && !ship.checking ? current?.quote : undefined,
    quote =
      freshQuote ??
      (lastQuote?.displayKey === displayKey ? lastQuote.quote : undefined),
    quoteError = ship.error || current?.error,
    quotePending = !!(quote && !freshQuote && !quoteError);
  const disabled = calendarMonthDays(month).filter(
    (day) =>
      !availability
        ?.find((d) => d.day === day)
        ?.slots.some((s) => s.id === slotId && s.available),
  );
  function toggle(day: string) {
    setDays((v) =>
      v.some((d) => d.day === day)
        ? v.filter((d) => d.day !== day)
        : v.length >= 31
          ? (toast("Mỗi gói tối đa 31 lượt."), v)
          : [...v, { day, slotId, writingMode: "AUTO" }],
    );
  }
  function update(day: string, patch: Partial<DayDraft>) {
    setDays((ds) => ds.map((d) => (d.day === day ? { ...d, ...patch } : d)));
  }
  function preset(kind: "MONTH" | "WEEKDAYS" | "AVAILABLE") {
    const all = calendarMonthDays(month).filter(
      (day) =>
        kind !== "WEEKDAYS" ||
        ![0, 6].includes(new Date(`${day}T12:00:00Z`).getUTCDay()),
    );
    if (kind !== "AVAILABLE" && all.some((day) => disabled.includes(day))) {
      toast(
        "Có ngày không thể giao trong lịch này. Chọn từng ngày hoặc dùng Các ngày còn nhận.",
      );
      return;
    }
    setDays(
      all
        .filter((day) => !disabled.includes(day))
        .map((day) => ({ day, slotId, writingMode: "AUTO" })),
    );
  }
  function next() {
    if (step === 0 && !days.length) {
      toast("Chọn ít nhất một ngày nhận hoa.");
      return;
    }
    if (
      step === 1 &&
      days.some(
        (d) =>
          !data.offerings.some(
            (o) =>
              o.id === d.offeringId &&
              o.active &&
              !avoid.some((t) =>
                o.tags.some(
                  (tag) => tag.toLocaleLowerCase() === t.toLocaleLowerCase(),
                ),
              ),
          ),
      )
    ) {
      toast("Chọn hoa cho đủ các ngày hoặc chờ Fleurious hoàn tất gợi ý.");
      return;
    }
    if (
      step === 2 &&
      (!point ||
        recipient.trim().length < 2 ||
        !/^[+0-9 .()-]{8,20}$/.test(phone))
    ) {
      toast("Điền người nhận, số điện thoại và chọn địa chỉ từ gợi ý.");
      return;
    }
    setStep((s) => Math.min(4, s + 1));
  }
  async function buy() {
    if (!freshQuote || !accepted || busy || editingMessages.length) return;
    setBusy(true);
    createKey.current ||= crypto.randomUUID();
    try {
      const plan = await request<DailyPlanData>("daily/plans", {
        ...payload,
        expectedTotal: freshQuote.total,
        expectedVersion: freshQuote.version,
        accepted: true,
        idempotencyKey: createKey.current,
      });
      sessionStorage.removeItem(`daily-draft:${user!.id}`);
      router.push(`/account/daily/${plan.id}`);
    } catch (e) {
      toast((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  if (!ready) return <div className="page-loading">Đang mở lịch hoa…</div>;
  if (!user)
    return (
      <section className="container section empty-state">
        <CalendarDays size={40} strokeWidth={1} />
        <h1>Hẹn những ngày có hoa.</h1>
        <p>Đăng nhập để lưu và quản lý từng lượt giao của bạn.</p>
        <Link
          href="/auth/login?next=/daily/create"
          className="button glass-primary"
        >
          Đăng nhập để hẹn hoa
        </Link>
      </section>
    );
  if (!data.policy.enabled)
    return (
      <section className="container section empty-state">
        <h1>Lịch mới đang được chuẩn bị.</h1>
        <p>
          Cửa hàng đang chọn bộ hoa và thời gian giao phù hợp cho Fleurious
          Daily.
        </p>
        <Link href="/daily" className="button">
          Xem Fleurious Daily
        </Link>
      </section>
    );
  const pool = [
      ...new Map(data.offerings.map((o) => [o.variantId, o])).values(),
    ],
    tags = [...new Set(pool.flatMap((o) => o.tags))],
    flowerSubtotal = days.reduce((sum, d) => {
      const offering = pool.find((o) => o.id === d.offeringId);
      return (
        sum +
        (offering?.active &&
        !avoid.some((t) =>
          offering.tags.some(
            (tag) => tag.toLocaleLowerCase() === t.toLocaleLowerCase(),
          ),
        )
          ? offering.price
          : 0)
      );
    }, 0);
  return (
    <section className="container section daily-wizard">
      <Link className="text-link" href="/daily">
        <ChevronLeft size={16} />
        Fleurious Daily
      </Link>
      <div className="page-heading">
        <span className="eyebrow">HẸN HOA THEO LỊCH CỦA BẠN</span>
        <h1>
          Thêm hoa vào
          <br />
          <em>những ngày sắp tới.</em>
        </h1>
      </div>
      <ol className="daily-steps">
        {[
          "Lịch nhận",
          "Chọn hoa",
          "Người nhận",
          "Lời thương",
          "Thanh toán",
        ].map((s, i) => (
          <li
            key={s}
            className={i === step ? "active" : i < step ? "done" : ""}
          >
            <button disabled={i > step} onClick={() => setStep(i)}>
              <span>{i < step ? <Check size={14} /> : i + 1}</span>
              {s}
            </button>
          </li>
        ))}
      </ol>
      <div className="daily-wizard-layout">
        <div
          className={`daily-panel${step === 4 ? " daily-review-panel" : ""}`}
        >
          {step === 0 && (
            <>
              <h2>Những ngày bạn muốn nhận hoa.</h2>
              <label>
                Khung giao mặc định
                <Select
                  value={slotId}
                  onChange={(e) => setSlot(e.target.value)}
                >
                  {data.slots.map((s) => (
                    <option value={s.id} key={s.id}>
                      {s.label}
                    </option>
                  ))}
                </Select>
              </label>
              <p className="small muted">
                Khung mặc định áp dụng khi chọn ngày mới. Các ngày đã chọn giữ
                khung riêng.
              </p>
              {availabilityError ? (
                <DailyError
                  error={availabilityError}
                  retry={() => setAvailabilityRevision((v) => v + 1)}
                />
              ) : (
                <>
                  <div className="daily-presets">
                    <button
                      type="button"
                      onClick={() => preset("MONTH")}
                      disabled={!availability}
                    >
                      Cả tháng
                    </button>
                    <button
                      onClick={() => preset("WEEKDAYS")}
                      disabled={!availability}
                    >
                      Thứ 2–Thứ 6
                    </button>
                    <button
                      onClick={() => preset("AVAILABLE")}
                      disabled={!availability}
                    >
                      Các ngày còn nhận
                    </button>
                    <button onClick={() => setDays([])}>Bỏ chọn</button>
                  </div>
                  <div className="daily-date-columns">
                    <DailyCalendar
                      month={month}
                      onMonth={setMonth}
                      selected={Object.fromEntries(
                        days.map((d) => [d.day, {}]),
                      )}
                      disabled={disabled.filter(
                        (d) => !days.some((v) => v.day === d),
                      )}
                      onDay={toggle}
                    />
                    <div className="daily-scroll-panel">
                      {" "}
                      <div className="daily-selected-days">
                        {[...days]
                          .sort((a, b) => a.day.localeCompare(b.day))
                          .map((d) => (
                            <div key={d.day}>
                              <strong>
                                {d.day.split("-").reverse().join("/")}
                              </strong>
                              <Select
                                aria-label={`Khung giờ ${d.day}`}
                                value={d.slotId}
                                onChange={(e) =>
                                  update(d.day, { slotId: e.target.value })
                                }
                              >
                                {data.slots.map((s) => (
                                  <option value={s.id} key={s.id}>
                                    {s.label}
                                  </option>
                                ))}
                              </Select>
                              <button
                                className="icon-button"
                                aria-label={`Bỏ ${d.day}`}
                                onClick={() => toggle(d.day)}
                              >
                                <X size={16} />
                              </button>
                            </div>
                          ))}
                      </div>
                    </div>
                  </div>
                  {!availability && (
                    <p role="status">Đang kiểm tra ngày nhận…</p>
                  )}
                </>
              )}
              <p className="small daily-calendar-note">
                {days.length} ngày đã chọn. Ngày mờ không còn đủ điều kiện nhận
                hoa.
              </p>
            </>
          )}
          {step === 1 && (
            <>
              <h2>Hoa theo cách bạn thích.</h2>
              <DailyFlowerPicker
                days={days}
                offerings={pool}
                mode={mode}
                preferences={{ avoidTags: avoid, style: "" }}
                onMode={(value) => {
                  setMode(value);
                  if (value === "SELF")
                    setDays((ds) =>
                      ds.map((d) =>
                        d.autoSelected
                          ? {
                              ...d,
                              offeringId: undefined,
                              autoSelected: undefined,
                            }
                          : d,
                      ),
                    );
                }}
                onPick={(day, offeringId) =>
                  update(day, { offeringId, autoSelected: false })
                }
                onClear={(day) =>
                  update(day, {
                    offeringId: undefined,
                    autoSelected: undefined,
                  })
                }
                onAssignments={applyFlowerAssignments}
              >
                {tags.length > 0 && (
                  <fieldset className="daily-tag-picker">
                    <legend>Loài/nhóm hoa cần tránh</legend>
                    {tags.map((t) => (
                      <label key={t}>
                        <input
                          type="checkbox"
                          checked={avoid.includes(t)}
                          onChange={() =>
                            setAvoid((v) =>
                              v.includes(t)
                                ? v.filter((x) => x !== t)
                                : [...v, t],
                            )
                          }
                        />
                        {t}
                      </label>
                    ))}
                  </fieldset>
                )}
              </DailyFlowerPicker>
              <p className="small muted daily-calendar-note">
                Giá lấy theo bó và size được chọn. Mẫu gợi ý tự động sẽ được cửa
                hàng duyệt trước khi chuẩn bị.
              </p>
            </>
          )}
          {step === 2 && (
            <>
              <h2>Gửi đến một người bạn thương.</h2>
              <label>
                Tên người nhận
                <input
                  value={recipient}
                  maxLength={100}
                  onChange={(e) => setRecipient(e.target.value)}
                  autoComplete="name"
                />
              </label>
              <label>
                Điện thoại nhận hoa
                <input
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  type="tel"
                  maxLength={20}
                />
              </label>
              <AddressAutocomplete
                value={address}
                onChange={setAddress}
                selection={point}
                onSelect={setPoint}
                requireSelection
                showDataNote={false}
              />
              <label>
                Số nhà/tầng/chỉ dẫn thêm
                <input
                  value={details}
                  maxLength={200}
                  onChange={(e) => setDetails(e.target.value)}
                />
              </label>
              {ship.error && (
                <DailyError error={ship.error} retry={ship.refresh} />
              )}
              <label>
                Tên người gửi trên thiệp
                <input
                  value={sender}
                  maxLength={100}
                  onChange={(e) => setSender(e.target.value)}
                />
              </label>
              <label className="daily-checkbox">
                <input
                  type="checkbox"
                  checked={surprise}
                  onChange={(e) => setSurprise(e.target.checked)}
                />
                Giữ bất ngờ: không gửi mẫu và lời nhắn trước cho người nhận
              </label>
              <p className="small muted">
                Mỗi gói có một người và địa chỉ mặc định. Đổi địa chỉ sau khi
                mua cần cửa hàng kiểm tra lại phí và các lượt chưa chuẩn bị.
              </p>
            </>
          )}
          {step === 3 && (
            <>
              <h2>Mỗi ngày, một lời nhắn.</h2>
              <label>
                Chủ đề lời chúc
                <Select
                  value={theme}
                  onChange={(e) => setTheme(e.target.value)}
                >
                  {[...new Set(data.policy.messages.map((m) => m.theme))].map(
                    (t) => (
                      <option key={t}>{t}</option>
                    ),
                  )}
                </Select>
              </label>
              <CardWritingChoice
                value={days[0]?.writingMode ?? "AUTO"}
                onChange={(writingMode) =>
                  setDays((ds) => ds.map((d) => ({ ...d, writingMode })))
                }
              />
              <p className="small muted">
                Mỗi ngày mặc định có một lời chúc tự động khác nhau. Chỉ viết
                bên dưới khi bạn muốn thay lời chúc của một ngày cụ thể; các
                ngày khác không thay đổi.
              </p>
              <label>
                1. Chọn ngày muốn viết lời nhắn riêng
                <Select
                  value={
                    days.some((d) => d.day === messageDay)
                      ? messageDay
                      : (days[0]?.day ?? "")
                  }
                  onChange={(e) => setMessageDay(e.target.value)}
                >
                  {[...days]
                    .sort((a, b) => a.day.localeCompare(b.day))
                    .map((d) => (
                      <option key={d.day} value={d.day}>
                        {d.day}
                        {d.message
                          ? " · Có lời nhắn riêng"
                          : " · Lời chúc tự động"}
                      </option>
                    ))}
                </Select>
              </label>
              <p className="small muted">
                Chọn ngày ở ô trên, rồi nhập lời nhắn cho đúng ngày đó ở ô dưới.
                Xóa hết nội dung để quay về lời chúc tự động.
              </p>
              {days
                .filter(
                  (d) =>
                    d.day ===
                    (days.some((v) => v.day === messageDay)
                      ? messageDay
                      : days[0]?.day),
                )
                .map((d) => (
                  <label key={d.day}>
                    2. Nội dung riêng cho ngày{" "}
                    {d.day.split("-").reverse().join("/")}
                    <textarea
                      rows={3}
                      value={d.message ?? ""}
                      maxLength={800}
                      placeholder={
                        quote?.days.find((v) => v.day === d.day)?.message ??
                        "Để trống để dùng lời chúc tự động cho ngày đã chọn."
                      }
                      onChange={(e) =>
                        update(d.day, { message: e.target.value || undefined })
                      }
                    />
                  </label>
                ))}
            </>
          )}
          {step === 4 && (
            <>
              <h2>Xem lại lịch hẹn của bạn.</h2>
              <p className="daily-review-intro">
                Kiểm tra nơi nhận, bó hoa và lời nhắn của từng ngày trước khi
                thanh toán.
              </p>
              <dl className="daily-review-recipient">
                <div>
                  <dt>
                    <UserRound size={15} aria-hidden="true" />
                    Người nhận
                  </dt>
                  <dd>
                    <strong>{recipient}</strong>
                    <span>{phone}</span>
                  </dd>
                </div>
                <div>
                  <dt>Người gửi trên thiệp</dt>
                  <dd>{sender || user?.name || "Bạn"}</dd>
                </div>
                <div className="daily-review-address">
                  <dt>
                    <MapPin size={15} aria-hidden="true" />
                    Địa chỉ giao hoa
                  </dt>
                  <dd>
                    {address}
                    {details && <span>Ghi chú địa chỉ: {details}</span>}
                  </dd>
                </div>
              </dl>
              <div className="daily-review-list-heading">
                <div>
                  <h3>Lịch giao của bạn</h3>
                  <span>{days.length} lượt giao · Giờ Hà Nội</span>
                </div>
                <span className="daily-review-mode">
                  <Flower2 size={14} aria-hidden="true" />
                  {mode === "SELF" ? "Tự chọn hoa" : "Fleurious chọn giúp"}
                </span>
              </div>
              <div
                className="daily-check-list"
                role="region"
                aria-label="Chi tiết từng lượt giao"
                tabIndex={0}
              >
                {quote?.days.map((d, index) => (
                  <article
                    key={d.day}
                    className="daily-review-card"
                    aria-label={`Lượt ${index + 1}, ngày ${d.day.split("-").reverse().join("/")}`}
                  >
                    <header className="daily-review-card-heading">
                      <div className="daily-review-date">
                        <span className="daily-review-number">
                          {String(index + 1).padStart(2, "0")}
                        </span>
                        <div>
                          <strong>
                            <time dateTime={d.day}>
                              {d.day.split("-").reverse().join("/")}
                            </time>
                          </strong>
                          <span>
                            <Clock3 size={13} aria-hidden="true" />
                            {d.slotLabel}
                          </span>
                        </div>
                      </div>
                      <span
                        className={`daily-review-status${d.approved ? " chosen" : ""}`}
                      >
                        {d.approved
                          ? "Mẫu bạn đã chọn"
                          : "Gợi ý · Chờ cửa hàng duyệt"}
                      </span>
                    </header>
                    <div className="daily-review-card-body">
                      <div className="daily-review-flower">
                        <img
                          src={d.selection.image}
                          alt={d.selection.name}
                          width="68"
                          height="84"
                          loading="lazy"
                        />
                        <div>
                          <span className="daily-review-label">Bó hoa</span>
                          <h4>{d.selection.name}</h4>
                          <span>Size {d.selection.variantName}</span>
                        </div>
                      </div>
                      <DailyReviewMessage
                        day={d.day}
                        message={d.message}
                        handwritten={d.writingMode === "HANDWRITTEN"}
                        updating={quotePending}
                        disabled={busy}
                        onEditingChange={onEditingMessage}
                        onSave={(value) => {
                          update(d.day, {
                            message: value.trim() ? value : undefined,
                          });
                          setAccepted(false);
                        }}
                      />
                    </div>
                    <footer className="daily-review-card-footer">
                      <CalendarDays size={14} aria-hidden="true" />
                      <span>
                        Có thể sửa lịch đến{" "}
                        <strong>{humanDate(d.lockAt)}</strong>
                      </span>
                    </footer>
                  </article>
                ))}
              </div>
              <details className="daily-terms" open>
                <summary>Điều kiện lịch hoa</summary>
                <p>{quote?.terms ?? data.policy.terms}</p>
              </details>
              <label className="daily-checkbox">
                <input
                  type="checkbox"
                  checked={accepted}
                  onChange={(e) => setAccepted(e.target.checked)}
                />
                Tôi đã kiểm tra lịch, tổng tiền và đồng ý điều kiện gói.
              </label>
            </>
          )}
          <div className="daily-wizard-actions">
            {step > 0 && (
              <button
                className="button secondary"
                onClick={() => setStep((s) => s - 1)}
              >
                Quay lại
              </button>
            )}
            {step < 4 && (
              <button
                className="button glass-primary"
                onClick={next}
                disabled={step === 1 && days.some((d) => !d.offeringId)}
              >
                Tiếp tục <ArrowRight size={17} />
              </button>
            )}
          </div>
        </div>
        <aside className="daily-summary daily-panel">
          <span className="eyebrow">LỊCH HOA CỦA BẠN</span>
          <h2>{days.length} ngày nở hoa.</h2>
          <p className="small muted">
            Tổng giá các bó đã chọn, trừ ưu đãi theo số ngày. Giá chính xác hiển
            thị sau khi chọn địa chỉ giao.
          </p>
          {!quote && (step > 0 || days.some((d) => d.offeringId)) && (
            <div className="daily-flower-subtotal" aria-live="polite">
              <span>Tiền hoa tạm tính</span>
              <strong>{money(flowerSubtotal)}</strong>
              <small>Chưa tính giảm giá và phí giao.</small>
            </div>
          )}
          {quote ? (
            <>
              <div className="summary-line">
                <span>Tổng giá các bó hoa</span>
                <strong>
                  {money(quote.days.reduce((n, d) => n + d.base, 0))}
                </strong>
              </div>
              <div className="summary-line">
                <span>Giảm tiền hoa ({quote.percent}%)</span>
                <strong>−{money(quote.discount)}</strong>
              </div>
              <div className="summary-line">
                <span>Hỗ trợ ship</span>
                <strong>−{money(quote.subsidy)}</strong>
              </div>
              <div className="summary-line">
                <span>Ship còn lại</span>
                <strong>{money(quote.shippingTotal)}</strong>
              </div>
              <div className="summary-line total">
                <span>Tổng thanh toán</span>
                <strong>{money(quote.total)}</strong>
              </div>
              <p className="small muted">
                Giá lấy theo các bó hoa đã chọn. Giá hội viên/voucher không cộng
                dồn.
              </p>
            </>
          ) : (
            <p role="status">
              {canQuote && !current
                ? "Đang tính giá và kiểm tra lịch…"
                : !point
                  ? "Chọn địa chỉ để tính đúng phí ship và tổng tiền."
                  : "Chọn lịch và mẫu để xem tổng tiền."}
            </p>
          )}
          {quote && (
            <div
              className="daily-quote-status"
              role="status"
              aria-live="polite"
            >
              {quoteError
                ? "Báo giá cần được kiểm tra lại."
                : editingMessages.length
                  ? "Lưu hoặc hủy lời chúc đang sửa để tiếp tục."
                  : quotePending
                    ? "Đang cập nhật báo giá…"
                    : ""}
            </div>
          )}
          {quoteError && (
            <DailyError
              error={quoteError}
              retry={() => {
                ship.refresh();
                reload();
              }}
            />
          )}
          {step === 4 && (
            <button
              className="button glass-primary full"
              onClick={buy}
              disabled={
                !freshQuote || !accepted || busy || editingMessages.length > 0
              }
            >
              {busy ? "Đang giữ lịch…" : "Xác nhận & thanh toán"}
            </button>
          )}
          <p className="small muted">
            Thanh toán một lần qua SePay. Giữ chỗ {data.policy.holdMinutes}{" "}
            phút; không tự gia hạn.
          </p>
        </aside>
      </div>
    </section>
  );
}

export function AccountDaily() {
  const { user, ready } = useShop(),
    [plans, setPlans] = useState<PlanList | null>(null),
    [error, setError] = useState("");
  const load = useCallback(() => {
    if (user)
      request<PlanList>("daily/plans")
        .then(setPlans)
        .catch((e) => setError(e.message));
  }, [user?.id]);
  useEffect(load, [load]);
  if (!ready) return <div className="page-loading">Đang mở lịch hoa…</div>;
  if (!user)
    return (
      <section className="container section empty-state">
        <h1>Lịch hoa của bạn.</h1>
        <Link href="/auth/login?next=/account/daily" className="button">
          Đăng nhập
        </Link>
      </section>
    );
  return (
    <section className="container section">
      <div className="section-heading">
        <div>
          <span className="eyebrow">FLEURIOUS DAILY</span>
          <h1>
            Những cuộc hẹn <em>có hoa.</em>
          </h1>
        </div>
        <Link href="/daily/create" className="button glass-primary">
          Hẹn lịch mới <ArrowRight size={17} />
        </Link>
      </div>
      {error && <DailyError error={error} retry={load} />}
      <div className="daily-plan-list">
        {plans?.map((p) => (
          <Link
            key={p.id}
            className="daily-plan-card daily-plan-card--summary"
            href={`/account/daily/${p.id}`}
          >
            <DailyPlanCardContent plan={p} />
          </Link>
        ))}
      </div>
      {plans && !plans.length && (
        <div className="empty-state">
          <Flower2 size={45} strokeWidth={1} />
          <h2>Lịch đang chờ một lời hẹn.</h2>
          <p>Chọn những ngày bạn muốn gửi hoặc nhận hoa.</p>
          <Link href="/daily/create" className="button">
            Hẹn hoa mỗi ngày
          </Link>
        </div>
      )}
    </section>
  );
}

export function DailyPlanPanel({
  id,
  admin = false,
  role = "CUSTOMER",
  onBack,
  initialDeliveryId = "",
}: {
  id: string;
  admin?: boolean;
  role?: string;
  onBack?: () => void;
  initialDeliveryId?: string;
}) {
  const { user, toast } = useShop(),
    [p, setPlan] = useState<DailyPlanData | null>(null),
    [error, setError] = useState(""),
    [selected, setSelected] = useState(initialDeliveryId),
    [month, setMonth] = useState(monthKey()),
    [busy, setBusy] = useState(false),
    [pool, setPool] = useState<DailyPublic | null>(null),
    [refundIds, setRefundIds] = useState<string[]>([]),
    [reason, setReason] = useState(""),
    [refs, setRefs] = useState<Record<string, string>>({});
  const path = admin ? `admin/daily/${id}` : `daily/plans/${id}`;
  const load = useCallback(
    () =>
      request<DailyPlanData>(path)
        .then((v) => {
          setPlan(v);
          setError("");
          setSelected(
            (s) =>
              s ||
              v.deliveries.find((d) =>
                [
                  "SCHEDULED",
                  "MATERIALIZED",
                  "ATTENTION",
                  "UNSCHEDULED",
                ].includes(d.state),
              )?.id ||
              v.deliveries[0]?.id ||
              "",
          );
        })
        .catch((e) => setError(e.message)),
    [path],
  );
  useEffect(() => {
    if (!admin && !user) return;
    load();
    request<DailyPublic>("daily/config")
      .then(setPool)
      .catch(() => {});
    const t = setInterval(load, 12000);
    window.addEventListener("fleurious:sync", load);
    window.addEventListener("focus", load);
    return () => {
      clearInterval(t);
      window.removeEventListener("fleurious:sync", load);
      window.removeEventListener("focus", load);
    };
  }, [load, user?.id, admin]);
  const d = p?.deliveries.find((d) => d.id === selected);
  useEffect(() => {
    if (!d) return;
    setMonth(d.day.slice(0, 7));
  }, [d?.id, d?.day]);
  async function act(action: string, body: unknown, method = "POST") {
    setBusy(true);
    try {
      await request(`${path}/${action}`, body, method);
      const updated = await request<DailyPlanData>(path);
      setPlan(updated);
      toast("Đã cập nhật lịch hoa.");
    } catch (e) {
      toast((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const backButton = onBack ? (
    <button
      type="button"
      className="button secondary daily-plan-back"
      onClick={onBack}
    >
      <ChevronLeft size={15} />
      Về danh sách gói
    </button>
  ) : (
    <Link
      className="button secondary daily-plan-back"
      href={admin ? "/admin/daily" : "/account/daily"}
    >
      <ChevronLeft size={15} />
      Về danh sách gói
    </Link>
  );
  if (!admin && !user)
    return (
      <section className="container section empty-state">
        <h1>Lịch hoa riêng của bạn.</h1>
        <Link href={`/auth/login?next=/account/daily/${id}`} className="button">
          Đăng nhập
        </Link>
      </section>
    );
  if (error && !p)
    return (
      <section className="container section">
        {backButton}
        <DailyError error={error} retry={load} />
      </section>
    );
  if (!p)
    return (
      <div>
        {backButton}
        <div className="page-loading">Đang mở lịch hoa…</div>
      </div>
    );
  const finance = !admin || ["OWNER", "MANAGER", "ACCOUNTANT"].includes(role),
    edit = !admin || ["OWNER", "MANAGER", "FLORIST"].includes(role),
    manager = ["OWNER", "MANAGER"].includes(role),
    locked =
      !d ||
      (d.state !== "UNSCHEDULED" && Date.parse(d.lockAt) <= Date.now()) ||
      !!d.orderId,
    terminal =
      !!d &&
      ["FULFILLED", "REFUND_PENDING", "REFUNDED", "CANCELLED"].includes(
        d.state,
      );
  const pending = p.invoices.filter((i) => i.state === "PENDING"),
    refundPending = p.refunds.filter((r) => r.state === "PENDING");
  return (
    <section
      className={
        admin ? "daily-plan-detail" : "container section daily-plan-detail"
      }
    >
      {backButton}
      <div className="section-heading daily-plan-heading">
        <div className="daily-plan-identity">
          <div className="daily-plan-code-row">
            <span className="eyebrow">{p.code}</span>
            <DailyPlanStatus state={p.state} />
          </div>
          <h1>Gửi {p.recipientName}</h1>
          <p>
            <CalendarDays size={14} aria-hidden="true" />
            {dailyDateRange(p.deliveries)}
            <span>· {p.deliveries.length} lượt giao</span>
          </p>
          {admin && (
            <p>
              <UserRound size={14} aria-hidden="true" />
              Người đặt: {p.buyerName}
            </p>
          )}
        </div>
        <Link href="/daily/create" className="button secondary daily-plan-new">
          Hẹn thêm lịch mới
        </Link>
      </div>
      {error && <DailyError error={error} retry={load} />}
      <div className="daily-progress">
        <span>
          {p.deliveries.filter((d) => d.state === "FULFILLED").length}/
          {p.deliveries.length} lượt đã giao
        </span>
        <progress
          aria-label="Tiến độ giao hoa"
          max={p.deliveries.length}
          value={p.deliveries.filter((d) => d.state === "FULFILLED").length}
        />
      </div>
      {finance && (
        <div className="daily-financial-summary">
          <span>
            Đã thu <strong>{money(p.receivedAmount ?? 0)}</strong>
          </span>
          <span>
            Đang hoàn{" "}
            <strong>
              {money(refundPending.reduce((s, r) => s + r.amount, 0))}
            </strong>
          </span>
          <span>
            Đã hoàn{" "}
            <strong>
              {money(
                p.refunds
                  .filter((r) => r.state === "COMPLETED")
                  .reduce((s, r) => s + r.amount, 0),
              )}
            </strong>
          </span>
        </div>
      )}
      {pending.map(
        (i) =>
          i.paymentQr && (
            <div key={i.id}>
              <PaymentQr
                url={i.paymentQr}
                amount={i.amount}
                code={i.code}
                bank={i.bank}
                accountNumber={i.accountNumber}
                accountName={i.accountName}
                expiresAt={i.expiresAt}
                serverNow={p.serverNow}
                title={
                  i.kind === "PURCHASE"
                    ? "Xác nhận những ngày có hoa."
                    : "Thanh toán phần nâng cấp mẫu hoa."
                }
              />
              {admin && finance && (
                <DailyPaymentConfirm
                  planId={p.id}
                  version={p.version}
                  invoice={i}
                  onConfirmed={async (alreadyPaid) => {
                    await load();
                    toast(
                      alreadyPaid
                        ? "Thanh toán đã được ghi nhận trước đó."
                        : "Đã xác nhận thanh toán và cập nhật lịch hoa.",
                    );
                  }}
                />
              )}
            </div>
          ),
      )}
      {p.invoices.some((i) => i.state === "REVIEW") && (
        <div className="notice">
          Giao dịch cần cửa hàng đối soát. Lịch chưa được thay đổi/kích hoạt từ
          khoản tiền này.
        </div>
      )}
      {admin && finance && p.reviewPayments.length > 0 && (
        <section className="daily-panel">
          <h2>Đối soát tiền đã nhận</h2>
          <p className="small muted">
            Chỉ xác nhận khoản đúng số tiền và tham chiếu ngân hàng. Giao dịch
            muộn được kiểm tra lại toàn bộ lịch trước khi kích hoạt.
          </p>
          {p.reviewPayments.map((payment) => (
            <article className="daily-refund-item" key={payment.id}>
              <strong>{money(payment.amount)}</strong>
              <p>{payment.reason}</p>
              <label>
                Tham chiếu ngân hàng
                <input
                  value={refs[payment.id] ?? ""}
                  onChange={(e) =>
                    setRefs((v) => ({ ...v, [payment.id]: e.target.value }))
                  }
                  placeholder={
                    payment.reference
                      ? "Nhập mã đã đối chiếu"
                      : "Giao dịch chưa có tham chiếu, liên hệ cửa hàng"
                  }
                />
              </label>
              <label>
                Ghi chú xác minh
                <input
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                />
              </label>
              <button
                className="button secondary"
                disabled={
                  busy ||
                  (refs[payment.id]?.length ?? 0) < 4 ||
                  reason.trim().length < 4
                }
                onClick={() =>
                  act("reconcile", {
                    paymentId: payment.id,
                    reference: refs[payment.id],
                    reason,
                  })
                }
              >
                Xác nhận khớp khoản tiền
              </button>
              {manager && (
                <button
                  className="button secondary"
                  disabled={busy || reason.trim().length < 4}
                  onClick={() =>
                    act(`payments/${payment.id}/refund`, { reason })
                  }
                >
                  Đề nghị hoàn khoản chưa phân bổ
                </button>
              )}
            </article>
          ))}
        </section>
      )}
      {["PENDING_PAYMENT", "EXPIRED"].includes(p.state) && (
        <div className="daily-wizard-actions">
          <Link href="/daily/create" className="button secondary">
            Hẹn lại lịch mới
          </Link>
          <button
            className="text-link"
            disabled={busy}
            onClick={() => act("cancel", {})}
          >
            Đóng yêu cầu chưa thanh toán
          </button>
        </div>
      )}
      <p className="small muted">
        {p.recipientPhone} · {p.address}
      </p>
      <div className="daily-detail-layout">
        <div className="daily-date-columns">
          <DailyCalendar
            month={month}
            onMonth={setMonth}
            readOnly
            selected={Object.fromEntries(
              p.deliveries.map((d) => [
                d.day,
                {
                  image: d.selectionSnapshot?.image,
                  state: dailyStateLabels[d.state],
                },
              ]),
            )}
            onDay={(day) => {
              const d = p.deliveries.find((d) => d.day === day);
              if (d) setSelected(d.id);
            }}
          />
          <div className="daily-scroll-panel">
            <div className="daily-delivery-list">
              {p.deliveries.map((row) => (
                <button
                  key={row.id}
                  className={selected === row.id ? "selected" : ""}
                  onClick={() => setSelected(row.id)}
                >
                  <strong>{row.day}</strong>
                  <span>
                    {["REFUND_PENDING", "REFUNDED", "CANCELLED"].includes(
                      row.state,
                    )
                      ? dailyStateLabels[row.state]
                      : row.order
                        ? row.order.fulfillment === "UNASSIGNED"
                          ? "Chờ chuẩn bị"
                          : row.order.fulfillment === "DELIVERED"
                            ? "Đã giao"
                            : row.order.fulfillment === "PREPARING"
                              ? "Đang chuẩn bị"
                              : row.order.fulfillment === "READY"
                                ? "Sẵn sàng giao"
                                : "Đang giao"
                        : (dailyStateLabels[row.state] ?? row.state)}
                  </span>
                  {row.issue && <small>Cần hỗ trợ</small>}
                </button>
              ))}
            </div>
          </div>
        </div>
        {d && (
          <article className="daily-panel daily-delivery-detail">
            <span className="eyebrow">HOA NGÀY {d.day}</span>
            <h2>{d.selectionSnapshot?.name ?? "Cửa hàng chọn mẫu"}</h2>
            {d.selectionSnapshot?.image && (
              <img
                className="daily-detail-image"
                src={d.selectionSnapshot.image}
                alt={d.selectionSnapshot.name}
                width="500"
                height="350"
              />
            )}
            <div className="daily-delivery-info">
              <div className="daily-delivery-info-heading">
                <span>Thông tin lượt giao</span>
                <span
                  className={`daily-plan-status daily-plan-status--${d.approved ? "active" : "pending"}`}
                >
                  {d.approved ? "Mẫu đã xác nhận" : "Mẫu chờ duyệt"}
                </span>
              </div>
              <dl className="daily-delivery-facts">
                <div>
                  <dt>
                    <Clock3 size={14} aria-hidden="true" /> Khung giao
                  </dt>
                  <dd>{d.slotLabel}</dd>
                </div>
                <div>
                  <dt>
                    <CalendarDays size={14} aria-hidden="true" /> Hạn sửa lịch
                  </dt>
                  <dd>
                    <time dateTime={d.lockAt}>{humanDate(d.lockAt)}</time>
                    <small>Giờ Hà Nội</small>
                  </dd>
                </div>
                {finance && (
                  <div className="daily-delivery-value">
                    <dt>Giá trị lượt</dt>
                    <dd>
                      <strong>{money(d.total ?? 0)}</strong>
                    </dd>
                  </div>
                )}
              </dl>
            </div>
            {d.issue && <p className="notice">{d.issue}</p>}
            {d.order && (
              <Link
                className="button secondary daily-delivery-order-link"
                href={
                  admin
                    ? `/admin/orders?q=${d.order.code}`
                    : `/orders/${d.order.id}`
                }
              >
                Theo dõi đơn {d.order.code} <ArrowRight size={16} />
              </Link>
            )}
            <DailyDeliveryMessage
              key={`message:${d.id}`}
              delivery={d}
              planId={p.id}
              policy={p.policy as unknown as DailyPolicy}
              admin={admin}
              editable={
                edit && !terminal && ["ACTIVE", "PAUSED"].includes(p.state)
              }
              onUpdated={load}
            />
            {edit && !terminal && ["ACTIVE", "PAUSED"].includes(p.state) && (
              <DailyDeliveryEditor
                key={`delivery-editor:${d.id}`}
                delivery={d}
                plan={p}
                pool={pool}
                admin={admin}
                locked={locked}
                onUpdated={load}
              />
            )}
          </article>
        )}
      </div>
      {finance &&
        ["ACTIVE", "PAUSED", "COMPLETED", "CLOSING"].includes(p.state) &&
        (!admin || manager) && (
          <details className="daily-terms">
            <summary>Yêu cầu hoàn các lượt được chọn</summary>
            <p>
              Hoàn đúng số tiền đã trả của từng lượt, không tăng lại giá các bó
              đã giao. Sau hạn chốt, liên hệ cửa hàng.
            </p>
            <div className="daily-refund-options">
              {p.deliveries
                .filter(
                  (d) =>
                    !["REFUND_PENDING", "REFUNDED", "CANCELLED"].includes(
                      d.state,
                    ) &&
                    (admin ||
                      (!d.orderId && Date.parse(d.lockAt) > Date.now())),
                )
                .map((d) => (
                  <label key={d.id}>
                    <input
                      type="checkbox"
                      checked={refundIds.includes(d.id)}
                      onChange={() =>
                        setRefundIds((v) =>
                          v.includes(d.id)
                            ? v.filter((x) => x !== d.id)
                            : [...v, d.id],
                        )
                      }
                    />
                    {d.day} · {money(d.total ?? 0)}
                  </label>
                ))}
            </div>
            <label>
              Lý do
              <textarea
                rows={2}
                minLength={4}
                maxLength={500}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
            </label>
            <button
              className="button secondary"
              disabled={busy || !refundIds.length || reason.trim().length < 4}
              onClick={() =>
                act("refunds", {
                  version: p.version,
                  deliveryIds: refundIds,
                  reason,
                })
              }
            >
              Gửi yêu cầu hoàn{" "}
              {money(
                p.deliveries
                  .filter((d) => refundIds.includes(d.id))
                  .reduce((s, d) => s + (d.total ?? 0), 0),
              )}
            </button>
          </details>
        )}
      {finance && p.refunds.length > 0 && (
        <section className="daily-panel">
          <h2>Theo dõi hoàn tiền</h2>
          {p.refunds.map((r) => (
            <article className="daily-refund-item" key={r.id}>
              <strong>
                {money(r.amount)} ·{" "}
                {r.state === "COMPLETED" ? "Đã hoàn" : "Chờ cửa hàng hoàn"}
              </strong>
              <p>{r.reason}</p>
              {r.reference && <small>Tham chiếu: {r.reference}</small>}
              {admin &&
                r.state === "PENDING" &&
                ["OWNER", "MANAGER", "ACCOUNTANT"].includes(role) && (
                  <>
                    <label>
                      Tham chiếu giao dịch trả tiền
                      <input
                        value={refs[r.id] ?? ""}
                        maxLength={100}
                        onChange={(e) =>
                          setRefs((v) => ({ ...v, [r.id]: e.target.value }))
                        }
                      />
                    </label>
                    <button
                      className="button secondary"
                      disabled={busy || (refs[r.id]?.length ?? 0) < 4}
                      onClick={async () => {
                        setBusy(true);
                        try {
                          await request(
                            `admin/daily/refunds/${r.id}/complete`,
                            { reference: refs[r.id] },
                          );
                          await load();
                          toast("Đã ghi nhận hoàn tiền.");
                        } catch (e) {
                          toast((e as Error).message);
                        } finally {
                          setBusy(false);
                        }
                      }}
                    >
                      Xác nhận đã chuyển tiền hoàn
                    </button>
                  </>
                )}
            </article>
          ))}
        </section>
      )}
    </section>
  );
}
