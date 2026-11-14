import { redirect } from "next/navigation";
import { currentUser, staffRoles } from "@/lib/auth";
import { AdminFrame } from "@/components/admin-frame";
export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await currentUser();
  if (!user) redirect("/auth/login?next=/admin");
  if (!staffRoles.includes(user.role)) redirect("/account");
  return (
    <AdminFrame role={user.role} name={user.name}>
      {children}
    </AdminFrame>
  );
}
