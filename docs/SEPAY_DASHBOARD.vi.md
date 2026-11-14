# Cấu hình SePay từ dashboard

Vào **Cài đặt → Thanh toán SePay** (`/admin/settings#sepay`) bằng tài khoản chủ cửa hàng.

1. Nhập mã ngân hàng hoặc BIN (ví dụ `VCB`, `MB`, `970436`), số tài khoản và tên chủ tài khoản. Lưu cấu hình SePay.
2. API Key webhook được website tạo một lần và lưu tự động. Các ô có icon sao chép; khóa được che mặc định và có nút hiện/ẩn.
3. Trong SePay, tạo webhook cho sự kiện **Có tiền vào**, định dạng **JSON**, xác thực **API Key**. Sao chép URL webhook và API Key từ website sang SePay. Header tương ứng là `Authorization: Apikey <key>`.
4. Bật tùy chọn gửi lại khi HTTP không thuộc 200–299 và dùng chức năng Gửi thử của SePay. Website trả HTTP 201 cùng JSON `success: true` khi tiếp nhận hợp lệ.

Token API đối soát là mục tùy chọn, lấy từ tài khoản SePay, dùng cho tác vụ đối soát v2 đã có. Website chỉ tự tạo API Key webhook, không tự phát hành token API của SePay.

URL webhook dựa trên `APP_URL`. Địa chỉ localhost chỉ dùng phát triển; khi triển khai cần `APP_URL` là tên miền công khai có HTTPS để SePay gọi tới.

## Hoạt động

- Thông tin ngân hàng dùng chung cho đơn hoa, gói hội viên, QR thanh toán, kiểm tra tài khoản nhận và đối soát. Lưu xong có hiệu lực ngay, không cần khởi động lại.
- Client đang mở được đồng bộ khả năng thanh toán qua WebSocket. Chỉ trạng thái cấu hình được công khai; API Key và token không có trong bootstrap/settings công khai.
- Cấu hình lưu riêng tại `Setting.sepay_payment`. API Key/token được mã hóa AES-256-GCM bằng khóa dẫn xuất từ `SESSION_SECRET`; giữ nguyên secret này khi triển khai hoặc chuyển máy.
- Cấu hình `.env` cũ vẫn được dùng nếu chưa có cấu hình trong database. Khi chủ cửa hàng mở phần cấu hình lần đầu, thông tin cũ được tiếp nhận, giữ nguyên khóa webhook đã có; chỉ tạo khóa mới nếu thiếu.
- Chủ cửa hàng có thể tạo lại khóa qua bước xác nhận trong giao diện. Khóa cũ hết hiệu lực ngay; cần thay khóa trong SePay.
- Thay tài khoản nhận hoặc tắt SePay bị chặn khi có yêu cầu thanh toán còn hạn. Checkout và thay cấu hình dùng chung khóa giao dịch để tránh chuyển sai đích nhận trong lúc đơn được tạo.
- Chỉ OWNER được đọc/sửa cấu hình bí mật. Nhật ký ghi người thay đổi, ngân hàng, bốn ký tự cuối tài khoản và việc thay token; không ghi khóa/token.

Mục cuối sidebar admin là **Đăng xuất**. Nút xóa phiên đăng nhập và đưa về trang đăng nhập quản trị, kể cả khi menu đang thu gọn.

## Kiểm tra

`npm test`: 61/61 ca, gồm khởi tạo khóa đồng thời, mã hóa, phân quyền, cấu hình mới ghi đè `.env`, QR hội viên, thanh toán và chống trùng, khóa thay tài khoản khi còn hóa đơn chờ, tạo lại khóa và vô hiệu thanh toán. Kiểm tra giao diện không lưu ngân hàng giả và không phát sinh chuyển khoản thật.

Tài liệu chính thức: [Webhook SePay](https://docs.sepay.vn/tich-hop-webhooks.html), [tham số QR ngân hàng](https://docs.sepay.vn/tao-qr-code-vietqr-dong.html).
