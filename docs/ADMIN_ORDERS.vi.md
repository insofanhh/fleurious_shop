# Đặt lại và tạo đơn tại quản trị

## Đơn hết hạn

Trang chi tiết và danh sách đơn trong tài khoản hiển thị **Đặt lại** khi đơn chưa thu tiền đã hết thời gian giữ hoa. Đơn hủy thủ công trước hạn hoặc đơn hoàn tiền không được coi là hết hạn.

Đặt lại mở checkout, thêm hoa vào giỏ hiện tại và điền sẵn người mua, người nhận, địa chỉ, lời nhắn. Giá và ưu đãi cũ không được giữ lại. Khách chọn lại lịch giao và ưu đãi; checkout tự kiểm tra và cập nhật tổng tiền mới. Sản phẩm hết hàng/ngừng bán bị loại hoặc giảm số lượng với thông báo cụ thể. Bấm Đặt lại để xem trước chưa giữ kho hoặc khôi phục đơn; chỉ khi xác nhận checkout hợp lệ mới khôi phục chính đơn hết hạn về **Chờ xác nhận**. ID và mã đơn tra cứu giữ nguyên, giá và các lượt giữ kho/slot/ưu đãi được kiểm tra và cấp lại trong một transaction.

Checkout khách hàng tự tính lại khi đổi giỏ, ưu đãi, mã giảm giá, khu vực, ngày/khung giao hoặc phương thức thanh toán. Kết quả được lấy từ server sau khi ngừng nhập khoảng 350ms; không cần điền xong thông tin liên hệ và không có nút kiểm tra thủ công. Giao diện báo đang kiểm tra, số tiền tiết kiệm hoặc lý do không hợp lệ ngay dưới phần chọn ưu đãi. Đơn chỉ gửi được khi kết quả mới nhất hợp lệ; phản hồi cũ không ghi đè lựa chọn mới. Server vẫn kiểm tra lại đầy đủ thông tin, giá, tồn và ưu đãi khi tạo đơn.

Chỉ chủ tài khoản của đơn hoặc trình duyệt có cookie đặt đơn khách mới được đặt lại. Checkout dùng mã yêu cầu mới; lịch sử giữ lại việc hủy và khôi phục. Thử lại cùng mã yêu cầu hoặc gửi lại yêu cầu cũ không sinh đơn/giữ kho trùng. Hai cửa sổ khác nhau không cùng khôi phục được một đơn. Đặt lại từ đơn **đã giao thành công** vẫn tạo lượt mua mới và giữ nguyên đơn đã giao.

Mỗi lần khôi phục có **mã chuyển khoản mới**, tách với mã đơn tra cứu; mã QR giữ chuỗi cũng được đổi token và chưa kích hoạt. SePay chỉ tự xác nhận khoản đúng tiền, đúng mã thanh toán hiện tại và còn hạn; tiền theo mã cũ vào đối soát, vẫn gắn với đúng đơn. Đơn đã có giao dịch chưa đối soát cần cửa hàng xử lý trước khi đặt lại. Khi thanh toán mới thành công, đơn tự sang **Chờ chuẩn bị** như đơn web thông thường.

`expiredAt` phân biệt hết hạn với hủy thông thường. Migration bổ sung dấu hết hạn cho các đơn cũ có lịch sử “Đơn hết thời gian xác nhận/thanh toán”. Đơn quá hạn chưa được worker xử lý vẫn hiển thị hết hạn ở client; server chặn thanh toán/xác nhận muộn. Khi đặt lại, phần giữ kho của đơn cũ được giải phóng trước khi kiểm tra hàng còn lại.

Đơn **Chờ xác nhận**, chưa thanh toán, chưa bắt đầu chuẩn bị được tự hủy khi hết hạn: đơn web theo `expiresAt`; đơn chuyển khoản thủ công theo `paymentDueAt`. Cron xử lý định kỳ và các API đọc đơn/tra cứu/admin đồng bộ lại các đơn quá hạn. Không tự hủy đơn đang chuẩn bị/giao, đơn đã trả tiền, COD thủ công hoặc đơn chuyển khoản thủ công không giới hạn thời gian. Đơn con Daily dùng luồng gói riêng.

Migration `20261117160000_order_reactivation` bổ sung lịch sử mã thanh toán/idempotency và kỳ giữ quota theo lần checkout. Local đã migrate; Vercel chạy `prisma migrate deploy` trước khi build và nạp Prisma client mới. Với môi trường khác cần chạy migration trước khi khởi động bản mới.

## Đếm ngược thanh toán

Payment card hiển thị thời gian còn lại theo thời hạn do server cấp, cập nhật từng giây và tính lại khi quay lại tab. Giao diện đổi màu trong 60 giây cuối. Đến hạn, QR cũ được ẩn và trang đơn hiện Đặt lại. Trạng thái thanh toán thành công được cập nhật qua luồng realtime/poll hiện có.

Đơn SePay giữ thời hạn 15 phút; đơn COD chờ xác nhận giữ thời hạn 24 giờ. Đếm ngược thanh toán chỉ xuất hiện khi còn yêu cầu QR hợp lệ. Mốc giờ hiển thị theo Hà Nội (UTC+7).

## Tạo đơn từ kênh khác

Trong `/admin/orders`, **Đặt đơn** mở form quản trị. Owner và Manager được tạo đơn; các vai trò khác giữ phạm vi thao tác hiện có.

