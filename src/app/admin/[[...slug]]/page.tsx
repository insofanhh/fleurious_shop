import { redirect } from "next/navigation";
import { currentUser, staffRoles } from "@/lib/auth";
import { AdminDashboard } from "@/components/admin-dashboard";
export const metadata = {
  title: "Quản trị cửa hàng",
  robots: { index: false, follow: false },
};
export default async function AdminPage({
  params,
}: {
  params: Promise<{ slug?: string[] }>;
}) {
  const user = await currentUser();
  if (!user) redirect("/auth/login?next=/admin");
  if (!staffRoles.includes(user.role)) redirect("/account");
  return (
    <AdminDashboard
      key={(await params).slug?.[0] ?? "overview"}
      section={(await params).slug?.[0] ?? "overview"}
      role={user.role}
      name={user.name}
    />
  );
}
