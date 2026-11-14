# Triển khai Vercel + TiDB

## Cấu hình

- Website: https://fleurious-shop.vercel.app
- GitHub: https://github.com/insofanhh/fleurious_shop
- Node.js 24, Next.js, region Singapore `sin1`.
- TiDB Cloud sử dụng TLS và kiểm tra chứng chỉ. `DATABASE_URL` lưu trong Vercel Environment Variables, không ghi trong repo.
- Các secret được lưu ở môi trường Production. Preview không kết nối chung database Production; cần cung cấp database riêng nếu muốn chạy bản preview có dữ liệu.
- `SESSION_SECRET` giữ nguyên khi chuyển DB để tiếp tục giải mã cấu hình SePay, QR và 2FA. Sao lưu secret riêng cùng backup DB.
- Build chạy `prisma migrate deploy` trước `npm run build`. Migration được áp dụng lên database cấu hình của môi trường đó.

Vercel chạy Next.js trực tiếp. Local/container vẫn chạy `server.ts` + Socket.IO. Cloud dùng `/api/realtime` với WebSocket của Vercel; mỗi kết nối đọc các sự kiện đã lưu trong TiDB theo đúng user/quyền, chỉ gửi tín hiệu yêu cầu tải lại dữ liệu. Phiên được kiểm tra lại, tự reconnect trước giới hạn thời gian của function. Có đồng bộ dự phòng khi mất kết nối.

Worker cloud chạy qua `after()` sau API và qua scheduler; job/outbox có lease, retry và khóa idempotency. Ảnh upload được re-encode WebP rồi lưu vào bảng `MediaAsset` trên TiDB, thay cho filesystem tạm của Vercel. Ảnh public/brand đi cùng code.

## Thiết lập cron-job.org thủ công

Tạo **một** job:

- URL: `https://fleurious-shop.vercel.app/api/internal/schedule`
- Method: **POST**.
- Header: `Authorization: Bearer <CRON_SECRET>`; lấy secret từ cấu hình Production trong Vercel hoặc file `.env.deploy.local` trên máy quản trị. Không đặt secret trong URL.
- Lịch: mỗi phút; timezone `Asia/Ho_Chi_Minh` (Hà Nội, UTC+7).
- Bật retry/thông báo khi lỗi; HTTP **202** nghĩa là đã nhận tác vụ. Xem kết quả thực thi trong Admin → Tác vụ nền.

Endpoint tự chia lịch: dọn đơn mỗi phút; hội viên và nhắc giao mỗi 5 phút; đối soát SePay mỗi 15 phút; tổng quan đơn lúc 07:00; nhắc giữ chuỗi lúc 20:30. Nếu một lần kích hoạt bị bỏ lỡ, tác vụ ngày chạy bù trong ngày sau giờ quy định. Gửi lặp cùng bucket không tạo job trùng.

Khi chưa bật cron, API đang có traffic vẫn xử lý outbox/dọn reservation; không coi đó là thay thế lịch chạy khi website không có lượt truy cập.

## SePay, email và vận hành

- Cấu hình ngân hàng/API key ở Admin → Cài đặt. Cập nhật webhook trong tài khoản SePay thành `https://fleurious-shop.vercel.app/api/payments/sepay/webhook`, dùng API key hiện có; URL local cũ không nhận webhook cloud.
- QR giữ chuỗi mới dùng domain production. Card đã in bằng localhost cần xuất lại từ đơn trên website công khai.
- Đăng ký/xác minh và quên mật khẩu cần SMTP thật. Các biến `SMTP_*`, VAPID và analytics được thêm vào Vercel khi có cấu hình tương ứng; không tạo dịch vụ giả thay cho dịch vụ chưa kết nối.
- Dùng tài khoản admin đã có trong DB; thông tin bootstrap local nằm trong `.local-access.txt` trên máy quản trị, không publish. Bật 2FA trước vận hành.
- `GET /api/health` kiểm tra kết nối DB. Quản trị, dữ liệu khách, đơn và card luôn kiểm tra đăng nhập/quyền.

## Chuyển dữ liệu và backup

`scripts/migrate-to-tidb.ts --copy` đọc source `.env` và destination `.env.deploy.local`. Script chỉ cho phép nguồn local, đích TiDB và các bảng đích trống; không xóa/ghi đè database đang có dữ liệu. Script tạo snapshot nhất quán trong `backups/` (đã gitignore), import trong transaction và đối chiếu số bản ghi. Migration schema cần chạy trước.

Giữ database local làm bản nguồn; ứng dụng local tiếp tục dùng `.env` của local. Backup dữ liệu/secret không commit lên Git. Sau khi cloud bắt đầu nhận đơn, cloud là nguồn dữ liệu vận hành; không chạy lại script import local.
