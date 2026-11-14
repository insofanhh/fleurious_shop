# Fleurious Circle — Phân tích mở rộng hạng hội viên

Ngày phân tích: 14/11/2026. Phạm vi: đặc tả để triển khai, chưa thay đổi hành vi ứng dụng.

## 1. Hiện trạng đã kiểm tra trong mã nguồn

- `User.memberSince` xác định đã tham gia; `User.tier` là chuỗi, mặc định `Member`.
- Đã có ba tên hạng `Member`, `Bloom`, `Burgundy`.
- Khi giao đơn, hệ thống cộng `subtotal - discount` của đơn `COMPLETED` và `PAID`, rồi xét ngưỡng `bloomSpend`, `burgundySpend`. Đây chưa phải sổ chi tiêu có điều chỉnh hoàn tiền theo từng khoản.
- Admin đã có trường đổi hạng và lý do điều chỉnh, nhưng đang ghi trực tiếp `User.tier`; chưa có nguồn cấp, ngày hết hạn hay bảo vệ hạng admin cấp trước lần xét tự động tiếp theo.
- Checkout vẫn dùng chung `memberQuota`, `memberPercent`, `memberCap` cho mọi hạng. Thay tên hạng hiện chưa tạo bộ quyền lợi khác nhau.
- `MemberPeriod` duy nhất theo user/tháng, đã có `reserved`, `consumed`; `MemberLedger` chống ghi lặp theo đơn/hành động. Cần kế thừa cơ chế này.
- SePay đang đối soát mã đơn hoa `FLR...`. `Payment` gắn tùy chọn với `Order`, chưa có hóa đơn gói hội viên.
- Thời gian nghiệp vụ đang dùng `Asia/Ho_Chi_Minh`, hiển thị “Hà Nội · UTC+7”.

Các vị trí chính: `prisma/schema.prisma`, `src/lib/commerce.ts`, `src/lib/settings.ts`, `src/app/api/[...path]/route.ts`, `src/components/customer-features.tsx`, `src/components/admin-dashboard.tsx`.

## 2. Mô hình đề xuất: một bộ hạng, ba nguồn nhận hạng

Giữ các tên hạng hiện tại và chuyển chúng thành dữ liệu quản lý được. Mỗi hạng có thứ tự duy nhất, bộ quyền lợi, giá bán và ngưỡng chi tiêu riêng.

| Nguồn | Cách nhận | Thời hạn đề xuất |
|---|---|---|
| Cơ bản | Đăng ký hội viên và xác minh tài khoản | Không hết hạn |
| Tích lũy | Chi tiêu mua hoa đạt ngưỡng | Mặc định giữ hạng, phù hợp cơ chế hiện tại |
| Mua gói | Thanh toán gói tháng/năm | 1 hoặc 12 tháng lịch kể từ thời điểm kích hoạt |
| Admin cấp | Nhân sự được phân quyền cấp trực tiếp | Bắt buộc chọn ngày hết hạn hoặc xác nhận cấp không thời hạn |

“Cơ bản” là nền của chương trình; ba cách nâng hạng là tích lũy, mua gói và admin cấp.

Hạng áp dụng = hạng có thứ tự cao nhất trong các quyền đang có hiệu lực. Một người có thể giữ nhiều quyền nhưng chỉ dùng một bộ quyền lợi tại một thời điểm. Không cộng N hoặc phần trăm của các nguồn.

Ví dụ: khách tích lũy được Bloom, mua Burgundy một tháng. Trong tháng mua gói dùng Burgundy; khi gói hết hạn quay về Bloom. Admin tặng Burgundy sau đó không xóa gói đã mua. Nếu gói mua trùng thời gian quà tặng, thời hạn gói vẫn chạy; giao diện phải cảnh báo trước khi thanh toán. Không tự chuyển thời gian đã mua thành tiền hoặc kéo dài ngầm.

Hạng hội viên độc lập hoàn toàn với vai trò quản trị.

## 3. Bộ hạng và giá: dữ liệu minh họa để dự toán

