"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  LayoutDashboard,
  ShoppingBag,
  CalendarDays,
  Flower2,
  LayoutGrid,
  Package,
  Users,
  Sparkles,
  Flame,
  TicketPercent,
  Truck,
  BarChart3,
  CreditCard,
  FileText,
  Heart,
  ShieldCheck,
  Settings2,
  Activity,
  History,
  LogOut,
  Menu,
  PanelLeftClose,
  PanelLeftOpen,
  X,
} from "lucide-react";
import { BrandMark } from "./brand-mark";
import { NotificationBell } from "./notification-center";
import { request, useShop } from "./shop-provider";
import { can } from "@/lib/auth-policy";
export const adminSections = [
  { id: "overview", name: "Tổng quan", Icon: LayoutDashboard, group: "" },
  { id: "orders", name: "Đơn hàng", Icon: ShoppingBag },
  { id: "calendar", name: "Lịch giao hoa", Icon: CalendarDays },
  { id: "products", name: "Sản phẩm", Icon: Flower2, group: "CỬA HÀNG" },
  { id: "taxonomies", name: "Danh mục & bộ sưu tập", Icon: LayoutGrid },
  { id: "inventory", name: "Tồn kho", Icon: Package },
  { id: "customers", name: "Khách hàng", Icon: Users },
  { id: "members", name: "Hội viên", Icon: Sparkles },
  { id: "streaks", name: "Giữ chuỗi", Icon: Flame },
  { id: "vouchers", name: "Ưu đãi", Icon: TicketPercent },
  { id: "delivery", name: "Giao hàng", Icon: Truck },
  { id: "analytics", name: "Phân tích", Icon: BarChart3, group: "QUẢN LÝ" },
  { id: "payments", name: "Thanh toán SePay", Icon: CreditCard },
  { id: "content", name: "Nội dung", Icon: FileText },
  { id: "reviews", name: "Đánh giá", Icon: Heart },
  { id: "team", name: "Nhân sự & quyền", Icon: ShieldCheck },
  { id: "settings", name: "Cài đặt", Icon: Settings2 },
  { id: "jobs", name: "Tác vụ nền", Icon: Activity },
  { id: "audit", name: "Nhật ký", Icon: History },
];

export function AdminFrame({
  role,
  name,
  children,
}: {
  role: string;
  name: string;
  children: ReactNode;
}) {
  const path = usePathname();
  const router = useRouter();
  const { refresh, toast } = useShop();
  const [loggingOut, setLoggingOut] = useState(false);
  const section = path.split("/")[2] || "overview";
  const title =
    adminSections.find((s) => s.id === section)?.name ?? "Thông báo";
  const [open, setOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const navRef = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    try {
      setCollapsed(
        localStorage.getItem("fleurious-admin-collapsed") === "true",
      );
      if (navRef.current)
        navRef.current.scrollTop = Number(
          sessionStorage.getItem("fleurious-admin-menu-scroll") || 0,
        );
    } catch {}
  }, []);
  useEffect(() => setOpen(false), [path]);
  useEffect(() => {
    if (!open) return;
    const close = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", close);
    return () => document.removeEventListener("keydown", close);
  }, [open]);
  function toggle() {
    setCollapsed((value) => {
      try {
        localStorage.setItem("fleurious-admin-collapsed", String(!value));
      } catch {}
      return !value;
    });
  }
  const navArea = (id: string) =>
    ["taxonomies", "inventory"].includes(id)
      ? "products"
      : id === "reviews"
        ? "content"
        : ["members", "streaks"].includes(id)
          ? "customers"
          : ["team", "jobs", "audit"].includes(id)
            ? "settings"
            : id;

  return (
    <div className={`admin-app ${collapsed ? "sidebar-collapsed" : ""}`}>
      {open && (
        <button
          className="admin-sidebar-overlay"
          onClick={() => setOpen(false)}
          aria-label="Đóng menu"
        />
      )}
      <aside
        className={`admin-sidebar ${open ? "open" : ""}`}
        aria-label="Menu quản trị"
      >
        <div className="sidebar-brand-row">
          <Link
            href="/admin"
            className="wordmark"
            aria-label="Fleurious dashboard"
          >
            <BrandMark />
            <span>fleurious.</span>
          </Link>
          <button
            className="sidebar-close"
            onClick={() => setOpen(false)}
            aria-label="Đóng menu quản trị"
          >
            <X size={18} />
          </button>
        </div>
        <small>THE FLOWER WORKSPACE</small>
        <nav
          ref={navRef}
          aria-label="Điều hướng quản trị"
          onScroll={(e) => {
            try {
              sessionStorage.setItem(
                "fleurious-admin-menu-scroll",
                String(e.currentTarget.scrollTop),
              );
            } catch {}
          }}
        >
          {adminSections
            .filter((s) => can(role, navArea(s.id)))
            .map((s) => (
              <div key={s.id}>
                {s.group && (
                  <div className="sidebar-section-label">{s.group}</div>
                )}
                <Link
                  href={`/admin${s.id === "overview" ? "" : `/${s.id}`}`}
                  scroll={false}
                  className={section === s.id ? "active" : ""}
                  aria-current={section === s.id ? "page" : undefined}
                  aria-label={s.name}
                  title={s.name}
                  onClick={() => setOpen(false)}
                >
                  <s.Icon />
                  <span className="sidebar-link-label">{s.name}</span>
                </Link>
              </div>
            ))}
        </nav>
        <div className="sidebar-bottom">
          <button
            className="sidebar-logout"
            type="button"
            title="Đăng xuất"
            aria-label="Đăng xuất"
            disabled={loggingOut}
            onClick={async () => {
              setLoggingOut(true);
              try {
                await request("auth/logout", {});
                await refresh().catch(() => {});
                router.replace("/auth/login?next=/admin");
                router.refresh();
              } catch (e) {
                toast((e as Error).message);
                setLoggingOut(false);
              }
            }}
          >
            <LogOut size={17} />
            <span>{loggingOut ? "Đang đăng xuất…" : "Đăng xuất"}</span>
          </button>
          <button
            className="sidebar-toggle"
            onClick={toggle}
            aria-label={collapsed ? "Mở rộng menu" : "Thu gọn menu"}
            aria-expanded={!collapsed}
            title={collapsed ? "Mở rộng menu" : "Thu gọn menu"}
          >
            {collapsed ? (
              <PanelLeftOpen size={18} />
            ) : (
              <PanelLeftClose size={18} />
            )}
          </button>
        </div>
      </aside>
      <header className="admin-topbar">
        <div>
          <button
            className="admin-mobile-menu"
            onClick={() => setOpen(!open)}
            aria-label="Mở menu quản trị"
            aria-expanded={open}
          >
            <Menu size={21} />
          </button>
          <span className="admin-breadcrumb">
            Workspace <span> / </span>
            <strong>{title}</strong>
          </span>
        </div>
        <div>
          <span className="small">Hà Nội · UTC+7</span>
          <NotificationBell />
          <Link href="/account" className="avatar" aria-label="Hồ sơ">
            {name[0]}
          </Link>
        </div>
      </header>
      {children}
    </div>
  );
}
