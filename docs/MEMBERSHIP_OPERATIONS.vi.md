# Vận hành Fleurious Circle

## Trạng thái triển khai

Đã có hạng Member/Bloom/Burgundy và tạo thêm hạng; phiên bản giá/quyền lợi; gói trả trước tháng/năm; gia hạn nối tiếp; nâng cùng chu kỳ trả chênh lệch; lịch gói tiếp theo; hạng tích lũy; admin cấp/thu hồi quyền riêng; quà sinh nhật; sổ lượt tháng; lịch sử; hóa đơn, đối soát và hoàn phí.

Đường dẫn:

- Khách: `/membership`, `/account/membership`, `/membership/invoices/<id>`.
- Quản trị: `/admin/members` → Hội viên / Hạng & quyền lợi / Giao dịch gói / Đối soát / Chờ hoàn.

## Giá và chính sách khởi đầu

Giá seed dùng để thử: Bloom 59.000 đ/tháng hoặc 590.000 đ/năm; Burgundy 129.000 đ/tháng hoặc 1.290.000 đ/năm. Owner chỉnh và công bố trước khi nhận tiền thật. Member giữ cấu hình hiện tại lúc khởi tạo catalog; các lần chạy seed tiếp theo không ghi đè.

Chi tiêu trọn đời tính từ lúc đăng ký hội viên, trên tiền hoa sau giảm giá của đơn đã giao/thu tiền; không cộng phí giao hoặc phí hội viên. Khoản hoàn chỉ điều chỉnh chi tiêu khi đã ghi nhận hoàn tất, theo trường phần hoàn tiền hoa. Hạ ngưỡng sẽ xét lại qua job; tăng ngưỡng không tự thu hồi quyền đã được cấp hợp lệ theo ngưỡng cũ. Hoàn tiền làm mất điều kiện sẽ thu hồi nguồn EARNED tương ứng, không truy thu giảm giá của đơn cũ và không thu hồi nguồn PAID/ADMIN khác.

Một sổ lượt/user/tháng Hà Nội. Nâng hạng không reset đã dùng/đang giữ. Hết gói xét hạng còn hiệu lực và tính lại số còn dùng; đã dùng quá hạn mức nền thì mua thường. Gói theo ngày kích hoạt có thể đi qua hai tháng lịch, gói năm qua 13 tháng lịch. Đây là chính sách được công bố trong FAQ; không phải 12 × N lượt cấp ngay.

Gói đã thanh toán giữ phiên bản quyền lợi đã mua; free/earned/admin dùng phiên bản chốt theo kỳ tháng. Không sửa mã/thứ tự của hạng đã công bố; thay tên, giá, điều kiện tạo phiên bản mới. Tắt hoạt động để lưu trữ thay vì xóa lịch sử. Chỉ OWNER công bố cấu hình; MANAGER cấp có hạn tối đa một năm cho khách khác, không cấp không thời hạn.

## Migration khi triển khai máy mới

```powershell
npm run db:migrate
npm run db:generate
npx tsx scripts/migrate-membership.ts --dry-run
npx tsx scripts/migrate-membership.ts
npm run build
npm start
```

Migration chỉ thêm cột/bảng/index. Các user có trước migration được đánh dấu cần rà soát; script bảo toàn hạng cao dưới nguồn LEGACY, không tự đoán là mua gói. Script có thể chạy lại: catalog và sổ chi tiêu có khóa chống lặp. Kỳ tháng cũ giữ số đã dùng/đang giữ và hạn mức Member đã mở. Đơn hoa đã giao/thu tiền hợp lệ được bổ sung vào ledger khi chuyển đổi user; các khoản hoàn lịch sử không rõ phân bổ không tự đoán phần tiền hoa.

Sao lưu DB theo quy trình hiện có trước rollout. Không xóa entitlement/invoice/ledger để rollback; có thể tắt nhận đăng ký/mua gói mới, các quyền đã cấp tiếp tục được server tôn trọng.

## SePay

Giữ các biến `SEPAY_BANK`, `SEPAY_ACCOUNT_NUMBER`, `SEPAY_ACCOUNT_NAME`, `SEPAY_WEBHOOK_KEY`. Webhook chung `POST /api/payments/sepay/webhook`, API Key trong header như README. Cấu hình nhận diện cả `FLR` cho đơn hoa và `FLM` cho hội viên.

Chưa có đủ biến cấu hình thì không thể xác nhận thanh toán gói. Không tạo credential giả trong `.env` production. Gói hội viên chỉ có QR chuyển khoản, không có COD và không tự động trích tiền. Không đánh dấu đã trả tiền từ redirect hoặc nút khách tự xác nhận.