| Cấu hình | Member | Bloom | Burgundy |
|---|---:|---:|---:|
| Phí/tháng | Miễn phí | 59.000 đ | 129.000 đ |
| Phí/năm, thanh toán trước | Miễn phí | 590.000 đ | 1.290.000 đ |
| Tiết kiệm so với mua 12 tháng | — | 118.000 đ, khoảng 16,7% | 258.000 đ, khoảng 16,7% |
| Chi tiêu tích lũy để đạt hạng | Đăng ký | 2.000.000 đ | 8.000.000 đ |
| Đơn được dùng ưu đãi/tháng | 3 | 5 | 8 |
| Giảm tiền hoa | 10% | 12% | 15% |
| Trần giảm/đơn | 100.000 đ | 120.000 đ | 150.000 đ |

Đây là ví dụ cấu hình, không phải giá bán đã chốt. Member giữ quyền lợi hiện tại để tránh giảm quyền lợi khách cũ. Ngưỡng Bloom/Burgundy lấy theo giá trị mặc định đang có; cần xác nhận lại giá trị shop đang sử dụng trước migration.

Giá năm là giá độc lập do admin nhập; phải thấp hơn 12 lần giá tháng khi bật bán cả hai chu kỳ. Phần trăm tiết kiệm được tính từ giá, không nhập bằng một trường rời dễ sai. Gói năm thu toàn bộ tiền một lần; không hiển thị giá quy đổi/tháng như số tiền sẽ thu ngay.

Quyền lợi bổ sung nên ưu tiên giá trị thực:

- Burgundy: hai lượt hỗ trợ phí giao/tháng, tối đa 30.000 đ/lượt, đơn tiền hoa sau giảm từ 500.000 đ; cần ngân sách và bộ đếm riêng.
- Voucher sinh nhật một lần/năm, có hạn, đơn tối thiểu và trần giảm. Không nhân quà khi đổi hạng trong cùng năm.
- Thiệp viết tay hoặc gói quà nâng cấp theo khả năng vận hành.
- Xem trước bộ sưu tập, danh sách yêu thích và nhắc ngày kỷ niệm theo lựa chọn của khách.
- Ưu tiên tư vấn florist; không tự hứa giao nhanh hoặc giữ slot khi vận hành chưa đáp ứng.

Giai đoạn đầu nên triển khai giảm tiền hoa + N lượt + quà sinh nhật. Miễn phí giao, quà vật lý và SLA tư vấn chỉ bật khi có quy trình thực hiện.

Vì Member miễn phí đã có 10% cho ba đơn, khách mua ít có thể không cần gói trả phí. Chỉ tăng N chưa đủ hấp dẫn. Cần đo phần lợi ích tăng thêm so với Member và chi phí hoa, giao, quà, thanh toán trước khi công bố giá.

## 4. Chi tiêu tích lũy và nâng hạng tự động

### Quy tắc khởi đầu

- Tính cho tài khoản mua hàng đã đăng ký hội viên. Không chuyển chi tiêu cho người nhận hoa hoặc người quét QR.
- Chỉ ghi nhận khi đã thanh toán và giao thành công; COD phải có xác nhận đã thu tiền.
- Chi tiêu hợp lệ = tiền hoa sau mọi giảm giá, trừ phần hoàn tiền thuộc tiền hoa.
- Không tính phí giao, phí hội viên, đơn hủy, khoản chưa thanh toán hoặc giao dịch ngoài đơn không được đối soát.
- Đơn trước thời điểm đăng ký hội viên không tự cộng ngược; nếu muốn nhập lịch sử, thực hiện một tác vụ có báo cáo và audit.
- Đạt nhiều ngưỡng trong một đơn thì lên thẳng hạng cao nhất đủ điều kiện.
- Đơn tạo ra lần nâng hạng vẫn dùng báo giá ban đầu; quyền lợi mới áp dụng đơn tiếp theo.

Mặc định đề xuất tích lũy trọn đời để tiếp nối hệ thống hiện tại. Admin đặt ngưỡng từng hạng; sửa ngưỡng có hiệu lực theo phiên bản. Hạ ngưỡng có thể chạy xét bổ sung; tăng ngưỡng không thu hồi hạng đã cấp theo quy tắc cũ.

Nếu shop muốn xét trong 12 tháng gần nhất và duy trì hạng theo năm, đó là chế độ riêng: cần cửa sổ chi tiêu, thời hạn giữ hạng, ngưỡng duy trì và thời gian báo trước. Không bật thay thế âm thầm cho khách đang giữ hạng trọn đời.

### Hoàn tiền

