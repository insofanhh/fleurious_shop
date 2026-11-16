# Giao hoa theo quãng đường Goong

## Bật tính phí

1. Chạy `npm run db:migrate` trên đúng database môi trường triển khai. Migration `20261116090000_distance_shipping` giữ dữ liệu/giá các đơn cũ. Khu vực cũ chỉ còn trong dữ liệu lịch sử, không dùng tính phí đơn mới.
2. Cấu hình `GOONG_API_KEY` (REST API key) trong ENV server local và Vercel Production/Preview phù hợp, sau đó khởi động lại hoặc redeploy. Không đặt key trong biến `NEXT_PUBLIC_*`.
3. Owner/Manager mở `/admin/settings` → **Giao hoa theo quãng đường**. Tìm và chọn đúng điểm cửa hàng từ gợi ý, nhập VNĐ/km rồi lưu. Đây là cách tính duy nhất cho phí tự động; không còn công tắc khu vực/quãng đường. Có thể đặt phí tối thiểu/tối đa, giới hạn khoảng cách và làm tròn lên 1.000đ; mặc định làm tròn tới 1đ, không cộng phí tối thiểu.
4. Lưu rồi dùng **Thử phí theo cấu hình đã lưu** với địa chỉ gần/xa, chung cư/ngõ, tên địa giới mới/cũ. Kiểm tra tuyến xe máy đúng nhu cầu thực tế. Trạng thái đã có key chỉ xác nhận ENV có giá trị; việc chọn địa điểm/tính phí mới kiểm tra được kết nối thật.
5. Thử đặt web, tạo đơn thủ công và thanh toán số tiền nhỏ theo quy trình cửa hàng trước khi mở rộng vận hành. Chưa kiểm thử Goong thật nếu chưa cung cấp key.

Không cần cron mới. Công việc thu dọn định kỳ hiện có xóa location/quote đã hết hạn quá một ngày và cache tuyến hết hạn. Múi giờ đơn và lịch giao tiếp tục là Hà Nội (`Asia/Ho_Chi_Minh`).

## Cách hoạt động

- Cả checkout, sổ địa chỉ, tạo đơn thủ công và địa chỉ cửa hàng dùng chung autocomplete. Gợi ý sau 4 ký tự và 350 ms; hỗ trợ phím mũi tên, Enter và Escape.
- Chọn địa điểm → server xác minh Place Detail → Distance Matrix một chiều cửa hàng tới khách. Giá trị nghiệp vụ `motorcycle` được adapter đổi thành profile `bike` khi gửi tới Goong; ô tô giữ `car`. Snapshot đơn mới ghi cả lựa chọn nghiệp vụ và profile thực gửi.
- Phí mặc định: `round(mét × VNĐ/km / 1000)`. Ví dụ 4.750 m × 5.000đ/km = 23.750đ. Ghi chú căn hộ/tầng không làm tính lại tuyến.
- **Phí tối đa** là mức trần của phí tự động, áp dụng sau phí tối thiểu và bước làm tròn. Để trống để không giới hạn; nhập 0 để giới hạn phí tự động về 0. Không được nhỏ hơn phí tối thiểu. Phí theo thỏa thuận là khoản nhập riêng, không chịu trần tự động. Ví dụ phí tính ra 24.000đ, mức trần 23.800đ thì thu 23.800đ. Thay mức trần làm hết hiệu lực quote cũ nhưng không sửa tiền đơn đã tạo.
- Sửa địa chỉ chính hủy lựa chọn và giá trước đó ngay. Chưa có phí hợp lệ sẽ không cho tạo đơn tự động. Lỗi nhà cung cấp không được coi là miễn phí.
- Quote giữ 10 phút, tự làm mới khi đang mở trang; location được xác nhận giữ 1 giờ. Địa chỉ quá hạn phải chọn lại. Hai hạn này không đổi hạn thanh toán của đơn đã tạo.
- Địa chỉ cũ chưa có place ID cần chọn lại từ gợi ý khi tính theo quãng đường. Không tự đoán kết quả đầu tiên. Đặt lại từ đơn cũ cũng xác nhận điểm giao và lấy giá mới.
- Đơn lưu phương thức `ZONE`/`DISTANCE`/`MANUAL`, phí và snapshot cấu hình/điểm đi/điểm đến. Đổi biểu phí sau đó không đổi đơn cũ, số tiền QR SePay hoặc công nợ COD.
- Báo giá gắn với phiên guest hoặc tài khoản; đơn thủ công dùng phiên nhân viên tạo, độc lập tài khoản khách. Server từ chối quote sai chủ, hết hạn, sai địa điểm hoặc khác version chính sách. Không tin phí/tọa độ browser gửi.
- Dropdown khu vực đã bỏ tại checkout, sổ địa chỉ và đơn thủ công. Dashboard Giao hàng quản lý khung giờ/sức chứa và dẫn tới cài đặt phí/km. API sửa khu vực cũ bị chặn; các đơn cũ giữ nguyên phí. Cấu hình từng lưu `ZONE` được đọc theo `DISTANCE`; nếu thiếu điểm cửa hàng/đơn giá/key thì yêu cầu cấu hình, không rơi về phí khu vực cũ.
- Owner/Manager có thể dùng **Phí giao theo thỏa thuận** nếu setting cho phép, kể cả khi nhà cung cấp lỗi. Bắt buộc địa chỉ, phí và lý do; lưu người tạo, nhật ký và phí tự động tham khảo nếu có quote còn hợp lệ. Khách không có quyền gửi phí thủ công.
- API tra cứu đơn công khai không trả địa chỉ/tọa độ/snapshot. Dữ liệu tìm vị trí gửi Goong không chứa tên người nhận, điện thoại hoặc nội dung thiệp.