Nếu muốn lấy bù webhook, cấp token chỉ đọc giao dịch và cấu hình `SEPAY_API_TOKEN`. Job `reconcile` truy vấn API v2 chính thức, có lease, phân trang/chốt khoảng thời gian, tiếp tục từ trang lỗi và chống trùng tài khoản + mã tham chiếu giữa UUID v2/ID webhook. Thiếu token thì không gửi request ra ngân hàng. Giao dịch tới muộn vẫn vào đối soát; không cấp quyền khi sai tiền hoặc lịch gói đã đổi. Lịch gói đã đổi không được bỏ qua bằng thao tác ghép thủ công: cần xử lý hoàn tiền hoặc hóa đơn phù hợp.

Tài liệu đối chiếu: [API danh sách giao dịch v2](https://developer.sepay.vn/vi/sepay-api/v2/giao-dich/danh-sach), [đối soát webhook](https://developer.sepay.vn/vi/sepay-webhooks/doi-soat-giao-dich).

## Cron và realtime

Worker MySQL hiện tự enqueue maintenance mỗi 5 phút. Production có thể dùng cron-job.org làm nguồn kích hoạt dự phòng:

| URL POST | Lịch |
|---|---|
| `/api/internal/jobs/membership-maintenance` | Mỗi 5 phút |
| `/api/internal/jobs/reconcile` | Mỗi 15 phút |

Header: `Authorization: Bearer CRON_SECRET`, không đặt secret trên URL. Job có khóa, retry, nhật ký. Maintenance cập nhật tên hạng tổng hợp khi nguồn hết/bắt đầu, nhắc trước 7/1 ngày và trong ngày hết hạn, cấp quà sinh nhật theo ngày Hà Nội. Nhắc được dedup và bỏ qua kỳ đã có gói nối tiếp. Thông báo trong tài khoản; Web Push chỉ hoạt động khi đã cấu hình VAPID và khách đăng ký nhận.

Checkout luôn tự xét quyền theo thời gian server; cron trễ không kéo dài gói. Client refetch khi quyền bắt đầu/hết hạn, qua tháng, nhận realtime hoặc quay lại tab. API riêng tư/hóa đơn không được cache PWA và trang hóa đơn đặt noindex.

## Hoàn phí và giá trị nâng gói

Quy trình: đề nghị → hoàn qua ngân hàng theo chính sách đã duyệt → ghi mã giao dịch hoàn thực tế → ghi nhận hoàn tất. Ứng dụng không tự chuyển tiền ngân hàng.

- Yêu cầu chưa hoàn tất không tự thu hồi quyền. Trong lúc chờ hoàn phí, khách không đổi/gia hạn gói để tránh chuyển tiếp phần giá trị đang xét.
- Hoàn một phần giữ quyền nếu không chọn thu hồi, nhưng giảm giá trị còn lại dùng để tính credit nâng gói sau này.
- Hoàn toàn bộ kết thúc quyền thuộc hóa đơn đó. Nguồn EARNED/ADMIN/LEGACY độc lập vẫn được giữ.
- Nếu hóa đơn đã chuyển giá trị sang nâng gói, cần chọn thu hồi quyền liên quan. Khi hoàn tất sẽ thu hồi cả quyền nâng gói được tài trợ từ phần credit đó, không thu hồi những kỳ mua độc lập khác. Cần xét tổng các hóa đơn liên quan khi duyệt số tiền hoàn; không chỉ hoàn hóa đơn chênh lệch rồi quên nguồn ban đầu.
- Số tiền hoàn không vượt tiền thực thu của hóa đơn; thao tác ghi nhận hoàn tất chống lặp. Chính sách thương mại/điều kiện hoàn thực tế cần cửa hàng công bố trước bán.

## Giới hạn có chủ ý

- Chưa thu tự động theo thẻ/ngân hàng, chưa có gói giao hoa định kỳ.
- Chưa bật miễn phí giao/quà vật lý/SLA tư vấn vì cần quy trình vận hành riêng. Quyền lợi đã có: giảm tiền hoa, N lượt, voucher sinh nhật.
- Chưa dùng cửa sổ chi tiêu 12 tháng hoặc xét duy trì hạng hàng năm; hiện tích lũy trọn đời. Sinh nhật 29/2 được xét ngày 28/2 ở năm không nhuận.
- Giao dịch thật cần public HTTPS và cấu hình SePay thật. Các test hiện chạy DB `_test`, payload/fetch giả lập; chưa chuyển tiền thật.

## Kiểm tra sau deploy

1. Mở trang khách ở mobile: đổi tháng/năm, kiểm tra giá trọn gói và mức tiết kiệm.
2. Owner mở admin: sửa/công bố một phiên bản, kiểm tra gói đã mua giữ snapshot; không đổi N đã dùng.
3. Kiểm tra cấp có hạn, quyền bắt đầu/hết hạn và quay về đúng hạng nền.
4. SePay Test Mode: đúng tiền, tiền sai, quá hạn, retry cùng giao dịch, webhook/API v2 trùng tham chiếu.
5. Kiểm tra job, thông báo, sổ chi tiêu/hoàn tiền, outbox và quyền của từng vai trò.
