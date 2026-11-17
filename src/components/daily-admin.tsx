"use client";
import Link from "next/link";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import {
  CalendarDays,
  ArrowRight,
  Plus,
  RefreshCw,
  Settings2,
  Check,
} from "lucide-react";
import { request, useShop } from "./shop-provider";
import { Select } from "./ui/select";
import { DailyPlanPanel } from "./daily-client";
import { DailyAdminCalendar } from "./daily-admin-calendar";
import { DailyPlanCardContent } from "./daily-plan-summary";
import {
  dailyStateLabels,
  type DailyPolicy,
  type DailyOfferingView,
} from "@/lib/daily-types";
import { dayKey, money, monthKey } from "@/lib/time";
type Row = {
  id: string;
  code: string;
  buyerName: string;
  recipientName: string;
  state: string;
  total?: number;
  deliveries: {
    id: string;
    day: string;
    state: string;
    issue: string;
    orderId: string | null;
  }[];
  refunds: { id: string; state: string }[];
};
type Setup = {
  policy: DailyPolicy;
  version: number;
  offerings: DailyOfferingView[];
  products: {
    id: string;
    name: string;
    active: boolean;
    variants: { id: string; name: string; price: number }[];
  }[];
};
function Numeric({
  value,
  onChange,
  min = 0,
  max = 10000000,
}: {
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
}) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)), [value]);
  return (
    <input
      type="number"
      inputMode="numeric"
      min={min}
      max={max}
      required
      value={draft}
      onChange={(e) => {
        setDraft(e.target.value);
        if (
          e.target.value !== "" &&
          Number.isSafeInteger(Number(e.target.value))
        )
          onChange(Number(e.target.value));
      }}
      onBlur={() => {
        if (draft !== "") setDraft(String(value));
      }}
    />
  );
}
export function DailyAdmin({ role }: { role: string }) {
  const { toast } = useShop(),
    [rows, setRows] = useState<Row[]>([]),
    [error, setError] = useState(""),
    [tab, setTab] = useState("plans"),
    [selected, setSelected] = useState(""),
    [selectedDelivery, setSelectedDelivery] = useState(""),
    [calendarView, setCalendarView] = useState({
      month: monthKey(),
      date: dayKey(),
    }),
    [running, setRunning] = useState(false);
  const load = useCallback(
    () =>
      request<Row[]>("admin/daily")
        .then((rows) => {
          setRows(rows);
          setError("");
        })
        .catch((e) => setError(e.message)),
    [],
  );
  useEffect(() => {
    load();
    const t = setInterval(load, 20000);
    window.addEventListener("fleurious:sync", load);
    return () => {
      clearInterval(t);
      window.removeEventListener("fleurious:sync", load);
    };
  }, [load]);
  useEffect(() => {
    const id = new URLSearchParams(location.search).get("plan");
    if (id) setSelected(id);
  }, []);
  const setup = ["OWNER", "MANAGER"].includes(role),
    all = rows.flatMap((p) => p.deliveries.map((d) => ({ ...d, plan: p }))),
    attention = all.filter((d) => d.issue || d.state === "UNSCHEDULED");
  if (selected)
    return (
      <div className="admin-main daily-admin">
        <DailyPlanPanel
          id={selected}
          admin
          role={role}
          initialDeliveryId={selectedDelivery}
          onBack={() => {
            setSelected("");
            setSelectedDelivery("");
            const url = new URL(window.location.href);
            url.searchParams.delete("plan");
            window.history.replaceState(
              window.history.state,
              "",
              `${url.pathname}${url.search}${url.hash}`,
            );
            load();
          }}
        />
      </div>
    );
  return (
    <div className="admin-main daily-admin">
      <div className="section-heading">
        <div>
          <span className="eyebrow">FLEURIOUS DAILY</span>
          <h1>
            Những lịch hoa <em>đang hẹn.</em>
          </h1>
        </div>
        {setup && (
          <button
            className="button secondary"
            disabled={running}
            onClick={async () => {
              setRunning(true);
              try {
                const r = await request<{ processed: number }>(
                  "admin/daily/run",
                  {},
                );
                toast(`Đã kiểm tra ${r.processed} lượt đến hạn.`);
                load();
              } catch (e) {
                toast((e as Error).message);
              } finally {
                setRunning(false);
              }
            }}
          >
            <RefreshCw size={16} />
            Kiểm tra lịch đến hạn
          </button>
        )}
      </div>
      {tab !== "calendar" && (
        <div className="daily-financial-summary">
          <span>
            Gói đang chạy{" "}
            <strong>{rows.filter((p) => p.state === "ACTIVE").length}</strong>
          </span>
          <span>
            Lượt hôm nay{" "}
            <strong>{all.filter((d) => d.day === dayKey()).length}</strong>
          </span>
          <span>
            Cần hỗ trợ <strong>{attention.length}</strong>
          </span>
          <span>
            Chờ hoàn{" "}
            <strong>
              {rows.reduce(
                (s, p) =>
                  s + p.refunds.filter((r) => r.state === "PENDING").length,
                0,
              )}
            </strong>
          </span>
        </div>
      )}
      <nav className="account-tabs">
        {[
          ["plans", "Gói khách hàng"],
          ["calendar", "Lịch giao"],
          ["issues", "Việc cần xử lý"],
          ...(setup ? [["settings", "Cấu hình & bộ hoa"]] : []),
        ].map(([id, label]) => (
          <button
            className={tab === id ? "active" : ""}
            key={id}
            onClick={() => setTab(id)}
          >
            {label}
          </button>
        ))}
      </nav>
      {["OWNER", "MANAGER", "FLORIST"].includes(role) &&
        !["settings", "calendar"].includes(tab) && (
          <div className="daily-wizard-actions">
            <a
              className="button secondary"
              href={`/api/admin/daily/export?day=${dayKey()}`}
              download
            >
              Xuất phiếu chuẩn bị hôm nay
            </a>
          </div>
        )}
      {error && (
        <p role="alert" className="notice">
          {error}
        </p>
      )}
      {tab === "settings" ? (
        <DailySettings />
      ) : tab === "calendar" ? (
        <DailyAdminCalendar
          role={role}
          initialView={calendarView}
          onViewChange={setCalendarView}
          onOpenPlan={(plan, delivery) => {
            setSelectedDelivery(delivery);
            setSelected(plan);
          }}
        />
      ) : (
        <>
          {tab === "issues" ? (
            <div className="daily-plan-list">
              {attention.map((d) => (
                <button
                  className="daily-plan-card"
                  key={d.id}
                  onClick={() => setSelected(d.plan.id)}
                >
                  <CalendarDays size={25} />
                  <div>
                    <strong>
                      {d.day} · {d.plan.recipientName}
                    </strong>
                    <p>{d.issue || "Chờ khách chọn lịch bù"}</p>
                  </div>
                  <ArrowRight size={18} />
                </button>
              ))}
              {!attention.length && (
                <p>Không có lượt cần xử lý trong danh sách đang xem.</p>
              )}
            </div>
          ) : (
            <>
              <p className="small muted">
                Tối đa 100 gói gần nhất. Mở Lịch giao để xem các lượt theo ngày.
              </p>
              <div className="daily-plan-list">
                {rows.map((p) => (
                  <button
                    className="daily-plan-card daily-plan-card--summary"
                    key={p.id}
                    onClick={() => setSelected(p.id)}
                  >
                    <DailyPlanCardContent plan={p} showBuyer />
                  </button>
                ))}
                {!rows.length && (
                  <div className="empty-state">
                    <h2>Chưa có lịch hoa.</h2>
                    <p>
                      Thêm bộ hoa và mở bán trong cấu hình Daily để bắt đầu.
                    </p>
                  </div>
                )}
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}
export function DailySettings() {
  const { toast } = useShop(),
    [setup, setSetup] = useState<Setup | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [editing, setEditing] = useState<DailyOfferingView | null>(null);
  const load = useCallback(
    () =>
      request<Setup>("admin/daily/settings")
        .then(setSetup)
        .catch((e) => setError(e.message)),
    [],
  );
  useEffect(() => {
    load();
  }, [load]);
  if (error && !setup)
    return (
      <p role="alert" className="notice">
        {error}
      </p>
    );
  if (!setup) return <p role="status">Đang mở cấu hình Daily…</p>;
  const p = setup.policy;
  function patch(value: Partial<DailyPolicy>) {
    setSetup((s) => (s ? { ...s, policy: { ...s.policy, ...value } } : s));
  }
  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const saved = await request<{ policy: DailyPolicy; version: number }>(
        "admin/daily/settings",
        { version: setup!.version, policy: p },
        "PATCH",
      );
      setSetup((s) => (s ? { ...s, ...saved } : s));
      toast("Đã lưu cấu hình Daily. Các gói đã mua giữ chính sách cũ.");
    } catch (e) {
      toast((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function offeringSave(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setBusy(true);
    try {
      await request(
        `admin/daily/offerings${editing?.id ? `/${editing.id}` : ""}`,
        {
          variantId: f.get("variantId"),
          budgetCode: editing?.budgetCode ?? "catalog",
          description: f.get("description"),
          tags: String(f.get("tags"))
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean),
          premium: editing?.premium ?? 0,
          cost: Number(f.get("cost")),
          capacity: Number(f.get("capacity")),
          active: f.get("active") === "on",
        },
        editing?.id ? "PATCH" : "POST",
      );
      setEditing(null);
      load();
      toast("Đã lưu mẫu hoa Daily.");
    } catch (e) {
      toast((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="daily-settings">
      <section className="admin-panel">
        <form onSubmit={save}>
          <div className="panel-heading">
            <h2>Ưu đãi và lịch vận hành</h2>
            <span>Phiên bản {setup.version}</span>
          </div>
          <p className="small muted">
            Cấu hình mới áp dụng cho lịch mới. Thêm sản phẩm vào danh mục Hoa
            mỗi ngày trước khi mở bán.
          </p>
          <label className="daily-checkbox">
            <input
              type="checkbox"
              checked={p.enabled}
              onChange={(e) => patch({ enabled: e.target.checked })}
            />
            Mở bán Fleurious Daily
          </label>
          <div className="daily-form-row">
            <label>
              Tên chương trình
              <input
                required
                maxLength={80}
                value={p.name}
                onChange={(e) => patch({ name: e.target.value })}
              />
            </label>
            <label>
              Slogan
              <input
                maxLength={150}
                value={p.slogan}
                onChange={(e) => patch({ slogan: e.target.value })}
              />
            </label>
          </div>
          <p className="small muted">
            Giá mỗi lượt lấy từ giá sản phẩm/size trong danh mục Hoa mỗi ngày.
            Tổng tiền hoa bằng tổng các bó đã chọn, sau đó áp dụng ưu đãi theo
            số lượt.
          </p>
          <h3>Mốc giảm và hỗ trợ ship</h3>
          {p.tiers.map((t, i) => (
            <fieldset className="daily-tier-editor" key={i}>
              <legend>Từ {t.count} lượt</legend>
              <div className="daily-form-row">
                {[
                  { key: "count", label: "Số lượt", min: 1, max: 31 },
                  { key: "percent", label: "Giảm tiền hoa (%)", max: 50 },
                  { key: "shipPercent", label: "Giảm ship (%)", max: 100 },
                  { key: "shipCap", label: "Trần giảm ship/lượt" },
                  {
                    key: "freeMeters",
                    label: "Miễn ship trong (m) khi > 0",
                    max: 100000,
                  },
                  {
                    key: "outsideSupport",
                    label: "Hỗ trợ ngoài bán kính/lượt",
                  },
                ].map((f) => (
                  <label key={f.key}>
                    {f.label}
                    <Numeric
                      value={t[f.key as keyof typeof t]}
                      min={f.min ?? 0}
                      max={f.max ?? 10000000}
                      onChange={(v) =>
                        patch({
                          tiers: p.tiers.map((x, j) =>
                            i === j ? { ...x, [f.key]: v } : x,
                          ),
                        })
                      }
                    />
                  </label>
                ))}
              </div>
              <button
                type="button"
                className="text-link"
                onClick={() =>
                  patch({ tiers: p.tiers.filter((_, j) => i !== j) })
                }
              >
                Bỏ mốc này
              </button>
            </fieldset>
          ))}
          <button
            type="button"
            className="text-link"
            disabled={p.tiers.length >= 10}
            onClick={() =>
              patch({
                tiers: [
                  ...p.tiers,
                  {
                    count: Math.min(31, (p.tiers.at(-1)?.count ?? 0) + 1),
                    percent: 0,
                    shipPercent: 0,
                    shipCap: 0,
                    freeMeters: 0,
                    outsideSupport: 0,
                  },
                ],
              })
            }
          >
            <Plus size={15} />
            Thêm mốc
          </button>
          <details className="daily-terms">
            <summary>Lịch, công suất và chi phí</summary>
            <div className="daily-form-row">
              {[
                {
                  key: "leadHours",
                  label: "Chuẩn bị trước ít nhất (giờ)",
                  min: 2,
                  max: 720,
                },
                {
                  key: "horizonDays",
                  label: "Nhận lịch trước tối đa (ngày)",
                  min: 31,
                  max: 180,
                },
                {
                  key: "cutoffHour",
                  label: "Giờ chốt hoa ngày trước giao",
                  max: 23,
                },
                {
                  key: "messageCutoffHour",
                  label: "Giờ chốt thiệp ngày trước giao",
                  max: 23,
                },
                {
                  key: "holdMinutes",
                  label: "Giữ chỗ thanh toán (phút)",
                  min: 5,
                  max: 60,
                },
                {
                  key: "graceDays",
                  label: "Hạn lịch bù sau lịch gốc (ngày)",
                  min: 1,
                  max: 60,
                },
                {
                  key: "capacityPerDay",
                  label: "Tối đa lượt Daily/ngày",
                  min: 1,
                  max: 500,
                },
                {
                  key: "repeatWindow",
                  label: "Hạn chế lặp trong số lượt",
                  max: 31,
                },
                { key: "campaignBudget", label: "Ngân sách hỗ trợ ship" },
                { key: "packingCost", label: "Công/bao bì/thiệp mỗi bó" },
                { key: "minimumMargin", label: "Lãi đóng góp tối thiểu/bó" },
              ].map((f) => (
                <label key={f.key}>
                  {f.label}
                  <Numeric
                    value={p[f.key as keyof DailyPolicy] as number}
                    min={f.min ?? 0}
                    max={f.max ?? 10000000}
                    onChange={(v) => patch({ [f.key]: v })}
                  />
                </label>
              ))}
            </div>
            <label>
              Ngày không nhận lịch (YYYY-MM-DD, cách bằng dấu phẩy)
              <textarea
                rows={2}
                defaultValue={p.blackoutDates.join(", ")}
                onBlur={(e) =>
                  patch({
                    blackoutDates: e.target.value
                      .split(",")
                      .map((s) => s.trim())
                      .filter(Boolean),
                  })
                }
              />
            </label>
            <p className="small muted">
              Giờ Hà Nội. Ngày nghỉ chung trong settings giao hàng cũng được áp
              dụng. Không tự thay đổi lịch đã bán.
            </p>
          </details>
          <details className="daily-terms">
            <summary>Thư viện lời chúc ({p.messages.length} câu)</summary>
            <p className="small muted">
              Dùng {"{recipient}"} và {"{sender}"} để chèn tên. Cần ít nhất 31
              câu.
            </p>
            {p.messages.map((m, i) => (
              <div className="daily-form-row" key={i}>
                <label>
                  Chủ đề
                  <input
                    required
                    maxLength={40}
                    value={m.theme}
                    onChange={(e) =>
                      patch({
                        messages: p.messages.map((v, j) =>
                          i === j ? { ...v, theme: e.target.value } : v,
                        ),
                      })
                    }
                  />
                </label>
                <label>
                  Lời chúc {i + 1}
                  <textarea
                    rows={2}
                    required
                    maxLength={800}
                    value={m.text}
                    onChange={(e) =>
                      patch({
                        messages: p.messages.map((v, j) =>
                          i === j ? { ...v, text: e.target.value } : v,
                        ),
                      })
                    }
                  />
                </label>
                <button
                  type="button"
                  className="text-link"
                  disabled={p.messages.length <= 31}
                  onClick={() =>
                    patch({ messages: p.messages.filter((_, j) => j !== i) })
                  }
                >
                  Bỏ
                </button>
              </div>
            ))}
            <button
              type="button"
              className="text-link"
              onClick={() =>
                patch({
                  messages: [
                    ...p.messages,
                    {
                      theme: "Dịu dàng",
                      text: "Một lời thương dành riêng cho {recipient}.",
                    },
                  ],
                })
              }
            >
              Thêm lời chúc
            </button>
          </details>
          <label>
            Điều kiện hiển thị khi mua
            <textarea
              rows={5}
              required
              minLength={20}
              maxLength={5000}
              value={p.terms}
              onChange={(e) => patch({ terms: e.target.value })}
            />
          </label>
          <button className="button glass-primary" disabled={busy}>
            Lưu cấu hình Daily
          </button>
        </form>
      </section>
      <section className="admin-panel">
        <div className="panel-heading">
          <h2>Bộ hoa Daily</h2>
          <button
            className="text-link"
            type="button"
            onClick={() =>
              setEditing({
                id: "",
                variantId:
                  (
                    setup.products[0]?.variants.find(
                      (v) => v.name === "Vừa xinh",
                    ) ?? setup.products[0]?.variants[0]
                  )?.id ?? "",
                budgetCode: "catalog",
                name: "",
                description: "",
                tags: [],
                premium: 0,
                price: 0,
                cost: 0,
                capacity: 10,
                active: true,
                image: "",
                productId: setup.products[0]?.id ?? "",
                productName: "",
                color: "",
                variantName: "",
              })
            }
          >
            <Plus size={16} />
            Thêm mẫu
          </button>
        </div>
        <p className="small muted">
          Chỉ chọn size sản phẩm phù hợp quy cách Daily. Giá bán lẻ không tự
          thay đổi khi thêm vào bộ Daily.
        </p>
        <div className="daily-offering-grid">
          {setup.offerings.map((o) => (
            <article key={o.id}>
              <img
                src={o.image}
                alt={o.name}
                width="220"
                height="220"
                loading="lazy"
              />
              <strong>{o.name}</strong>
              <p>
                {o.variantName} · {o.active ? "Đang dùng" : "Đã ẩn"}
              </p>
              <p>
                {money(o.price)}/bó · Tối đa {o.capacity}/ngày
              </p>
              <button className="text-link" onClick={() => setEditing(o)}>
                Chỉnh sửa
              </button>
            </article>
          ))}
        </div>
        {editing && (
          <form
            key={editing.id || "new"}
            className="daily-panel"
            onSubmit={offeringSave}
          >
            <h3>{editing.id ? "Chỉnh mẫu" : "Mẫu hoa mới"}</h3>
            <div className="daily-form-row">
              <label>
                Sản phẩm
                <Select
                  name="productId"
                  required
                  value={editing.productId}
                  onChange={(e) => {
                    const product = setup.products.find(
                      (p) => p.id === e.target.value,
                    );
                    const variant =
                      product?.variants.find((v) => v.name === "Vừa xinh") ??
                      product?.variants[0];
                    setEditing({
                      ...editing,
                      productId: product?.id ?? "",
                      variantId: variant?.id ?? "",
                    });
                  }}
                >
                  {setup.products.map((p) => (
                    <option value={p.id} key={p.id}>
                      {p.name}
                      {p.active ? "" : " (đang ẩn)"}
                    </option>
                  ))}
                </Select>
              </label>
              <label>
                Size
                <Select
                  name="variantId"
                  required
                  value={editing.variantId}
                  onChange={(e) =>
                    setEditing({ ...editing, variantId: e.target.value })
                  }
                >
                  {(
                    setup.products.find((p) => p.id === editing.productId)
                      ?.variants ?? []
                  ).map((v) => (
                    <option value={v.id} key={v.id}>
                      {v.name}
                    </option>
                  ))}
                </Select>
              </label>
              <p className="small muted">
                Giá lấy từ sản phẩm:{" "}
                <strong>
                  {money(
                    setup.products
                      .flatMap((p) => p.variants)
                      .find((v) => v.id === editing.variantId)?.price ?? 0,
                  )}
                </strong>
                /bó. Chỉnh giá trong quản lý sản phẩm.
              </p>
              <label>
                Giá vốn hoa ước tính
                <input
                  type="number"
                  inputMode="numeric"
                  name="cost"
                  min={0}
                  required
                  defaultValue={editing.cost}
                />
              </label>
              <label>
                Lượng cung ứng tối đa/ngày
                <input
                  type="number"
                  inputMode="numeric"
                  name="capacity"
                  min={1}
                  max={500}
                  required
                  defaultValue={editing.capacity ?? 10}
                />
              </label>
            </div>
            <label>
              Mô tả quy cách
              <textarea
                name="description"
                rows={3}
                maxLength={1000}
                defaultValue={editing.description}
              />
            </label>
            <label>
              Loài hoa / phong cách (cách bằng dấu phẩy)
              <input
                name="tags"
                defaultValue={editing.tags.join(", ")}
                placeholder="hồng, cẩm chướng, nhẹ nhàng"
              />
            </label>
            <label className="daily-checkbox">
              <input
                type="checkbox"
                name="active"
                defaultChecked={editing.active}
              />
              Cho phép chọn mẫu
            </label>
            <div className="daily-wizard-actions">
              <button className="button glass-primary" disabled={busy}>
                Lưu mẫu
              </button>
              <button
                className="button secondary"
                type="button"
                onClick={() => setEditing(null)}
              >
                Đóng
              </button>
            </div>
          </form>
        )}
      </section>
      <section className="admin-panel">
        <h2>Cách tính tiền hoa</h2>
        <p>
          Cộng giá các bó theo từng ngày rồi giảm theo mốc số lượt. Phí ship và
          hỗ trợ ship được tính riêng theo địa chỉ nhận.
        </p>
        <div className="daily-simulation">
          {p.tiers.map((t) => (
            <p key={t.count}>
              <span>Từ {t.count} lượt</span>
              <strong>Giảm {t.percent}% tiền hoa</strong>
            </p>
          ))}
        </div>
      </section>
    </div>
  );
}
