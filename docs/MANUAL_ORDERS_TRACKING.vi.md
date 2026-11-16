# Đơn thủ công, QR gửi khách và tra cứu công khai

## Cách dùng

1. Admin → Đơn hàng → Đặt đơn: chọn kênh, hoa, kích cỡ, số lượng, khu vực và lịch giao. Hệ thống tự kiểm tra giá/tồn kho/ưu đãi sau 350ms; không cần điền thông tin người mua để xem giá, không có bước bấm “Kiểm tra tổng tiền”.
2. Chọn mọi giai đoạn từ Chờ xác nhận đến Đã giao, với thanh toán được quản lý riêng. Giai đoạn Đã giao phải có ngày giao hôm nay. Không tự đánh dấu đã trả tiền vì đơn đã giao.
3. Chọn Chuyển khoản · SePay và Chưa thu tiền. Mặc định hạn 24 giờ, có thể đổi theo từng đơn hoặc chọn không giới hạn. Mặc định chung nằm trong Cài đặt → Cửa hàng → Hạn thanh toán đơn thủ công.
4. Sau khi tạo, cửa sổ QR xuất hiện ngay. Có thể tải ảnh PNG, sao chép mã đơn hoặc link `/track-order?code=...` để gửi khách. Có thể mở lại QR trong chi tiết đơn → Xem QR thanh toán.
5. Trong cửa sổ QR, “Đổi / gia hạn thanh toán” cho phép thêm thời gian kể từ hiện tại hoặc bỏ giới hạn, cần lý do và lưu nhật ký. Không sửa được đơn đã thanh toán/đã dừng.
6. Nút copy cạnh mã đơn ở bảng và Kanban sao chép đúng mã để gửi khách. Trang Theo dõi đơn có trong menu desktop, menu mobile và footer.

Khi SePay xác nhận đúng mã/đủ tiền/còn hạn, hoặc quản lý/kế toán xác nhận đã thu đủ, đơn đang Chờ xác nhận tự chuyển sang **Chờ chuẩn bị** (`CONFIRMED` / `UNASSIGNED`) trong cùng giao dịch ghi nhận thanh toán. Áp dụng cho cả đơn website và đơn thủ công, kể cả đơn tạo thủ công với thanh toán Đã thu đủ ngay từ đầu. Đơn đã bắt đầu chuẩn bị, sẵn sàng giao, đang giao hoặc đã giao giữ nguyên tiến trình. Kanban, trang khách và cửa sổ chi tiết admin đồng bộ trạng thái mới; không cần bấm xác nhận đơn lần nữa. Chuyển sai tiền, đơn đã dừng hoặc tiền đến quá hạn chưa đối soát không tự xác nhận; webhook gửi lại không tạo thêm lần chuyển trạng thái.

Giá trả về muộn từ lựa chọn cũ không được áp dụng. Khi dữ liệu thay đổi, kết quả cũ bị vô hiệu ngay và nút tạo chờ kiểm tra mới. Backend vẫn kiểm tra lại trong giao dịch tạo đơn và từ chối nếu giá/tồn/quota đã thay đổi; khi lỗi, form tự tính lại.

## Phân tích thời hạn QR

Fleurious dùng ảnh QR chuyển khoản ngân hàng + SePay Webhooks, không dùng phiên thanh toán của Payment Gateway.

Tài liệu SePay mô tả ảnh QR chứa tài khoản, ngân hàng, số tiền và nội dung. Ví dụ trang checkout có bộ đếm 15 phút do ứng dụng quản lý. Webhook báo giao dịch ngân hàng đã phát sinh, vì vậy bộ đếm của website không phải cơ chế ngăn ngân hàng nhận tiền từ một ảnh QR đã tải/gửi trước đó.

Nguồn:

