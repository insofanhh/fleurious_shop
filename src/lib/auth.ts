import { cookies } from "next/headers";
import { db } from "./db";
import { hash, token } from "./security";
export const SESSION_COOKIE = "fleurious_session";
export async function currentUser() {
  const value = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!value) return null;
  const session = await db.session.findUnique({
    where: { id: hash(value) },
    include: { user: true },
  });
  return session && session.expiresAt > new Date() && !session.user.disabled
    ? session.user
    : null;
}
export async function createSession(userId: string) {
  const value = token();
  await db.session.create({
    data: {
      id: hash(value),
      userId,
      expiresAt: new Date(Date.now() + 30 * 86400000),
    },
  });
  return value;
}
export const publicUser = (u: {
  id: string;
  name: string;
  email: string;
  role: string;
  phone: string;
  verified: boolean;
  memberSince: Date | null;
  tier: string;
  googleSubject?: string | null;
}) => ({
  id: u.id,
  name: u.name,
  email: u.email,
  phone: u.phone,
  role: u.role,
  verified: u.verified,
  memberSince: u.memberSince,
  tier: u.tier,
  googleLinked: !!u.googleSubject,
});
export const staffRoles = [
  "OWNER",
  "MANAGER",
  "FLORIST",
  "DELIVERY",
  "MARKETING",
  "ACCOUNTANT",
];
export { can } from "./auth-policy";
