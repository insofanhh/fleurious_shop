# Fleurious Daily — Vận hành và triển khai

Phiên bản triển khai: 17/11/2026. Cấu hình Vercel chạy migration trước khi build; kiểm tra kết quả deployment sau khi cập nhật nhánh production.

## Các màn hình

- `/daily`: giới thiệu, cách hoạt động, ngân sách và mốc ưu đãi.
- `/daily/create`: đăng nhập, chọn lịch, hoa, người nhận/địa chỉ Goong, thiệp và báo giá tự động.
- `/account/daily`: danh sách gói của người mua.
- `/account/daily/[id]`: thanh toán, lịch tháng, từng lượt giao, sửa lời nhắn, đổi ngày, lịch bù, phụ thu và hoàn tiền.
- `/admin/daily`: danh sách gói, lịch giao, việc cần hỗ trợ, duyệt mẫu, đối soát và cấu hình.
- `/admin/settings`: có liên kết đến cấu hình Daily.
- Đơn giao Daily vẫn dùng `/admin/orders`, Kanban, lịch giao, card in, `/orders/[id]`, QR và đánh giá hiện có.

### Lịch giao trong admin Daily

- Lịch tháng gọn, ngày có lịch hiển thị số lượt cần giao và tên người nhận; mobile giữ số lượt, danh sách người nhận nằm dưới lịch. Ngày đã giao, cần duyệt mẫu hoặc cần hỗ trợ có dấu hiệu riêng.
- Bấm ngày xem từng người nhận, khung giờ, hoa/size, trạng thái chuẩn bị/giao và liên kết tới gói/đơn. Mở gói đi đúng lượt đang chọn; quay lại giữ tháng/ngày đã xem. Phiếu chuẩn bị xuất theo ngày đang chọn.
- `GET /api/admin/daily/calendar?month=YYYY-MM` đọc toàn bộ lượt trong tháng, độc lập giới hạn 100 gói gần nhất của tab danh sách. Lượt đã thanh toán/giữ lịch chính thức được hiển thị trước khi tới hạn sinh Order; lượt chưa thanh toán, đã hủy, chờ lịch bù hoặc đang hoàn không tính là lịch phải giao. Lượt đã giao hiển thị riêng để xem tiến độ.
- Theo quyền hiện có: quản lý và giao hàng xem thêm điện thoại/địa chỉ; chuẩn bị hoa và kế toán không nhận các trường liên hệ này từ API lịch. Lịch không trả giá vốn, thông tin ngân hàng hoặc lời nhắn trên thiệp.
- Polling/focus/sự kiện `fleurious:sync` cập nhật dữ liệu tháng mà không làm mất dấu các ngày khác khi chọn một ngày. Xem lịch không sinh đơn hay giữ tồn kho.

## Thiết lập trước khi mở bán

1. Khởi động lại `npm run dev` sau khi cập nhật Prisma/migration để server nạp client database mới. Bản triển khai đã áp dụng migration vào database local; không thay đổi TiDB/production.
2. Trong quản lý sản phẩm, có thể chọn nhiều danh mục, dịp tặng và màu hoa. Chọn danh mục **Hoa mỗi ngày** để đưa sản phẩm vào Bộ hoa Daily; không còn checkbox Daily riêng. Mẫu mới mặc định size **Vừa xinh**; nhập giá bán và tồn kho cho size này trước khi lưu.
3. Mở **Hoa mỗi ngày → Cấu hình & bộ hoa**. Khi bắt đầu, chương trình chưa mở bán. Không còn mục Nhóm ngân sách hoặc giá cố định theo gói.
4. Chỉnh mẫu: chọn sản phẩm và size ở hai ô riêng, mô tả quy cách, loài hoa/phong cách, giá vốn ước tính và công suất/ngày. Tên mẫu tự lấy theo tên sản phẩm; giá lấy trực tiếp từ giá size sản phẩm. Bỏ danh mục Daily sẽ ẩn mẫu; thêm lại danh mục khôi phục mẫu cũ và giữ quy cách.
5. Kiểm tra các mốc giảm theo số lượt, hỗ trợ ship, năng lực ngày/slot, ngân sách ship và lãi đóng góp tối thiểu. Tổng tiền hoa bằng tổng giá các bó của từng ngày, trừ giảm giá theo số lượt. Ví dụ 5 bó 70.000đ và 5 bó 100.000đ có giá gốc 850.000đ; mốc 10 lượt giảm 5% còn 807.500đ, chưa tính ship.
6. Kiểm tra thư viện lời chúc. Gói tự động cần đủ số câu khác nhau cho các ngày chưa tự viết, trong chủ đề được chọn. Có thể dùng `{recipient}` và `{sender}`.
7. Xem lại điều kiện đổi/hủy, giờ chốt hoa/thiệp, ngày nghỉ, giới hạn lịch bù, rồi bật **Mở bán Fleurious Daily**.

