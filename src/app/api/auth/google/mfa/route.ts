import { NextRequest } from "next/server";
import { z } from "zod";
import { handle, checkOrigin, json, rateLimit } from "@/lib/api";
import { completeGoogleMfa, GOOGLE_COOKIE } from "@/lib/google-auth";
import { SESSION_COOKIE } from "@/lib/auth";

export const runtime = "nodejs";
export async function POST(request: NextRequest) {
  return handle(async () => {
    checkOrigin(request);
    const input = z
      .object({
        ticket: z.string().regex(/^[a-f0-9]{64}$/),
        code: z.string().trim().min(1).max(30),
      })
      .parse(await request.json());
    await rateLimit(`google:mfa:${input.ticket}`, 6, 300);
    const result = await completeGoogleMfa(
      input.ticket,
      request.cookies.get(GOOGLE_COOKIE)?.value ?? "",
      input.code,
    );
    const response = json({ next: result.nextPath });
    response.cookies.set(SESSION_COOKIE, result.session, {
      httpOnly: true,
      secure: new URL(process.env.APP_URL ?? request.url).protocol === "https:",
      sameSite: "lax",
      path: "/",
      maxAge: 30 * 86400,
    });
    response.cookies.set(GOOGLE_COOKIE, "", {
      path: "/api/auth/google",
      maxAge: 0,
    });
    return response;
  });
}
