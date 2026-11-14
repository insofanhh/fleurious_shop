# Fleurious

Triển khai cloud: [Vercel + TiDB và thiết lập cron-job.org](docs/VERCEL_DEPLOY.vi.md).

Website bán hoa dùng Next.js App Router, TypeScript, MySQL/Prisma, WebSocket và SePay. Giao diện ưu tiên mobile, màu Cellar Burgundy `#6e1423` / Cream `#f4eade`, các điều khiển Liquid Glass có chế độ giảm chuyển động.

## Chạy ở máy hiện tại

- Storefront: http://localhost:3000
- Admin: http://localhost:3000/admin
- Thông tin hai tài khoản **local** được tạo ngẫu nhiên nằm trong `.local-access.txt`. File này và `.env` được bỏ qua khi commit.
- Database ứng dụng: `fleurious_shop`. Kiểm thử dùng database riêng có hậu tố `_test`, không xóa dữ liệu cửa hàng.
- Múi giờ hiển thị: **Hà Nội · UTC+7**. IANA tương ứng là `Asia/Ho_Chi_Minh`; timestamp được lưu/đọc UTC. Không có IANA `Asia/Hanoi`.

Yêu cầu: Node.js 24 LTS, MySQL 8.x. Bản local đã kiểm thử trên MySQL 8.0.30 của Laragon; production nên dùng MySQL 8.4 LTS. Redis 7 chỉ cần khi bật queue/fanout Redis.

```powershell
npm ci
npm run setup
# Kiểm tra DATABASE_URL trong .env; setup giữ nguyên .env đã tồn tại.
mysql -h 127.0.0.1 -u root -e "CREATE DATABASE IF NOT EXISTS fleurious_shop CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"
npm run db:migrate
npm run db:generate
npm run db:seed
npx tsx scripts/migrate-membership.ts
npm run dev
```

Next.js được chạy bằng custom Node server để phục vụ cả HTTP và Socket.IO. Webpack được chọn để tránh lỗi junction của Turbopack trên môi trường Windows/Laragon này.

```powershell
npm run build
npm start
```

Server local mặc định chỉ bind `127.0.0.1`. Dùng `HOST=0.0.0.0` khi chạy trong container. Chỉ chạy một server trên cổng 3000 tại một thời điểm.

## Phần đã có

**Khách hàng**

- Trang chủ, khám phá masonry có kiểm soát/lưới đều, tìm kiếm, lọc dịp/màu/ngân sách/danh mục, sắp giá, sản phẩm và nhiều size.
- Yêu thích, giỏ nháp, checkout khách vãng lai/tài khoản, phí giao/khu vực, ngày/slot, thiệp, ghi chú.
- SePay QR chuyển khoản và webhook xác thực; COD có thể bật/tắt trong admin.
- Trang đơn riêng tư, lịch sử trạng thái, QR giữ chuỗi tách rõ khỏi QR thanh toán.
- Đăng ký, email xác minh, khôi phục mật khẩu, hồ sơ, địa chỉ, thông báo, 2FA TOTP và mã dự phòng.
- Hội viên Member/Bloom/Burgundy và hạng tùy chỉnh: gói tháng/năm qua SePay, gia hạn, nâng gói trả chênh lệch, tích lũy chi tiêu và admin cấp có hạn/không thời hạn. Hạng cao nhất còn hiệu lực áp dụng; giữ/trừ/trả lượt tháng dùng chung, hết lượt vẫn mua giá thường.
- Lịch ảnh giữ chuỗi, một ngày hợp lệ/ngày, mốc liên tiếp và tích lũy tháng riêng, ví ưu đãi.
- Đánh giá từ đơn đã giao; chỉ hiển thị sau khi duyệt.

**Quản trị**