Sổ chi tiêu ghi bút toán cộng/trừ gắn với đơn và khoản hoàn đã hoàn tất. Hoàn một phần chỉ trừ phần tiền hoa tương ứng, không trừ nhầm phí giao hoặc trừ lại phần đã giảm.

Hạng tích lũy được tính lại sau hoàn tiền. Nếu khoản hoàn làm mất điều kiện đã dùng để cấp hạng, có thể thu hồi quyền tích lũy phát sinh từ khoản đó sau khoảng thông báo công bố trước. Hạng mua và hạng admin cấp vẫn được xét độc lập. Không truy thu giảm giá của các đơn đã xác nhận hợp lệ. Trường hợp gian lận cần thao tác riêng có audit.

## 5. Mua tháng/năm, gia hạn và đổi gói

Luồng: chọn hạng → chọn tháng/năm → xem giá và điều khoản → tạo hóa đơn hội viên → chuyển khoản QR SePay → server xác nhận tiền → cấp quyền → cập nhật thẻ theo realtime.

- Phải đăng nhập, xác minh email, chấp nhận đúng phiên bản điều khoản trước khi mua.
- Gói tháng/năm là quyền lợi thành viên, không phải đặt mua hoa giao mỗi tháng.
- Thời điểm bắt đầu tính từ kích hoạt sau xác nhận thanh toán; thời hạn lưu dưới dạng `[startsAt, endsAt)`.
- Cộng tháng theo lịch Hà Nội, không dùng cố định 30/365 ngày. Giữ ngày neo gốc và kẹp vào ngày cuối tháng nếu ngày không tồn tại; năm nhuận phải có trường hợp kiểm thử riêng.
- Gia hạn cùng hạng: nối tiếp ngày hết hạn nếu còn hiệu lực; nếu đã hết thì tính từ lúc kích hoạt.
- Chuyển tháng sang năm cùng hạng: kỳ năm bắt đầu khi kỳ đã mua kết thúc. Không hủy giá trị thời gian còn lại.
- Hạ hạng: lên lịch sau quyền trả phí hiện tại, không hạ ngay và không hoàn tiền tự động.
- Khách có hạng tích lũy/admin bằng hoặc cao hơn phải được báo rõ; không gợi ý mua một gói không tạo lợi ích hiện tại.
- Không đồng thời tạo nhiều hóa đơn chờ cho cùng một yêu cầu; mỗi hóa đơn có thời hạn và khóa chống tạo lặp.

### Nâng gói trả phí đang chạy

Không mặc định thu nguyên giá hạng mới rồi bỏ thời gian hạng cũ. Báo giá nâng cấp giữ nguyên ngày kết thúc, tính phần giá hạng mới cho thời gian còn lại, trừ giá trị chưa sử dụng của khoản trả phí cũ.

Chỉ cùng chu kỳ tháng/tháng hoặc năm/năm được tính chênh lệch tức thì trong bản đầu. Đổi chu kỳ đồng thời với nâng hạng lên lịch ở kỳ tiếp theo hoặc cần luồng riêng. Tiền được làm tròn tới VND, có breakdown và báo giá hết hạn. Hạng nhận miễn phí không tạo tín dụng tiền mặt để trừ vào giá mua.

Giá trị gói cũ đã chuyển thành credit phải được ghi nhận, không thể dùng lại khi yêu cầu nâng lần thứ hai. Trong lúc chờ thanh toán, vẫn giữ quyền hiện tại. Nếu hạng/thời hạn đổi sau khi tạo báo giá, phải kiểm tra lại trước khi kích hoạt; khoản tiền không còn khớp đưa vào đối soát.

### Gia hạn thanh toán

Với luồng VietQR/webhook đang có, đề xuất chủ động mua và gia hạn, không tự động trích tiền. Gửi nhắc trước 7 ngày, 1 ngày và lúc hết hạn theo kênh khách đồng ý. Hết hạn chỉ kết thúc nguồn trả phí, không khóa tài khoản hay cấm mua hoa.

## 6. Quota: không reset khi đổi hạng

Giữ một sổ sử dụng chung theo user/tháng dương lịch Hà Nội. Không tạo quota mới theo mỗi lần thanh toán hoặc mỗi nguồn cấp hạng.

Lượt còn lại = max(0, hạn mức của hạng đang áp dụng − lượt đã dùng − lượt đang giữ).

