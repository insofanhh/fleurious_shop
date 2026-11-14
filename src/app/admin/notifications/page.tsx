import { NotificationInbox } from "@/components/notification-center";
export const metadata = {
  title: "Thông báo quản trị",
  robots: { index: false, follow: false },
};
export default function NotificationsPage() {
  return <NotificationInbox />;
}