- Tổng quan từ MySQL, báo cáo tiền nhận/đơn/khách/quyền lợi; phạm vi 200 đơn gần nhất được ghi rõ trên màn hình.
- Đơn dạng bảng/Kanban/lịch; lịch ngày giao theo Hà Nội, tải theo khoảng ngày; agenda trên mobile.
- State machine kiểm tra transition, version chống hai nhân viên ghi đè, đổi lịch sau khi khách đồng ý và kiểm tra lại slot.
- Sản phẩm, nhiều size, giá/tồn từng size, upload ảnh có re-encode, danh mục/dịp/màu/bộ sưu tập, khách/hạng/khóa tài khoản, voucher, nội dung và duyệt đánh giá.
- Cài đặt hội viên/QR/mốc thưởng/ngân sách, phiên bản và audit; nhân sự với vai trò Owner/Manager/Florist/Delivery/Marketing/Accountant.
- Thêm tối đa 20 mốc thưởng phần trăm ngoài hai mốc cơ bản; phạm vi tổng tiền hoa hoặc một sản phẩm (mọi size), ngày bắt đầu/kết thúc, trần giảm, minimum và hạn riêng. Có preview trước công bố, version chống ghi đè và tạm dừng mốc.
- Phân công người phụ trách đơn, đổi lịch có kiểm tra sức chứa và xác nhận khách đã đồng ý.
- Thanh toán SePay cần đối soát, yêu cầu hoàn một phần/toàn bộ; ghi mã giao dịch ngân hàng sau khi hoàn thực tế. Không giả lập API hoàn tiền tự động của SePay.
- Job có lease, retry, nhật ký; outbox bền vững và WebSocket room do server cấp quyền.

**PWA**

- Manifest, icon/maskable, cài Home Screen, trang offline, cache ảnh/tài nguyên public có giới hạn, Web Push khi cấu hình VAPID.
- Không cache checkout, admin, tài khoản, đơn, QR hoặc API riêng tư. Không nhận thanh toán/claim QR offline.
- Hướng dẫn cài và cập nhật service worker trong Hồ sơ. Push trên iOS cần cài Home Screen và người dùng cấp quyền.

## Cấu hình SePay

Triển khai hiện tại dùng **SePay bank-transfer webhook + VietQR**. Không tự lấy trạng thái thanh toán từ return URL và không có nút tự đánh dấu “đã trả tiền” cho khách.

Điền trong `.env`, rồi khởi động lại:

```dotenv
APP_URL="https://shop.example.com"
SEPAY_BANK="VCB"
SEPAY_ACCOUNT_NUMBER="YOUR_BANK_ACCOUNT"
SEPAY_ACCOUNT_NAME="YOUR_ACCOUNT_NAME"
SEPAY_WEBHOOK_KEY="YOUR_RANDOM_WEBHOOK_KEY"
```

Trong SePay tạo webhook:

1. Sự kiện **Có tiền vào**, tài khoản đúng với `SEPAY_ACCOUNT_NUMBER`.
2. URL `https://shop.example.com/api/payments/sepay/webhook`.
3. Định dạng **JSON**, xác thực **API Key**; dùng đúng khóa ở `SEPAY_WEBHOOK_KEY`.
4. SePay gửi `Authorization: Apikey YOUR_RANDOM_WEBHOOK_KEY`. Đây là khóa webhook, không phải Bearer API token truy vấn giao dịch.
5. Bật gửi lại khi lỗi/ngoài 2xx theo cấu hình SePay. Receiver trả `201` với `success: true` khi đã nhận và lưu được giao dịch.
6. Cấu hình nhận diện mã thanh toán cho cả `FLR` (đơn hoa) và `FLM` (gói hội viên), sau tiền tố là 12 ký tự hexadecimal. Cả hai dùng cùng webhook; receiver cũng đọc mã từ nội dung chuyển khoản.

Webhook kiểm tra tài khoản nhận, chiều tiền vào, số tiền nguyên VND, mã đơn, hạn và trạng thái. Mã giao dịch SePay có unique constraint. Thiếu/thừa tiền, tới muộn hoặc không khớp được lưu `REVIEW`, không tự xác nhận đơn. Giao dịch gửi lặp không trừ thêm lượt.

SePay chưa có đủ cấu hình thì checkout khóa lựa chọn SePay; COD vẫn dùng được nếu admin bật. Các kiểm thử hiện tại dùng dữ liệu giả lập, không phát sinh chuyển khoản ngân hàng.

