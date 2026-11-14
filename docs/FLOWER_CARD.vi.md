# Thiệp lời nhắn và card QR giữ chuỗi

## Chọn cách viết thiệp

Ở trang thanh toán và form tạo đơn trong admin có hai lựa chọn:

- **Thiệp tự động**: in tên người nhận bên trái, lời nhắn ở giữa và tên người gửi bên phải. Khi không có lời nhắn, dùng câu chúc mặc định.
- **Thiệp viết tay**: vẫn in tên người nhận/người gửi, để trống hoàn toàn vùng lời nhắn. Lời nhắn nhập trong form được lưu cho nhân viên tham khảo khi viết tay, không xuất lên ảnh.

Đơn cũ mặc định là Thiệp tự động. Lựa chọn được giữ lại khi Đặt lại đơn và hiển thị trong chi tiết đơn của khách/admin.

## Admin → Đơn hàng → Chi tiết → Card đi cùng bó hoa

OWNER/MANAGER/FLORIST được xem và tải hai ảnh độc lập:

| Ảnh | Kích thước thiết kế | PNG 600 dpi |
| --- | --- | --- |
| Thiệp lời nhắn/viết tay | 74 × 105 mm | 1748 × 2480 px |
| Card QR giữ chuỗi khổ ngang | 90 × 50 mm | 2126 × 1181 px |

Card QR dùng nền Burgundy và kem: logo + slogan trong ngoặc kép bên trái, QR 34 mm bên phải. Không in mã đơn, tên khách, số tiền hoặc dòng hướng dẫn dưới chân. QR giữ khoảng trắng bốn module, không chèn logo lên mã. Các ô QR có cạnh sắc để tránh đường nối khi xuất ảnh.

Mỗi ảnh có **Tải ảnh thiệp/Tải ảnh QR** (PNG) và **Tải SVG**. SVG đã chuyển chữ/logo thành đường vector, giữ đúng chữ tiếng Việt khi chỉnh sửa hoặc phóng lớn. Không còn thao tác xuất PDF hoặc mở PDF để in. Giữ đúng tỷ lệ và vùng trống quanh mã khi chỉnh kích thước; quét thử trước khi in.

Có thể tải khi QR đang chờ đơn đủ điều kiện để chuẩn bị đóng gói. Tải ảnh không kích hoạt ngày, thay trạng thái đơn hoặc tiêu hao lượt. QR đã thu hồi, hết hạn, hết lượt hoặc đơn hủy không thể xuất. API yêu cầu đăng nhập và đúng quyền, ảnh trả về private/no-store. PNG tải xuống có nhật ký, không ghi token vào audit.

`APP_URL` cần dùng tên miền công khai HTTPS trước khi in gửi khách. Logic quét → đăng nhập → nhận ngày giữ nguyên. QR giữ chuỗi không hiển thị trong đơn hàng phía khách.

## Admin → Cài đặt → Phôi thiệp & card logo

- **Phôi thiệp viết tay**: dùng chung bố cục thiệp trong đơn hàng, khổ 74 × 105 mm; có nền kem, đầu Burgundy uốn cong, logo và slogan. Giữ “Gửi” bên trái, “THƯƠNG GỬI TỪ” bên phải ở đúng vị trí thiệp trong đơn; để trống tên hai bên và toàn bộ vùng lời nhắn.
- **Card logo Fleurious**: 60 × 60 mm, logo/wordmark màu kem trên nền Cellar Burgundy; không có lời nhắn hoặc thông tin đơn.

Cả hai có xem trước, tải PNG 600 dpi và SVG; quyền tải theo mục Settings.

## Mẫu và kiểm tra

Chạy `node --import tsx scripts/preview-flower-card.ts` để tạo năm mẫu PNG/SVG trong `output/cards/`. Các mẫu dùng tên giả và QR tên miền `.example`, chỉ để duyệt thiết kế; card dùng thật phải tải từ chi tiết đơn.

`npm test` kiểm tra việc lưu/đặt lại kiểu thiệp, vùng lời nhắn viết tay hoàn toàn trống, kích thước/density ảnh, giải mã QR từ PNG khổ ngang, không in dữ liệu cá nhân lên card QR, quyền và trạng thái tải. Font Lora và Be Vietnam Pro cùng giấy phép OFL nằm ở `public/fonts/`.
