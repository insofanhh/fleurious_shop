"use client";
import { useShop } from "./shop-provider";
import { safeAuthNext } from "@/lib/auth-redirect";

export function GoogleSignIn({
  next,
  link = false,
}: {
  next?: string | null;
  link?: boolean;
}) {
  const { googleAuthAvailable } = useShop();
  const content = (
    <>
      <svg width="19" height="19" viewBox="0 0 24 24" aria-hidden="true">
        <path
          fill="#4285F4"
          d="M21.6 12.23c0-.71-.06-1.39-.18-2.05H12v3.88h5.38a4.61 4.61 0 0 1-2 3.02v2.51h3.24c1.9-1.75 2.98-4.33 2.98-7.36Z"
        />
        <path
          fill="#34A853"
          d="M12 22c2.7 0 4.96-.9 6.62-2.41l-3.24-2.51c-.9.6-2.05.97-3.38.97-2.6 0-4.8-1.76-5.6-4.12H3.05v2.59A10 10 0 0 0 12 22Z"
        />
        <path
          fill="#FBBC05"
          d="M6.4 13.93a6 6 0 0 1 0-3.86V7.48H3.05a10 10 0 0 0 0 9.04l3.35-2.59Z"
        />
        <path
          fill="#EA4335"
          d="M12 5.95c1.47 0 2.79.5 3.82 1.5l2.87-2.87A9.6 9.6 0 0 0 12 2a10 10 0 0 0-8.95 5.48l3.35 2.59c.8-2.36 3-4.12 5.6-4.12Z"
        />
      </svg>
      <span>{link ? "Liên kết với Google" : "Tiếp tục với Google"}</span>
    </>
  );
  return (
    <div className="google-sign-in">
      {googleAuthAvailable ? (
        <a
          className="button secondary full google-button"
          href={`/api/auth/google?next=${encodeURIComponent(safeAuthNext(next))}${link ? "&intent=link" : ""}`}
        >
          {content}
        </a>
      ) : (
        <button
          className="button secondary full google-button"
          type="button"
          disabled
        >
          {content}
        </button>
      )}
      {!googleAuthAvailable && (
        <p className="small muted">Đăng nhập Google sẽ sớm sẵn sàng.</p>
      )}
    </div>
  );
}