Ngân sách hỗ trợ ship là hạn mức tích lũy của chương trình: gồm lượt đã giao, các cam kết đang chạy và đang tạm nghỉ. Không tự reset đầu tháng. Tăng hạn mức khi được duyệt thêm ngân sách; hủy/hoàn lượt chưa giao giải phóng phần chưa dùng, lịch tạm nghỉ vẫn giữ cam kết.

Danh mục Hoa mỗi ngày điều khiển việc tham gia Daily trên cả form tạo và sửa sản phẩm. Chế độ tự động cũng chọn mẫu cụ thể trong danh mục; bước xem lại hiển thị bó hoa/lời nhắn từng ngày và tổng báo giá chung, không có khối giá riêng trên từng thẻ. Khi quay lại tab/cửa sổ, giữ nội dung báo giá trước trong lúc kiểm tra nền và khóa thanh toán đến khi có báo giá mới hợp lệ; nếu tổng tiền hoặc mẫu hoa thay đổi, người mua cần xác nhận lại. Gói đã mua lưu giá và chính sách tại thời điểm mua; đổi giá sản phẩm hoặc cấu hình không tính lại tiền gói cũ. Những gói cũ từ cơ chế Nhóm ngân sách vẫn dùng snapshot cũ khi đổi mẫu/hoàn tiền.

### Chọn hoa theo từng ngày

- Chỉ còn hai lựa chọn **Fleurious chọn giúp** và **Tôi tự chọn**. Dữ liệu gói cũ ở chế độ kết hợp vẫn được đọc bình thường.
- Bên trái là lịch ngày đã chọn; bấm một ngày để xem danh sách bó hoa bên phải. Ngày có ảnh đã được gán hoa, viền đậm đánh dấu ngày đang xem. Mobile xếp lịch phía trên danh sách, có nút sang ngày tiếp theo.
- **Tôi tự chọn**: chọn bó/size cho từng ngày. Chưa đủ hoa cho các ngày thì chưa sang bước tiếp theo.
- **Fleurious chọn giúp**: API gợi ý chia đều số lần xuất hiện theo sản phẩm, luân phiên size trong cùng sản phẩm, không lặp sản phẩm trong một vòng khi đủ mẫu/công suất. Số ngày vượt số mẫu thì bắt đầu vòng mới, tránh lặp hai ngày liền khi có thể. Mẫu hết công suất hoặc thuộc nhóm cần tránh không được gợi ý. Ưu tiên phong cách trong các mẫu có tần suất ngang nhau.
- Khách có thể bấm ngày để thay riêng bó hoa. **Gợi ý lại** chia lại các ngày tự động và giữ các ngày khách đã chọn; **Dùng lại gợi ý cho ngày này** trả riêng ngày đó về tự động. Những lựa chọn riêng có thể làm phân bố không đều hoặc lặp hoa theo ý khách.
- Chỉ tạo gợi ý mới khi còn thiếu ngày hoặc khách chủ động yêu cầu; chuyển tab/focus và kiểm tra lại báo giá không bốc lại mẫu. API gợi ý chưa giữ chỗ hoặc sinh khoản thanh toán. Báo giá/checkout kiểm tra lại giá, mẫu và công suất; không tự thay mẫu đã xem khi hết công suất.
- Mẫu tự động có thể có giá khác nhau, tiền hoa tạm tính thay đổi theo lựa chọn. Ngày khách tự chọn được ghi nhận đã duyệt; ngày hệ thống chọn vẫn cần cửa hàng duyệt trước khi chuẩn bị.

