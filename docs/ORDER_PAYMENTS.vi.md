# Thanh toán và hoàn tiền đơn hoa

## Xác nhận tiền trong quản trị

Tại Đơn hàng, chọn trạng thái thanh toán → **Xác nhận đã thanh toán**. Nhập mã giao dịch ngân hàng/phiếu thu và ghi chú xác minh. Chỉ xác nhận khi đã thực nhận đủ tổng tiền. Owner/Manager thao tác tại bảng, Kanban hoặc chi tiết đơn; API cũng cho phép Accountant xác nhận. Lịch sử, audit và thông báo realtime được ghi cùng giao dịch dữ liệu.

Xác nhận thủ công và webhook SePay khóa cùng đơn để không tiêu thụ quota, voucher hay ưu đãi hai lần. Webhook đến sau khớp số tiền, mã đơn và mã giao dịch đã xác nhận sẽ được đối chiếu mà không thu tiền lần hai; giao dịch khác chuyển sang cần đối soát. Đơn hết hạn, đã hủy hoặc đang/đã hoàn không thể được đánh dấu thanh toán lại.

## Hủy và hoàn tiền

- **Chưa nhận tiền:** Owner/Manager được hủy khi chưa sẵn sàng giao. Đơn sang cột **Hủy**, giải phóng các lượt giữ và vô hiệu QR.
- **Đã nhận tiền:** thay Hủy bằng **Dừng đơn & hoàn tiền** (đơn đã giao: **Hoàn tiền đơn đã giao**). Tạo yêu cầu hoàn toàn bộ phần còn lại và chuyển sang `REFUND_PENDING` — **Chờ hoàn tiền**. Việc tạo yêu cầu chưa có nghĩa tiền đã được hoàn.
- Sau khi thực hiện hoàn tiền qua ngân hàng, vào **Thanh toán SePay → Yêu cầu hoàn tiền → Ghi nhận đã hoàn**, nhập mã giao dịch hoàn. Hoàn đủ mới chuyển thanh toán và đơn sang `REFUNDED` — **Đã hoàn tiền**; hoàn một phần chuyển thanh toán sang `PARTIALLY_REFUNDED`.

Tính năng này chỉ ghi nhận và đối soát; không tự chuyển tiền khỏi ngân hàng. Không cho sửa đơn đã trả tiền về Chưa thanh toán, kéo đơn hoàn/hủy quay về giao hàng hoặc hoàn vượt số đã nhận. Cập nhật có kiểm tra phiên bản để ngăn thao tác trên dữ liệu cũ; xác nhận lại cùng khoản đã hoàn không tạo hiệu ứng lần hai.

## Kanban và vận hành

Mỗi đơn xuất hiện trong đúng một cột. Đơn dừng chờ hoàn, đã hoàn toàn bộ, hoặc đơn hủy cũ đã nhận tiền vào **Hoàn tiền**. Đơn chưa thu tiền đã hủy vào **Hủy**. Hoàn một phần trong khi còn giao hàng giữ nguyên cột tiến trình; sau khi giao xong được xếp vào Hoàn tiền để tiện đối soát. Thẻ hiển thị riêng số tiền chờ hoàn và đã hoàn.

Kéo thẻ vào Hủy/Hoàn tiền thực hiện cùng quy tắc và bước xác nhận như menu. Các bước giao hàng không thể bỏ qua. Đơn đã dừng không còn trong lịch giao, không được phân công/đổi lịch; QR giữ chuỗi và ngày/thưởng phụ thuộc nguồn QR bị vô hiệu theo chính sách hiện có.

## Kho và hội viên

Đơn dừng trước khi giao giải phóng hàng đang giữ, khung giao và quyền lợi theo chính sách kỳ hiện có. Hoa đã giao/đã tiêu thụ không tự cộng lại kho; nếu có hàng thực tế nhận lại cần kiểm kê riêng. Đơn đã giao không trả lại lượt quyền lợi đã dùng.

Chi tiêu lên hạng chỉ tính tiền hoa ròng của đơn đã giao, đã thu tiền; không gồm phí giao. Hoàn tiền hoa đã đối soát được trừ đúng một lần, kể cả hoàn một phần trước khi hoàn tất giao hàng. Tổng hoàn gồm cả yêu cầu đang chờ và đã hoàn không vượt tiền đơn, phân bổ tiền hoa phải khớp phần còn lại.

## Giao diện QR

Payment card giữ nền kem, bo góc và các nút sao chép. Khi phần nội dung thẻ rộng từ 480px, QR ở trái, số tiền và ngân hàng ở phải. Thẻ tối đa 780px; cột hẹp/mobile chuyển về một cột để QR vẫn dễ quét.
