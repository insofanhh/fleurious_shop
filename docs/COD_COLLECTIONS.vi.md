# Công nợ COD và nhắc thu

## Vận hành

- **Tổng quan → COD cần thu**: tổng hợp toàn bộ khoản đang mở, độc lập với biểu đồ 200 đơn gần nhất. Chi tiết phân trang 12 khoản, ưu tiên hạn thu cũ trước, tìm theo mã đơn/người thanh toán/điện thoại.
- Tổng còn phải thu = khách chưa thanh toán + shipper chưa bàn giao. Quá hạn là một phần của tổng, không cộng thêm.
- Khi xác nhận giao COD: chọn khách chưa thanh toán, cửa hàng đã nhận đủ, hoặc shipper đã thu hộ. Giao và xác nhận thu được lưu trong cùng giao dịch; bằng chứng không hợp lệ sẽ hủy cả thao tác.
- Nhân viên giao chỉ cập nhật đơn được phân công. Có thể báo đã thu hộ kèm phiếu thu/ghi chú; báo cáo này **chưa** xác nhận thanh toán. Quản lý/kế toán xác minh từ khối công nợ.
- Khi xác nhận thu hộ: khách hết nợ, khoản phải thu chuyển sang shipper, không tăng tổng công nợ. **Nhận bàn giao** ghi nhận tiền về cửa hàng và tất toán khoản này.
- **Theo dõi / Hẹn thu**: xác định đúng người trả tiền, phân công người phụ trách, ghi nhận đã liên hệ, ghi chú và thời điểm nhắc tiếp. Lịch hẹn không thay đổi hạn thu hoặc số tiền.
- Trong chi tiết đơn có phiếu thu, trạng thái công nợ, thời gian thu/bàn giao và lịch sử theo dõi. Kanban giữ cột Đã giao, thêm nhãn Chưa thu tiền / Chờ shipper bàn giao.

Người đặt hoa mặc định là người thanh toán. Chỉ lấy điện thoại tài khoản người đặt nếu có; không lấy số người nhận hoa để nhắc tiền.

## Quyền và kiểm soát

Owner/Manager/Accountant được xem, xác nhận thu và nhận bàn giao. Các API công nợ kiểm tra quyền riêng; nội dung tài chính nội bộ không đưa vào dữ liệu đơn hàng phía khách. Phân công thu chỉ nhận tài khoản tài chính đang hoạt động.

Phiếu thu đủ tiền có ràng buộc duy nhất theo đơn. Thu tiền và bàn giao dùng khóa dòng đơn, kiểm tra phiên bản, giao dịch và nhật ký; gửi lại thao tác thành công không thu lần hai. Kho không bị trừ lại khi thu tiền sau giao. Doanh số xét nâng hạng và sự kiện purchase chỉ ghi nhận sau xác nhận thanh toán. QR COD tiếp tục mở khi giao, theo chính sách hiện tại.

Hoàn tiền là nghĩa vụ riêng: nếu shipper vẫn giữ tiền, khoản chờ bàn giao được giữ nguyên, kể cả khi cửa hàng đã hoàn cho khách. Chỉ tất toán khi nhận bàn giao. Chỉ số tiền nhận ròng không tính tiền thu hộ chưa về cửa hàng; tiền hoàn đã hoàn tất vẫn được trừ.

## Cấu hình nhắc

**Cài đặt → Công nợ COD & nhắc thu**:

| Cấu hình | Mặc định |
| --- | --- |
| Hạn thu sau giao | 0 giờ: ngay khi giao thực tế |
| Hạn shipper bàn giao | 24 giờ sau xác nhận thu hộ |
| Nhắc lần đầu | 2 giờ sau hạn thu |
| Ưu tiên | Quá hạn 24 giờ |
| Báo quản lý | Quá hạn 72 giờ |
| Tổng hợp ngày | 09:00 |
| Giờ gửi nhắc | 08:00 đến trước 20:00 |
| Push thiết bị / thông báo cho kế toán | Bật |

Lưu UTC trong DB; lịch hẹn, chốt ngày và giờ gửi dùng Hà Nội (Asia/Ho_Chi_Minh, UTC+7). Các hạn đã tạo là dữ liệu chốt của khoản thu; thay cấu hình hạn áp dụng cho lần phát sinh tiếp theo. Thay cấu hình giờ gửi/mức ưu tiên áp dụng cho các lượt kiểm tra tiếp theo.

Khi khoản phát sinh, gửi thông báo nội bộ. Job mỗi 5 phút kiểm tra nhắc đến hạn, chỉ gửi mức độ cao nhất phù hợp và chống trùng theo khoản/ngày/lịch hẹn/người nhận. Khoản đã thu hoặc chưa đến giờ hẹn được bỏ qua sau khi khóa và đọc lại dữ liệu. Worker kiểm tra lại trước khi gửi push để bỏ thông báo còn chờ trong outbox nếu đã tất toán hoặc đổi lịch hẹn. Lịch tổng hợp có cơ chế chạy bù trong giờ làm việc. Thông báo cũ là lịch sử; không phải số dư hiện tại.

Mặc định quản lý và kế toán nhận thông báo; có thể tắt người nhận kế toán hoặc push trong cài đặt. Người phụ trách chỉ chọn từ nhóm tài chính. Không tự gửi tin nhắc cho khách.

## Cron, realtime và triển khai

1. Chạy `npm run db:migrate` trên DB đích trước khi chạy bản code mới; migration `20261115130000_cod_receivables` thêm thời gian giao/thu, bảng công nợ, phiếu thu, lịch sử.
2. Chạy `npm run build` và khởi động lại ứng dụng/worker để nạp Prisma Client mới.
3. Lịch cron-job.org hiện có gọi `/api/internal/schedule` mỗi phút sẽ tự thêm job `collection-reminders`, không cần một lịch cron mới. Nếu cấu hình từng tác vụ riêng, có thể POST `/api/internal/jobs/collection-reminders` với cùng header Bearer CRON_SECRET hiện có.
4. Local Socket.IO và WebSocket trên Vercel đều làm mới Tổng quan khi thu tiền/bàn giao/hẹn thu. Kế toán được nhận sự kiện đồng bộ đơn, còn các thao tác nội bộ gửi riêng đến người có quyền tài chính.

Không thay đổi các đơn cũ đã đánh dấu PAID, không tạo nợ dựa trên việc thiếu phiếu thu mới, không suy thời điểm giao từ updatedAt. Dữ liệu cũ thiếu thời gian giao thực tế được hiển thị là chưa xác minh.

## Phạm vi

Bản này hỗ trợ **thu đủ một lần**, thu hộ, bàn giao và nhắc nội bộ. Đặt cọc/thu nhiều lần và đối soát tự động SePay cho đơn có phương thức COD là đợt tiếp theo; COD chuyển khoản hiện xác nhận thủ công bằng mã giao dịch. Luồng SePay hiện có tiếp tục đối soát đơn sử dụng phương thức SePay.

Kiểm thử nghiệp vụ trong `tests/collections.test.ts` và `tests/commerce.test.ts`: giao chưa thu; tạo đơn thủ công đã giao/chưa trả; khóa và thu đồng thời; bằng chứng sai rollback; báo thu hộ theo phân công; thu hộ/bàn giao; hoàn tiền không xóa khoản shipper giữ; không trừ kho lại hoặc nâng hạng sớm; lịch hẹn; quyền; dữ liệu ngoài 200 đơn; cron chạy lại, giờ yên lặng và chốt ngày Hà Nội.
