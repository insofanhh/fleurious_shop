"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  Bell,
  CheckCheck,
  ChevronLeft,
  ChevronRight,
  ShoppingBag,
  Sparkles,
  AlertCircle,
  MessageSquare,
  X,
} from "lucide-react";
import { request, useShop } from "./shop-provider";
import { humanDate } from "@/lib/time";

type Notice = {
  id: string;
  title: string;
  body: string;
  url: string;
  read: boolean;
  createdAt: string;
};
type Inbox = { items: Notice[]; unread: number; total: number; page: number };
const empty: Inbox = { items: [], unread: 0, total: 0, page: 1 };
const Context = createContext<{
  data: Inbox;
  loading: boolean;
  error: string;
  page: number;
  setPage: (page: number) => void;
  reload: () => void;
  read: (id?: string) => Promise<void>;
  admin: boolean;
} | null>(null);
export function NotificationProvider({ children }: { children: ReactNode }) {
  const { user } = useShop();
  const path = usePathname();
  const admin = path.startsWith("/admin");
  const endpoint = admin ? "admin/notifications" : "me/notifications";
  const identity = `${endpoint}:${user?.id ?? "guest"}`;
  const activeIdentity = useRef(identity);
  activeIdentity.current = identity;
  const [loadedIdentity, setLoadedIdentity] = useState("");
  const [page, setPage] = useState(1),
    [data, setData] = useState<Inbox>(empty),
    [loading, setLoading] = useState(false),
    [error, setError] = useState("");
  const revision = useRef(0);
  const load = useCallback(async () => {
    if (activeIdentity.current !== identity) return;
    const current = ++revision.current;
    if (!user) {
      setData(empty);
      setError("");
      setLoading(false);
      setLoadedIdentity(identity);
      return;
    }
    setLoading(true);
    try {
      const result = await request<Inbox>(`${endpoint}?page=${page}`);
      if (current === revision.current && activeIdentity.current === identity) {
        setData(result);
        setLoadedIdentity(identity);
        setError("");
      }
    } catch (e) {
      if (current === revision.current) setError((e as Error).message);
    } finally {
      if (current === revision.current) setLoading(false);
    }
  }, [endpoint, page, user?.id, identity]);
  useEffect(() => {
    setPage(1);
    setData(empty);
  }, [endpoint, user?.id]);
  useEffect(() => {
    load();
    const sync = () => {
      load();
    };
    window.addEventListener("fleurious:sync", sync);
    window.addEventListener("focus", sync);
    return () => {
      ++revision.current;
      window.removeEventListener("fleurious:sync", sync);
      window.removeEventListener("focus", sync);
    };
  }, [load]);
  async function read(id?: string) {
    await request(endpoint, id ? { id } : { before: new Date().toISOString() });
    await load();
  }
  return (
    <Context.Provider
      value={{
        data: loadedIdentity === identity ? data : empty,
        loading,
        error,
        page,
        setPage,
        reload: load,
        read,
        admin,
      }}
    >
      {children}
    </Context.Provider>
  );
}
function useInbox() {
  return useContext(Context)!;
}
export function NotificationBadge() {
  const { data } = useInbox();
  return data.unread > 0 ? (
    <span
      className="notification-badge"
      aria-label={`${data.unread} thông báo chưa đọc`}
    >
      {data.unread > 99 ? "99+" : data.unread}
    </span>
  ) : null;
}
export function NotificationBell() {
  const { data, admin, setPage } = useInbox();
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const path = usePathname();
  useEffect(() => setOpen(false), [path]);
  useEffect(() => {
    if (!open) return;
    const outside = (e: PointerEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false);
    };
    const keyboard = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        button.current?.focus();
      }
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", keyboard);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", keyboard);
    };
  }, [open]);
  return (
    <div className="notification-center" ref={box}>
      <button
        ref={button}
        className="notification-trigger"
        aria-label={`Thông báo${data.unread ? `, ${data.unread} chưa đọc` : ""}`}
        aria-expanded={open}
        aria-controls={open ? "notification-popover" : undefined}
        onClick={() => {
          if (!open) setPage(1);
          setOpen(!open);
        }}
      >
        <Bell size={21} strokeWidth={1.5} />
        <NotificationBadge />
      </button>
      {open && (
        <section
          id="notification-popover"
          className="notification-popover"
          aria-label="Danh sách thông báo"
        >
          <div className="notification-popover-heading">
            <div>
              <span className="eyebrow">
                {admin ? "WORKSPACE" : "DÀNH CHO BẠN"}
              </span>
              <h2>
                Thông báo <small>{data.unread} chưa đọc</small>
              </h2>
            </div>
            <button
              onClick={() => setOpen(false)}
              aria-label="Đóng bảng thông báo"
            >
              <X size={19} />
            </button>
          </div>
          <NotificationList compact onNavigate={() => setOpen(false)} />
          <Link
            className="notification-view-all"
            href={admin ? "/admin/notifications" : "/notifications"}
            onClick={() => setOpen(false)}
          >
            Xem tất cả thông báo <ChevronRight size={16} />
          </Link>
        </section>
      )}
    </div>
  );
}
function NoticeIcon({ notice }: { notice: Notice }) {
  const Icon = notice.url.includes("orders")
    ? ShoppingBag
    : notice.url.includes("member") || notice.url.includes("reward")
      ? Sparkles
      : notice.url.includes("reviews")
        ? MessageSquare
        : notice.url.startsWith("/admin")
          ? AlertCircle
          : Bell;
  return <Icon size={19} strokeWidth={1.5} />;
}
export function NotificationList({
  compact = false,
  onNavigate,
}: {
  compact?: boolean;
  onNavigate?: () => void;
}) {
  const { data, error, loading, reload, read, page, setPage } = useInbox();
  const { user, toast } = useShop();
  return (
    <div className={`inbox-list ${compact ? "compact" : ""}`}>
      {!user ? (
        <div className="inbox-empty">
          <Bell size={28} />
          <h3>Một góc cập nhật dành cho bạn</h3>
          <p>Đăng nhập để xem đơn hoa, hội viên và ưu đãi mới.</p>
          <Link
            href="/auth/login?next=/notifications"
            className="text-link"
            onClick={onNavigate}
          >
            Đăng nhập <ChevronRight size={16} />
          </Link>
        </div>
      ) : (
        <>
          {data.unread > 0 && (
            <div className="inbox-actions">
              <span aria-live="polite">{data.unread} thông báo chưa đọc</span>
              <button onClick={() => read().catch((e) => toast(e.message))}>
                <CheckCheck size={15} /> Đọc tất cả
              </button>
            </div>
          )}
          {error ? (
            <div className="inbox-empty" role="alert">
              <p>{error}</p>
              <button className="text-link" onClick={reload}>
                Thử lại
              </button>
            </div>
          ) : loading && !data.items.length ? (
            <p className="inbox-empty" role="status">
              Đang tải thông báo…
            </p>
          ) : !data.items.length ? (
            <div className="inbox-empty">
              <Bell size={28} />
              <h3>Bạn đã xem hết cập nhật</h3>
              <p>Thông báo mới sẽ tự xuất hiện tại đây.</p>
            </div>
          ) : (
            <div className="inbox-items">
              {(compact ? data.items.slice(0, 8) : data.items).map((n) => (
                <Link
                  key={n.id}
                  href={n.url}
                  className={`inbox-item ${n.read ? "" : "unread"}`}
                  onClick={() => {
                    if (!n.read) read(n.id).catch((e) => toast(e.message));
                    onNavigate?.();
                  }}
                >
                  <span className="inbox-icon">
                    <NoticeIcon notice={n} />
                  </span>
                  <div>
                    <strong>{n.title}</strong>
                    <p>{n.body}</p>
                    <time dateTime={n.createdAt}>{humanDate(n.createdAt)}</time>
                  </div>
                  {!n.read && (
                    <span className="inbox-unread-dot" aria-label="Chưa đọc" />
                  )}
                </Link>
              ))}
            </div>
          )}
          {!compact && data.total > 30 && (
            <div className="inbox-pagination">
              <button
                aria-label="Trang trước"
                disabled={page <= 1}
                onClick={() => setPage(page - 1)}
              >
                <ChevronLeft size={18} />
              </button>
              <span>
                Trang {page} / {Math.ceil(data.total / 30)}
              </span>
              <button
                aria-label="Trang sau"
                disabled={page * 30 >= data.total}
                onClick={() => setPage(page + 1)}
              >
                <ChevronRight size={18} />
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
export function NotificationInbox({
  embedded = false,
}: {
  embedded?: boolean;
}) {
  const { admin } = useInbox();
  const { user, toast, vapidKey } = useShop();
  const [busy, setBusy] = useState(false);
  async function push() {
    setBusy(true);
    try {
      if (
        !vapidKey ||
        !("PushManager" in window) ||
        !("serviceWorker" in navigator)
      )
        throw new Error(
          "Thông báo đẩy chưa được hỗ trợ hoặc cấu hình. Bạn vẫn nhận cập nhật realtime tại đây.",
        );
      const granted = await Notification.requestPermission();
      if (granted !== "granted")
        return toast(
          "Bạn có thể bật quyền thông báo trong cài đặt trình duyệt.",
        );
      const registration = await navigator.serviceWorker.ready;
      const raw = atob(vapidKey.replace(/-/g, "+").replace(/_/g, "/"));
      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: Uint8Array.from(raw, (c) => c.charCodeAt(0)),
      });
      await request("me/push", subscription.toJSON());
      toast("Đã bật thông báo trên thiết bị này.");
    } catch (e) {
      toast((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const content = (
    <>
      <div className="inbox-page-heading">
        <div>
          <span className="eyebrow">
            {admin ? "WORKSPACE" : "NHỮNG CẬP NHẬT NHỎ"}
          </span>
          <h1>Thông báo</h1>
          <p>
            {admin
              ? "Đơn hàng, hội viên và tình hình cửa hàng, cập nhật trực tiếp."
              : "Theo dõi đơn hoa, đặc quyền hội viên và những món quà dành cho bạn."}
          </p>
        </div>
        {user && (
          <button className="button secondary" disabled={busy} onClick={push}>
            <Bell size={17} /> Bật thông báo thiết bị
          </button>
        )}
      </div>
      <NotificationList />
    </>
  );
  return embedded ? (
    content
  ) : (
    <section
      className={
        admin ? "admin-main inbox-page" : "container section inbox-page"
      }
      id={admin ? "main-content" : undefined}
    >
      {content}
    </section>
  );
}
