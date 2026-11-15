# Menu, thông báo và quét QR

- Menu admin nằm trong layout bền vững. Chuyển mục giữ vị trí cuộn; lựa chọn thu gọn chỉ còn icon được lưu trên trình duyệt. Trên mobile vẫn dùng menu trượt.
- Chuông admin mở danh sách nhanh; `/admin/notifications` có danh sách phân trang, số chưa đọc, đọc từng mục và đọc tất cả. Thông báo được lưu riêng theo nhân sự, lọc lại theo quyền hiện tại.
- Desktop cửa hàng thay biểu tượng tìm kiếm bằng chuông. Mobile thay Bộ sưu tập bằng Thông báo. `/notifications` là trang thông báo cá nhân; `/account/notifications` tiếp tục mở cùng chức năng để giữ liên kết cũ. Tab thông báo được bỏ khỏi tài khoản.
- Tìm sản phẩm vẫn dùng ô tìm kiếm trên trang danh sách hoa.

## Sự kiện và thời gian cập nhật

Outbox đã có của ứng dụng được phát qua Socket.IO theo tài khoản. Danh sách và badge tự cập nhật, đồng bộ cả khi kết nối lại. Chu kỳ xử lý hiện tại khoảng 3 giây, không cần tải lại trang.

Thông báo admin gồm đơn mới/cập nhật đơn, tài khoản mới, hội viên mới, gói xác nhận mua/chờ thanh toán, gói đã kích hoạt, hạng tích lũy hoặc admin cấp/thu hồi, đánh giá chờ duyệt. Thông báo đơn dẫn đến danh sách đã lọc theo mã đơn.

Các cảnh báo SePay cần đối soát, hoàn phí hội viên chờ xử lý, tác vụ nền thất bại, tồn kho còn tối đa 3 sản phẩm có thể bán và phần thưởng chờ ngân sách được kiểm tra mỗi phút. Khóa chống trùng bảo đảm xử lý lại outbox không tạo bản sao; tồn kho và ngân sách nhắc tối đa một lần/ngày theo giờ Hà Nội. Đây là lịch sử cảnh báo; cần mở mục liên quan để xem trạng thái hiện tại.

Khách nhận cập nhật đơn, xác nhận thanh toán SePay, hội viên, thưởng và các nhắc lịch đã có. Đăng ký thông báo thiết bị vẫn cần VAPID/PWA và quyền trình duyệt; cập nhật trong website dùng WebSocket độc lập.

## Thông báo thiết bị

- Cần HTTPS, service worker và cặp VAPID public/private khớp nhau. Thiếu khóa riêng hoặc khóa không khớp thì không mời thiết bị đăng ký bằng một cấu hình không gửi được thông báo.
- Tạo khóa bằng `npm run push:setup`; các file env được gitignore. Giữ nguyên cặp khóa khi deploy lại, không tạo cặp mới cho mỗi lần build. Thêm cả ba biến `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` vào Production trên Vercel, lưu khóa riêng dưới dạng Secret rồi redeploy.
- iPhone/iPad: Chia sẻ → Thêm vào Màn hình chính → mở biểu tượng Fleurious → Thông báo → Bật thông báo thiết bị → Cho phép. Cần iOS/iPadOS 16.4 trở lên, theo [WebKit](https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/). Trong tab trình duyệt, giao diện hướng dẫn cài PWA thay vì báo lỗi chung.
- Quyền bị từ chối, trình duyệt không hỗ trợ, thiếu HTTPS và thiếu cấu hình có hướng dẫn riêng. Sau khi đổi quyền trong cài đặt, quay lại ứng dụng để kiểm tra lại.
- Nút chỉ hiển thị đã bật sau khi đăng ký thiết bị được lưu thành công trên server. Thử lại tái sử dụng đăng ký còn hợp lệ; đăng ký bằng khóa VAPID cũ được thay thế trong thao tác bật. Thiết bị đã bật được đồng bộ với tài khoản hiện đang đăng nhập.
- `npm run test:push` kiểm tra yêu cầu quyền ngay trong thao tác bấm, iPhone/iPad, từ chối quyền, thử lại, đổi khóa và chữ ký VAPID. Trình giả lập không xác nhận được việc APNs giao thông báo tới iPhone thật; cần kiểm tra bước đó trên thiết bị.

## Camera giữ chuỗi

Nút camera nổi ở góc phải trang `/streak`, phía trên thanh điều hướng mobile. Camera ưu tiên ống kính sau; có lựa chọn ảnh QR và dán liên kết. Đóng hộp thoại, chuyển trang hoặc đưa trang về nền sẽ dừng camera.

Chỉ chấp nhận liên kết cùng origin có dạng `/q/<64 ký tự hex>`. Quét QR mở đúng trang xem trước/đăng nhập/nhận ngày hiện có; không tự nhận ngày, không đổi điều kiện quota, thời hạn hay chuỗi. Camera hệ thống trên điện thoại tiếp tục quét được liên kết như trước. Camera website cần HTTPS hoặc localhost.

Giải mã ảnh và video sử dụng [ZXing Browser](https://github.com/zxing-js/browser), tải khi người dùng mở trình quét.

## Kiểm tra

- `npm run typecheck`, `npm test`: 55/55 ca, gồm chống thông báo trùng, phân quyền/riêng tư, tài khoản vô hiệu hóa và xác thực liên kết QR.
- Build production và kiểm tra trình duyệt desktop/mobile.
- Đã kiểm tra nhận thông báo thử qua outbox/WebSocket mà không tải lại; mở một mục cập nhật đúng số chưa đọc.
- Đã giải mã ảnh QR thử và mở đúng `/q/...`; QR thử không liên kết với đơn thật và không cấp ngày.
- Camera vật lý chưa được kiểm tra trên thiết bị thực; môi trường trình duyệt kiểm tra không mở được camera.