- [SePay: Tạo QR và form thanh toán](https://developer.sepay.vn/vi/sepay-webhooks/tao-qr-va-form-thanh-toan)
- [SePay: Tích hợp webhook, payload và cơ chế gửi lại](https://developer.sepay.vn/vi/sepay-webhooks/tich-hop-webhook)

| Chính sách | Lợi ích | Hệ quả cần xử lý |
| --- | --- | --- |
| Không giới hạn | Thuận tiện tư vấn qua Zalo/Facebook/Instagram, khách không bị gấp; không phải gửi lại ảnh thường xuyên | Hàng và ưu đãi có thể bị giữ lâu; admin phải chủ động theo dõi và đóng đơn không còn nhu cầu. Khách vẫn có thể dùng ảnh cũ sau khi cửa hàng đóng đơn; tiền đó phải đối soát. |
| Có hạn | Có mốc rõ để tư vấn, nhắc khách, theo dõi yêu cầu chậm và dừng xác nhận tự động sau hạn | Khách có thể chuyển tiền sau hạn dù website đã ngừng hiển thị QR; phải có đối soát tiền muộn và cơ chế gia hạn. Mốc quá ngắn không phù hợp tư vấn đa kênh. |

**Chính sách đã chọn: 24 giờ mặc định, admin được đổi hoặc bỏ giới hạn.** Đây là khuyến nghị vận hành cho Fleurious, không phải thời hạn bắt buộc do SePay quy định.

- Đơn website tiếp tục thời hạn giữ hàng hiện có (SePay 15 phút).
- Đơn thủ công mới có `manualPayment=true` và hạn riêng `paymentDueAt`; không tự hủy/giải phóng hàng vì đồng hồ thanh toán hết hạn, kể cả đơn còn chờ xác nhận. Hạn là mốc dừng xác nhận tự động, không phải cam kết ngân hàng từ chối chuyển khoản.
- Hết hạn: ngừng cung cấp/tải QR mới, hiển thị cảnh báo. Tiền đến muộn được lưu REVIEW để kế toán/quản lý kiểm tra và xác nhận thủ công với bằng chứng. Khi nhập đúng mã tham chiếu ngân hàng và có duy nhất một giao dịch đúng đơn/đúng tiền, hệ thống đóng giao dịch đối soát đó cùng lần xác nhận thu. Không phục hồi đơn đã hủy hay tính tiền hai lần.
- Không giới hạn: có thể tự khớp chuyển khoản đúng mã/đúng tiền khi đơn còn hoạt động, dù thời gian giữ hàng cũ đã qua. Đơn đã dừng hoặc giao dịch sai tiền vẫn phải đối soát.
- Gia hạn là quyết định chủ động của admin, được kiểm tra phiên bản và ghi nhật ký. Ảnh đã gửi không có khả năng tự thu hồi; nên gửi kèm mã đơn, hạn thanh toán và link tra cứu.
- Chặn đổi tài khoản nhận tiền/tắt SePay khi vẫn còn đơn thủ công đang chờ trả, kể cả đơn không giới hạn hoặc đã qua hạn, để tránh chuyển tiền vào tài khoản cũ.
- Giao hàng, tồn kho, hội viên, QR giữ chuỗi và thanh toán được tách riêng. Chỉ sự kiện thanh toán được xác nhận mới ghi nhận purchase/chi tiêu hội viên; không tự mở QR giữ chuỗi tại bước xác nhận đơn SePay chưa trả tiền. Khi đã giao, giữ chính sách QR sau giao hiện có.

## Trang tra cứu không đăng nhập

Tra cứu bằng mã đơn, chuẩn hóa chữ hoa và khoảng trắng ngoài cùng. Endpoint POST `/api/orders/track` có giới hạn tần suất, trả `private, no-store`. Trang và đường dẫn tra cứu được đặt noindex; không đưa mã vào metadata chia sẻ.

Dữ liệu công khai theo allowlist: mã, trạng thái giao/thanh toán, ngày tạo/lịch giao/thời điểm giao, tên/kích cỡ/số lượng/ảnh sản phẩm. Không trả ID nội bộ, tên người mua/người nhận, email, điện thoại, địa chỉ, thiệp, ghi chú, lịch sử nội bộ, QR giữ chuỗi, phiếu thu hoặc thông tin ngân hàng.

Tiến trình hiển thị các bước cố định, không đọc nội dung OrderHistory để tránh lộ ghi chú riêng. Trang kiểm tra lại mỗi 30 giây khi đang mở, khi quay lại tab và khi bấm làm mới. Tra cứu bằng mã không cấp quyền xem trang chi tiết đơn riêng tư hoặc thay đổi đơn.

## Triển khai và kiểm thử

- Chạy migration `20261115170000_manual_payment_terms` trước bản code mới và khởi động lại app/worker để nạp Prisma Client.
- Migration giữ nguyên chính sách các đơn cũ; chỉ đơn thủ công được tạo bằng luồng mới có hạn thanh toán riêng.
- Kiểm thử trong `tests/commerce.test.ts`, `tests/sepay-settings.test.ts`: giá không cần thông tin người mua, đủ các giai đoạn SePay chưa trả, mặc định 24h, không giới hạn, chuyển muộn, webhook replay, gia hạn, phân quyền, allowlist tra cứu, PNG QR và chặn đổi ngân hàng khi còn yêu cầu thủ công.