1. Chọn Zalo, Facebook, Instagram, Tại cửa hàng hoặc Kênh khác.
2. Chọn **Hoa**, sau đó chọn **Kích cỡ** từ danh sách của hoa đó và nhập số lượng. Kích cỡ hiển thị giá và tồn kho hiện tại; lựa chọn hết hàng hoặc đã có ở dòng khác không chọn lại được. Đổi hoa sẽ xóa kích cỡ cũ và đưa số lượng về 1 để chọn lại.
3. Gắn với tài khoản khách nếu muốn đơn xuất hiện trong hồ sơ và tính chi tiêu hội viên. Không tự gắn tài khoản chỉ dựa vào email nhập tay. Khách lẻ không bắt buộc email.
4. Điền người nhận, địa chỉ, khu vực, ngày/khung giao, lời nhắn và ghi chú trao đổi tại kênh bán.
5. Chọn giá thường, ưu đãi hội viên của khách hoặc mã giảm giá; chọn phương thức, trạng thái thanh toán và trạng thái ban đầu.
6. Hệ thống tự tính lại tổng tiền khi đổi sản phẩm hoặc ưu đãi. Kiểm tra kết quả rồi **Tạo đơn**.

| Trạng thái ban đầu | Cột Kanban    | Điều kiện                                 |
| ------------------ | ------------- | ----------------------------------------- |
| Chờ xác nhận       | Chờ xác nhận  | Chưa thu hoặc đã thu tiền                 |
| Chờ chuẩn bị       | Chờ chuẩn bị  | SePay phải đã thu đủ; COD có thể chưa thu |
| Đang chuẩn bị      | Đang chuẩn bị | Như trên                                  |
| Sẵn sàng giao      | Sẵn sàng giao | Như trên                                  |
| Đang giao          | Đang giao     | Như trên                                  |
| Đã giao & thu tiền | Đã giao       | Đã thu đủ tiền, ngày giao là hôm nay      |

Đơn đánh dấu đã thu tiền cần mã giao dịch/phiếu thu và ghi chú xác minh. Đơn thủ công có thể bắt đầu ở tiến trình cửa hàng đang thực hiện, gồm SePay chưa thu; chỉ đơn còn Chờ xác nhận chịu quy tắc tự hủy khi quá hạn. Với tiến trình đang xử lý, quản lý có thể ghi nhận khung giờ hôm nay đã qua; vẫn kiểm tra ngày hợp lệ, ngày nghỉ, sức chứa khung giao và tồn kho. Form này không dùng để nhập lịch sử các ngày trước.

Đơn, nguồn bán, người tạo, thu tiền và các bước tiến trình được ghi trong cùng transaction. Lỗi sẽ rollback toàn bộ; gửi lại cùng yêu cầu không tạo thêm đơn hoặc giữ kho lần hai. Tạo ở Đã giao thực hiện xuất kho và tính chi tiêu hội viên đúng như đơn website. Kênh bán hiển thị trên danh sách, chi tiết và thẻ Kanban; sự kiện tạo đơn dùng cùng cơ chế realtime.

Đơn SePay chưa thanh toán có QR thanh toán và đồng hồ trong chi tiết đơn quản trị. Quy tắc Hủy/Hoàn tiền và điều kiện mở QR giữ chuỗi tiếp tục dùng luồng chung, xem [Thanh toán và hoàn tiền](ORDER_PAYMENTS.vi.md).

Chọn **Thiệp tự động** hoặc **Thiệp viết tay** trước khi tạo đơn. Với viết tay, lời nhắn được lưu cho nhân viên nhưng vùng nội dung trên ảnh thiệp để trống. Tải PNG/SVG riêng cho thiệp và card QR; phôi trắng/card logo có trong Cài đặt. Xem [Hướng dẫn bộ card](FLOWER_CARD.vi.md).

## Kiểm thử cập nhật tự hủy/đặt lại

- Production build/TypeScript thành công; **244 kiểm thử nghiệp vụ và HTTP đạt**, không fail/skip. Có ca hủy đúng hạn và giải phóng một lần, trường hợp miễn tự hủy, kiểm tra giá/tồn, quyền tài khoản/cookie khách, nhiều lần đặt lại, race/idempotency, quota hội viên/voucher và tiền chuyển theo mã cũ/mới.
- Playwright dùng database `_test`, phí Goong và SePay giả lập: tạo đơn tại cửa hàng gắn tài khoản → hết hạn vào cột Hủy → khách Đặt lại và xác nhận checkout → cùng ID/mã đơn quay về Chờ xác nhận → tiền theo mã cũ vào đối soát → thanh toán mã mới sang Chờ chuẩn bị. Kanban cập nhật qua sự kiện đồng bộ, tra cứu công khai theo mã cũ vẫn đúng.
- 12 yêu cầu chuẩn bị Đặt lại đồng thời không trả lỗi trùng dữ liệu, không giữ kho hay nhân đôi sản phẩm trong giỏ. Bộ đếm rate limit xử lý tranh chấp tạo dòng đầu tiên bằng phép tăng nguyên tử; giới hạn số lượt vẫn được áp dụng.
- Migration mới đã áp dụng trên database local và các database kiểm thử; deployment Vercel sẽ chạy migration trước khi build.