## Giới hạn gọi và cache

`GOONG_REQUESTS_PER_MINUTE=120` là ngân sách toàn hệ thống mặc định cho các endpoint địa chỉ/quote, ngoài giới hạn theo IP và phiên. Điều chỉnh theo quota gói Goong và lưu lượng thực tế. Proxy giới hạn thời gian chờ mỗi HTTP 6 giây, không gọi nhà cung cấp trong transaction giữ tồn kho.

`GOONG_ROUTE_CACHE_ENABLED=false` mặc định. Chỉ bật `true` sau khi xác nhận điều khoản lưu dữ liệu của tài khoản Goong. Cache MySQL có TTL 5 phút, phân biệt chiều đi/đến và phương tiện; thay biểu phí sẽ tính lại tiền từ tuyến còn hợp lệ. Quote và snapshot đơn là dữ liệu vận hành của ứng dụng, tách biệt cache tuyến dùng chung.

## Tương thích phương tiện và xử lý lỗi

Kiểm tra API thật ngày 16/11/2026 phát hiện `/v2/distancematrix` trả HTTP 400 với `vehicle=motorcycle`, dù trang trợ giúp V2 liệt kê giá trị này. API chỉ chấp nhận `car`, `bike`, `truck`, `taxi`, `hd`. Cùng cặp điểm, `bike` và `car` trả HTTP 200; Directions với `bike` trả `travel_mode=DRIVING`. Vì tài liệu và API chưa nhất quán, adapter tách lựa chọn hai bánh của cửa hàng khỏi mã profile Goong. Khi Goong thay hợp đồng, sửa tập trung ở `goongRouteProfile()`, tăng `GOONG_ROUTING_REVISION` và kiểm tra tuyến thực tế.

Cache tuyến và quote gắn revision adapter; không dùng lại kết quả của revision cũ cho đơn mới. Nếu API báo `SHIPPING_ROUTE_CHANGED`, form tự lấy lại phí, cập nhật tổng tiền và chờ người mua xác nhận. Đơn đã tạo và số tiền SePay/COD của đơn đó vẫn giữ nguyên. Không tự đổi sang ô tô hoặc một nhà cung cấp khác khi gặp lỗi.

Các lỗi công khai dùng thông báo cố định tiếng Việt, không trả nội dung/URL upstream hoặc key:

| Lỗi Goong | Mã ứng dụng | Ý nghĩa |
| --- | --- | --- |
| HTTP 400/422 hoặc `INVALID_REQUEST` | `GOONG_INVALID_REQUEST` | Yêu cầu tích hợp/tham số chưa hợp lệ; cần kiểm tra cấu hình |
| HTTP 401/403 hoặc `REQUEST_DENIED` | `GOONG_ACCESS_DENIED` | Key/quyền truy cập bị từ chối |
| HTTP 429 hoặc `OVER_QUERY_LIMIT` | `GOONG_RATE_LIMITED` | Hết giới hạn lượt gọi |
| Timeout, mất mạng, HTTP 5xx | `GOONG_UNAVAILABLE` | Dịch vụ tạm không kết nối được |
| Tuyến `ZERO_RESULTS`/`NOT_FOUND` | `NO_DELIVERY_ROUTE` | Không tìm được tuyến phù hợp; không phát hành phí 0đ |

## Kiểm thử

Chạy `npm test` (chỉ database hậu tố `_test`), `npm run typecheck` và `npm run build` tuần tự; không chạy build/generate Prisma đồng thời với tests.

`tests/shipping.test.ts` giả lập HTTP Goong ở biên fetch, bao gồm công thức, lỗi provider, phân quyền, quote theo phiên/địa điểm/TTL/version, cache tùy chọn, giữ tổng tiền, replay, SePay, COD, đặt lại và bảo mật tra cứu. Không có công tắc giả lập trong mã production.

Xác minh local ngày 16/11/2026 sau bản sửa profile: 176/176 tests đạt; typecheck và production build thành công. Luồng UI/API với Goong giả lập trước đó đã qua Chrome 1280/390 px và WebKit 390/320 px: cài đặt chỉ có biểu phí/km, autocomplete bằng bàn phím trong modal, đổi điểm nhận, phí thỏa thuận, lỗi dịch vụ, checkout và sổ địa chỉ không còn dropdown khu vực. Bản sửa profile được kiểm tra thêm bằng Goong thật qua service, `/api/shipping/quote` và checkout Chrome: tuyến 1.251 m × 3.000đ/km trả phí 3.753đ. Không tạo đơn hoặc thanh toán thật; chưa triển khai bản sửa lên Production.

Tài liệu API: [Autocomplete V2](https://help.goong.io/kb/rest-api-v2/autocomplete-rest-api-v2/autocomplete-v2/), [Place Detail V2](https://help.goong.io/kb/rest-api-v2/place-detail-rest-api-v2/place-detail-place-detail-v2/), [Distance Matrix V2](https://help.goong.io/kb/rest-api-v2/distance-matrix-rest-api-v2/distance-matrix-v2/).
