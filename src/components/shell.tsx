"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import {
  Flower2,
  Bell,
  ShoppingBag,
  UserRound,
  Menu,
  X,
  ArrowUpRight,
  Sparkles,
  Flame,
  Heart,
  Camera,
  ArrowRight,
} from "lucide-react";
import { useShop } from "./shop-provider";
import { dayKey } from "@/lib/time";
import { NotificationBell, NotificationBadge } from "./notification-center";
import { BrandMark } from "./brand-mark";
export function Shell({ children }: { children: React.ReactNode }) {
  const { cart, settings } = useShop();
  const path = usePathname();
  const [open, setOpen] = useState(false);
  if (path.startsWith("/admin")) return children;
  return (
    <>
      <div className="announcement">
        <span>Giao một bó hoa. Gửi ngàn thương mến.</span>
        <span className="announcement-right">
          Giao hoa tại Hà Nội <ArrowUpRight size={12} />
        </span>
      </div>
      <header className="header">
        <div className="header-inner">
          <Link href="/" className="wordmark" aria-label="Fleurious trang chủ">
            <BrandMark />
            <span className="wordmark-name">fleurious.</span>
          </Link>
          <nav className="desktop-nav" aria-label="Điều hướng chính">
            <Link
              className={path === "/flowers" ? "active" : ""}
              href="/flowers"
            >
              Tất cả hoa
            </Link>
            <Link href="/collections/sinh-nhat">Theo dịp tặng</Link>
            <Link href="/membership">
              Hội viên <span className="tiny-star">✧</span>
            </Link>
            <Link href="/about">Chuyện của hoa</Link>
          </nav>
          <div className="header-actions">
            <div className="header-notifications">
              <NotificationBell />
            </div>
            <Link
              href="/account"
              className="desktop-only"
              aria-label="Tài khoản"
            >
              <UserRound size={21} strokeWidth={1.5} />
            </Link>
            <Link
              href="/cart"
              className="bag-link"
              aria-label={`Giỏ hoa, ${cart.reduce((s, i) => s + i.quantity, 0)} sản phẩm`}
            >
              <ShoppingBag size={21} strokeWidth={1.5} />
              <span>{cart.reduce((s, i) => s + i.quantity, 0)}</span>
            </Link>
            <button
              className="mobile-menu"
              aria-label="Mở menu"
              onClick={() => setOpen(!open)}
            >
              {open ? <X size={22} /> : <Menu size={22} />}
            </button>
          </div>
        </div>
        {open && (
          <nav className="mobile-drawer">
            {[
              ["/flowers", "Tất cả hoa"],
              ["/membership", "Hội viên Fleurious"],
              ["/streak", "Những ngày có hoa"],
              ["/about", "Chuyện của hoa"],
            ].map(([href, label]) => (
              <Link key={href} href={href} onClick={() => setOpen(false)}>
                {label}
                <ArrowUpRight size={17} />
              </Link>
            ))}
          </nav>
        )}
      </header>
      <main id="main-content">{children}</main>
      <section className="closing-note">
        <BrandMark />
        <p>
          Vì ai cũng xứng đáng
          <br />
          có những ngày <em>nở hoa.</em>
        </p>
        <Link href="/flowers" className="text-link">
          Tìm bó hoa của bạn <ArrowRight size={17} />
        </Link>
      </section>
      <footer className="footer">
        <div>
          <Link href="/" className="wordmark" aria-label="Fleurious trang chủ">
            <BrandMark />
            <span className="wordmark-name">fleurious.</span>
          </Link>
          <p>
            Hoa tươi, cảm xúc thật.
            <br />
            Được nâng niu từ Hà Nội.
          </p>
        </div>
        <div>
          <h3>Khám phá</h3>
          <Link href="/flowers">Tất cả hoa</Link>
          <Link href="/membership">Hội viên</Link>
          <Link href="/streak">Giữ chuỗi</Link>
        </div>
        <div>
          <h3>Chúng tôi ở đây</h3>
          <Link href="/delivery">Giao hàng</Link>
          <Link href="/returns">Đổi trả & hỗ trợ</Link>
          <Link href="/privacy">Quyền riêng tư</Link>
        </div>
        <div>
          <h3>Kết nối</h3>
          <a href={`tel:${settings.phone.replaceAll(" ", "")}`}>
            {settings.phone}
          </a>
          <p>{settings.address}</p>
          <span>
            <Camera size={18} /> @fleurious.flowers
          </span>
        </div>
        <div className="footer-bottom">
          <span>© {dayKey().slice(0, 4)} Fleurious. Made with care.</span>
          <span>
            Hà Nội · UTC+7 <Flower2 size={13} />
          </span>
        </div>
      </footer>
      {path !== "/checkout" && (
        <nav className="bottom-nav" aria-label="Điều hướng điện thoại">
          {[
            { href: "/", label: "Khám phá", Icon: Flower2 },
            { href: "/notifications", label: "Thông báo", Icon: Bell },
            { href: "/streak", label: "Giữ chuỗi", Icon: Flame },
            { href: "/account", label: "Tài khoản", Icon: UserRound },
          ].map(({ href, label, Icon }) => (
            <Link
              key={href}
              href={href}
              className={
                path === href ||
                (href === "/notifications" && path === "/account/notifications")
                  ? "active"
                  : ""
              }
            >
              <span className="bottom-nav-icon">
                <Icon size={21} strokeWidth={1.6} />
                {href === "/notifications" && <NotificationBadge />}
              </span>
              <span>{label}</span>
            </Link>
          ))}
        </nav>
      )}
    </>
  );
}