Ví dụ: Member có 3 lượt, đã dùng 2. Nâng Bloom có 5 lượt thì còn 3, không phải thêm nguyên 5. Gia hạn, đổi tháng/năm hoặc admin cấp lại hạng cũng không reset số đã dùng.

- Mua gói năm không cấp ngay 12 × N lượt.
- Không cộng dồn lượt chưa dùng sang tháng mới.
- Cùng một đơn dù có nhiều bó hoa vẫn dùng một lượt tiền hoa.
- Hết lượt vẫn được mua thường hoặc chọn voucher đủ điều kiện.
- Hạng hết hạn giữa tháng: đơn mới xét quyền của hạng nền; nếu đã dùng quá hạn mức nền thì còn 0. Không thu hồi đơn đã xác nhận.
- Đơn đang giữ quyền lợi được thanh toán theo snapshot và TTL đã công bố; hết TTL trả lượt về kỳ gốc.
- Hoàn/hủy trả lượt theo chính sách của kỳ gốc, không tạo lượt mới ở tháng hiện tại.
- Thay cấu hình hạng dùng phiên bản mới: khoản đã thanh toán được bảo toàn quyền lợi trong thời hạn đã mua; cấu hình giá/quyền lợi mới áp dụng cho lần mua/gia hạn mới. Quota của hạng miễn phí/tích lũy áp dụng phiên bản công bố cho kỳ chưa mở.

### Hai loại thời gian phải công bố rõ

Gói 1 tháng tính theo ngày kích hoạt, trong khi quota làm mới ngày 1. Vì vậy gói một tháng có thể đi qua hai tháng lịch; gói năm có thể đi qua 13 tháng lịch. Mua sát cuối tháng rồi đầu tháng dùng tiếp có thể nhận quyền lợi ở cả hai kỳ.

Đề xuất bản đầu giữ quota tháng dương lịch như đang có, cấp hạn mức tháng khi quyền đang hiệu lực và công bố đúng cơ chế này. Không quảng cáo “gói năm cấp đúng 12 lần quota”. Phải tính chi phí trường hợp 13 kỳ khi định giá; ngăn reset trong cùng một tháng bằng sổ chung. Đây là lựa chọn sản phẩm có chủ ý, không phải lỗi chống trùng.

Nếu shop muốn đúng 12 kỳ quyền lợi mỗi năm, nên chuyển quota trả phí sang chu kỳ kỷ niệm ngày kích hoạt, đồng thời thiết kế lại cách kết hợp với quota miễn phí/tích lũy. Không tự chia theo ngày hoặc đổi đồng hồ quota khi chưa công bố rõ vì sẽ làm “N lượt/tháng” khó hiểu.

## 7. Ưu đãi và quan hệ với giữ chuỗi

- Một đơn chọn một ưu đãi tiền hoa: quyền lợi hội viên hoặc voucher/ưu đãi giữ chuỗi.
- Quyền lợi phí giao chỉ cộng cùng giảm tiền hoa nếu cấu hình cho phép; bộ đếm phí giao riêng và có hoàn/trả đúng kỳ.
- Hạng cao không tự tăng số ngày chuỗi hoặc miễn thao tác quét QR.
- Mua gói hội viên không tạo QR giữ chuỗi, không cộng chi tiêu lên hạng, không giữ kho hay slot giao hoa.
- Có thể tặng voucher khi mua gói nếu shop chủ động cấu hình. Chỉ cấp một lần theo hóa đơn đã thanh toán; không cấp lại khi webhook hoặc realtime lặp.
- Quà sinh nhật/quà năm tính theo user + chương trình + năm/quy tắc; nhiều nguồn cấp không nhân quà.

## 8. Giao diện client

### Trang /membership

Giữ UI Burgundy/Cream và thiết kế thẻ hiện tại, thay icon hoa trên thẻ bằng logo thương hiệu dùng chung. Sửa thông điệp thành “Tham gia miễn phí. Mở thêm đặc quyền khi nâng hạng.”

Thứ tự mobile:

1. Thẻ hạng đang dùng, ngày hết hạn nếu có, N còn lại.
2. Ba cách nâng hạng: mua gói, mua hoa tích lũy, được shop tặng.
3. Bộ chuyển Tháng/Năm; nhãn tiết kiệm tính đúng từ giá.
4. Các thẻ hạng cuộn dọc, quyền lợi chính và CTA rõ.
5. Tiến độ chi tiêu lên hạng kế tiếp.
6. Câu hỏi về hết hạn, gia hạn, quota, đổi gói và hoàn phí.

