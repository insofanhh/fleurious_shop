import { after, NextRequest, NextResponse } from "next/server";
import { currentUser, createSession, SESSION_COOKIE } from "@/lib/auth";
import { GOOGLE_COOKIE, completeGoogleLogin } from "@/lib/google-auth";
import { AppError } from "@/lib/errors";
import { db } from "@/lib/db";
import { hash, equal } from "@/lib/security";
import { runCloudWorker } from "@/lib/cloud-worker";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;
export async function GET(request: NextRequest) {
  const origin = process.env.APP_URL ?? request.nextUrl.origin;
  const state = request.nextUrl.searchParams.get("state") ?? "";
  const browser = request.cookies.get(GOOGLE_COOKIE)?.value ?? "";
  let response: NextResponse;
  let next = "/account";
  let mfa = false;
  try {
    if (!/^[a-f0-9]{64}$/.test(state) || !/^[a-f0-9]{64}$/.test(browser))
      throw new AppError(
        "GOOGLE_EXPIRED",
        "Phiên đăng nhập không hợp lệ.",
        401,
      );
    const attempt = await db.googleLoginAttempt.findUnique({
      where: { id: hash(state) },
    });
    if (attempt && equal(attempt.browserHash, hash(browser)))
      next = attempt.nextPath;
    const result = await completeGoogleLogin({
      state,
      browser,
      code: request.nextUrl.searchParams.get("code") ?? undefined,
      error: request.nextUrl.searchParams.get("error") ?? undefined,
      currentUserId: (await currentUser())?.id,
    });
    mfa = result.needsMfa;
    response = NextResponse.redirect(
      new URL(
        mfa
          ? `/auth/google-mfa?ticket=${state}&next=${encodeURIComponent(result.nextPath)}`
          : result.nextPath,
        origin,
      ),
    );
    if (!mfa)
      response.cookies.set(
        SESSION_COOKIE,
        await createSession(result.user.id),
        {
          httpOnly: true,
          secure: new URL(origin).protocol === "https:",
          sameSite: "lax",
          path: "/",
          maxAge: 30 * 86400,
        },
      );
    if (process.env.VERCEL === "1")
      after(async () => {
        await runCloudWorker(true).catch(() => {});
      });
  } catch (error) {
    const code =
      error instanceof AppError
        ? error.code.replace("GOOGLE_", "").toLowerCase()
        : "failed";
    const login = new URL("/auth/login", origin);
    login.searchParams.set(
      "oauth_error",
      [
        "cancelled",
        "expired",
        "account_exists",
        "blocked",
        "link_mismatch",
        "unavailable",
      ].includes(code)
        ? code
        : "failed",
    );
    login.searchParams.set("next", next);
    response = NextResponse.redirect(login);
  }
  if (!mfa)
    response.cookies.set(GOOGLE_COOKIE, "", {
      path: "/api/auth/google",
      maxAge: 0,
    });
  response.headers.set("Cache-Control", "no-store");
  response.headers.set("Referrer-Policy", "no-referrer");
  return response;
}
