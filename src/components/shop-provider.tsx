"use client";
import {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  type ReactNode,
} from "react";
import { io } from "socket.io-client";
import { MotionConfig } from "motion/react";
import { Check, X, ShoppingBag } from "lucide-react";
import Link from "next/link";
import type { Bootstrap, CartItem, PublicUser, Me } from "@/lib/types";
import { track } from "./analytics-consent";
import { monthKey } from "@/lib/time";
export async function request<T = unknown>(
  url: string,
  data?: unknown,
  method = data === undefined ? "GET" : "POST",
): Promise<T> {
  const response = await fetch(`/api/${url}`, {
    method,
    credentials: "same-origin",
    headers: data !== undefined ? { "Content-Type": "application/json" } : {},
    body: data !== undefined ? JSON.stringify(data) : undefined,
    cache: "no-store",
  });
  const value = await response.json();
  if (!response.ok) {
    if (
      value.code === "SHIPPING_ROUTE_CHANGED" &&
      typeof window !== "undefined"
    )
      window.dispatchEvent(new Event("fleurious:shipping-refresh"));
    throw new Error(value.error ?? "Không thể xử lý yêu cầu");
  }
  return value;
}
type ShopContext = Bootstrap & {
  user: PublicUser | null;
  me: Me | null;
  ready: boolean;
  cart: CartItem[];
  setQuantity: (id: string, n: number) => void;
  add: (id: string, n?: number) => void;
  mergeCart: (items: CartItem[]) => void;
  clearCart: () => void;
  refresh: () => Promise<void>;
  refreshCatalog: () => Promise<void>;
  toast: (message: string) => void;
  favorites: string[];
  favorite: (id: string) => void;
};
const Context = createContext<ShopContext | null>(null);
export const useShop = () => useContext(Context)!;
export function ShopProvider({
  initial,
  children,
}: {
  initial: Bootstrap;
  children: ReactNode;
}) {
  const [catalog, setCatalog] = useState(initial),
    [user, setUser] = useState<PublicUser | null>(null),
    [me, setMe] = useState<Me | null>(null),
    [ready, setReady] = useState(false),
    [cart, setCart] = useState<CartItem[]>([]),
    [favorites, setFavorites] = useState<string[]>([]),
    [message, setMessage] = useState("");
  const toast = useCallback((message: string) => setMessage(message), []);
  const refresh = useCallback(async () => {
    const auth = await request<{ user: PublicUser | null }>("auth/me");
    setUser(auth.user);
    if (auth.user) {
      const data = await request<Me>("me");
      setUser(data.user);
      setMe(data);
      setFavorites(data.favorites.map((f) => f.productId));
    } else setMe(null);
    setReady(true);
  }, []);
  const refreshCatalog = useCallback(
    async () => setCatalog(await request<Bootstrap>("bootstrap")),
    [],
  );
  useEffect(() => {
    if (!me?.membership) return;
    const now = Date.now();
    const [year, month] = monthKey().split("-").map(Number);
    const boundaries = [
      Date.UTC(year, month, 1) - 7 * 3600000,
      ...me.membership.sources.flatMap((s) => [
        Date.parse(s.startsAt),
        ...(s.endsAt ? [Date.parse(s.endsAt)] : []),
      ]),
    ].filter((t) => t > now);
    const timer = setTimeout(
      () => refresh().catch(() => {}),
      Math.min(2147483647, Math.max(250, Math.min(...boundaries) - now + 250)),
    );
    const focus = () => refresh().catch(() => {});
    window.addEventListener("focus", focus);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("focus", focus);
    };
  }, [me?.membership, refresh]);
  useEffect(() => {
    try {
      const saved: CartItem[] = JSON.parse(
        localStorage.getItem("fleurious-cart") ?? "[]",
      );
      setCart(
        saved.filter(
          (i) =>
            typeof i.variantId === "string" &&
            Number.isInteger(i.quantity) &&
            i.quantity > 0 &&
            i.quantity <= 20,
        ),
      );
      setFavorites(
        JSON.parse(localStorage.getItem("fleurious-favorites") ?? "[]"),
      );
    } catch {
      /* Corrupt local drafts can be discarded. */
    }
    refresh().catch(() => {
      setReady(true);
      toast("Không thể đồng bộ tài khoản. Bạn vẫn có thể xem hoa.");
    });
    if ("serviceWorker" in navigator && window.isSecureContext)
      navigator.serviceWorker.register("/sw.js").catch(() => {});
  }, [refresh, toast]);
  useEffect(() => {
    if (message) {
      const timer = setTimeout(() => setMessage(""), 4500);
      return () => clearTimeout(timer);
    }
  }, [message]);
  useEffect(() => {
    if (catalog.realtimeTransport === "websocket") {
      let stopped = false;
      let socket: WebSocket | undefined;
      let retry: ReturnType<typeof setTimeout> | undefined;
      let delay = 1000;
      const sync = () => {
        refresh().catch(() => {});
        window.dispatchEvent(new Event("fleurious:sync"));
      };
      const connect = () => {
        if (stopped) return;
        const url = new URL("/api/realtime", window.location.href);
        url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
        socket = new WebSocket(url);
        socket.onopen = () => {
          delay = 1000;
          sync();
        };
        socket.onmessage = (event) => {
          try {
            const packet = JSON.parse(event.data);
            if (packet.type === "catalog") refreshCatalog().catch(() => {});
            sync();
          } catch {
            /* Ignore malformed transport messages. */
          }
        };
        socket.onclose = () => {
          if (!stopped) {
            retry = setTimeout(connect, delay);
            delay = Math.min(30000, delay * 2);
          }
        };
      };
      connect();
      const fallback = setInterval(() => {
        if (
          document.visibilityState === "visible" &&
          socket?.readyState !== WebSocket.OPEN
        )
          sync();
      }, 15000);
      return () => {
        stopped = true;
        clearTimeout(retry);
        clearInterval(fallback);
        socket?.close();
      };
    }
    const socket = io({ autoConnect: true });
    socket.on("connect", () => {
      window.dispatchEvent(new Event("fleurious:sync"));
    });
    socket.on("catalog", () => {
      refreshCatalog().catch(() => {});
    });
    socket.on("update", () => {
      refresh().catch(() => {});
      window.dispatchEvent(new Event("fleurious:sync"));
    });
    return () => {
      socket.disconnect();
    };
  }, [user?.id, catalog.realtimeTransport, refresh, refreshCatalog]);
  function saveCart(next: CartItem[]) {
    setCart(next);
    localStorage.setItem("fleurious-cart", JSON.stringify(next));
  }
  function setQuantity(id: string, n: number) {
    saveCart(
      n <= 0
        ? cart.filter((i) => i.variantId !== id)
        : cart.map((i) =>
            i.variantId === id ? { ...i, quantity: Math.min(20, n) } : i,
          ),
    );
  }
  function add(id: string, n = 1) {
    const existing = cart.find((i) => i.variantId === id);
    saveCart(
      existing
        ? cart.map((i) =>
            i.variantId === id
              ? { ...i, quantity: Math.min(20, i.quantity + n) }
              : i,
          )
        : [...cart, { variantId: id, quantity: n }],
    );
    track("add_to_cart", { items: [{ variantId: id, quantity: n }] });
    toast("Đã thêm một chút dịu dàng vào giỏ hoa.");
  }
  const mergeCart = useCallback((items: CartItem[]) => {
    setCart((previous) => {
      const quantities = new Map(
        previous.map((i) => [i.variantId, i.quantity]),
      );
      for (const item of items)
        quantities.set(
          item.variantId,
          Math.min(20, (quantities.get(item.variantId) ?? 0) + item.quantity),
        );
      const next = Array.from(quantities, ([variantId, quantity]) => ({
        variantId,
        quantity,
      }));
      localStorage.setItem("fleurious-cart", JSON.stringify(next));
      return next;
    });
  }, []);
  async function favorite(id: string) {
    const active = !favorites.includes(id);
    const next = active
      ? [...favorites, id]
      : favorites.filter((i) => i !== id);
    setFavorites(next);
    localStorage.setItem("fleurious-favorites", JSON.stringify(next));
    if (user)
      try {
        await request("me/favorites", { productId: id, active });
      } catch (e) {
        toast((e as Error).message);
        refresh();
      }
  }
  return (
    <Context.Provider
      value={{
        ...catalog,
        user,
        me,
        ready,
        cart,
        setQuantity,
        add,
        mergeCart,
        clearCart: () => saveCart([]),
        refresh,
        refreshCatalog,
        toast,
        favorites,
        favorite,
      }}
    >
      <MotionConfig reducedMotion="user">{children}</MotionConfig>
      {message && (
        <div className="toast" role="status">
          <Check size={19} />
          <span>{message}</span>
          <button onClick={() => setMessage("")} aria-label="Đóng thông báo">
            <X size={17} />
          </button>
          {message.startsWith("Đã thêm một chút") && (
            <Link href="/cart" aria-label="Xem giỏ hoa">
              <ShoppingBag size={19} />
            </Link>
          )}
        </div>
      )}
    </Context.Provider>
  );
}