Giá năm: “590.000 đ/năm · Thanh toán một lần”, dòng phụ “Tương đương khoảng 49.167 đ/tháng”. Hạng đang có dùng “Đang sử dụng”; gia hạn dùng “Gia hạn”; hạng cao hơn dùng “Nâng lên Burgundy”. Không mở sẵn chu kỳ năm bằng cách khiến giá hiển thị như giá tháng.

### Profile /account

Ví dụ nội dung:

> Burgundy · Còn 6/8 lượt ưu đãi tháng này. Mua gói năm, hiệu lực đến 14/11/2027. Hạng tích lũy của bạn: Bloom. Nếu không gia hạn, bạn tiếp tục dùng Bloom.

Hiển thị riêng hạng đang hưởng, nguồn tạo quyền, lịch gia hạn, hạng nền, chi tiêu hợp lệ, số còn thiếu lên hạng, lịch sử thanh toán/cấp hạng. Nếu quyền cao nhất có nhiều nguồn, ngày hết hạng phải tính từ chuỗi quyền liên tục thực tế; không chỉ lấy ngày của một bản ghi bất kỳ.

### Thanh toán gói

Trang riêng tối giản, không yêu cầu người nhận hoặc địa chỉ giao hoa. Hiển thị tên gói, chu kỳ, giá, ngày bắt đầu/kết thúc dự kiến, quy tắc quota, QR SePay, hạn thanh toán và trạng thái đang xác nhận. Sau webhook thành công cập nhật thẻ; mất WebSocket thì tải lại trạng thái từ server. Khi offline chỉ xem thông tin đã lưu, không xác nhận mua hoặc tự kích hoạt gói.

### Checkout hoa

Nêu đúng hạng và lợi ích của đơn: “Burgundy −15%, tối đa 150.000 đ · Dùng 1/6 lượt còn lại”. So sánh với voucher khả dụng trước khi khách quyết định. Không âm thầm chọn một ưu đãi kém hơn và tiêu lượt.

## 9. Admin dashboard

### Hạng & quyền lợi

CRUD tên/mã hạng, thứ tự, mô tả, màu thẻ trong bảng màu thương hiệu, hiển thị, cho phép bán; giá tháng/năm; N đơn/tháng; phần trăm, trần giảm, đơn tối thiểu; ngưỡng chi tiêu; quyền lợi bổ sung; phiên bản, ngày công bố và chính sách áp dụng.

Validate thứ tự/ngưỡng không xung đột; giá năm thấp hơn 12 giá tháng; cap/giá/quota không âm. Cảnh báo khi hạng cao có quyền lợi thấp hơn hạng thấp. Không xóa cứng hạng đang được dùng: ngừng bán hoặc lưu trữ, giữ lịch sử.

### Danh sách hội viên

Tìm theo tên/email/điện thoại; lọc hạng áp dụng, nguồn, sắp hết hạn, đã hết gói trả phí, còn/hết quota. Cột: khách, hạng áp dụng, hạng tích lũy, gói trả phí, thời hạn, chi tiêu, lượt đã dùng/đang giữ/còn lại. Không lẫn “gói trả phí hết hạn” với “không còn là hội viên”.

### Cấp hạng thủ công

Một hành động riêng “Cấp/nâng hạng”, không ghi đè một ô tier trong form sửa khách. Chọn hạng, ngày bắt đầu, ngày kết thúc hoặc không thời hạn, lý do bắt buộc, có thông báo khách hay không. Trước lưu hiển thị hạng trước/sau và quota còn lại dự kiến.

Lưu actor, thời gian, nguồn, giá trị trước/sau và lý do. Thu hồi chỉ thu hồi quyền admin đã cấp, không xóa quyền mua/tích lũy. Nếu cấp hạng thấp hơn hạng đang có, cảnh báo rằng hạng áp dụng sẽ không đổi.

OWNER quản lý cấu hình và cấp không thời hạn; MANAGER chỉ cấp có hạn nếu được phân quyền. FLORIST/DELIVERY không cấp hạng. Hạn chế tài khoản tự cấp hạng nếu không có quyền rõ ràng. Khóa khách là hành động tài khoản riêng.

### Giao dịch, đối soát và báo cáo

