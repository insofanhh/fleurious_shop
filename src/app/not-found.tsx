import Link from "next/link";
export default function NotFound() {
  return (
    <div className="empty-state">
      <span className="eyebrow">404 · LẠC MỘT CHÚT THÔI</span>
      <h1>Bó hoa này chưa ở đây.</h1>
      <Link className="button" href="/flowers">
        Về vườn hoa
      </Link>
    </div>
  );
}
