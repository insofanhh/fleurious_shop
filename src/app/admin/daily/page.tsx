import { redirect } from "next/navigation";
import { currentUser, can } from "@/lib/auth";
import { DailyAdmin } from "@/components/daily-admin";
export const metadata = {
  title: "Fleurious Daily · Quản lý lịch hoa",
  robots: { index: false, follow: false },
};
export default async function Page() {
  const user = await currentUser();
  if (!user) redirect("/auth/login?next=/admin/daily");
  if (!can(user.role, "orders") && !can(user.role, "payments"))
    redirect("/admin");
  return <DailyAdmin role={user.role} />;
}