Hóa đơn hội viên tách danh sách đơn hoa; có mã, gói, phiên bản giá, kỳ, số tiền, giao dịch SePay, trạng thái, lần cấp quyền, hoàn phí và lịch sử. KPI: doanh thu hội viên, doanh thu hoa của hội viên, số gói tháng/năm, gia hạn, hạng tích lũy, nguồn admin, quota sử dụng và chi phí ưu đãi tăng thêm. Không đếm nguồn admin/earned như doanh số bán gói.

## 10. Dữ liệu và dịch vụ

| Bảng/dịch vụ | Vai trò |
|---|---|
| MembershipTier | Mã ổn định, tên, thứ tự và trạng thái hạng |
| MembershipTierVersion | Giá, quyền lợi, ngưỡng và điều khoản đã công bố; bản đã bán bất biến |
| MembershipEnrollment | Tư cách tham gia, thời điểm và phiên bản đồng ý |
| MembershipEntitlement | Nguồn EARNED/PAID/ADMIN, hạng/version, bắt đầu/kết thúc, trạng thái, người cấp, nguồn tham chiếu |
| MembershipInvoice | Hóa đơn mua/gia hạn/nâng gói, snapshot giá, trạng thái, idempotency, hạn thanh toán |
| MembershipSpendLedger | Chi tiêu đủ điều kiện và bút toán hoàn/điều chỉnh, chống ghi lặp |
| MembershipHistory | Lịch sử nguồn cấp và hạng áp dụng, lý do thay đổi |
| MemberPeriod/MemberLedger | Giữ cơ chế kỳ tháng chung, reserve/consume/release và phiên bản quota |
| Payment/PaymentWebhookEvent | Giao dịch SePay dùng chung, phân tuyến tới đơn hoa hoặc hóa đơn hội viên |

Nếu tiếp tục dùng `Payment`, bổ sung `membershipInvoiceId` và bảo đảm một giao dịch chỉ gắn tối đa một đối tượng. Giao dịch chưa khớp vẫn có thể không gắn đối tượng để đối soát. Provider transaction ID phải unique trên toàn hệ thống, không tách hai bảng rồi nhận cùng một giao dịch hai lần.

`resolveMembership(userId, now, tx)` trả hạng, phiên bản quyền lợi, nguồn giải thích, khoảng hiệu lực và quota. Giá/checkout/admin/profile cùng dùng dịch vụ này; không tin tier/giá/N do client gửi. `User.tier` chỉ được giữ như dữ liệu tương thích hoặc bản tổng hợp, không còn là nguồn quyết định duy nhất.

Thao tác kích hoạt: khóa hóa đơn và tài khoản liên quan → kiểm tra chưa cấp → xác nhận thanh toán → ghi entitlement/history → cập nhật dữ liệu tổng hợp → ghi outbox trong một transaction. Thứ tự khóa thống nhất với đơn/hoàn tiền để tránh deadlock. Chỉ phát realtime sau commit; ngắt kết nối thì refetch snapshot.

API dự kiến: danh sách hạng công khai; quyền hội viên hiện tại; báo giá mua/nâng gói; tạo và xem hóa đơn; CRUD/publish hạng cho admin; cấp/thu hồi quyền admin; lịch sử và đối soát. Tất cả API thay đổi dữ liệu cần session, quyền, CSRF theo nền hiện tại và khóa chống lặp khi phù hợp.

## 11. SePay, lịch chạy và các tình huống lỗi

Thêm tiền tố mã hội viên riêng, ví dụ `FLM...`, đồng thời cập nhật bộ lọc mã ở SePay và bộ phân tuyến webhook. Giữ nguyên mã `FLR...` của đơn hoa. Không gắn giả hóa đơn hội viên vào một đơn có kho, giao hoa và QR chuỗi.

Webhook phải xác thực, kiểm tra tài khoản nhận, tiền vào, mã hóa đơn, số tiền và trạng thái; nhận lặp không được gia hạn/cấp quyền lặp. Thanh toán thiếu/thừa, đến muộn, sai mã hoặc sai trạng thái chuyển đối soát; không kích hoạt dựa trên trang redirect hay nút “đã chuyển khoản”. Nếu webhook hợp lệ được xử lý trước khi mất response, lần gửi lại trả thành công từ bản ghi đã có.