## Thanh toán SePay

Trong chi tiết gói admin, dưới QR của hóa đơn đang chờ có **Xác nhận đã thanh toán** cho OWNER/MANAGER/ACCOUNTANT. Nhập đúng mã giao dịch ngân hàng và ghi chú sau khi đã nhận đủ tiền. Xác nhận áp dụng cho mua gói và nâng cấp mẫu; dùng cùng luồng kích hoạt với SePay, ghi nhận tiền và lưu người xác nhận trong nhật ký. Mã tham chiếu được đối chiếu để webhook đến sau không tạo thêm khoản thu cho cùng giao dịch. Hóa đơn đã hết hạn/đang đối soát phải xử lý qua mục đối soát, không ép kích hoạt bằng nút này.

- Mã hóa đơn Daily bắt đầu bằng **FLD**; mã đơn thường **FLR**, hội viên **FLM** vẫn hoạt động.
- Nếu tài khoản SePay đang cấu hình nhận diện mã hoặc lọc webhook chỉ cho FLR/FLM, bổ sung FLD hoặc dùng bộ lọc chung phù hợp trước khi mở bán.
- Dùng tài khoản ngân hàng/webhook/API token đã cấu hình trong dashboard; không cần môi trường bí mật riêng cho Daily.
- QR giữ lịch tạm theo cấu hình, mặc định 15 phút. Hết thời hạn trên website không chặn được ngân hàng nhận tiền.
- Đúng tiền, đúng mã và còn lịch: tự xác nhận gói. Sai tiền, chuyển muộn hoặc yêu cầu nâng cấp không còn phù hợp: ghi nhận giao dịch cần đối soát, không tự giao thiếu tiền hoặc đổi lịch.
- Admin tài chính có thể đối soát theo đúng giao dịch và tham chiếu đã nhận. Tiền muộn chỉ được kích hoạt lại sau kiểm tra lịch/công suất/ngân sách.
- Khoản chuyển sai/thừa không thể dùng: quản lý tạo yêu cầu hoàn chính giao dịch chưa phân bổ; kế toán/quản lý xác nhận sau khi chuyển hoàn thực và nhập tham chiếu. Không dựng một hóa đơn đã trả tiền để hợp thức hóa khoản hoàn.
- Khi còn hóa đơn Daily đang chờ trong hạn, hệ thống chặn đổi ngân hàng/tắt SePay như các yêu cầu thanh toán hiện có.

## Công việc mỗi ngày

1. Xem lịch và thông báo để kiểm tra những lượt sắp chốt, mẫu chưa duyệt và lịch bù chưa được xếp.
2. Với chế độ cửa hàng chọn, mẫu trên lịch là gợi ý dựa trên pool, ngân sách, màu/phong cách, loài cần tránh và mẫu gần đây. Nhân viên xem rồi **Duyệt mẫu này**. Không tự duyệt thay nhân viên khi tới hạn.
3. Đến hạn chốt D-1, scheduler tạo đúng một Order đã tài trợ từ gói, đưa vào **Chờ chuẩn bị** và giữ tồn kho lúc đó. Không tăng giữ chỗ slot lần thứ hai.
4. Nếu mẫu chưa được duyệt, thiếu tồn kho, ngày/slot dừng giao hoặc đã trễ giờ: đưa vào cần xử lý, gửi thông báo và giữ lịch để cửa hàng liên hệ. Không tự đánh dấu giao thành công để bù cron trễ.
5. Chuẩn bị, in/tải card và giao theo quy trình Order hiện có. Người gửi trên thiệp lấy tên gửi của gói; thiệp tay để trống nội dung trên hình in.
6. Có thể xuất **phiếu chuẩn bị CSV theo ngày** từ admin Daily. Chỉ quản lý/nhân viên chuẩn bị được tải; dữ liệu riêng tư không công khai. Đầu ô có khả năng là công thức bảng tính được xử lý như văn bản.
7. Giao thành công mới mở QR giữ chuỗi cho lượt Daily. Khách vẫn phải quét và đăng nhập; thanh toán gói không tự kích hoạt 30 ngày chuỗi.

