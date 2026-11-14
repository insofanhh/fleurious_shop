import { NextRequest, NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import {
  GOOGLE_COOKIE,
  googleAuthAvailable,
  startGoogleLogin,
} from "@/lib/google-auth";
import { safeAuthNext } from "@/lib/auth-redirect";
import { rateLimit } from "@/lib/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: NextRequest) {
  const next = safeAuthNext(request.nextUrl.searchParams.get("next"));
  const origin = process.env.APP_URL ?? request.nextUrl.origin;
  const login = new URL("/auth/login", origin);
  login.searchParams.set("next", next);
  if (!googleAuthAvailable()) {
    login.searchParams.set("oauth_error", "unavailable");
    return NextResponse.redirect(login);
  }
  try {
    await rateLimit(
      `google:start:${request.headers.get("x-forwarded-for")?.split(",")[0] ?? "local"}`,
      20,
      300,
    );
    const user = await currentUser();
    const link = request.nextUrl.searchParams.get("intent") === "link";
    if (link && !user) return NextResponse.redirect(login);
    const result = await startGoogleLogin(next, link ? user!.id : undefined);
    const response = NextResponse.redirect(result.url);
    response.cookies.set(GOOGLE_COOKIE, result.browser, {
      httpOnly: true,
      secure: new URL(origin).protocol === "https:",
      sameSite: "lax",
      path: "/api/auth/google",
      maxAge: 600,
    });
    response.headers.set("Cache-Control", "no-store");
    response.headers.set("Referrer-Policy", "no-referrer");
    return response;
  } catch {
    login.searchParams.set("oauth_error", "failed");
    return NextResponse.redirect(login);
  }
}