Phí hội viên hoàn bằng quy trình riêng: yêu cầu → kiểm tra điều khoản/quyền lợi đã dùng → duyệt → thực hiện/đối soát khoản hoàn → ghi nhận hoàn tất và cập nhật quyền. Một yêu cầu hoàn phí chưa có tiền hoàn thực tế không được tự coi là đã hoàn. Không quảng cáo chính sách hoàn phí khi chưa được shop chốt và công bố.

cron-job.org gọi endpoint có secret header để enqueue các việc: hết hạn hóa đơn; cập nhật hạng hết hạn; nhắc gia hạn; đối soát thanh toán; xét chi tiêu lại sau sửa ngưỡng/hoàn tiền. Job có dedup key, retry và lock. Checkout luôn tự kiểm tra thời hạn ở server: cron trễ không kéo dài quyền; cron không phải điều kiện duy nhất để mở quota tháng.

Nguồn chính thức đã đối chiếu:

- [SePay — tích hợp webhook](https://docs.sepay.vn/tich-hop-webhooks.html): payload, phản hồi và chống trùng theo ID giao dịch.
- [SePay — bảo mật webhook](https://developer.sepay.vn/vi/sepay-webhooks/bao-mat): xác thực và kiểm tra số tiền, tài khoản, mã giao dịch.

## 12. Chuyển đổi dữ liệu và thứ tự thực hiện

1. Chốt bảng quyền lợi/giá, quota lịch, chi tiêu trọn đời và điều khoản mua/gia hạn/hoàn.
2. Tạo schema, phiên bản hạng, entitlement resolver và migration có bản xem trước.
3. Member hiện có giữ tư cách/quota đang mở. Tên hạng cao cũ chưa rõ nguồn phải nhập thành quyền LEGACY được bảo toàn và lập danh sách rà soát; không tự đoán là gói trả phí hay quyền admin.
4. Triển khai quản lý hạng, cấp quyền admin và sổ chi tiêu; sửa checkout dùng quyền lợi theo hạng.
5. Xây báo giá/hóa đơn hội viên, SePay, gia hạn và nâng gói; bật bằng feature flag sau kiểm thử.
6. Hoàn thiện trang membership/profile, realtime, nhắc gia hạn và báo cáo.
7. Đối soát dữ liệu và chạy UAT trước mở bán; rollback bằng tắt bán mới, bảo toàn hóa đơn/quyền đã thanh toán.

### Điều kiện nghiệm thu bắt buộc

- Cùng quyền lợi của một hạng dù nhận bằng mua, tích lũy hay admin; nhiều nguồn không cộng dồn.
- Hết gói cao quay về đúng hạng còn hiệu lực, không về Member một cách máy móc.
- Hai checkout tranh lượt cuối chỉ một lần giữ thành công; nâng/gia hạn không reset lượt.
- Hạng hết giữa tháng, đổi ngày theo Hà Nội, cuối tháng 28/29/30/31 ngày và năm nhuận đều đúng.
- Webhook gửi lại, trả response lỗi sau commit, hai giao dịch cùng hóa đơn và thanh toán sau hết hạn không cấp quyền lặp.
- Gia hạn hai lần nối tiếp đúng; nâng gói không tái sử dụng credit đã dùng; đổi giá không sửa hóa đơn đã thanh toán.
- Đơn đạt ngưỡng rồi hoàn một phần/toàn phần được điều chỉnh đúng, không tác động nhầm nguồn trả phí/admin.
- Admin cấp có hạn, thu hồi, nhiều nguồn đồng thời, role không đủ quyền và sửa cấu hình cạnh tranh có kiểm thử.
- Mua gói không sinh QR chuỗi, không tính doanh thu hoa và không giữ slot/kho.
- Client hiển thị đúng số tiền sẽ thu, thời hạn, quota, nguồn hạng và hạng dự phòng sau hết hạn.

### Mặc định đề xuất để triển khai tiếp

Member/Bloom/Burgundy; Member miễn phí; Bloom/Burgundy mua 1 hoặc 12 tháng, năm rẻ hơn tổng 12 tháng; chi tiêu ròng trọn đời mở hạng không thời hạn; admin cấp độc lập có audit; hạng cao nhất còn hiệu lực được áp dụng; quota dùng chung tháng dương lịch Hà Nội; chủ động gia hạn qua QR SePay; một ưu đãi tiền hoa mỗi đơn. Giá và quyền lợi trong bảng là dữ liệu minh họa cần dự toán trước công bố.