## Scheduler/realtime

Tái sử dụng lịch cron-job.org đang gọi `/api/internal/schedule` với bearer `CRON_SECRET`; thêm việc `daily-maintenance` mỗi phút trong lịch nội bộ, không tạo cron riêng cho từng khách/ngày.

Các thao tác chạy theo mốc đến hạn, có khóa database và idempotency. Có batch hữu hạn để không giữ transaction dài khi một gói có 31 ngày; cron chạy lại tiếp tục việc còn lại. Có nút quản lý **Kiểm tra lịch đến hạn** để xử lý ngay bằng cùng service.

Client đồng bộ qua sự kiện `fleurious:sync` từ realtime hiện có, refresh khi focus và polling dự phòng. Nội dung outbox chỉ mang ID gói/đơn; không phát lời nhắn hoặc địa chỉ ra kênh công khai.

Ngày/giờ hiển thị theo **Hà Nội**, dùng `Asia/Ho_Chi_Minh`, thời điểm database UTC. Tháng 28/29/30/31 ngày và khoảng qua tháng/năm được tính đúng.

## Đổi lịch, lời nhắn và hoàn tiền

- Giá/quy tắc của gói đã mua được snapshot. Thay settings không đổi giá các lượt đã tài trợ.
- Khách sửa ngày/slot trước hạn nếu còn công suất; giữ chỗ mới và giải phóng chỗ cũ cùng transaction.
- Tạm nghỉ đưa lượt về chờ xếp lịch bù và giải phóng slot cũ, giữ nguyên giá trị và ưu đãi đã mua. Không tự xóa tiền khi quá hạn chọn bù; cửa hàng nhận thông báo để hỗ trợ.
- Chọn mẫu có giá ròng cao hơn sinh hóa đơn riêng cho phần chênh lệch, dùng mức giảm của lịch đã mua. Mẫu cũ vẫn giữ cho đến khi khoản nâng cấp được trả đúng và yêu cầu còn hợp lệ. Đổi xuống mẫu rẻ hơn hoặc đổi địa chỉ cần cửa hàng hỗ trợ/hoàn-xếp lại các lượt phù hợp, chưa có tự phục vụ các khoản chênh lệch âm.
- Lời thương sửa trực tiếp trong khung bằng icon bút; khi nhập có icon lưu/hủy, tối đa 800 ký tự, Ctrl+Enter để lưu và Escape để hủy. Lỗi lưu giữ bản nháp để thử lại. Focus/polling không ghi đè bản nháp; có phiên bản mới cần bấm icon tải nội dung mới trước khi lưu. Chỉ đổi/duyệt mẫu hoa và đổi ngày/khung giao dùng modal. Các hạn sửa lịch, chốt lời thương, duyệt mẫu và phụ thu vẫn được kiểm tra ở server.
- Cách viết thiệp được chốt khi đặt lịch: không còn điều khiển sửa lại trong chi tiết gói; API chặn đổi giữa thiệp tự động và thiệp viết tay cho cả khách và nhân viên. Vẫn cho sửa lời thương theo hạn chốt của gói. Thiệp có version chống ghi đè; sau khi chuẩn bị không cho khách tự sửa. Nếu sửa khi Order còn chờ chuẩn bị, lịch sử ghi yêu cầu dùng bản thiệp mới nhất và giữ nguyên cách viết thiệp.
- Khách yêu cầu hoàn các lượt chưa khóa; quản lý xử lý các trường hợp sau hạn hoặc đã có Order. Hoàn đúng số tiền ròng của từng lượt, không tăng lại giá các bó đã giao.
- Đơn con đã trả được dừng qua luồng hoàn của gói, hiển thị ở cột **Hoàn tiền**, không dùng Hủy đơn chưa trả. Các nút/API hoàn đơn thông thường được chặn cho nguồn Daily để không hoàn hai lần.
- Hoàn tiền chỉ hoàn tất sau khi tài chính nhập tham chiếu chuyển hoàn thực; không tự gọi ngân hàng trả tiền chỉ bằng thao tác UI.

