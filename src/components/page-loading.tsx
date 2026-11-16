import { AnimatedBrandMark } from "@/components/brand-mark";

export default function PageLoading() {
  return (
    <div
      className="page-loading"
      role="status"
      aria-live="polite"
      aria-busy="true"
    >
      <AnimatedBrandMark />
      <p>Đang chuẩn bị một chút dịu dàng…</p>
    </div>
  );
}
