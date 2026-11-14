# Trạng thái triển khai — 14/11/2026

## Bản chạy được

Đã xây dựng ứng dụng Next.js/MySQL tại `C:\laragon\www\Fleurious_shop`, chạy production local ở `http://localhost:3000`, admin ở `/admin`. Mã và dữ liệu thật phía server được dùng cho các luồng hiện có; không dùng localStorage giả lập đơn, quota hoặc quyền quản trị. LocalStorage chỉ giữ giỏ nháp và yêu thích của khách chưa đăng nhập.

- Giờ Hà Nội UTC+7 cho ngày giao, quota, lịch và chuỗi; timestamp UTC. Tên IANA đúng: `Asia/Ho_Chi_Minh`.
- Thanh toán chọn SePay chuyển khoản VietQR + webhook API Key; chưa có khóa thật nên chưa mở thanh toán SePay thực tế. COD vẫn có thể dùng theo cấu hình.
- Storefront, catalogue/lọc/sort, sản phẩm/size, giỏ/checkout, tài khoản, hội viên, ví thưởng, QR và lịch ảnh.
- Admin: bảng/Kanban/lịch, phân công, đổi lịch, giá/tồn nhiều size, upload, taxonomy/collection, khách/hội viên, voucher, nội dung, review moderation, payment/refund, settings, roles/audit/jobs.
- N đơn ưu đãi mỗi tháng; hết N mua thường; ledger và transaction chống vượt quota.
- Hội viên có phiên bản quyền lợi theo hạng, gói trả trước tháng/năm, gia hạn/nâng gói và ba nguồn PAID/EARNED/ADMIN. Hạng cũ được bảo toàn LEGACY; admin quản lý hạng, cấp/thu hồi, hóa đơn và hoàn phí tại `/admin/members`.
- Quà sinh nhật một lần mỗi năm; chi tiêu ròng và hoàn phần tiền hoa; SePay dùng mã FLM riêng, đối soát v2 tùy chọn có checkpoint và chống trùng giữa API/webhook. Chưa cấu hình ngân hàng thật nên chưa thu phí thật.
- Giữ chuỗi liên tiếp/tích lũy riêng, một ngày/user, giới hạn QR, hai mốc cơ bản và tối đa 20 mốc phần trăm bổ sung có scope/time window. Có ghi quyền nhận thưởng khi chờ ngân sách.
- Socket.IO theo session, outbox/lease; queue MySQL có retry, tùy chọn BullMQ/Redis và fanout Redis.
- PWA, cache public giới hạn, offline notice, install/update guide, push adapter; email xác minh/reset và 2FA TOTP/recovery.
- Analytics nội bộ MySQL; adapter GA4/PostHog và consent đã có, chưa bật hoặc xác minh tại vendor vì thiếu project keys.

## Kiểm chứng đã thực hiện

| Kiểm tra | Kết quả |
|---|---|
| TypeScript `tsc --noEmit` | Qua |
| Production `npm run build` | Qua, Webpack, không còn warning optional BullMQ |
| Migrations | 11 migration applied, schema up to date |
| Cài migration từ database mới | Qua toàn bộ 11 migration và 51 test trên DB `_test` tạm; đã dọn DB tạm sau kiểm thử |
| `npm test` | **51/51 qua**, dùng database `_test` riêng và kiểm tra lại cả cài đặt schema mới |
| HTTP smoke | Các API admin và trang public chính qua; kiểm tra 401, CSRF, login/logout |
| Dependency audit production | 0 lỗ hổng được npm báo ở thời điểm kiểm tra |
| Browser | Xem mobile 390px và desktop 1440px, catalogue, thêm giỏ, server quote, login admin, chuyển menu, editor size, mốc thưởng và lịch |

Các ca nghiệp vụ gồm: timezone ngày/tháng, chuỗi qua tháng và mất ngày, mã hóa token, quota cạnh tranh, kho cuối, slot cuối, hai QR một ngày, hai người tranh QR, cấp thưởng không lặp, source cancel/revoke, reward đang giữ, chờ ngân sách, scope sản phẩm và phân bổ giảm, SePay lệch tiền/tới muộn/lặp, checkout idempotency/song song, giữ quota kỳ cũ, đổi hạng, TOTP/recovery replay và analytics consent/dedup/retry theo vendor.

Kiểm thử SePay dùng payload giả lập và secret test trong tiến trình kiểm thử; **không có giao dịch ngân hàng thật**. Npm audit sạch không thay thế kiểm tra an ninh triển khai. Docker/Linux runtime và Redis production chưa được chạy trên máy này; migration đã chuẩn hóa case để không phụ thuộc MySQL Windows tự gộp chữ hoa/thường.

## Để nhận đơn thật

1. Cấu hình tài khoản/khóa webhook SePay, public HTTPS và webhook retry; thử trong SePay Test Mode rồi xác nhận một giao dịch thật bởi chủ shop.
2. Cấu hình SMTP, VAPID, URL production và các secret riêng; tạo Owner thật, bật 2FA, không dùng tài khoản `.local`.
3. Chốt N, mức giảm/cap, ngân sách, hạng, vùng/slot/ngày nghỉ; thay giá, ảnh, số điện thoại và chính sách mẫu bằng dữ liệu cửa hàng.
4. Cấu hình cron-job.org theo README, giám sát lỗi, backup và thử restore DB + ảnh + khóa mã hóa.
5. UAT trên iPhone/Android thực, kiểm tra PWA/push, payload analytics tại project thật nếu bật; đo hiệu năng và tải theo lượng khách dự kiến.

Phần mở rộng còn lại được liệt kê trung thực trong README: nhiều chiến dịch độc lập, quà vật lý/ship/điểm, giao hoa định kỳ, tự trích phí gia hạn/referral, quản lý BOM/lô/hao hụt, tuyến giao, ảnh duyệt hoa, dashboard vendor nâng cao và E2E browser tự động. Hội viên trả trước tháng/năm đã triển khai; không xem các phần mở rộng khác là đã hoàn thành.

Chi tiết vận hành: [README](../README.md). Đặc tả gốc và điều chỉnh SePay/Hà Nội: [Kế hoạch](FLEURIOUS_WEBSITE_PLAN.vi.md).