## Báo cáo/quyền lợi

- Tổng quan báo tiền Daily riêng, dựa trên giao dịch thực nhận; không cộng tiền các Order con vào thu đơn lẻ.
- Theo dõi giá trị đã giao, giá trị còn phải giao, khoản đang/đã hoàn và giao dịch cần đối soát.
- GA4/PostHog: một sự kiện purchase theo hóa đơn có consent, không gửi lại tiền cho từng Order giao. Không gửi người nhận, địa chỉ hoặc lời nhắn; opt-out xóa liên kết cho những lượt thanh toán sau và chặn event chưa gửi theo cơ chế hiện có.
- Daily không tiêu quota hội viên và không tự chồng giảm giá thông thường. Chi tiêu nâng hạng lấy tiền hoa ròng của các Order đã giao, được đảo đúng khi hoàn.
- Review gắn sản phẩm/variant và Order thực đã giao theo kiểm duyệt hiện có.

## Phạm vi phiên bản này

Đã có gói trả trước, lịch ngày/tháng thật, chọn hoa trên lịch bằng danh sách ảnh, tự chọn hoặc tự động có chỉnh từng ngày, lời chúc, thiệp tay, cấu hình giá/ship, lịch cá nhân, duyệt mẫu, tạo Order theo lịch, tạm nghỉ/lịch bù, nâng mẫu có phụ thu, đối soát/hoàn, quyền, thông báo, báo cáo và kết nối hệ thống cũ.

Chưa tự gia hạn/trích tiền định kỳ, chưa dùng AI sinh lời chúc/chọn hoa, chưa tối ưu tuyến giao nhiều điểm, chưa hỗ trợ nhiều người/địa chỉ trong một gói. Gói văn phòng, bình/bao bì tái sử dụng và những bổ sung ghi rõ sau thử nghiệm trong kế hoạch vẫn là giai đoạn tiếp theo.

## Kiểm thử

Chạy `npm run test:http`: generate/build/TypeScript, migrate database `_test`, toàn bộ kiểm thử nghiệp vụ và HTTP trên Next production build local. Các kiểm thử Daily có cạnh tranh chỗ cuối, 31 ngày, webhook lặp/sai/muộn, giá snapshot, thời điểm QR, đổi thiệp/version, lịch bù, phụ thu, tiền thừa, hoàn phân bổ, ngân sách tạm nghỉ, analytics và export.

Kiểm thử trình duyệt dùng database browser `_test` tách biệt, giao dịch SePay giả lập và dữ liệu địa chỉ/phí Goong giả lập tại biên API. Không có chuyển khoản thật và không ghi dữ liệu thử vào database cửa hàng/production. Kết quả cuối được ghi trong phần bàn giao; số đo local không thay kết quả production.

### Kết quả đã xác minh