Tài liệu chính thức: [Webhook](https://docs.sepay.vn/tich-hop-webhooks.html), [QR](https://docs.sepay.vn/tao-qr-code-vietqr-dong.html).

## Hội viên, QR và ưu đãi

- Member mặc định 3 lượt, giảm 10%, trần 100.000 đ. Bloom 59.000 đ/tháng hoặc 590.000 đ/năm, 5 lượt/12%; Burgundy 129.000 đ/tháng hoặc 1.290.000 đ/năm, 8 lượt/15%: **giá trị seed để thử**, chỉnh tại Admin → Hội viên → Hạng & quyền lợi trước mở bán.
- Mua, tích lũy và admin cấp được lưu độc lập; hạng cao nhất còn hiệu lực áp dụng. Gói trả phí giữ phiên bản quyền lợi lúc mua. Hạng miễn phí/tích lũy dùng phiên bản đã chốt cho kỳ tháng; công bố mới không reset lượt.
- Quota theo tháng dương lịch Hà Nội, không chuyển lượt sang tháng mới. Đổi hạng chỉ thay hạn mức, giữ số đã dùng/đang giữ; hết gói trở về hạng còn hiệu lực. Gói theo ngày kích hoạt có thể đi qua hai tháng lịch hoặc 13 tháng lịch với gói năm; không cấp một lần 12 × N lượt.
- Profile hội viên có lịch sử nguồn hạng, hóa đơn, tiến độ chi tiêu và ngày sinh tùy chọn. Quà sinh nhật cấp một lần/user/năm theo quyền lợi đang hưởng, không nhân khi nâng hạng. Ngày sinh tự lưu một lần; sửa nhầm cần cửa hàng kiểm tra.
- Chi tiêu lên hạng chỉ tính tiền hoa ròng của đơn đã giao/thu tiền từ khi tham gia, không gồm phí giao/phí hội viên. Hoàn tiền ghi rõ phần tiền hoa và chỉ đảo chi tiêu khi khoản hoàn hoàn tất. Hạng cũ không rõ nguồn được nhập LEGACY, không giả định là mua gói.
- Xem [hướng dẫn vận hành hội viên](docs/MEMBERSHIP_OPERATIONS.vi.md) cho migration, SePay, hoàn phí, cron và quyền admin.
- Một checkout hợp lệ giữ lượt/kho/slot/voucher cùng transaction; online hết hạn sau 15 phút. Hủy đúng điều kiện trả vào kỳ gốc, không cộng bù âm thầm sang kỳ mới.
- QR được tạo ngay khi có đơn. Mặc định SePay mở sau trả tiền + admin xác nhận; COD mở sau đã giao. Có thể chọn SePay chỉ mở sau giao.
- Mặc định QR tối đa một người nhận, một lần/tài khoản/QR, hiệu lực 72 giờ từ khi mở. Người nhận không cần là người mua/hội viên.
- Mỗi user chỉ nhận một ngày hợp lệ trong ngày Hà Nội. Ngày đã active không tiêu QR mới. Các claim cạnh tranh được khóa/kiểm tra nguyên tử.
- Hai mốc đang cấu hình độc lập: liên tiếp và tích lũy tháng. Mỗi mốc cấp tối đa một lần/user/tháng khi thực sự chạm mốc. Chuỗi qua tháng không tự cấp lại mốc cũ.
- Thưởng tiền hàng không cộng dồn với hội viên/voucher khác. Mức giảm được phân bổ xuống order item để đối soát.
- Hết ngân sách: vẫn ghi quyền đạt mốc ở trạng thái chờ mở thưởng, không bỏ mất quyền. Worker mở ưu đãi theo thứ tự khi admin bổ sung ngân sách; thời hạn bắt đầu lại lúc mở.
- Nguồn đơn hủy trước giao có thể làm ngày không hợp lệ; giữ ảnh kỷ niệm, tính lại tiến độ và thu hồi thưởng chưa dùng. Không sửa hóa đơn đã chốt vì một thưởng đã sử dụng.

## Analytics có sự đồng ý

Adapter GA4 Measurement Protocol và PostHog đã có mã tích hợp, mặc định tắt. Điền `GA4_MEASUREMENT_ID`, `GA4_API_SECRET` và/hoặc `POSTHOG_KEY`, `POSTHOG_HOST` để bật. Secret chỉ dùng ở server. Khi có cấu hình, trang công khai hiển thị lựa chọn đồng ý/từ chối; mục Quyền riêng tư cho đổi lựa chọn. Từ chối vẫn mua bình thường.

Hiện theo dõi page view công khai, view sản phẩm, thêm giỏ, bắt đầu checkout, enrollment và claim thành công; không kèm URL QR, lời thiệp, địa chỉ, điện thoại hoặc email. Purchase được enqueue phía server chỉ khi SePay khớp hoặc COD giao/thu tiền thành công, gắn với consent ở lúc đặt đơn. Sự kiện không gửi lại từ trang thành công. Outbox retry độc lập từng vendor; ID ổn định hỗ trợ chống lặp. Timeout mơ hồ vẫn có thể giao lại theo cơ chế at-least-once; báo cáo tiền nội bộ luôn lấy MySQL.

GA4 API trả 2xx chưa đủ chứng minh property đã ghi nhận đúng; cần dùng công cụ kiểm tra Measurement Protocol/DebugView và PostHog Live events sau khi có project thật. Chưa cấu hình vendor nên chưa chạy xác nhận trực tiếp tại tài khoản analytics. Dashboard nội bộ không giả lập traffic hoặc conversion chưa đo được. Clarity/Metabase chưa nhúng, tránh triển khai nhiều recorder trùng.

## Email, 2FA và push

Điền `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM` để gửi email xác minh/khôi phục. Production từ chối đăng ký mới nếu chưa có SMTP. Local không gửi email thì trả liên kết thử **chỉ ở development**, hiển thị trên form.

Bật 2FA tại Tài khoản → Hồ sơ. Khóa TOTP được mã hóa, mã dự phòng chỉ lưu hash và dùng một lần. OTP đã dùng không thể replay. Mã dự phòng được hiển thị một lần sau khi bật; các phiên đăng nhập khác bị thu hồi.

Tạo VAPID bằng `web-push.generateVAPIDKeys()` trong môi trường quản trị và đặt `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`. Không commit khóa riêng. Quyền push chỉ xin sau khi người dùng nhấn nút bật cập nhật.

## cron-job.org và worker

Các endpoint scheduler dùng **POST**, header `Authorization: Bearer CRON_SECRET`; không đặt secret trên URL. Endpoint ghi/enqueue rồi trả `202`, không chờ toàn bộ tác vụ.

| Endpoint | Lịch đề xuất, timezone Asia/Ho_Chi_Minh |
|---|---|
| `/api/internal/jobs/cleanup` | Mỗi phút |
| `/api/internal/jobs/reconcile` | Mỗi 15 phút |
| `/api/internal/jobs/delivery-reminders` | Mỗi 5 phút |
| `/api/internal/jobs/digest` | 07:00 mỗi ngày |
| `/api/internal/jobs/streak-reminders` | 20:30 mỗi ngày, người đã bật push |
| `/api/internal/jobs/membership-maintenance` | Mỗi 5 phút; mở kỳ lười tại server không phụ thuộc cron |

`reconcile` dọn reservation, mở thưởng chờ ngân sách và tùy chọn lấy giao dịch SePay v2 khi có `SEPAY_API_TOKEN` chỉ đọc. Bộ đối soát có checkpoint, phân trang, lease và chống trùng giữa UUID API v2/ID webhook qua tài khoản + mã tham chiếu. Chưa có token thì không gọi API ngân hàng. Tiền sai, tới muộn hoặc lịch gói đã thay đổi vẫn cần admin đối soát.

Local dùng queue bền vững MySQL; server có vòng xử lý và watchdog dọn reservation. Có thể chạy riêng `npm run worker`. Khi bật `QUEUE_DRIVER=redis`, BullMQ dispatch job và MySQL vẫn giữ trạng thái/idempotency để phục hồi. Redis cần 7.x; bản Redis 5 đi kèm một số Laragon không dùng cho BullMQ.

Khi scale nhiều gateway, đặt `SOCKET_REDIS=true` và cùng `REDIS_URL` để fanout Socket.IO. Client reconnect tải snapshot, không coi event WebSocket là bằng chứng thanh toán. Outbox có lease và có thể giao lại; các tác dụng nghiệp vụ chống lặp tại DB.

## Kiểm thử

```powershell
npm test
npm run typecheck
npm run build
# Khi server localhost đang chạy:
npm run test:e2e
```

`npm test` tự tạo/migrate database có hậu tố `_test`. Có thể chỉ định `TEST_DATABASE_URL`; script từ chối tên không có hậu tố này. Kiểm tra timezone, chuỗi, crypto, cạnh tranh quota/kho/slot/QR, cấp thưởng, hồi ngân sách, hủy, webhook, idempotency và 2FA. Không phát sinh tiền thật.

`test:e2e` hiện là HTTP smoke cho trang/API, CSRF, đăng nhập và quyền admin; không phải một bộ Playwright UI tự động đầy đủ. Giao diện mobile được kiểm tra trực tiếp trên trình duyệt trong lượt phát triển này.

## Deploy bằng container

Đã chuẩn bị `Dockerfile`, `compose.yaml`, nginx mẫu. Chưa triển khai lên máy chủ công khai hoặc chạy Docker trên máy Windows này.

1. Đặt `.env` thật: URL HTTPS, secret, MySQL password riêng, SePay, SMTP và VAPID. Với compose, `MYSQL_PASSWORD` / `MYSQL_ROOT_PASSWORD` bắt buộc; dùng mật khẩu phù hợp URI hoặc encode đúng trong DATABASE_URL.
2. `docker compose build` và `docker compose up -d mysql redis`.
3. `docker compose run --rm web npm run db:migrate`.
4. Nếu cần dữ liệu khởi đầu: `docker compose run --rm web npm run db:seed`. Sau migrate chạy `docker compose run --rm web npx tsx scripts/migrate-membership.ts` để tạo hạng và bảo toàn lịch sử. Production không tạo hai tài khoản demo local.
5. Điền tạm `ADMIN_EMAIL`, `ADMIN_PASSWORD` mạnh, chạy `docker compose run --rm web npm run admin:create`; xóa password bootstrap khỏi `.env`, bật 2FA trong hồ sơ.
6. `docker compose up -d web worker`, đặt reverse proxy HTTPS theo `ops/nginx.conf.example`, cấu hình cron-job.org và webhook SePay.
7. Kiểm tra `/api/health`, thanh toán Test Mode rồi giao dịch thật do chủ shop thực hiện, luồng hủy/hoàn và cảnh báo job.

Upload được lưu ở volume `/app/storage/uploads`, phục vụ qua `/media/[file]`; có thể xem ngay sau upload mà không cần rebuild. Nếu thay bằng S3/CDN, giữ URL snapshot trong đơn/lịch. Sao lưu MySQL, volume ảnh và **SESSION_SECRET** cùng quy trình khôi phục; mất secret sẽ không giải mã được QR/TOTP cũ. RPO/RTO phụ thuộc hạ tầng và cần diễn tập restore trước mở bán.

## Phạm vi tiếp theo theo kế hoạch

Những phần dưới đây chưa được coi là đã hoàn thành chỉ vì có menu/bản kế hoạch:

- Dashboard truy vấn trực tiếp GA4/PostHog, Clarity/Metabase embedding, A/B testing và attribution UTM: adapter tracking có consent đã có; còn cần xác minh tại tài khoản vendor thật và cấu hình báo cáo.
- Nhiều chiến dịch độc lập, thưởng quà hiện vật/ship/điểm, lịch hiệu lực cho toàn bộ cấu hình hội viên: hiện có rule phần trăm với phạm vi tiền hàng/sản phẩm và lịch bắt đầu/kết thúc cho mốc tùy chỉnh.
- Ảnh bó hoa duyệt trước giao, tuyến giao và tích hợp vận chuyển; phân công nhân viên theo đơn đã có.
- BOM từng cành, lô nhập/hao hụt, nhiều chi nhánh; hiện quản lý tồn theo size và giữ chỗ.
- Giao hoa định kỳ, tự động trích tiền gia hạn, referral, điểm và vé bảo vệ chuỗi. Gói hội viên trả trước tháng/năm đã có.
- Bộ E2E browser tự động, đo Core Web Vitals thực địa, tải cao, restore drill và UAT vận hành thực tế.

Ảnh/giá/nội dung seed là dữ liệu trình diễn. Ảnh tải từ Unsplash qua `scripts/assets.ts`; thay bằng ảnh sản phẩm thực tế và chính sách đã duyệt trước khi nhận đơn thật.

Tài liệu gốc: [Kế hoạch chi tiết](docs/FLEURIOUS_WEBSITE_PLAN.vi.md).
