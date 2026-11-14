# Đăng nhập Google

## Điền Google Cloud Console

Chọn OAuth Client loại **Web application**.

**Authorized JavaScript origins** (chỉ origin, không thêm đường dẫn):

```text
http://localhost:3000
https://fleurious-shop.vercel.app
```

**Authorized redirect URIs** (nhập chính xác cả đường dẫn, không thêm dấu `/` cuối):

```text
http://localhost:3000/api/auth/google/callback
https://fleurious-shop.vercel.app/api/auth/google/callback
```

Luồng này chuyển hướng qua server, không dùng popup hoặc Google JavaScript SDK. Redirect URI là phần bắt buộc. Nếu ứng dụng Google đang ở chế độ Testing, thêm những tài khoản cần thử vào Test users trong Audience.

## Biến môi trường

Thêm vào `.env` local và Vercel Environment Variables → **Production**:

```dotenv
GOOGLE_CLIENT_ID="YOUR_CLIENT_ID.apps.googleusercontent.com"
GOOGLE_CLIENT_SECRET="YOUR_CLIENT_SECRET"
```

`APP_URL` phải là origin đúng của môi trường (`http://localhost:3000` hoặc `https://fleurious-shop.vercel.app`). Local cần khởi động lại server; sau khi thêm biến trên Vercel cần Redeploy. Không dùng tiền tố `NEXT_PUBLIC_` cho secret. Khi thiếu một trong hai biến, nút Google hiển thị trạng thái chưa sẵn sàng và không mở OAuth.

## Đăng nhập và giữ chuỗi

- Khách mới đăng nhập Google được tạo tài khoản CUSTOMER với email đã được Google xác minh. Không yêu cầu SMTP cho luồng này.
- Tài khoản Google được nhận diện bằng `sub`, không dùng email làm khóa nhà cung cấp. Email trùng tài khoản Fleurious có sẵn không tự liên kết: đăng nhập bằng mật khẩu trước, mở **Hồ sơ → Đăng nhập Google → Liên kết với Google**, chọn Google có cùng email. Cách này giữ nguyên đơn, hội viên và lịch hoa, đồng thời tránh gắn nhầm tài khoản.
- Tài khoản đã bật 2FA vẫn cần nhập mã 2FA/mã dự phòng sau Google. Chưa hoàn tất 2FA thì không có session đăng nhập mới.
- Quét card → `/q/<token>` → đăng nhập/đăng ký → quay lại đúng QR. Đăng nhập không tự nhận ngày; người nhận bấm **Thêm hoa vào hôm nay**. Lần quét lại không tiêu thêm lượt hoặc cộng thêm ngày.
- Có thể bật/tắt hiển thị mật khẩu ở form đăng nhập, đăng ký và đặt lại mật khẩu; thao tác này không submit form hoặc xóa giá trị đang nhập.

OAuth sử dụng authorization code, state gắn cookie HttpOnly, PKCE S256, nonce, kiểm tra chữ ký Google, issuer, audience, thời hạn và `email_verified`. State hết hạn sau 10 phút và chỉ dùng một lần; challenge 2FA sau Google có hạn 5 phút. Không lưu access token/refresh token của Google.

## Kiểm thử

`npm test` có bộ kiểm thử Google dùng RSA/JWKS mô phỏng ngay trong process test; mã ứng dụng chỉ gọi endpoint Google chính thức. Có kiểm tra sai audience/nonce, email chưa xác minh, state sai trình duyệt/hết hạn/replay, trùng email, liên kết tường minh, tài khoản khóa, 2FA và nhận ngày QR theo Hà Nội.

Kiểm thử với Google thật cần Client ID/Secret hợp lệ và tài khoản Google nằm trong Audience phù hợp. Không coi mock OAuth là xác nhận cấu hình trên Google Cloud Console.

Đã chạy 96/96 bài kiểm thử, HTTP với Google mô phỏng (JWT RSA, JWKS và PKCE thật trong server kiểm thử), cùng luồng trình duyệt QR → đăng nhập → đổi qua đăng ký rồi quay lại đăng nhập → nhận ngày trên lịch. Nút hiện/ẩn mật khẩu đã được kiểm tra ở đăng nhập/đăng ký và giữ nguyên mật khẩu khi submit. Các fixture chỉ dùng database `_test` và được dọn sau kiểm tra.

Tài liệu chính thức: [OpenID Connect](https://developers.google.com/identity/openid-connect/openid-connect), [xác minh ID token](https://developers.google.com/identity/gsi/web/guides/verify-google-id-token).