- Kiểm tra tổng thể trước khi cập nhật Git: `npm run test:http` build/TypeScript thành công, **248 kiểm thử đạt**, không fail/skip, gồm lịch giao admin, khôi phục đơn hết hạn và logo/font khi offline.
- Sau cập nhật lịch giao admin: production build/TypeScript và **39 kiểm thử Daily đạt**, gồm dữ liệu theo tháng, gói cũ nằm ngoài 100 gói mới nhất, lịch chưa sinh đơn, loại lượt chưa trả/tạm nghỉ/hoàn, trạng thái đơn thực tế và phân quyền thông tin liên hệ. Playwright xác minh nhiều người nhận cùng ngày, giữ dấu lịch, xuất đúng ngày, mở đúng lượt/quay lại giữ lựa chọn, chuyển tháng, cập nhật realtime và desktop/mobile 390/320 px không tràn ngang.
- Sau chuyển lời thương sang sửa trực tiếp: production build/TypeScript thành công; Playwright xác minh icon sửa/lưu/hủy, không mở modal lời thương, lỗi lưu giữ bản nháp và thử lại được, focus không mất nội dung, tải phiên bản mới khi xung đột, Ctrl+Enter/Escape, admin lưu và khóa theo hạn chốt. Không đổi cách viết thiệp; khung lời thương không bị nhân bản khi đồng bộ. Desktop 1440 px, mobile 390/320 px không tràn ngang.
- Sau cập nhật modal chỉnh lượt giao: production build/TypeScript thành công và **37 kiểm thử Daily đạt**. Ca mới kiểm tra khóa cách viết thiệp ở cả hai chiều, với khách/nhân viên và Order đã sinh; sửa lời thương không đổi cách viết đã chốt.
- Playwright modal: mở/đóng/Escape bỏ bản nháp, lưu lời thương, giữ bản nháp khi focus, phát hiện phiên bản mới, lỗi ngày không hợp lệ, lưu lịch, tạo hóa đơn nâng mẫu và admin duyệt mẫu. Desktop cùng mobile 390/320 px hoạt động, không tràn ngang và không có lỗi JavaScript. Giao dịch thanh toán dùng SePay giả lập trong database kiểm thử.
- `npm run test:http`: build/TypeScript thành công, **234 kiểm thử đạt**, không có test fail hoặc skip, gồm quan hệ nhiều danh mục/dịp/màu, giá từng sản phẩm, giữ giá lịch đã mua, lời chúc riêng, xác nhận thanh toán thủ công và chia đều hoa. Các ca gợi ý kiểm tra chu kỳ 1–31 ngày, ổn định theo seed, giữ ngày tùy chỉnh, công suất, loại hoa cần tránh, không giữ chỗ khi gợi ý và giữ nguyên mẫu từ xem trước đến checkout. Các ca thanh toán kiểm tra phân quyền, xác nhận lặp, webhook đến trước/sau/đồng thời, mã giao dịch trùng, hóa đơn hết hạn/đang đối soát và hóa đơn nâng cấp.
- Playwright chọn hoa: lịch trái/danh sách ảnh phải ở desktop 1440 px; mobile 390/320 px không tràn ngang; đổi ngày, chọn riêng, gợi ý lại/khôi phục, chuyển chế độ và quay lại bước chọn giữ đúng hoa; focus không thay gợi ý. Lịch qua hai tháng chọn đúng ngày và mẫu. Checkout 31 ngày lưu đúng mẫu, phân biệt ngày tự chọn/ngày tự động; dữ liệu và giao dịch đều trong database kiểm thử.
- Sau chỉnh giao diện admin và nhập danh sách ngày nghỉ, production build/TypeScript cuối tiếp tục thành công.
- Playwright mobile 390 px: chọn cả tháng 31 ngày, mua gói, hiển thị QR thanh toán, nhận webhook SePay giả lập, xác nhận gói và sửa lời nhắn thành công; không có lỗi JavaScript.
- Playwright desktop 1350 px: admin duyệt mẫu, chạy scheduler, kiểm tra Order `PAID`/`UNASSIGNED` trong danh sách đơn, QR chưa đủ điều kiện trước giao, cấu hình và xuất CSV thành công.
- Admin nhập hai ngày nghỉ liên tiếp bằng bàn phím, lưu và xác minh hai ngày trong database kiểm thử; không mất dấu phẩy hoặc tự sửa lịch của gói đã mua.
- Admin mobile 390 px: cấu hình hoạt động, không tràn ngang. Các ảnh chụp QA dùng reduced motion để ghi lại đủ nội dung; không xác nhận PWA trên thiết bị thật qua bài kiểm tra này.

Migration local đã áp dụng, gồm bảng nối ProductTaxonomy và chuyển các sản phẩm Daily hiện có vào danh mục Hoa mỗi ngày. Migration không sửa snapshot của các lịch đã mua. Vercel đã cấu hình `prisma migrate deploy && npm run build`; môi trường triển khai khác cần chạy migration trước khi khởi động bản mới. Dev server đang chạy từ trước cần khởi động lại để nạp Prisma client mới. Chương trình mặc định chưa mở bán.
