"use client";
import { NotificationInbox } from "./notification-center";
import { Select } from "./ui/select";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { motion } from "motion/react";
import {
  ArrowDown,
  ArrowRight,
  ArrowUpRight,
  Check,
  ChevronDown,
  Flower2,
  Heart,
  LayoutGrid,
  ListFilter,
  Minus,
  Plus,
  Search,
  ShoppingBag,
  Sparkles,
  Truck,
  ShieldCheck,
  Leaf,
  Flame,
} from "lucide-react";
import { useShop } from "./shop-provider";
import type { Product } from "@/lib/types";
import { money } from "@/lib/time";
import { ProductReviews } from "./product-reviews";
import { track } from "./analytics-consent";
import {
  AccountPage,
  AuthPage,
  CheckoutPage,
  MembershipPage,
  OrderPage,
  QrPage,
  StreakPage,
} from "./customer-features";
export function ProductCard({
  product,
  index = 0,
}: {
  product: Product;
  index?: number;
}) {
  const { favorite, favorites, add } = useShop();
  const variant = product.variants[0];
  return (
    <motion.article
      layout="position"
      transition={{ duration: 0.22 }}
      className={`product-card product-height-${index % 4}`}
    >
      <div className="product-image-wrap">
        <Link href={`/flowers/${product.slug}`} className="product-image-link">
          <img
            src={product.image}
            alt={product.name}
            width="600"
            height="760"
            loading={index < 2 ? "eager" : "lazy"}
          />
        </Link>
        {product.badge && (
          <span className="product-badge">{product.badge}</span>
        )}
        <button
          className={`favorite-button glass ${favorites.includes(product.id) ? "selected" : ""}`}
          onClick={() => favorite(product.id)}
          aria-label={`${favorites.includes(product.id) ? "Bỏ yêu thích" : "Yêu thích"} ${product.name}`}
        >
          <Heart
            size={17}
            fill={favorites.includes(product.id) ? "currentColor" : "none"}
            strokeWidth={1.4}
          />
        </button>
        <button
          className="quick-add glass"
          onClick={() => add(variant.id)}
          disabled={variant.stock <= variant.reserved}
          aria-label={`Thêm ${product.name} vào giỏ`}
        >
          <Plus size={18} />
        </button>
      </div>
      <div className="product-meta">
        <Link href={`/flowers/${product.slug}`}>
          <h3>{product.name}</h3>
          <p>{product.subtitle}</p>
        </Link>
        <span>{money(variant.price)}</span>
      </div>
    </motion.article>
  );
}
export function Storefront({ segments }: { segments: string[] }) {
  const [first, second] = segments;
  if (!first) return <Home />;
  if (first === "flowers" && second) return <ProductDetail slug={second} />;
  if (first === "flowers" || first === "collections" || first === "favorites")
    return (
      <Catalogue
        collection={first === "collections" ? second : undefined}
        favoritesOnly={first === "favorites"}
      />
    );
  if (first === "membership")
    return (
      <MembershipPage
        invoiceId={second === "invoices" ? segments[2] : undefined}
      />
    );
  if (first === "notifications") return <NotificationInbox />;
  if (first === "streak") return <StreakPage />;
  if (first === "cart") return <Cart />;
  if (first === "checkout") return <CheckoutPage />;
  if (first === "auth") return <AuthPage mode={second ?? "login"} />;
  if (first === "account") return <AccountPage section={second} />;
  if (first === "orders") return <OrderPage id={second} />;
  if (first === "q") return <QrPage token={second} />;
  return <ContentPage slug={first} />;
}
function Home() {
  const { products, settings, content, membershipTiers } = useShop();
  const baseMember = membershipTiers.find((t) => t.rank === 0);
  const banner = content.find((c) => c.kind === "banner");
  return (
    <>
      <section className="hero container">
        <div className="hero-copy">
          <span className="eyebrow">
            <span className="little-line" /> HOA TƯƠI · CẢM XÚC THẬT
          </span>
          {banner ? (
            <h1 className="preserve-lines">{banner.title}</h1>
          ) : (
            <h1>
              Gửi hoa,
              <br />
              gửi những điều
              <br />
              <em>dịu dàng.</em>
            </h1>
          )}
          <p>
            {banner ? (
              banner.body
            ) : (
              <>
                Một bó hoa, một lời chưa nói.
                <br />
                Để Fleurious kể câu chuyện của bạn.
              </>
            )}
          </p>
          <Link href="/flowers" className="button glass-primary">
            Khám phá những đóa hoa <ArrowUpRight size={19} />
          </Link>
          <div className="hero-bottom">
            <div className="mini-avatars">
              <img src="/images/pink.webp" alt="" />
              <img src="/images/white.webp" alt="" />
              <span>
                <Heart size={15} />
              </span>
            </div>
            <span>
              Được bó bằng tay.
              <br />
              <strong>Được gửi bằng cả tấm lòng.</strong>
            </span>
          </div>
        </div>
        <div className="hero-visual">
          <div className="hero-arch">
            <img
              src={banner?.image || "/images/roses.webp"}
              alt="Bó hoa được nâng niu, gửi cùng những điều dịu dàng"
              width="1000"
              height="1200"
              fetchPriority="high"
            />
          </div>
          <span className="hero-round-seal">
            HANDPICKED
            <br />
            <Flower2 size={27} strokeWidth={1} />
            <span>WITH LOVE</span>
          </span>
          <div className="hero-photo-note glass">
            <span className="note-flower">✧</span>
            <div>
              <strong>Một chút hoa, một chút yêu.</strong>
              <span>Cho người thương. Cho chính mình.</span>
            </div>
          </div>
          <span className="hero-vertical">
            A LITTLE FLOWER. A LOT OF FEELING.
          </span>
        </div>
      </section>
      <div className="promise-strip">
        <span>
          <Flower2 /> Hoa tươi chọn mỗi ngày
        </span>
        <span>
          <Truck /> Giao tận tay tại Hà Nội
        </span>
        <span>
          <Heart /> Thiệp viết tay, gửi lời thương
        </span>
        <span>
          <Leaf /> Nâng niu từng chi tiết
        </span>
      </div>
      <section className="section container">
        <div className="section-heading">
          <div>
            <span className="eyebrow">MỖI DỊP, MỘT CÂU CHUYỆN</span>
            <h2>
              Hôm nay, bạn muốn <em>gửi điều gì?</em>
            </h2>
          </div>
        </div>
        <div className="occasion-grid">
          {[
            {
              title: "Một lời yêu",
              label: "Kỷ niệm",
              slug: "ky-niem",
              image: "/images/roses.webp",
            },
            {
              title: "Niềm vui mới",
              label: "Sinh nhật",
              slug: "sinh-nhat",
              image: "/images/pink.webp",
            },
            {
              title: "Cho riêng mình",
              label: "Tặng bản thân",
              slug: "tang-ban-than",
              image: "/images/white.webp",
            },
            {
              title: "Vạn điều tốt đẹp",
              label: "Chúc mừng",
              slug: "chuc-mung",
              image: "/images/yellow.webp",
            },
          ].map((o, i) => (
            <Link
              href={`/collections/${o.slug}`}
              className="occasion-card"
              key={o.slug}
            >
              <img
                src={o.image}
                width="400"
                height="440"
                alt={o.label}
                loading="lazy"
              />
              <span className="occasion-number">0{i + 1}</span>
              <div>
                <span>{o.label}</span>
                <h3>{o.title}</h3>
              </div>
              <ArrowUpRight size={22} />
            </Link>
          ))}
        </div>
      </section>
      <section className="section container featured-section">
        <div className="section-heading">
          <div>
            <span className="eyebrow">ĐƯỢC CHỌN BẰNG CẢ TẤM LÒNG</span>
            <h2>
              Những đóa hoa <em>được yêu.</em>
            </h2>
          </div>
          <Link href="/flowers" className="text-link">
            Ghé thăm vườn hoa <ArrowUpRight size={18} />
          </Link>
        </div>
        <div className="product-grid editorial">
          {products.slice(0, 4).map((p, i) => (
            <ProductCard key={p.id} product={p} index={i} />
          ))}
        </div>
        <div className="center mobile-only">
          <Link href="/flowers" className="text-link">
            Xem tất cả hoa <ArrowRight size={17} />
          </Link>
        </div>
      </section>
      <section className="membership-story container">
        <div className="story-image">
          <img
            src="/images/soft.webp"
            alt="Hoa dành cho những ngày bạn muốn nâng niu bản thân"
            width="750"
            height="800"
            loading="lazy"
          />
          <span className="image-caption">little rituals, lovely days.</span>
        </div>
        <div className="story-copy">
          <span className="eyebrow">
            FLEURIOUS CIRCLE <Sparkles size={15} />
          </span>
          <h2>
            Thêm một chút đặc biệt
            <br />
            cho người <em>yêu hoa.</em>
          </h2>
          <p>
            Trở thành hội viên để mỗi lần gửi hoa đều có thêm một niềm vui nhỏ.
          </p>
          <div className="benefit-row">
            <span>
              <Flower2 />
              {baseMember?.quota ?? settings.memberQuota} đơn ưu đãi mỗi tháng
            </span>
            <span>
              <Heart />
              Giảm {baseMember?.percent ?? settings.memberPercent}%, tối đa{" "}
              {money(baseMember?.cap ?? settings.memberCap)}
            </span>
          </div>
          <Link href="/membership" className="button glass-primary">
            Bước vào vòng tròn yêu hoa <ArrowUpRight size={18} />
          </Link>
          <span className="small muted">
            Đăng ký miễn phí · Hết lượt vẫn mua theo giá thường
          </span>
        </div>
      </section>
      <section className="streak-story container">
        <div>
          <span className="eyebrow">NHỮNG NGÀY CÓ HOA</span>
          <h2>
            Một đóa hoa hôm nay.
            <br />
            <em>Một kỷ niệm ở lại.</em>
          </h2>
          <p>
            Quét QR từ một đơn hoa, lưu một ngày dịu dàng.
            <br />
            Gom những ngày có hoa và mở những món quà nhỏ.
          </p>
          <Link href="/streak" className="text-link">
            Khám phá lịch hoa của bạn <ArrowUpRight size={18} />
          </Link>
        </div>
        <div className="mini-calendar" aria-label="Minh họa lịch ảnh giữ chuỗi">
          <div>
            <span>YOUR BLOOMING DAYS</span>
            <Flame size={20} />
          </div>
          <section>
            {["T2", "T3", "T4", "T5", "T6", "T7", "CN"].map((d) => (
              <span key={d}>{d}</span>
            ))}
            {Array.from({ length: 14 }, (_, i) => (
              <span
                className={[2, 3, 4, 8, 9].includes(i) ? "with-flower" : ""}
                key={i}
              >
                {[2, 3, 4, 8, 9].includes(i) && (
                  <>
                    <img src={products[i % products.length]?.image} alt="" />
                    <Flame size={11} fill="currentColor" />
                  </>
                )}
                <b>{i + 1}</b>
              </span>
            ))}
          </section>
          <p>Chỉ là những ngày bình thường, có thêm hoa.</p>
        </div>
      </section>
      <section className="journal-section container">
        <div className="section-heading">
          <div>
            <span className="eyebrow">MỘT CHÚT CẢM HỨNG</span>
            <h2>
              Chuyện hoa <em>& những ngày thường.</em>
            </h2>
          </div>
        </div>
        <Link href="/cham-hoa" className="journal-card">
          <img
            src="/images/garden.webp"
            alt="Một góc vườn hoa"
            width="1200"
            height="600"
            loading="lazy"
          />
          <div>
            <span className="eyebrow">CHĂM HOA · 3 PHÚT ĐỌC</span>
            <h3>Để những ngày có hoa dài hơn.</h3>
            <span className="text-link">
              Đọc câu chuyện <ArrowUpRight size={17} />
            </span>
          </div>
        </Link>
      </section>
    </>
  );
}
function Catalogue({
  collection,
  favoritesOnly,
}: {
  collection?: string;
  favoritesOnly?: boolean;
}) {
  const { products, favorites, taxonomies } = useShop();
  const collectionTaxonomy = taxonomies.find((t) => t.slug === collection);
  const params = useSearchParams();
  const initialOccasion: Record<string, string> = {
    "sinh-nhat": "Sinh nhật",
    "ky-niem": "Kỷ niệm",
    "tang-ban-than": "Tặng bản thân",
    "chuc-mung": "Chúc mừng",
  };
  const [search, setSearch] = useState(params.get("q") ?? ""),
    [category, setCategory] = useState(params.get("category") ?? "Tất cả"),
    [occasion, setOccasion] = useState(
      params.get("occasion") ??
        initialOccasion[collection ?? ""] ??
        (collectionTaxonomy?.kind === "OCCASION"
          ? collectionTaxonomy.name
          : ""),
    ),
    [color, setColor] = useState(params.get("color") ?? ""),
    [sort, setSort] = useState(params.get("sort") ?? "featured"),
    [budget, setBudget] = useState(params.get("budget") ?? "all"),
    [filterOpen, setFilterOpen] = useState(false),
    [grid, setGrid] = useState(false),
    [limit, setLimit] = useState(8);
  useEffect(() => {
    const next = new URLSearchParams();
    if (search) next.set("q", search);
    if (category !== "Tất cả") next.set("category", category);
    if (occasion) next.set("occasion", occasion);
    if (color) next.set("color", color);
    if (budget !== "all") next.set("budget", budget);
    if (sort !== "featured") next.set("sort", sort);
    const value = next.toString();
    window.history.replaceState(
      window.history.state,
      "",
      `${window.location.pathname}${value ? `?${value}` : ""}`,
    );
  }, [search, category, occasion, color, budget, sort]);
  useEffect(() => {
    if (!collection) return;
    setOccasion(
      initialOccasion[collection] ??
        (collectionTaxonomy?.kind === "OCCASION"
          ? collectionTaxonomy.name
          : ""),
    );
    if (collectionTaxonomy?.kind === "CATEGORY")
      setCategory(collectionTaxonomy.name);
  }, [collection]);
  const filtered = useMemo(
    () =>
      products
        .filter(
          (p) =>
            (!favoritesOnly || favorites.includes(p.id)) &&
            (collectionTaxonomy?.kind !== "COLLECTION" ||
              collectionTaxonomy.productIds.includes(p.id)) &&
            (!color || p.color === color) &&
            (category === "Tất cả" || p.category === category) &&
            (!occasion || p.occasion === occasion) &&
            `${p.name} ${p.subtitle} ${p.color}`
              .toLocaleLowerCase("vi")
              .includes(search.toLocaleLowerCase("vi")) &&
            (budget === "all" ||
              (budget === "low"
                ? p.variants[0].price < 500000
                : budget === "mid"
                  ? p.variants[0].price >= 500000 &&
                    p.variants[0].price <= 800000
                  : p.variants[0].price > 800000)),
        )
        .sort((a, b) =>
          sort === "price-asc"
            ? a.variants[0].price - b.variants[0].price
            : sort === "price-desc"
              ? b.variants[0].price - a.variants[0].price
              : Number(b.featured) - Number(a.featured),
        ),
    [
      products,
      favorites,
      favoritesOnly,
      category,
      occasion,
      search,
      budget,
      sort,
      color,
      collectionTaxonomy,
    ],
  );
  return (
    <section className="container catalogue section">
      <div className="breadcrumb">
        <Link href="/">Trang chủ</Link>
        <span>/</span>
        <span>{favoritesOnly ? "Hoa yêu thích" : "Vườn hoa"}</span>
      </div>
      <div className="catalogue-intro">
        <span className="eyebrow">MỘT BÓ HOA, NGÀN CÁCH YÊU</span>
        <h1>
          {favoritesOnly ? (
            "Những đóa hoa bạn yêu."
          ) : occasion ? (
            <>
              {occasion},<br />
              <em>bằng những đóa hoa.</em>
            </>
          ) : (
            <>
              Tìm một bó hoa,
              <br />
              <em>kể câu chuyện của bạn.</em>
            </>
          )}
        </h1>
        <p>Mỗi đóa hoa được chọn. Mỗi cảm xúc được nâng niu.</p>
      </div>
      <div className="catalogue-controls">
        <div className="category-tabs">
          {["Tất cả", ...new Set(products.map((p) => p.category))].map((c) => (
            <button
              className={category === c ? "active" : ""}
              key={c}
              onClick={() => {
                setCategory(c);
                setLimit(8);
              }}
            >
              {c}
            </button>
          ))}
        </div>
        <div className="catalogue-actions">
          <button
            className="filter-trigger"
            onClick={() => setFilterOpen(!filterOpen)}
          >
            <ListFilter size={16} /> Bộ lọc
            {(occasion || budget !== "all") && <span className="filter-dot" />}
          </button>
          <button
            className="icon-button"
            aria-label="Đổi bố cục"
            onClick={() => setGrid(!grid)}
          >
            <LayoutGrid size={18} />
          </button>
          <Select
            aria-label="Sắp xếp sản phẩm"
            value={sort}
            onChange={(e) => {
              setSort(e.target.value);
              if (e.target.value !== "featured") setGrid(true);
            }}
          >
            <option value="featured">Được yêu thích</option>
            <option value="price-asc">Giá tăng dần</option>
            <option value="price-desc">Giá giảm dần</option>
          </Select>
        </div>
      </div>
      <div className="search-field">
        <Search size={18} />
        <input
          autoFocus={params.has("search")}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Bạn đang tìm một chút dịu dàng nào?"
          aria-label="Tìm sản phẩm"
        />
      </div>
      {filterOpen && (
        <div className="filter-panel">
          <label>
            Dịp tặng
            <Select
              value={occasion}
              onChange={(e) => setOccasion(e.target.value)}
            >
              <option value="">Mọi dịp</option>
              {[...new Set(products.map((p) => p.occasion))].map((o) => (
                <option key={o}>{o}</option>
              ))}
            </Select>
          </label>
          <label>
            Ngân sách
            <Select value={budget} onChange={(e) => setBudget(e.target.value)}>
              <option value="all">Mọi ngân sách</option>
              <option value="low">Dưới 500.000đ</option>
              <option value="mid">500.000 – 800.000đ</option>
              <option value="high">Trên 800.000đ</option>
            </Select>
          </label>
          <label>
            Màu hoa
            <Select value={color} onChange={(e) => setColor(e.target.value)}>
              <option value="">Mọi sắc màu</option>
              {[...new Set(products.map((p) => p.color))].map((c) => (
                <option key={c}>{c}</option>
              ))}
            </Select>
          </label>
          <button
            className="text-link"
            onClick={() => {
              setOccasion("");
              setBudget("all");
              setSearch("");
              setColor("");
            }}
          >
            Xóa bộ lọc
          </button>
        </div>
      )}
      <div className="results-count">
        {filtered.length} đóa hoa đang chờ bạn
        {occasion && (
          <button onClick={() => setOccasion("")}>{occasion} ×</button>
        )}
      </div>
      {filtered.length ? (
        <div className={`product-grid ${grid ? "uniform" : "editorial"}`}>
          {filtered.slice(0, limit).map((p, i) => (
            <ProductCard key={p.id} product={p} index={i} />
          ))}
        </div>
      ) : (
        <div className="empty-state">
          <Flower2 size={40} />
          <h2>Chưa tìm thấy đóa hoa này.</h2>
          <p>Thử một từ khóa hoặc ngân sách khác nhé.</p>
        </div>
      )}
      {filtered.length > limit && (
        <div className="center">
          <button
            className="button secondary"
            onClick={() => setLimit(limit + 8)}
          >
            Ngắm thêm hoa <ArrowDown size={17} />
          </button>
        </div>
      )}
    </section>
  );
}
function ProductDetail({ slug }: { slug: string }) {
  const { products, settings, user, me, add, favorite, favorites } = useShop();
  const p = products.find((p) => p.slug === slug)!;
  useEffect(() => {
    track("view_item", { productId: p.id });
  }, [p.id]);
  const [selected, setSelected] = useState(p.variants[0].id),
    [quantity, setQuantity] = useState(1),
    [tab, setTab] = useState("story");
  const variant = p.variants.find((v) => v.id === selected)!;
  const benefits = me?.membership.current;
  const memberSubtotal = variant.price * quantity;
  const remaining = user?.memberSince
    ? Math.max(
        0,
        (me?.period?.limit ?? settings.memberQuota) -
          (me?.period?.consumed ?? 0) -
          (me?.period?.reserved ?? 0),
      )
    : 0;
  return (
    <div className="container section">
      <div className="breadcrumb">
        <Link href="/flowers">Vườn hoa</Link>
        <span>/</span>
        <span>{p.name}</span>
      </div>
      <div className="product-detail">
        <div className="detail-photo">
          <img src={p.image} alt={p.name} width="900" height="1100" />
          <span className="product-badge">
            {p.badge || "Được bó bằng cả tấm lòng"}
          </span>
          <button
            className="favorite-button glass"
            onClick={() => favorite(p.id)}
            aria-label="Yêu thích"
          >
            <Heart
              size={21}
              fill={favorites.includes(p.id) ? "currentColor" : "none"}
            />
          </button>
        </div>
        <div className="detail-copy">
          <span className="eyebrow">
            {p.category.toUpperCase()} · {p.occasion.toUpperCase()}
          </span>
          <h1>{p.name}</h1>
          <p className="detail-subtitle">{p.subtitle}</p>
          <div className="detail-price">{money(variant.price)}</div>
          {remaining > 0 && benefits && memberSubtotal >= benefits.minimum ? (
            <div className="member-price">
              <Sparkles size={16} />
              <span>
                Giá {benefits.name} cho {quantity} sản phẩm{" "}
                <strong>
                  {money(
                    memberSubtotal -
                      Math.min(
                        Math.floor((memberSubtotal * benefits.percent) / 100),
                        benefits.cap,
                      ),
                  )}
                </strong>{" "}
                · Còn {remaining} lượt
              </span>
            </div>
          ) : (
            <Link href="/membership" className="member-price">
              <Sparkles size={16} />
              Thêm đặc quyền khi trở thành hội viên <ArrowUpRight size={15} />
            </Link>
          )}
          <div className="field-label">Một chút xinh, hay thật đong đầy?</div>
          <div className="variant-options">
            {p.variants.map((v) => (
              <button
                key={v.id}
                className={v.id === selected ? "selected" : ""}
                onClick={() => setSelected(v.id)}
              >
                <Flower2 size={19} />
                <strong>{v.name}</strong>
                <span>{money(v.price)}</span>
              </button>
            ))}
          </div>
          <div className="add-to-cart-row">
            <div className="quantity">
              <button
                onClick={() => setQuantity(Math.max(1, quantity - 1))}
                aria-label="Giảm số lượng"
              >
                <Minus size={16} />
              </button>
              <span>{quantity}</span>
              <button
                onClick={() => setQuantity(Math.min(20, quantity + 1))}
                aria-label="Tăng số lượng"
              >
                <Plus size={16} />
              </button>
            </div>
            <button
              className="button glass-primary"
              disabled={variant.stock - variant.reserved < quantity}
              onClick={() => add(variant.id, quantity)}
            >
              <ShoppingBag size={18} />
              {variant.stock - variant.reserved < quantity
                ? "Tạm hết hoa"
                : "Thêm vào giỏ hoa"}
            </button>
          </div>
          <div className="detail-promises">
            <span>
              <Truck size={17} />
              Chọn ngày & khung giờ tại thanh toán
            </span>
            <span>
              <Heart size={17} />
              Kèm thiệp viết tay
            </span>
            <span>
              <ShieldCheck size={17} />
              Hoa được chuẩn bị riêng cho bạn
            </span>
          </div>
          <div className="detail-tabs">
            <button
              className={tab === "story" ? "active" : ""}
              onClick={() => setTab("story")}
            >
              Câu chuyện bó hoa
            </button>
            <button
              className={tab === "care" ? "active" : ""}
              onClick={() => setTab("care")}
            >
              Chăm hoa
            </button>
          </div>
          <p className="preserve-lines muted">
            {tab === "story"
              ? p.description
              : "Thay nước sạch mỗi ngày, cắt vát gốc 1–2 cm và loại bỏ lá dưới mặt nước. Đặt hoa nơi thoáng mát, tránh nắng trực tiếp và trái cây chín."}
          </p>
        </div>
      </div>
      <ProductReviews product={p} />
      <section className="section">
        <div className="section-heading">
          <h2>
            Có thể bạn cũng <em>thương.</em>
          </h2>
        </div>
        <div className="product-grid">
          {products
            .filter((i) => i.id !== p.id)
            .slice(0, 4)
            .map((p, i) => (
              <ProductCard key={p.id} product={p} index={i} />
            ))}
        </div>
      </section>
    </div>
  );
}
function Cart() {
  const { cart, products, setQuantity } = useShop();
  const rows = cart
    .map((i) => {
      const p = products.find((p) =>
        p.variants.some((v) => v.id === i.variantId),
      );
      return p
        ? {
            ...i,
            product: p,
            variant: p.variants.find((v) => v.id === i.variantId)!,
          }
        : null;
    })
    .filter((i) => i !== null);
  const total = rows.reduce((sum, i) => sum + i.variant.price * i.quantity, 0);
  return (
    <section className="container section">
      <div className="page-heading">
        <span className="eyebrow">MỘT CHÚT DỊU DÀNG ĐÃ ĐƯỢC CHỌN</span>
        <h1>
          Giỏ hoa <em>của bạn.</em>
        </h1>
      </div>
      {rows.length ? (
        <div className="checkout-layout">
          <div className="cart-items">
            {rows.map((i) => (
              <article className="cart-row" key={i.variantId}>
                <Link href={`/flowers/${i.product.slug}`}>
                  <img
                    src={i.product.image}
                    alt={i.product.name}
                    width="120"
                    height="145"
                  />
                </Link>
                <div>
                  <h3>{i.product.name}</h3>
                  <p>{i.variant.name}</p>
                  <strong>{money(i.variant.price)}</strong>
                  <div className="quantity">
                    <button
                      aria-label={`Giảm ${i.product.name}`}
                      onClick={() => setQuantity(i.variantId, i.quantity - 1)}
                    >
                      <Minus size={14} />
                    </button>
                    <span>{i.quantity}</span>
                    <button
                      aria-label={`Tăng ${i.product.name}`}
                      onClick={() => setQuantity(i.variantId, i.quantity + 1)}
                    >
                      <Plus size={14} />
                    </button>
                  </div>
                </div>
                <button
                  className="remove-item"
                  onClick={() => setQuantity(i.variantId, 0)}
                >
                  Bỏ
                </button>
              </article>
            ))}
          </div>
          <aside className="order-summary">
            <span className="eyebrow">GỬI ĐI CÙNG TẤM LÒNG</span>
            <h2>Một lời thương.</h2>
            <div className="summary-line">
              <span>Tiền hoa</span>
              <strong>{money(total)}</strong>
            </div>
            <p className="small muted">
              Phí giao và ưu đãi được tính tại bước thanh toán.
            </p>
            <Link href="/checkout" className="button glass-primary full">
              Tiếp tục gửi hoa <ArrowRight size={18} />
            </Link>
            <Link href="/flowers" className="text-link">
              Ngắm thêm một chút
            </Link>
          </aside>
        </div>
      ) : (
        <div className="empty-state">
          <ShoppingBag size={44} strokeWidth={1} />
          <h2>Giỏ hoa đang chờ một lời thương.</h2>
          <p>Ghé vườn hoa và chọn điều bạn muốn gửi.</p>
          <Link href="/flowers" className="button">
            Tìm một bó hoa <ArrowUpRight size={18} />
          </Link>
        </div>
      )}
    </section>
  );
}
function ContentPage({ slug }: { slug: string }) {
  const { content } = useShop();
  const page = content.find((c) => c.slug === slug);
  return (
    <article className="container content-page section">
      <span className="eyebrow">FLEURIOUS JOURNAL</span>
      <h1>{page?.title ?? "Chuyện của hoa"}</h1>
      {page?.image && (
        <img src={page.image} width="1200" height="700" alt={page.title} />
      )}
      <div className="prose preserve-lines">
        {page?.body ?? "Chúng tôi đang chuẩn bị câu chuyện này."}
      </div>
      <Link href="/flowers" className="text-link">
        Ghé thăm vườn hoa <ArrowRight size={18} />
      </Link>
    </article>
  );
}
