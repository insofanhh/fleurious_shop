"use client";
import { FlowerIcon } from "./flower-icon";
import { ProductEditor } from "./product-editor";
import { ProductVisibility } from "./product-visibility";
import { AdminPaymentShare } from "./admin-payment-share";
import { CopyButton } from "./copy-button";
import {
  CollectionsPanel,
  DeliveryDialog,
  CollectionOrderDetails,
  collectionFinance,
} from "./collections-panel";
import { ImageUpload } from "./ui/image-upload";
import { useAutoSlug } from "./ui/use-auto-slug";
import { taxonomyLabels } from "@/lib/catalogue";
import {
  orderActions,
  orderLane,
  stoppedOrderStatuses,
  hasReceivedPayment,
} from "@/lib/order-workflow";
import { OrderCard } from "./order-card";
import { CardTemplates } from "./card-templates";
import { cardWritingLabels } from "@/lib/card-design";
import { AdminOrderCreate } from "./admin-order-create";
import { canCreateOrder, orderChannels } from "@/lib/order-channels";
import { isOrderExpired, isPaymentOverdue } from "@/lib/order-expiry";
import { ShippingSummary } from "./shipping-summary";
import { ShippingSettings } from "./shipping-settings";
import { SepaySettings } from "./sepay-settings";
import { adminSections } from "./admin-frame";
import { MembershipAdmin } from "./membership-admin";
import { Select } from "./ui/select";
import Link from "next/link";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useId,
  useState,
  type ReactNode,
  type FormEvent,
} from "react";
import { useRouter, useSearchParams } from "next/navigation";
import dynamic from "next/dynamic";
import {
  DndContext,
  useDraggable,
  useDroppable,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  useReactTable,
  getCoreRowModel,
  flexRender,
  type ColumnDef,
} from "@tanstack/react-table";
import {
  ArrowUpRight,
  ArrowRight,
  BarChart3,
  CalendarDays,
  Check,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  CreditCard,
  FileText,
  Flame,
  Gift,
  GripVertical,
  LayoutDashboard,
  LayoutGrid,
  Leaf,
  List,
  MoreHorizontal,
  Package,
  Plus,
  Search,
  Settings2,
  ShieldCheck,
  ShoppingBag,
  TicketPercent,
  Truck,
  Users,
  X,
  Clock3,
} from "lucide-react";
import { request, useShop } from "./shop-provider";
import { humanDate, money, dayKey, shiftDay } from "@/lib/time";
import { orderStatus } from "./customer-features";
import { can } from "@/lib/auth-policy";
import type { Order, Product } from "@/lib/types";
import type { ShopSettings } from "@/lib/settings";
import { RewardRuleManager } from "./reward-rule-manager";
const Calendar = dynamic(() => import("./operations-calendar"), {
  ssr: false,
  loading: () => <p>Đang mở lịch giao…</p>,
});
type Row = Record<string, any>;
export function AdminDashboard({
  section,
  role,
  name,
}: {
  section: string;
  role: string;
  name: string;
}) {
  const { toast, refreshCatalog, refresh, slots } = useShop();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [data, setData] = useState<any>(null),
    [error, setError] = useState(""),
    [query, setQuery] = useState(searchParams.get("q") ?? ""),
    [page, setPage] = useState(1),
    [view, setView] = useState(section === "calendar" ? "calendar" : "table"),
    [editor, setEditor] = useState<Row | null>(null),
    [orderDetail, setOrderDetail] = useState<Order | null>(null),
    [busy, setBusy] = useState(false);
  const [financialAction, setFinancialAction] = useState<{
    order: Order;
    mode: "payment" | "refund";
  } | null>(null);
  const [creatingOrder, setCreatingOrder] = useState(false);
  const [paymentShareId, setPaymentShareId] = useState<string | null>(null);
  const [deliveryOrder, setDeliveryOrder] = useState<Order | null>(null);
  const [taxonomyFilter, setTaxonomyFilter] = useState("ALL");
  const [staff, setStaff] = useState<
    { id: string; name: string; role: string }[]
  >([]);
  useEffect(() => {
    if (["orders", "calendar"].includes(section))
      request<typeof staff>("admin/orders/staff")
        .then(setStaff)
        .catch(() => {});
  }, [section]);
  const [calendarRange, setCalendarRange] = useState({
    from: shiftDay(dayKey(), -31),
    to: shiftDay(dayKey(), 62),
  });
  const title =
    adminSections.find((s) => s.id === section)?.name ?? "Không tìm thấy";
  const load = useCallback(async () => {
    try {
      const result = await request(
        section === "calendar" || (section === "orders" && view === "calendar")
          ? `admin/calendar?from=${calendarRange.from}&to=${calendarRange.to}&q=${encodeURIComponent(query)}`
          : `admin/${section}${section === "orders" ? `?page=${page}&q=${encodeURIComponent(query)}` : ""}`,
      );
      setData(result);
      setError("");
    } catch (e) {
      setError((e as Error).message);
    }
  }, [section, page, query, view, calendarRange.from, calendarRange.to]);
  useEffect(() => {
    setData(null);
    setEditor(null);
    setPage(1);
    setQuery(searchParams.get("q") ?? "");
    setView(section === "calendar" ? "calendar" : "table");
  }, [section, searchParams]);
  useEffect(() => {
    const timer = setTimeout(load, 200);
    window.addEventListener("fleurious:sync", load);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("fleurious:sync", load);
    };
  }, [load]);
  async function save(entity: Row) {
    setBusy(true);
    try {
      const id = editor?.id;
      let payload = entity;
      if (section === "products" || section === "inventory") {
        payload = {
          name: entity.name,
          slug: entity.slug,
          subtitle: entity.subtitle,
          description: entity.description,
          category: entity.category,
          occasion: entity.occasion,
          color: entity.color,
          image: entity.image,
          badge: entity.badge ?? "",
          featured: entity.featured,
          active: entity.active,
          variants: entity.variants,
        };
      }
      await request(
        `admin/${section === "inventory" ? "products" : section === "members" ? "customers" : section}${id ? `/${id}` : ""}`,
        payload,
        id ? "PATCH" : "POST",
      );
      setEditor(null);
      await load();
      await refreshCatalog();
      toast("Đã lưu thay đổi.");
    } catch (e) {
      toast((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function archive(id: string) {
    if (
      !window.confirm("Ẩn mục này khỏi cửa hàng? Dữ liệu lịch sử vẫn được giữ.")
    )
      return;
    try {
      await request(`admin/${section}/${id}`, {}, "DELETE");
      await load();
      await refreshCatalog();
      toast("Đã ẩn mục.");
    } catch (e) {
      toast((e as Error).message);
    }
  }
  async function transition(order: Order, action: string) {
    if (action === "DELIVER") {
      setDeliveryOrder(order);
      return;
    }
    if (action === "MARK_PAID" || action === "REQUEST_REFUND") {
      setFinancialAction({
        order,
        mode: action === "MARK_PAID" ? "payment" : "refund",
      });
      return;
    }
    try {
      await request(
        `admin/orders/${order.id}`,
        { action, version: order.version },
        "PATCH",
      );
      await load();
      toast("Đã cập nhật tiến trình đơn.");
    } catch (e) {
      toast((e as Error).message);
      await load();
    }
  }
  const rows = (data?.rows ?? []) as Order[];
  useEffect(() => {
    if (data?.rows)
      setOrderDetail((current) =>
        current
          ? (data.rows.find((order: Order) => order.id === current.id) ??
            current)
          : null,
      );
  }, [data]);
  return (
    <>
      <main className="admin-main" id="main-content">
        <div className="admin-title">
          <div>
            <h1>
              {section === "overview" ? (
                <>
                  Một ngày đẹp, {name.split(" ").at(-1)}{" "}
                  <span style={{ color: "#a98763" }}>✧</span>
                </>
              ) : (
                title
              )}
            </h1>
            <p>
              {section === "overview"
                ? "Mỗi bó hoa là một câu chuyện. Cùng chăm chút những câu chuyện hôm nay."
                : "Mọi thay đổi được kiểm tra quyền và lưu theo giờ Hà Nội."}
            </p>
          </div>
          {[
            "products",
            "vouchers",
            "content",
            "delivery",
            "taxonomies",
          ].includes(section) && (
            <button
              className="button glass-primary"
              disabled={!data || busy}
              onClick={() =>
                setEditor(
                  section === "taxonomies" && taxonomyFilter !== "ALL"
                    ? { kind: taxonomyFilter }
                    : {},
                )
              }
            >
              <Plus size={16} />
              Thêm mới
            </button>
          )}
          {section === "orders" && canCreateOrder(role) && (
            <button
              type="button"
              onClick={() => setCreatingOrder(true)}
              className="button secondary"
            >
              <Plus size={15} />
              Đặt đơn
            </button>
          )}
        </div>
        {error ? (
          <div className="form-error" role="alert">
            {error}
            <button onClick={load} className="text-link">
              Tải lại
            </button>
          </div>
        ) : !data ? (
          <div className="page-loading">Đang mở góc làm việc…</div>
        ) : (
          <>
            {(section === "overview" || section === "analytics") && (
              <Overview
                data={data}
                analytics={section === "analytics"}
                role={role}
                collectionQuery={searchParams.get("collection") ?? ""}
              />
            )}
            {(section === "orders" || section === "calendar") && (
              <>
                <div className="admin-toolbar">
                  <div className="search-field">
                    <Search size={16} />
                    <input
                      aria-label="Tìm đơn"
                      placeholder="Tìm mã đơn, tên khách…"
                      value={query}
                      onChange={(e) => {
                        setQuery(e.target.value);
                        setPage(1);
                      }}
                    />
                  </div>
                  <div className="view-switch">
                    {[
                      { id: "table", label: "Danh sách", Icon: List },
                      { id: "kanban", label: "Kanban", Icon: LayoutGrid },
                      { id: "calendar", label: "Lịch", Icon: CalendarDays },
                    ].map((v) => (
                      <button
                        key={v.id}
                        className={view === v.id ? "active" : ""}
                        onClick={() => setView(v.id)}
                      >
                        <v.Icon size={14} />
                        {v.label}
                      </button>
                    ))}
                  </div>
                </div>
                {view === "table" ? (
                  <DataTable
                    rows={rows}
                    columns={orderColumns(transition, setOrderDetail, role)}
                  />
                ) : view === "kanban" ? (
                  <Kanban
                    orders={rows}
                    onTransition={transition}
                    onDetail={setOrderDetail}
                    role={role}
                  />
                ) : (
                  <Calendar
                    orders={rows}
                    onSelect={setOrderDetail}
                    onRange={(from, to) =>
                      setCalendarRange((old) =>
                        old.from === from && old.to === to ? old : { from, to },
                      )
                    }
                  />
                )}
                <div className="pagination">
                  <span>
                    {data.total} đơn ·{" "}
                    {view === "calendar"
                      ? "theo khoảng lịch · tối đa 1.000 đơn"
                      : `trang ${data.page} · tối đa 50 đơn/trang`}
                  </span>
                  <div>
                    <button
                      disabled={page <= 1 || view === "calendar"}
                      onClick={() => setPage(page - 1)}
                    >
                      Trước
                    </button>
                    <button
                      disabled={page * 50 >= data.total || view === "calendar"}
                      onClick={() => setPage(page + 1)}
                    >
                      Sau
                    </button>
                  </div>
                </div>
              </>
            )}
            {(section === "products" || section === "inventory") && (
              <>
                <div className="admin-notice">
                  Sản phẩm đã có đơn sẽ được ẩn thay vì xóa. Tồn không được thấp
                  hơn số lượng đang giữ.
                </div>
                <DataTable
                  rows={data}
                  columns={[
                    {
                      header: "Sản phẩm",
                      accessorKey: "name",
                      cell: ({ row }) => (
                        <div className="table-product">
                          <img src={row.original.image} alt="" />
                          <div>
                            <strong>{row.original.name}</strong>
                            <small>{row.original.slug}</small>
                          </div>
                        </div>
                      ),
                    },
                    { header: "Danh mục", accessorKey: "category" },
                    {
                      header: "Giá từ",
                      id: "price",
                      cell: ({ row }) =>
                        money(row.original.variants[0]?.price ?? 0),
                    },
                    {
                      header: "Khả dụng / đang giữ",
                      id: "stock",
                      cell: ({ row }) =>
                        `${row.original.variants.reduce((s: number, v: Row) => s + v.stock - v.reserved, 0)} / ${row.original.variants.reduce((s: number, v: Row) => s + v.reserved, 0)}`,
                    },
                    {
                      header: "Hiển thị",
                      accessorKey: "active",
                      cell: ({ row }) => (
                        <ProductVisibility
                          id={row.original.id}
                          name={row.original.name}
                          active={row.original.active}
                          onSaved={async () => {
                            await load();
                            await refreshCatalog();
                          }}
                        />
                      ),
                    },
                    {
                      header: "Thao tác",
                      id: "actions",
                      cell: ({ row }) => (
                        <div className="table-actions">
                          <button
                            onClick={() =>
                              setEditor({
                                ...row.original,
                                price: row.original.variants[0]?.price,
                                stock: row.original.variants[0]?.stock,
                              })
                            }
                          >
                            Chỉnh sửa
                          </button>
                        </div>
                      ),
                    },
                  ]}
                />
              </>
            )}
            {section === "members" && (
              <MembershipAdmin initial={data} role={role} onSaved={load} />
            )}
            {section === "customers" && (
              <>
                <div className="admin-notice">
                  Hội viên được dùng N đơn ưu đãi/tháng; hết lượt vẫn mua
                  thường.{" "}
                  <Link href="/admin/settings">Cấu hình quyền lợi →</Link>
                </div>
                <DataTable
                  rows={data}
                  columns={[
                    { header: "Khách hàng", accessorKey: "name" },
                    { header: "Email", accessorKey: "email" },
                    {
                      header: "Hạng",
                      accessorKey: "tier",
                      cell: ({ row }) =>
                        row.original.memberSince
                          ? row.original.tier
                          : "Khách thường",
                    },
                    {
                      header: "Đơn",
                      id: "orders",
                      cell: ({ row }) => row.original._count.orders,
                    },
                    {
                      header: "Lượt kỳ này",
                      id: "period",
                      cell: ({ row }) => {
                        const p = row.original.periods[0];
                        return p
                          ? `${p.consumed} dùng · ${p.reserved} giữ / ${p.limit}`
                          : "Chưa mở kỳ";
                      },
                    },
                    {
                      header: "Xác minh",
                      accessorKey: "verified",
                      cell: ({ getValue }) =>
                        getValue() ? "Đã xác minh" : "Chưa xác minh",
                    },
                    {
                      header: "Thao tác",
                      id: "actions",
                      cell: ({ row }) => (
                        <div className="table-actions">
                          <button
                            onClick={() =>
                              setEditor({ ...row.original, reason: "" })
                            }
                          >
                            Chỉnh sửa
                          </button>
                          {row.original.disabled && (
                            <span className="status-tag">Đã khóa</span>
                          )}
                        </div>
                      ),
                    },
                  ]}
                />
              </>
            )}
            {section === "streaks" && (
              <>
                <div className="admin-kpis">
                  <Kpi
                    label="QR đã tạo"
                    value={data.grants}
                    Icon={FlowerIcon}
                    note="Từ các đơn hàng"
                  />
                  <Kpi
                    label="Ngày đã ghi nhận"
                    value={data.days.length}
                    Icon={Flame}
                    note="100 ngày gần nhất"
                  />
                  <Kpi
                    label="Ưu đãi đã cấp"
                    value={data.rewards.length}
                    Icon={Gift}
                    note="100 phần thưởng gần nhất"
                  />
                  <Kpi
                    label="Ngân sách cam kết"
                    value={money(data.budget?.committed ?? 0)}
                    Icon={TicketPercent}
                    note="Tính theo trần voucher"
                  />
                </div>
                <div className="admin-notice">
                  Mốc liên tiếp và tích lũy tháng được tính riêng. Mỗi tài khoản
                  tối đa một ngày/ngày.{" "}
                  <Link href="/admin/settings">Cấu hình mốc thưởng →</Link>
                </div>
                <DataTable
                  rows={data.days}
                  columns={[
                    {
                      header: "Khách hàng",
                      id: "user",
                      cell: ({ row }) => row.original.user.name,
                    },
                    { header: "Ngày Hà Nội", accessorKey: "day" },
                    {
                      header: "Kỷ niệm",
                      accessorKey: "productName",
                      cell: ({ row }) => (
                        <div className="table-product">
                          <img src={row.original.image} alt="" />
                          {row.original.productName}
                        </div>
                      ),
                    },
                    {
                      header: "Tính thưởng",
                      accessorKey: "valid",
                      cell: ({ getValue }) =>
                        getValue() ? "Hợp lệ" : "Đã vô hiệu",
                    },
                  ]}
                />
                <div className="section-heading" style={{ marginTop: 30 }}>
                  <h2>Ưu đãi đã cấp</h2>
                </div>
                <DataTable
                  rows={data.rewards}
                  columns={[
                    {
                      header: "Khách",
                      id: "user",
                      cell: ({ row }) => row.original.user.name,
                    },
                    { header: "Phần thưởng", accessorKey: "title" },
                    {
                      header: "Trạng thái",
                      accessorKey: "status",
                      cell: ({ getValue }) =>
                        orderStatus[String(getValue())] ?? getValue(),
                    },
                    {
                      header: "Hạn",
                      accessorKey: "expiresAt",
                      cell: ({ getValue }) => humanDate(String(getValue())),
                    },
                  ]}
                />
              </>
            )}
            {section === "streaks" && (
              <RewardRuleManager
                rules={data.customRules ?? []}
                version={data.rulesVersion ?? 1}
                onSaved={load}
              />
            )}
            {section === "settings" && (
              <>
                <ShippingSettings
                  onSaved={async () => {
                    await load();
                    await refreshCatalog();
                  }}
                />
                <SepaySettings role={role} />
                <CardTemplates />
                <SettingsForm
                  data={data}
                  onSaved={async () => {
                    await load();
                    await refreshCatalog();
                  }}
                />
              </>
            )}
            {section === "vouchers" && (
              <DataTable
                rows={data}
                columns={[
                  { header: "Mã", accessorKey: "code" },
                  { header: "Ưu đãi", accessorKey: "title" },
                  {
                    header: "Giảm",
                    accessorKey: "percent",
                    cell: ({ getValue }) => `${getValue()}%`,
                  },
                  {
                    header: "Sử dụng / giới hạn",
                    id: "usage",
                    cell: ({ row }) =>
                      `${row.original.used} / ${row.original.limit}`,
                  },
                  {
                    header: "Hạn",
                    accessorKey: "expiresAt",
                    cell: ({ getValue }) => humanDate(String(getValue())),
                  },
                  {
                    header: "Thao tác",
                    id: "actions",
                    cell: ({ row }) => (
                      <div className="table-actions">
                        <button onClick={() => setEditor(row.original)}>
                          Sửa
                        </button>
                        <button onClick={() => archive(row.original.id)}>
                          Tắt
                        </button>
                      </div>
                    ),
                  },
                ]}
              />
            )}
            {section === "taxonomies" && (
              <>
                <div className="taxonomy-filters" aria-label="Nhóm danh mục">
                  {[["ALL", "Tất cả"], ...Object.entries(taxonomyLabels)].map(
                    ([kind, label]) => (
                      <button
                        type="button"
                        key={kind}
                        aria-pressed={taxonomyFilter === kind}
                        onClick={() => setTaxonomyFilter(kind)}
                      >
                        {label}
                      </button>
                    ),
                  )}
                </div>
                <DataTable
                  rows={data.filter(
                    (item: Row) =>
                      taxonomyFilter === "ALL" || item.kind === taxonomyFilter,
                  )}
                  columns={[
                    { header: "Tên", accessorKey: "name" },
                    {
                      header: "Loại",
                      accessorKey: "kind",
                      cell: ({ getValue }) =>
                        taxonomyLabels[
                          getValue() as keyof typeof taxonomyLabels
                        ] ?? String(getValue()),
                    },
                    { header: "Slug", accessorKey: "slug" },
                    {
                      header: "Hiển thị",
                      accessorKey: "active",
                      cell: ({ getValue }) => (getValue() ? "Đang dùng" : "Ẩn"),
                    },
                    {
                      header: "Thao tác",
                      id: "actions",
                      cell: ({ row }) => (
                        <div className="table-actions">
                          <button onClick={() => setEditor(row.original)}>
                            Sửa
                          </button>
                          <button onClick={() => archive(row.original.id)}>
                            Ẩn
                          </button>
                        </div>
                      ),
                    },
                  ]}
                />
              </>
            )}
            {section === "reviews" && (
              <DataTable
                rows={data}
                columns={[
                  { header: "Khách", accessorKey: "authorName" },
                  { header: "Sao", accessorKey: "rating" },
                  { header: "Nội dung", accessorKey: "body" },
                  { header: "Trạng thái", accessorKey: "status" },
                  {
                    header: "Duyệt",
                    id: "actions",
                    cell: ({ row }) => (
                      <div className="table-actions">
                        {["APPROVED", "REJECTED"].map((status) => (
                          <button
                            key={status}
                            onClick={async () => {
                              try {
                                await request(
                                  `admin/reviews/${row.original.id}`,
                                  { status },
                                  "PATCH",
                                );
                                await load();
                                toast("Đã cập nhật đánh giá.");
                              } catch (e) {
                                toast((e as Error).message);
                              }
                            }}
                          >
                            {status === "APPROVED" ? "Công khai" : "Ẩn"}
                          </button>
                        ))}
                      </div>
                    ),
                  },
                ]}
              />
            )}
            {section === "content" && (
              <DataTable
                rows={data}
                columns={[
                  { header: "Tiêu đề", accessorKey: "title" },
                  { header: "Loại", accessorKey: "kind" },
                  { header: "Đường dẫn", accessorKey: "slug" },
                  {
                    header: "Hiển thị",
                    accessorKey: "active",
                    cell: ({ getValue }) => (getValue() ? "Công khai" : "Ẩn"),
                  },
                  {
                    header: "Thao tác",
                    id: "actions",
                    cell: ({ row }) => (
                      <div className="table-actions">
                        <button onClick={() => setEditor(row.original)}>
                          Sửa
                        </button>
                        <button onClick={() => archive(row.original.id)}>
                          Ẩn
                        </button>
                      </div>
                    ),
                  },
                ]}
              />
            )}
            {section === "delivery" && (
              <>
                <p className="admin-notice">
                  Phí giao hoa được tính theo quãng đường Goong × giá/km.
                  <Link href="/admin/settings" className="text-link">
                    {" "}
                    Cài đặt phí giao hoa
                  </Link>
                </p>
                <div className="section-heading" style={{ marginTop: 30 }}>
                  <h2>Khung giờ & công suất</h2>
                </div>
                <DataTable
                  rows={data.slots}
                  columns={[
                    { header: "Khung giờ", accessorKey: "label" },
                    { header: "Công suất / ngày", accessorKey: "capacity" },
                    { header: "Giờ bắt đầu", accessorKey: "startHour" },
                    { header: "Giờ kết thúc", accessorKey: "endHour" },
                    {
                      header: "Thao tác",
                      id: "actions",
                      cell: ({ row }) => (
                        <button
                          className="text-link"
                          onClick={() =>
                            setEditor({ ...row.original, type: "slot" })
                          }
                        >
                          Chỉnh sửa
                        </button>
                      ),
                    },
                  ]}
                />
              </>
            )}
            {section === "payments" && (
              <>
                <div className="admin-notice">
                  {data.configured
                    ? "SePay đã có cấu hình tài khoản và khóa webhook."
                    : "SePay chưa được cấu hình."}{" "}
                  <Link href="/admin/settings#sepay" className="text-link">
                    Cài đặt ngân hàng & webhook
                  </Link>
                  <br />
                  Giao dịch lệch tiền, tới muộn hoặc không khớp mã được chuyển
                  đối soát.
                </div>
                <DataTable
                  rows={data.payments}
                  columns={[
                    { header: "SePay ID", accessorKey: "providerId" },
                    {
                      header: "Đơn",
                      id: "order",
                      cell: ({ row }) =>
                        row.original.order?.code ?? "Chưa khớp",
                    },
                    {
                      header: "Số tiền",
                      accessorKey: "amount",
                      cell: ({ getValue }) => money(Number(getValue())),
                    },
                    {
                      header: "Kết quả",
                      accessorKey: "state",
                      cell: ({ getValue }) =>
                        getValue() === "MATCHED" ? "Đã khớp" : "Cần đối soát",
                    },
                    {
                      header: "Nhận lúc",
                      accessorKey: "receivedAt",
                      cell: ({ getValue }) => humanDate(String(getValue())),
                    },
                  ]}
                />
                <div className="section-heading" style={{ marginTop: 30 }}>
                  <h2>Yêu cầu hoàn tiền</h2>
                </div>
                <DataTable
                  rows={data.refunds}
                  columns={[
                    {
                      header: "Đơn",
                      id: "order",
                      cell: ({ row }) => row.original.order.code,
                    },
                    {
                      header: "Số tiền",
                      accessorKey: "amount",
                      cell: ({ getValue }) => money(Number(getValue())),
                    },
                    {
                      header: "Trạng thái",
                      accessorKey: "status",
                      cell: ({ getValue }) =>
                        getValue() === "COMPLETED" ? "Đã hoàn" : "Chờ hoàn",
                    },
                    {
                      header: "Đối soát",
                      id: "action",
                      cell: ({ row }) =>
                        row.original.status === "COMPLETED" ? (
                          row.original.reference
                        ) : (
                          <button
                            className="text-link"
                            onClick={async () => {
                              const reference = window.prompt(
                                "Sau khi đã hoàn tiền qua ngân hàng, nhập mã giao dịch hoàn để đối soát:",
                              );
                              if (!reference) return;
                              try {
                                await request(
                                  `admin/refunds/${row.original.id}`,
                                  { reference },
                                  "PATCH",
                                );
                                await load();
                                toast("Đã ghi nhận hoàn tiền.");
                              } catch (e) {
                                toast((e as Error).message);
                              }
                            }}
                          >
                            Ghi nhận đã hoàn
                          </button>
                        ),
                    },
                  ]}
                />
              </>
            )}
            {section === "team" && (
              <>
                <div className="admin-notice">
                  Thêm quyền cho tài khoản đã đăng ký. Đổi quyền sẽ thu hồi
                  phiên đăng nhập hiện tại. Chỉ Owner có quyền thay đổi vai trò.
                </div>
                <DataTable
                  rows={data}
                  columns={[
                    { header: "Tên", accessorKey: "name" },
                    { header: "Email", accessorKey: "email" },
                    { header: "Vai trò", accessorKey: "role" },
                  ]}
                />
                <form
                  className="form-stack narrow-form"
                  style={{ marginTop: 25 }}
                  onSubmit={async (e) => {
                    e.preventDefault();
                    try {
                      await request(
                        "admin/team",
                        Object.fromEntries(new FormData(e.currentTarget)),
                      );
                      await load();
                      toast("Đã cập nhật quyền.");
                    } catch (e) {
                      toast((e as Error).message);
                    }
                  }}
                >
                  <label>
                    Email tài khoản
                    <input type="email" name="email" required />
                  </label>
                  <label>
                    Vai trò
                    <Select name="role">
                      {[
                        "MANAGER",
                        "FLORIST",
                        "DELIVERY",
                        "MARKETING",
                        "ACCOUNTANT",
                        "CUSTOMER",
                      ].map((r) => (
                        <option key={r}>{r}</option>
                      ))}
                    </Select>
                  </label>
                  <button className="button">Cập nhật quyền</button>
                </form>
              </>
            )}
            {(section === "audit" || section === "jobs") && (
              <>
                <div className="admin-notice">
                  {section === "jobs"
                    ? `${data.unsent} sự kiện chờ gửi. Scheduler gọi POST /api/internal/jobs/cleanup bằng Bearer CRON_SECRET. Worker thực thi sau khi nhận.`
                    : "Nhật ký thay đổi quan trọng: cấu hình, sản phẩm, đơn hàng và phân quyền."}
                </div>
                <div className="audit-list">
                  {(section === "jobs" ? data.jobs : data).map((r: Row) => (
                    <div className="audit-entry" key={r.id}>
                      <strong>
                        {r.action ?? r.name} {r.status ? `· ${r.status}` : ""}
                      </strong>
                      <p>
                        {humanDate(r.createdAt)} · {r.entityId ?? r.id}
                      </p>
                      <details>
                        <summary>Chi tiết</summary>
                        <pre>
                          {typeof r.detail === "string"
                            ? r.detail
                            : JSON.stringify(r.detail, null, 2)}
                        </pre>
                      </details>
                    </div>
                  ))}
                  {(section === "jobs" ? data.jobs : data).length === 0 && (
                    <p className="muted">Chưa có bản ghi.</p>
                  )}
                </div>
              </>
            )}
          </>
        )}
        {creatingOrder && (
          <AdminOrderCreate
            onClose={() => setCreatingOrder(false)}
            onSaved={async (order) => {
              setCreatingOrder(false);
              if (
                order.paymentMethod === "SEPAY" &&
                ["UNPAID", "PENDING"].includes(order.paymentStatus)
              )
                setPaymentShareId(order.id);
              setQuery("");
              setPage(1);
              await load();
              await refreshCatalog();
              toast(
                `Đã tạo đơn ${order.code}. Tiến trình đã đồng bộ với Kanban.`,
              );
            }}
          />
        )}
        {paymentShareId && (
          <Modal
            title="QR chuyển khoản gửi khách"
            onClose={() => setPaymentShareId(null)}
          >
            <AdminPaymentShare orderId={paymentShareId} />
          </Modal>
        )}
        {editor && (
          <Modal
            title={editor.id ? "Chăm chút lại một chút" : "Thêm một điều mới"}
            onClose={() => setEditor(null)}
          >
            {section === "products" || section === "inventory" ? (
              <ProductEditor initial={editor} onSave={save} busy={busy} />
            ) : (
              <EntityForm
                section={section}
                initial={editor}
                onSave={save}
                busy={busy}
              />
            )}
          </Modal>
        )}
        {orderDetail && (
          <Modal
            title={orderDetail.code}
            className="admin-order-modal"
            eyebrow="CHI TIẾT ĐƠN HÀNG"
            onClose={() => setOrderDetail(null)}
          >
            <div className="admin-order-detail">
              <div className="detail-overview">
                <div className="detail-statuses">
                  <span
                    className={`status-tag ${orderDetail.status === "COMPLETED" ? "success" : ""}`}
                  >
                    {isOrderExpired(orderDetail)
                      ? "Hết hạn"
                      : orderStatus[
                          orderDetail.status === "PENDING" ||
                          stoppedOrderStatuses.includes(orderDetail.status)
                            ? orderDetail.status
                            : orderDetail.fulfillment
                        ]}
                  </span>
                  <span className="order-channel">
                    {orderChannels[orderDetail.source ?? "WEBSITE"]}
                  </span>
                </div>
                <time dateTime={orderDetail.createdAt}>
                  Tạo lúc {humanDate(orderDetail.createdAt)} · Hà Nội
                </time>
              </div>
              <div className="detail-layout">
                <div className="detail-main">
                  <section className="detail-panel detail-products">
                    <div className="detail-panel-heading">
                      <h3>Sản phẩm trong đơn</h3>
                      <span>
                        {orderDetail.items.reduce(
                          (total, item) => total + item.quantity,
                          0,
                        )}{" "}
                        sản phẩm
                      </span>
                    </div>
                    <div className="detail-product-list">
                      {orderDetail.items.map((item) => (
                        <article className="detail-product" key={item.id}>
                          <img
                            src={item.image}
                            alt={item.name}
                            width={64}
                            height={80}
                          />
                          <div>
                            <h4>{item.name}</h4>
                            <p>
                              {item.variantName} <span>× {item.quantity}</span>
                            </p>
                            <small>{money(item.price)} / sản phẩm</small>
                          </div>
                          <strong>{money(item.price * item.quantity)}</strong>
                        </article>
                      ))}
                    </div>
                  </section>
                  <section className="detail-panel">
                    <div className="detail-panel-heading">
                      <h3>Người mua & người nhận</h3>
                    </div>
                    <div className="detail-contacts">
                      <div>
                        <span className="detail-label">Người mua</span>
                        <strong>{orderDetail.buyerName}</strong>
                        {orderDetail.buyerEmail ? (
                          <a href={`mailto:${orderDetail.buyerEmail}`}>
                            {orderDetail.buyerEmail}
                          </a>
                        ) : (
                          <span className="muted">Chưa có email</span>
                        )}
                      </div>
                      <div>
                        <span className="detail-label">Người nhận hoa</span>
                        <strong>{orderDetail.recipientName}</strong>
                        {orderDetail.recipientPhone && (
                          <a href={`tel:${orderDetail.recipientPhone}`}>
                            {orderDetail.recipientPhone}
                          </a>
                        )}
                      </div>
                    </div>
                  </section>
                  <section className="detail-panel detail-delivery">
                    <div className="detail-panel-heading">
                      <h3>Thông tin giao hoa</h3>
                      <span>Hà Nội · UTC+7</span>
                    </div>
                    <dl className="detail-delivery-grid">
                      <div>
                        <dt>Ngày giao</dt>
                        <dd>
                          {orderDetail.deliveryDay
                            .split("-")
                            .reverse()
                            .join("/")}
                        </dd>
                      </div>
                      <div>
                        <dt>Khung giờ</dt>
                        <dd>{orderDetail.slotLabel}</dd>
                      </div>
                      <div className="detail-address">
                        <dt>Địa chỉ nhận hoa</dt>
                        <dd>{orderDetail.address || "—"}</dd>
                      </div>
                    </dl>
                    {["OWNER", "MANAGER"].includes(role) &&
                      !["COMPLETED", ...stoppedOrderStatuses].includes(
                        orderDetail.status,
                      ) && (
                        <form
                          className="form-stack detail-assignment-form"
                          onSubmit={async (e) => {
                            e.preventDefault();
                            try {
                              await request(
                                `admin/orders/${orderDetail.id}/assign`,
                                {
                                  assignee: new FormData(e.currentTarget).get(
                                    "assignee",
                                  ),
                                  version: orderDetail.version,
                                },
                                "PATCH",
                              );
                              setOrderDetail(null);
                              await load();
                              toast("Đã phân công người phụ trách.");
                            } catch (e) {
                              toast((e as Error).message);
                            }
                          }}
                        >
                          <label>
                            Người phụ trách
                            <Select
                              name="assignee"
                              defaultValue={orderDetail.assignee ?? ""}
                            >
                              <option value="">Chưa phân công</option>
                              {staff.map((s) => (
                                <option key={s.id} value={s.id}>
                                  {s.name} · {s.role}
                                </option>
                              ))}
                            </Select>
                          </label>
                          <button className="button secondary">
                            Lưu phân công
                          </button>
                        </form>
                      )}

                    {(!["OWNER", "MANAGER"].includes(role) ||
                      ["COMPLETED", ...stoppedOrderStatuses].includes(
                        orderDetail.status,
                      )) && (
                      <div className="detail-assignee">
                        <span className="detail-label">Người phụ trách</span>
                        <strong>
                          {staff.find(
                            (member) => member.id === orderDetail.assignee,
                          )?.name ??
                            (orderDetail.assignee
                              ? "Đã phân công"
                              : "Chưa phân công")}
                        </strong>
                      </div>
                    )}
                    {["OWNER", "MANAGER"].includes(role) &&
                      !["COMPLETED", ...stoppedOrderStatuses].includes(
                        orderDetail.status,
                      ) && (
                        <details className="detail-disclosure">
                          <summary>Đổi lịch giao</summary>
                          <form
                            className="form-stack detail-disclosure-form"
                            onSubmit={async (e) => {
                              e.preventDefault();
                              const form = new FormData(e.currentTarget);
                              try {
                                await request(
                                  `admin/orders/${orderDetail.id}/delivery`,
                                  {
                                    day: form.get("day"),
                                    slotId: form.get("slotId"),
                                    version: orderDetail.version,
                                    customerAgreed: form.has("agreed"),
                                    reason: form.get("reason"),
                                  },
                                  "PATCH",
                                );
                                setOrderDetail(null);
                                await load();
                                toast("Đã cập nhật lịch giao.");
                              } catch (e) {
                                toast((e as Error).message);
                              }
                            }}
                          >
                            <label>
                              Ngày giao
                              <input
                                name="day"
                                type="date"
                                defaultValue={orderDetail.deliveryDay}
                                min={dayKey()}
                                required
                              />
                            </label>
                            <label>
                              Khung giờ
                              <Select
                                name="slotId"
                                defaultValue={
                                  slots.find(
                                    (slot) =>
                                      slot.label === orderDetail.slotLabel,
                                  )?.id ?? slots[0]?.id
                                }
                              >
                                {slots.map((s) => (
                                  <option key={s.id} value={s.id}>
                                    {s.label}
                                  </option>
                                ))}
                              </Select>
                            </label>
                            <label>
                              Lý do
                              <input name="reason" required minLength={4} />
                            </label>
                            <label className="checkbox-label">
                              <input name="agreed" type="checkbox" required />
                              Khách đã đồng ý thay đổi lịch
                            </label>
                            <button className="button secondary">
                              Lưu lịch giao
                            </button>
                          </form>
                        </details>
                      )}
                  </section>
                  <section className="detail-panel detail-notes">
                    <div className="detail-panel-heading">
                      <h3>Lời nhắn & ghi chú</h3>
                    </div>
                    <p className="small muted">
                      {cardWritingLabels[orderDetail.cardWritingMode ?? "AUTO"]}
                      {orderDetail.cardWritingMode === "HANDWRITTEN"
                        ? " · Lời nhắn dưới đây dành để viết tay, không in lên ảnh thiệp."
                        : " · Lời nhắn được in sẵn trên thiệp."}
                    </p>
                    {orderDetail.cardMessage && (
                      <div>
                        <span className="detail-label">
                          {orderDetail.cardWritingMode === "HANDWRITTEN"
                            ? "Lời nhắn cần viết tay"
                            : "Lời nhắn trên thiệp"}
                        </span>
                        <blockquote>{orderDetail.cardMessage}</blockquote>
                      </div>
                    )}
                    {orderDetail.note && (
                      <div className="detail-florist-note">
                        <span className="detail-label">
                          Ghi chú cho cửa hàng
                        </span>
                        <p>{orderDetail.note}</p>
                      </div>
                    )}
                    {!orderDetail.cardMessage && !orderDetail.note && (
                      <p className="muted">
                        Đơn chưa có lời nhắn hoặc ghi chú.
                      </p>
                    )}
                  </section>
                  <details className="detail-panel detail-history">
                    <summary>
                      <span>Lịch sử đơn hàng</span>
                      <small>{orderDetail.history?.length ?? 0} cập nhật</small>
                    </summary>
                    <ol className="detail-timeline">
                      {[...(orderDetail.history ?? [])]
                        .sort(
                          (a, b) =>
                            Date.parse(a.createdAt) - Date.parse(b.createdAt),
                        )
                        .map((entry) => (
                          <li key={entry.id}>
                            <p>{entry.text}</p>
                            <time dateTime={entry.createdAt}>
                              {humanDate(entry.createdAt)}
                            </time>
                          </li>
                        ))}
                    </ol>
                    {!orderDetail.history?.length && (
                      <p className="muted">Chưa có cập nhật.</p>
                    )}
                  </details>
                </div>
                <aside className="detail-aside">
                  <section className="detail-panel detail-billing">
                    <div className="detail-panel-heading">
                      <h3>Thanh toán</h3>
                      <span>
                        {orderDetail.paymentMethod === "SEPAY"
                          ? "SePay"
                          : "Tiền mặt / COD"}
                      </span>
                    </div>
                    <dl className="detail-totals">
                      <div>
                        <dt>Tiền hoa</dt>
                        <dd>{money(orderDetail.subtotal)}</dd>
                      </div>
                      <div className="detail-discount">
                        <dt>
                          Ưu đãi
                          {orderDetail.discountLabel && (
                            <small>{orderDetail.discountLabel}</small>
                          )}
                        </dt>
                        <dd>−{money(orderDetail.discount)}</dd>
                      </div>
                      <div>
                        <dt>Phí giao hoa</dt>
                        <dd>{money(orderDetail.deliveryFee)}</dd>
                      </div>
                      <div className="detail-total">
                        <dt>Tổng thanh toán</dt>
                        <dd>{money(orderDetail.total)}</dd>
                      </div>
                    </dl>
                    {orderDetail.shippingSnapshot && (
                      <ShippingSummary
                        snapshot={orderDetail.shippingSnapshot}
                      />
                    )}
                    <div className="detail-action-field">
                      <span className="detail-label">
                        Trạng thái thanh toán
                      </span>
                      <OrderPaymentControl
                        order={orderDetail}
                        role={role}
                        onTransition={transition}
                      />
                    </div>
                    <div className="detail-action-field">
                      <span className="detail-label">Cập nhật tiến trình</span>
                      <OrderAction
                        order={orderDetail}
                        onTransition={async (o, a) => {
                          await transition(o, a);
                          setOrderDetail(null);
                        }}
                        role={role}
                      />
                    </div>
                    {collectionFinance(role) &&
                      orderDetail.paymentMethod === "COD" && (
                        <CollectionOrderDetails orderId={orderDetail.id} />
                      )}
                    {canCreateOrder(role) &&
                      orderDetail.paymentMethod === "SEPAY" &&
                      ["UNPAID", "PENDING"].includes(
                        orderDetail.paymentStatus,
                      ) &&
                      !stoppedOrderStatuses.includes(orderDetail.status) &&
                      !isOrderExpired(orderDetail) && (
                        <details className="detail-disclosure detail-payment-qr">
                          <summary>Xem QR thanh toán</summary>
                          <AdminOrderQr order={orderDetail} />
                        </details>
                      )}
                    {["OWNER", "MANAGER"].includes(role) &&
                      !stoppedOrderStatuses.includes(orderDetail.status) &&
                      ["PAID", "PARTIALLY_REFUNDED"].includes(
                        orderDetail.paymentStatus,
                      ) && (
                        <details className="detail-disclosure">
                          <summary>
                            Đề nghị hoàn tiền một phần / toàn bộ
                          </summary>
                          <form
                            className="form-stack detail-disclosure-form"
                            onSubmit={async (e) => {
                              e.preventDefault();
                              const form = new FormData(e.currentTarget);
                              try {
                                await request(
                                  `admin/orders/${orderDetail.id}/refunds`,
                                  {
                                    version: orderDetail.version,
                                    amount: Number(form.get("amount")),
                                    merchandiseAmount: Number(
                                      form.get("merchandiseAmount"),
                                    ),
                                    reason: form.get("reason"),
                                  },
                                );
                                setOrderDetail(null);
                                await load();
                                toast(
                                  "Đã tạo yêu cầu. Hoàn qua ngân hàng rồi ghi mã đối soát tại Thanh toán.",
                                );
                              } catch (e) {
                                toast((e as Error).message);
                              }
                            }}
                          >
                            <label>
                              Phần hoàn thuộc tiền hoa (VND)
                              <input
                                name="merchandiseAmount"
                                type="number"
                                min="0"
                                max={
                                  orderDetail.subtotal - orderDetail.discount
                                }
                                defaultValue="0"
                                required
                              />
                              <small>
                                Nhập 0 nếu chỉ hoàn phí giao. Phần này được trừ
                                khỏi chi tiêu lên hạng khi hoàn tất.
                              </small>
                            </label>
                            <label>
                              Số tiền hoàn (VND)
                              <input
                                type="number"
                                name="amount"
                                min={1}
                                max={orderDetail.total}
                                required
                              />
                            </label>
                            <label>
                              Lý do
                              <input name="reason" minLength={4} required />
                            </label>
                            <button className="button secondary">
                              Tạo yêu cầu hoàn
                            </button>
                          </form>
                        </details>
                      )}
                  </section>
                  {["OWNER", "MANAGER", "FLORIST"].includes(role) && (
                    <details className="detail-panel detail-print-card">
                      <summary>
                        <span>Thiệp & QR giữ chuỗi</span>
                        <small>Tải card để in kèm hoa</small>
                      </summary>
                      <OrderCard id={orderDetail.id} />
                    </details>
                  )}
                </aside>
              </div>
            </div>
          </Modal>
        )}
        {deliveryOrder && (
          <DeliveryDialog
            order={deliveryOrder}
            role={role}
            onClose={() => setDeliveryOrder(null)}
            onSaved={async () => {
              setDeliveryOrder(null);
              setOrderDetail(null);
              await load();
              toast("Đã cập nhật giao hàng và thu tiền.");
            }}
          />
        )}
        {financialAction && (
          <OrderFinancialDialog
            order={financialAction.order}
            mode={financialAction.mode}
            onClose={() => setFinancialAction(null)}
            onSaved={async () => {
              setFinancialAction(null);
              setOrderDetail(null);
              await load();
              await refresh();
              toast(
                financialAction.mode === "payment"
                  ? "Đã xác nhận thanh toán. Đơn đã nhận tiền chỉ có thể hoàn tiền, không hủy."
                  : "Đã chuyển đơn sang chờ hoàn tiền. Hoàn qua ngân hàng rồi đối soát tại Thanh toán SePay.",
              );
            }}
          />
        )}
      </main>
    </>
  );
}
function DataTable({
  rows,
  columns,
}: {
  rows: Row[];
  columns: ColumnDef<Row>[];
}) {
  const table = useReactTable({
    data: rows,
    columns,
    getCoreRowModel: getCoreRowModel(),
  });
  return (
    <div className="data-table-wrap">
      <table className="data-table">
        <thead>
          {table.getHeaderGroups().map((h) => (
            <tr key={h.id}>
              {h.headers.map((c) => (
                <th key={c.id}>
                  {flexRender(c.column.columnDef.header, c.getContext())}
                </th>
              ))}
            </tr>
          ))}
        </thead>
        <tbody>
          {table.getRowModel().rows.map((r) => (
            <tr key={r.id}>
              {r.getVisibleCells().map((c) => (
                <td key={c.id}>
                  {flexRender(c.column.columnDef.cell, c.getContext())}
                </td>
              ))}
            </tr>
          ))}
          {!rows.length && (
            <tr>
              <td
                colSpan={columns.length}
                style={{ textAlign: "center", padding: 45, color: "#8b7873" }}
              >
                Chưa có dữ liệu ở đây.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
function Kpi({
  label,
  value,
  Icon,
  note,
}: {
  label: string;
  value: ReactNode;
  Icon: React.ComponentType<{ size?: number }>;
  note: string;
}) {
  return (
    <div className="kpi-card">
      <div>
        <span>{label}</span>
        <Icon size={19} />
      </div>
      <strong>{value}</strong>
      <small>{note}</small>
    </div>
  );
}
function Overview({
  data,
  analytics,
  role,
  collectionQuery,
}: {
  data: Row;
  analytics: boolean;
  role: string;
  collectionQuery: string;
}) {
  const orders = data.orders as Order[];
  const today = orders.filter(
    (o) =>
      o.deliveryDay === data.today && !stoppedOrderStatuses.includes(o.status),
  );
  const days = Array.from({ length: 7 }, (_, i) => shiftDay(dayKey(), i - 6));
  const values = days.map((d) =>
    orders
      .filter((o) => dayKey(new Date(o.createdAt)) === d)
      .reduce((s, o) => s + (o.netPaid ?? 0), 0),
  );
  const max = Math.max(...values, 1);
  const points = values
    .map((v, i) => `${i * 100},${160 - (v / max) * 130}`)
    .join(" ");
  return (
    <>
      <div className="admin-kpis">
        <Kpi
          label="Tiền nhận ròng"
          value={money(data.revenue)}
          Icon={CreditCard}
          note={`Trong ${data.reportScope}`}
        />
        <Kpi
          label="Đơn giao hôm nay"
          value={today.length}
          Icon={ShoppingBag}
          note={`${today.filter((o) => o.fulfillment === "DELIVERED").length} đơn đã giao`}
        />
        <Kpi
          label="Khách hàng"
          value={data.users}
          Icon={Users}
          note="Tài khoản trong cửa hàng"
        />
        <Kpi
          label="Ưu đãi đã cấp"
          value={data.rewards}
          Icon={Gift}
          note={`Đã giảm ${money(data.discount)} trên đơn đã trả`}
        />
      </div>
      {!analytics && collectionFinance(role) && (
        <CollectionsPanel role={role} initialQuery={collectionQuery} />
      )}
      {data.paymentReviews > 0 && (
        <div className="admin-notice">
          {data.paymentReviews} giao dịch SePay cần đối soát.{" "}
          <Link href="/admin/payments">Xem giao dịch →</Link>
        </div>
      )}
      <div className="admin-two-columns">
        <section className="admin-panel">
          <div className="panel-heading">
            <h2>Nhịp hoa trong tuần</h2>
            <span>Tiền nhận theo ngày tạo đơn</span>
          </div>
          <svg
            className="revenue-chart"
            viewBox="0 0 600 180"
            role="img"
            aria-label={`Doanh thu 7 ngày: ${values.map((v) => money(v)).join(", ")}`}
          >
            <defs>
              <linearGradient id="chart-fill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#6e1423" stopOpacity=".17" />
                <stop offset="100%" stopColor="#6e1423" stopOpacity="0" />
              </linearGradient>
            </defs>
            {[30, 75, 120, 160].map((y) => (
              <line
                key={y}
                x1="0"
                x2="600"
                y1={y}
                y2={y}
                stroke="#e9ddd0"
                strokeDasharray="4 5"
              />
            ))}
            <polygon
              points={`0,180 ${points} 600,180`}
              fill="url(#chart-fill)"
            />
            <polyline
              points={points}
              fill="none"
              stroke="#6e1423"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            {values.map((v, i) => (
              <circle
                key={i}
                cx={i * 100}
                cy={160 - (v / max) * 130}
                r="4"
                fill="#fffdf9"
                stroke="#6e1423"
                strokeWidth="2"
              />
            ))}
          </svg>
          <div className="chart-labels">
            {days.map((d) => (
              <span key={d}>
                {d.slice(8)}/{d.slice(5, 7)}
              </span>
            ))}
          </div>
        </section>
        <section className="admin-panel">
          <div className="panel-heading">
            <h2>Hoa cần chăm chút hôm nay</h2>
            <Link href="/admin/calendar">
              Mở lịch <ArrowUpRight size={12} />
            </Link>
          </div>
          {today.slice(0, 4).map((o) => (
            <div className="task-preview" key={o.id}>
              <span>
                <FlowerIcon size={17} />
              </span>
              <div>
                <strong>{o.buyerName}</strong>
                <p>
                  {o.items[0]?.name} · {orderStatus[o.fulfillment]}
                </p>
              </div>
              <small>{money(o.total)}</small>
            </div>
          ))}
          {!today.length && (
            <div
              className="empty-state"
              style={{ minHeight: 180, padding: "25px 10px" }}
            >
              <Leaf size={28} />
              <p>
                Chưa có đơn giao hôm nay.
                <br />
                Một chút yên bình trước những mùa hoa.
              </p>
            </div>
          )}
        </section>
      </div>
      <section className="admin-panel">
        <div className="panel-heading">
          <h2>{analytics ? "Tiến trình vận hành" : "Những đơn hoa gần đây"}</h2>
          <Link href="/admin/orders">
            Xem tất cả <ArrowUpRight size={12} />
          </Link>
        </div>
        {analytics ? (
          <>
            {[
              "UNASSIGNED",
              "PREPARING",
              "READY",
              "OUT_FOR_DELIVERY",
              "DELIVERED",
            ].map((s) => {
              const count = orders.filter(
                (o) =>
                  o.fulfillment === s &&
                  !stoppedOrderStatuses.includes(o.status),
              ).length;
              return (
                <div className="metric-bar" key={s}>
                  <span>{orderStatus[s]}</span>
                  <div>
                    <span
                      style={{
                        width: `${(count / Math.max(orders.length, 1)) * 100}%`,
                      }}
                    />
                  </div>
                  <strong>{count}</strong>
                </div>
              );
            })}
            <p className="small muted">
              Báo cáo phạm vi {data.reportScope}. Số liệu trên lấy trực tiếp từ
              MySQL, đã trừ khoản hoàn đối soát; không tính giao dịch SePay chưa
              khớp.{" "}
              {data.analyticsEnabled
                ? "Adapter GA4/PostHog chỉ gửi sự kiện khi khách đồng ý."
                : "Chưa cấu hình khóa GA4/PostHog."}
            </p>
          </>
        ) : (
          <DataTable
            rows={orders.slice(0, 5)}
            columns={[
              { header: "Mã đơn", accessorKey: "code" },
              { header: "Khách hàng", accessorKey: "buyerName" },
              { header: "Ngày giao", accessorKey: "deliveryDay" },
              {
                header: "Giá trị",
                accessorKey: "total",
                cell: ({ getValue }) => money(Number(getValue())),
              },
              {
                header: "Tiến trình",
                accessorKey: "fulfillment",
                cell: ({ getValue }) => (
                  <span className="status-tag">
                    {orderStatus[String(getValue())]}
                  </span>
                ),
              },
            ]}
          />
        )}
      </section>
    </>
  );
}
const actionsFor = orderActions;

function AdminOrderQr({ order }: { order: Order }) {
  return <AdminPaymentShare orderId={order.id} />;
}

function OrderPaymentControl({
  order,
  role,
  onTransition,
  compact = false,
}: {
  order: Order;
  role: string;
  onTransition: (order: Order, action: string) => Promise<void>;
  compact?: boolean;
}) {
  const finance = collectionFinance(role);
  const editable =
    finance &&
    !isOrderExpired(order) &&
    !stoppedOrderStatuses.includes(order.status) &&
    ["UNPAID", "PENDING"].includes(order.paymentStatus);
  return (
    <div className={`order-payment-control ${compact ? "compact" : ""}`}>
      {editable ? (
        <Select
          aria-label={`Thanh toán ${order.code}`}
          value={order.paymentStatus}
          onChange={(e) => {
            if (e.target.value === "MARK_PAID")
              onTransition(order, "MARK_PAID");
          }}
        >
          <option value={order.paymentStatus}>
            {orderStatus[order.paymentStatus]}
          </option>
          <option value="MARK_PAID">Xác nhận đã thanh toán</option>
        </Select>
      ) : (
        <span
          className={`status-tag ${order.paymentStatus === "PAID" ? "success" : ""}`}
        >
          {orderStatus[order.paymentStatus]}
        </span>
      )}
      {(order.refundPendingAmount ?? 0) > 0 && !compact && (
        <small>Chờ hoàn {money(order.refundPendingAmount!)}</small>
      )}
      {order.receivable?.state === "OPEN" && (
        <small className="collection-badge">
          {order.receivable.kind === "SHIPPER"
            ? "Chờ shipper bàn giao"
            : "Đã giao · Chưa thu tiền"}
        </small>
      )}
      {order.manualPayment &&
        ["UNPAID", "PENDING"].includes(order.paymentStatus) &&
        isPaymentOverdue(order) && (
          <small className="form-error">
            Quá hạn thanh toán · Cần đối soát nếu đã chuyển tiền
          </small>
        )}
      {(order.refundedAmount ?? 0) > 0 && (
        <small>Đã hoàn {money(order.refundedAmount!)}</small>
      )}
    </div>
  );
}
function OrderFinancialDialog({
  order,
  mode,
  onClose,
  onSaved,
}: {
  order: Order;
  mode: "payment" | "refund";
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const remaining = Math.max(
    0,
    order.total -
      (order.refundedAmount ?? 0) -
      (order.refundPendingAmount ?? 0),
  );
  return (
    <Modal
      title={
        mode === "payment"
          ? "Xác nhận đã thanh toán"
          : "Dừng đơn & yêu cầu hoàn tiền"
      }
      onClose={onClose}
    >
      <form
        className="form-stack order-financial-form"
        onSubmit={async (e) => {
          e.preventDefault();
          const form = new FormData(e.currentTarget);
          setBusy(true);
          setError("");
          try {
            if (mode === "payment")
              await request(
                `admin/orders/${order.id}/payment`,
                {
                  version: order.version,
                  reason: form.get("reason"),
                  reference: form.get("reference"),
                },
                "PATCH",
              );
            else
              await request(`admin/orders/${order.id}/stop-refund`, {
                version: order.version,
                reason: form.get("reason"),
              });
            await onSaved();
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <p>
          <strong>{order.code}</strong> · {order.buyerName}
        </p>
        <div className="admin-notice">
          {mode === "payment" ? (
            <>
              Xác nhận đã thực nhận đủ <strong>{money(order.total)}</strong>.
              Thao tác có nhật ký và không tự gọi chuyển tiền ngân hàng.
            </>
          ) : (
            <>
              Yêu cầu hoàn thêm <strong>{money(remaining)}</strong>
              {(order.refundPendingAmount ?? 0) > 0
                ? `, ngoài ${money(order.refundPendingAmount!)} đang chờ hoàn`
                : ""}
              . Đơn dừng chuẩn bị/giao, QR giữ chuỗi bị thu hồi. Trạng thái chỉ
              thành Đã hoàn tiền sau khi đối soát giao dịch hoàn tại mục Thanh
              toán SePay.
              {order.fulfillment === "DELIVERED"
                ? " Hoa đã giao sẽ không tự cộng lại vào tồn kho."
                : " Các hàng đang giữ được giải phóng."}
            </>
          )}
        </div>
        {mode === "payment" && (
          <label>
            Mã giao dịch / phiếu thu
            <input
              name="reference"
              required
              minLength={4}
              maxLength={100}
              autoComplete="off"
              placeholder="Mã giao dịch ngân hàng hoặc phiếu thu tiền mặt"
            />
          </label>
        )}
        <label>
          {mode === "payment"
            ? "Ghi chú xác minh nhận tiền"
            : "Lý do hoàn tiền"}
          <textarea name="reason" required minLength={4} maxLength={300} />
        </label>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <div className="order-financial-actions">
          <button
            type="button"
            className="button secondary"
            onClick={onClose}
            disabled={busy}
          >
            Đóng
          </button>
          <button className="button" disabled={busy}>
            {busy
              ? "Đang lưu…"
              : mode === "payment"
                ? "Xác nhận đã nhận đủ tiền"
                : "Tạo yêu cầu hoàn & dừng đơn"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
function OrderAction({
  order,
  onTransition,
  role,
}: {
  order: Order;
  onTransition: (order: Order, action: string) => Promise<void>;
  role: string;
}) {
  const { user } = useShop();
  const actions =
    role === "DELIVERY" && order.assignee !== user?.id
      ? []
      : actionsFor(order, role);
  if (!actions.length)
    return (
      <span className="small muted">
        {isOrderExpired(order) ? "Hết hạn" : orderStatus[order.status]}
      </span>
    );
  return (
    <Select
      aria-label={`Chuyển trạng thái ${order.code}`}
      value=""
      onChange={(e) => {
        const action = e.target.value;
        if (
          action === "CANCEL" &&
          !window.confirm("Hủy đơn chưa thanh toán và giải phóng các lượt giữ?")
        )
          return;
        onTransition(order, action);
      }}
    >
      <option value="">Chuyển trạng thái…</option>
      {actions.map((a) => (
        <option value={a.value} key={a.value}>
          {a.label}
        </option>
      ))}
    </Select>
  );
}
function orderColumns(
  onTransition: (o: Order, a: string) => Promise<void>,
  onDetail: (o: Order) => void,
  role: string,
): ColumnDef<Row>[] {
  return [
    {
      header: "Đơn hoa",
      accessorKey: "code",
      cell: ({ row }) => (
        <div className="order-code-cell">
          <span className="order-code-with-copy">
            <button
              className="text-link"
              onClick={() => onDetail(row.original as Order)}
            >
              {row.original.code}
            </button>
            <CopyButton value={row.original.code} />
          </span>
          <small className="order-channel">
            {
              orderChannels[
                (row.original.source ?? "WEBSITE") as keyof typeof orderChannels
              ]
            }
          </small>
        </div>
      ),
    },
    { header: "Khách hàng", accessorKey: "buyerName" },
    {
      header: "Hoa",
      id: "items",
      cell: ({ row }) => (
        <div className="table-product">
          <img src={row.original.items[0]?.image} alt="" />
          <div>
            <strong>{row.original.items[0]?.name}</strong>
            <small>{row.original.items.length} sản phẩm</small>
          </div>
        </div>
      ),
    },
    {
      header: "Giao hoa",
      accessorKey: "deliveryDay",
      cell: ({ row }) => (
        <div>
          {row.original.deliveryDay}
          <br />
          <small>{row.original.slotLabel}</small>
        </div>
      ),
    },
    {
      header: "Giá trị",
      accessorKey: "total",
      cell: ({ getValue }) => money(Number(getValue())),
    },
    {
      header: "Thanh toán",
      accessorKey: "paymentStatus",
      cell: ({ row }) => (
        <OrderPaymentControl
          order={row.original as Order}
          role={role}
          onTransition={onTransition}
        />
      ),
    },
    {
      header: "Tiến trình",
      accessorKey: "fulfillment",
      cell: ({ row }) =>
        isOrderExpired(row.original as Order)
          ? "Hết hạn"
          : orderStatus[
              row.original.status === "PENDING" ||
              stoppedOrderStatuses.includes(row.original.status)
                ? row.original.status
                : row.original.fulfillment
            ],
    },
    {
      header: "Thao tác",
      id: "actions",
      cell: ({ row }) => (
        <div className="table-actions">
          <OrderAction
            order={row.original as Order}
            onTransition={onTransition}
            role={role}
          />
        </div>
      ),
    },
  ];
}
const lanes = [
  { id: "PENDING", label: "Chờ xác nhận", action: "" },
  { id: "UNASSIGNED", label: "Chờ chuẩn bị", action: "CONFIRM" },
  { id: "PREPARING", label: "Đang chuẩn bị", action: "PREPARE" },
  { id: "READY", label: "Sẵn sàng giao", action: "READY" },
  { id: "OUT_FOR_DELIVERY", label: "Đang giao", action: "DISPATCH" },
  { id: "DELIVERED", label: "Đã giao", action: "DELIVER" },
  { id: "REFUND", label: "Hoàn tiền", action: "REQUEST_REFUND" },
  { id: "CANCELLED", label: "Hủy", action: "CANCEL" },
];
function Kanban({
  orders,
  onTransition,
  onDetail,
  role,
}: {
  orders: Order[];
  onTransition: (o: Order, a: string) => Promise<void>;
  onDetail: (o: Order) => void;
  role: string;
}) {
  const { toast } = useShop();
  function end(e: DragEndEvent) {
    if (!e.over) return;
    const order = orders.find((o) => o.id === e.active.id),
      lane = lanes.find((l) => l.id === e.over?.id);
    if (!order || !lane || orderLane(order) === lane.id) return;
    if (
      lane.action &&
      actionsFor(order, role).some((a) => a.value === lane.action)
    ) {
      if (
        lane.action === "CANCEL" &&
        !window.confirm("Hủy đơn chưa thanh toán và giải phóng các lượt giữ?")
      )
        return;
      onTransition(order, lane.action);
    } else
      toast(
        lane.id === "CANCELLED" && hasReceivedPayment(order)
          ? "Đơn đã nhận tiền cần chuyển sang Hoàn tiền."
          : "Không thể chuyển trực tiếp sang cột này. Hãy dùng trạng thái hợp lệ của đơn.",
      );
  }
  return (
    <>
      <p className="small muted">
        Kéo bằng tay nắm để chuyển tiến trình; trên điện thoại có thể dùng nút
        chọn trong từng đơn. Đang hiển thị tối đa 50 đơn của trang hiện tại.
      </p>
      <DndContext onDragEnd={end}>
        <div className="kanban">
          {lanes.map((l) => (
            <KanbanLane
              key={l.id}
              lane={l}
              orders={orders.filter((o) => orderLane(o) === l.id)}
              onTransition={onTransition}
              onDetail={onDetail}
              role={role}
            />
          ))}
        </div>
      </DndContext>
    </>
  );
}
function KanbanLane({
  lane,
  orders,
  onTransition,
  onDetail,
  role,
}: {
  lane: (typeof lanes)[number];
  orders: Order[];
  onTransition: (o: Order, a: string) => Promise<void>;
  onDetail: (o: Order) => void;
  role: string;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: lane.id });
  return (
    <div ref={setNodeRef} className={`kanban-column ${isOver ? "over" : ""}`}>
      <div className="kanban-column-heading">
        {lane.label}
        <span>{orders.length}</span>
      </div>
      {orders.map((o) => (
        <KanbanCard
          key={o.id}
          order={o}
          onTransition={onTransition}
          onDetail={onDetail}
          role={role}
        />
      ))}
    </div>
  );
}
function KanbanCard({
  order,
  onTransition,
  onDetail,
  role,
}: {
  order: Order;
  onTransition: (o: Order, a: string) => Promise<void>;
  onDetail: (o: Order) => void;
  role: string;
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } =
    useDraggable({ id: order.id });
  return (
    <article
      ref={setNodeRef}
      className={`kanban-card ${isDragging ? "dragging" : ""}`}
      style={
        transform
          ? {
              transform: `translate3d(${transform.x}px,${transform.y}px,0)`,
              zIndex: 10,
              position: "relative",
            }
          : undefined
      }
    >
      <div>
        <span className="order-code-with-copy">
          <button onClick={() => onDetail(order)}>{order.code}</button>
          <CopyButton value={order.code} />
        </span>
        <button
          className="drag-handle"
          aria-label={`Kéo đơn ${order.code}`}
          {...listeners}
          {...attributes}
        >
          <GripVertical size={14} />
        </button>
      </div>
      <h3>{order.buyerName}</h3>
      <span className="order-channel">
        {orderChannels[order.source ?? "WEBSITE"]}
      </span>
      <img src={order.items[0]?.image} alt="" />
      <p>{order.items[0]?.name}</p>
      <p>
        {order.deliveryDay} · {order.slotLabel}
      </p>
      {(order.refundPendingAmount ?? 0) > 0 && (
        <p className="kanban-refund-note">
          Chờ hoàn: {money(order.refundPendingAmount!)}
        </p>
      )}
      <OrderPaymentControl
        order={order}
        role={role}
        onTransition={onTransition}
        compact
      />
      <OrderAction order={order} onTransition={onTransition} role={role} />
    </article>
  );
}
function Modal({
  title,
  children,
  onClose,
  className = "",
  eyebrow,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  className?: string;
  eyebrow?: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    ref.current?.showModal();
  }, []);
  return (
    <dialog
      className={`admin-modal ${className}`}
      aria-labelledby={titleId}
      ref={ref}
      onCancel={onClose}
      onClose={onClose}
    >
      <div className="modal-heading">
        <div>
          {eyebrow && <span className="eyebrow">{eyebrow}</span>}
          <h2 id={titleId}>{title}</h2>
        </div>
        <button aria-label="Đóng" onClick={onClose}>
          <X size={21} />
        </button>
      </div>
      {children}
    </dialog>
  );
}
type Field = {
  key: string;
  label: string;
  type?: string;
  options?: string[];
  default?: unknown;
  required?: boolean;
};
function EntityForm({
  section,
  initial,
  onSave,
  busy,
}: {
  section: string;
  initial: Row;
  onSave: (data: Row) => Promise<void>;
  busy: boolean;
}) {
  const { toast, taxonomies, products } = useShop();
  const type = "slot";
  const autoSlug = useAutoSlug(
    initial.name ?? "",
    initial.slug ?? "",
    !!initial.id,
  );
  const [taxonomyKind, setTaxonomyKind] = useState(initial.kind ?? "CATEGORY");
  const [imageValue, setImageValue] = useState(initial.image ?? "");
  const [uploading, setUploading] = useState(false);
  let fields: Field[] = [];
  if (section === "customers" || section === "members")
    fields = [
      { key: "name", label: "Tên khách" },
      { key: "phone", label: "Điện thoại", required: false },
      {
        key: "disabled",
        label: "Khóa tài khoản và thu hồi phiên",
        type: "checkbox",
      },
      { key: "reason", label: "Lý do điều chỉnh" },
    ];
  if (section === "taxonomies")
    fields = [
      {
        key: "kind",
        label: "Loại",
        options: ["CATEGORY", "SIZE", "OCCASION", "COLOR", "COLLECTION"],
      },
      { key: "name", label: "Tên" },
      { key: "slug", label: "Slug (không dấu)" },
      { key: "description", label: "Mô tả", type: "textarea", required: false },
      { key: "image", label: "Ảnh", required: false },
      { key: "active", label: "Hiển thị", type: "checkbox", default: true },
    ];
  if (section === "vouchers")
    fields = [
      { key: "code", label: "Mã (chữ hoa, số)" },
      { key: "title", label: "Tên ưu đãi" },
      { key: "percent", label: "Giảm %", type: "number", default: 5 },
      { key: "cap", label: "Trần giảm VND", type: "number", default: 50000 },
      {
        key: "minimum",
        label: "Đơn tối thiểu",
        type: "number",
        default: 300000,
      },
      { key: "limit", label: "Giới hạn lượt", type: "number", default: 100 },
      {
        key: "expiresAt",
        label: "Hạn (giờ Hà Nội)",
        type: "date",
        default: shiftDay(dayKey(), 30),
      },
      {
        key: "active",
        label: "Đang hoạt động",
        type: "checkbox",
        default: true,
      },
    ];
  if (section === "content")
    fields = [
      {
        key: "kind",
        label: "Loại nội dung",
        options: ["page", "article", "faq", "banner"],
      },
      { key: "slug", label: "Slug" },
      { key: "title", label: "Tiêu đề" },
      { key: "body", label: "Nội dung (văn bản thuần)", type: "textarea" },
      { key: "image", label: "Đường dẫn ảnh", required: false },
      { key: "active", label: "Hiển thị", type: "checkbox", default: true },
    ];
  if (section === "delivery")
    fields = [
      { key: "label", label: "Tên khung giờ", default: "09:00 – 12:00" },
      {
        key: "startHour",
        label: "Giờ bắt đầu",
        type: "number",
        default: 9,
      },
      {
        key: "endHour",
        label: "Giờ kết thúc",
        type: "number",
        default: 12,
      },
      {
        key: "capacity",
        label: "Sức chứa / ngày",
        type: "number",
        default: 12,
      },
      {
        key: "active",
        label: "Nhận đơn",
        type: "checkbox",
        default: true,
      },
    ];
  return (
    <form
      className="form-stack"
      onSubmit={(e) => {
        e.preventDefault();
        const form = new FormData(e.currentTarget);
        const data: Row = {};
        for (const f of fields.filter(
          (f) => !["price", "stock"].includes(f.key),
        ))
          data[f.key] =
            f.type === "checkbox"
              ? form.has(f.key)
              : f.type === "number"
                ? Number(form.get(f.key))
                : f.type === "date"
                  ? `${form.get(f.key)}T23:59:59+07:00`
                  : (form.get(f.key) ?? "");
        if (section === "delivery") data.type = type;
        if (section === "taxonomies")
          data.productIds = form.getAll("productIds");
        onSave(data);
      }}
    >
      <div className="two-columns">
        {fields
          .filter((f) => !["price", "stock"].includes(f.key))
          .map((f) =>
            f.key === "image" ? (
              <div key={f.key} className="catalog-full-width">
                <ImageUpload
                  value={imageValue}
                  onChange={setImageValue}
                  label={f.label}
                  required={f.required !== false}
                  onBusyChange={setUploading}
                />
              </div>
            ) : (
              <label
                key={f.key}
                className={f.type === "checkbox" ? "checkbox-label" : ""}
                style={
                  f.type === "textarea" ? { gridColumn: "1/-1" } : undefined
                }
              >
                {f.type === "checkbox" ? (
                  <>
                    <input
                      type="checkbox"
                      name={f.key}
                      defaultChecked={Boolean(initial[f.key] ?? f.default)}
                    />
                    {f.label}
                  </>
                ) : (
                  <>
                    {f.label}
                    {section === "taxonomies" && f.key === "name" ? (
                      <input
                        name="name"
                        value={autoSlug.name}
                        onChange={(e) => autoSlug.changeName(e.target.value)}
                        required
                        maxLength={100}
                      />
                    ) : section === "taxonomies" && f.key === "slug" ? (
                      <>
                        <input
                          name="slug"
                          value={autoSlug.slug}
                          onChange={(e) => autoSlug.changeSlug(e.target.value)}
                          required
                        />
                        <button
                          type="button"
                          className="text-link"
                          onClick={autoSlug.resetSlug}
                        >
                          Tạo lại slug từ tên
                        </button>
                      </>
                    ) : f.options ? (
                      <Select
                        name={f.key}
                        defaultValue={initial[f.key] ?? f.options[0]}
                        {...(f.key === "kind" && section === "taxonomies"
                          ? {
                              value: taxonomyKind,
                              onChange: (
                                e: React.ChangeEvent<HTMLSelectElement>,
                              ) => setTaxonomyKind(e.target.value),
                            }
                          : {})}
                      >
                        {f.options.map((o) => (
                          <option key={o} value={o}>
                            {section === "taxonomies" && f.key === "kind"
                              ? taxonomyLabels[o as keyof typeof taxonomyLabels]
                              : o}
                          </option>
                        ))}
                      </Select>
                    ) : f.type === "textarea" ? (
                      <textarea
                        name={f.key}
                        rows={5}
                        defaultValue={initial[f.key] ?? ""}
                        required={f.required !== false}
                      />
                    ) : (
                      <input
                        name={f.key}
                        type={f.type ?? "text"}
                        defaultValue={
                          f.type === "date"
                            ? String(initial[f.key] ?? f.default).slice(0, 10)
                            : (initial[f.key] ?? f.default ?? "")
                        }
                        required={f.required !== false}
                        min={f.type === "number" ? 0 : undefined}
                      />
                    )}
                  </>
                )}
              </label>
            ),
          )}
      </div>
      {section === "taxonomies" && taxonomyKind === "COLLECTION" && (
        <fieldset
          style={{ border: "1px solid #dfd1c5", borderRadius: 10, padding: 15 }}
        >
          <legend>Sản phẩm cho loại COLLECTION</legend>
          {products.map((p) => (
            <label className="checkbox-label" key={p.id}>
              <input
                type="checkbox"
                name="productIds"
                value={p.id}
                defaultChecked={initial.productIds?.includes(p.id)}
              />
              {p.name}
            </label>
          ))}
        </fieldset>
      )}
      <button className="button" disabled={busy || uploading}>
        {busy ? "Đang lưu…" : "Lưu thay đổi"}
        <Check size={16} />
      </button>
    </form>
  );
}
function SettingsForm({
  data,
  onSaved,
}: {
  data: { settings: ShopSettings; version: number };
  onSaved: () => Promise<void>;
}) {
  const { toast } = useShop();
  const [busy, setBusy] = useState(false);
  const groups: {
    title: string;
    note: string;
    fields: { key: keyof ShopSettings; label: string; type?: string }[];
  }[] = [
    {
      title: "Cửa hàng",
      note: "Múi giờ cố định: Hà Nội · UTC+7 (Asia/Ho_Chi_Minh).",
      fields: [
        { key: "shopName", label: "Tên cửa hàng" },
        { key: "phone", label: "Điện thoại" },

        {
          key: "minimumLeadHours",
          label: "Đặt trước tối thiểu (giờ)",
          type: "number",
        },
        { key: "codEnabled", label: "Cho phép COD", type: "checkbox" },
        {
          key: "manualPaymentHours",
          label: "Hạn thanh toán đơn thủ công (giờ, 0 = không giới hạn)",
          type: "number",
        },
        {
          key: "blackoutDates",
          label: "Ngày nghỉ (YYYY-MM-DD, ngăn cách bằng dấu phẩy)",
        },
      ],
    },
    {
      title: "Hội viên",
      note: "Bảng giá, ngưỡng chi tiêu và quyền lợi từng hạng được quản lý tại mục Hội viên → Hạng & quyền lợi.",
      fields: [
        {
          key: "memberEnabled",
          label: "Cho đăng ký / mua gói mới",
          type: "checkbox",
        },
      ],
    },
    {
      title: "Công nợ COD & nhắc thu",
      note: "Theo giờ Hà Nội. Hạn thu tính từ lúc giao thực tế; nhắc lại không thay đổi hạn thu. Chỉ thông báo nội bộ cho quản lý và kế toán.",
      fields: [
        {
          key: "collectionRemindersEnabled",
          label: "Bật nhắc công nợ",
          type: "checkbox",
        },
        {
          key: "collectionPushEnabled",
          label: "Gửi push thiết bị",
          type: "checkbox",
        },
        {
          key: "collectionNotifyAccountant",
          label: "Thông báo cho kế toán (quản lý luôn nhận)",
          type: "checkbox",
        },
        {
          key: "collectionDueHours",
          label: "Hạn thu khách sau giao (giờ, 0 = ngay khi giao)",
          type: "number",
        },
        {
          key: "collectionShipperDueHours",
          label: "Hạn shipper bàn giao sau thu hộ (giờ)",
          type: "number",
        },
        {
          key: "collectionFirstReminderHours",
          label: "Nhắc lần đầu sau hạn thu (giờ)",
          type: "number",
        },
        {
          key: "collectionPriorityHours",
          label: "Đánh dấu ưu tiên khi quá hạn (giờ)",
          type: "number",
        },
        {
          key: "collectionEscalationHours",
          label: "Báo quản lý khi quá hạn (giờ)",
          type: "number",
        },
        {
          key: "collectionDigestHour",
          label: "Giờ tổng hợp mỗi ngày (0–23)",
          type: "number",
        },
        {
          key: "collectionWorkStart",
          label: "Giờ bắt đầu gửi nhắc (0–23)",
          type: "number",
        },
        {
          key: "collectionWorkEnd",
          label: "Giờ kết thúc gửi nhắc (1–24)",
          type: "number",
        },
      ],
    },
    {
      title: "QR và những ngày có hoa",
      note: "Tạo mã ngay khi có đơn. COD luôn chỉ mở nhận khi giao thành công.",
      fields: [
        { key: "streakEnabled", label: "Bật giữ chuỗi", type: "checkbox" },
        { key: "campaignName", label: "Tên chương trình" },
        { key: "qrMaxClaims", label: "Người nhận / QR mới", type: "number" },
        { key: "qrHours", label: "QR có hiệu lực (giờ)", type: "number" },
        { key: "qrTrigger", label: "SePay mở QR khi", type: "trigger" },
      ],
    },
    {
      title: "Mốc thưởng và ngân sách",
      note: "Mỗi mốc tối đa một lần/tài khoản/tháng khi chạm mốc. Giá trị dưới đây áp dụng cho các lần đạt mốc tiếp theo; không cấp lại mốc cũ.",
      fields: [
        {
          key: "monthlyThreshold",
          label: "Mốc tích lũy tháng (ngày)",
          type: "number",
        },
        { key: "monthlyPercent", label: "Giảm mốc tháng (%)", type: "number" },
        {
          key: "consecutiveThreshold",
          label: "Mốc liên tiếp (ngày)",
          type: "number",
        },
        {
          key: "consecutivePercent",
          label: "Giảm mốc liên tiếp (%)",
          type: "number",
        },
        { key: "rewardCap", label: "Trần giảm thưởng (VND)", type: "number" },
        { key: "rewardMinimum", label: "Đơn tối thiểu (VND)", type: "number" },
        {
          key: "rewardDays",
          label: "Thưởng có hiệu lực (ngày)",
          type: "number",
        },
        {
          key: "campaignBudget",
          label: "Ngân sách cam kết tối đa (VND)",
          type: "number",
        },
      ],
    },
  ];
  return (
    <form
      className="admin-settings"
      onSubmit={async (e) => {
        e.preventDefault();
        const fields = new FormData(e.currentTarget);
        const settings: Row = { ...data.settings };
        for (const g of groups)
          for (const f of g.fields)
            settings[f.key] =
              f.type === "checkbox"
                ? fields.has(f.key)
                : f.type === "number"
                  ? Number(fields.get(f.key))
                  : f.key === "blackoutDates"
                    ? String(fields.get(f.key))
                        .split(",")
                        .map((s) => s.trim())
                        .filter(Boolean)
                    : String(fields.get(f.key));
        setBusy(true);
        try {
          await request(
            "admin/settings",
            { settings, version: data.version },
            "PATCH",
          );
          await onSaved();
          toast(
            "Đã công bố cấu hình mới. Các kỳ hội viên đã mở giữ nguyên quota.",
          );
        } catch (e) {
          toast((e as Error).message);
        } finally {
          setBusy(false);
        }
      }}
    >
      {groups.map((g) => (
        <section className="admin-panel" key={g.title}>
          <h2>{g.title}</h2>
          <p>{g.note}</p>
          <div className="two-columns">
            {g.fields.map((f) => (
              <label
                className={f.type === "checkbox" ? "checkbox-label" : ""}
                key={f.key}
              >
                {f.type === "checkbox" ? (
                  <>
                    <input
                      type="checkbox"
                      name={f.key}
                      defaultChecked={Boolean(data.settings[f.key])}
                    />
                    {f.label}
                  </>
                ) : (
                  <>
                    {f.label}
                    {f.type === "trigger" ? (
                      <Select
                        name={f.key}
                        defaultValue={String(data.settings[f.key])}
                      >
                        <option value="CONFIRMED">
                          Đã trả tiền + cửa hàng xác nhận
                        </option>
                        <option value="DELIVERED">Đã giao thành công</option>
                      </Select>
                    ) : (
                      <input
                        name={f.key}
                        type={f.type ?? "text"}
                        required={f.key !== "blackoutDates"}
                        min={f.type === "number" ? 0 : undefined}
                        defaultValue={
                          Array.isArray(data.settings[f.key])
                            ? (data.settings[f.key] as string[]).join(", ")
                            : String(data.settings[f.key])
                        }
                      />
                    )}
                  </>
                )}
              </label>
            ))}
          </div>
        </section>
      ))}
      <div className="settings-save">
        <button className="button" disabled={busy}>
          {busy ? "Đang công bố…" : "Lưu & công bố cấu hình"}
          <Check size={16} />
        </button>
        <span className="small muted">
          Phiên bản {data.version} · Thay đổi có nhật ký
        </span>
      </div>
    </form>
  );
}
