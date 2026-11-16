**Kế hoạch tính phí giao hoa theo quãng đường — Fleurious**

Trạng thái: đã triển khai nền tảng dữ liệu, API và giao diện. Theo yêu cầu tiếp theo, đã bỏ lựa chọn khu vực: mọi phí tự động của đơn mới dùng Goong × đơn giá/km, có phí tối thiểu/tối đa. Những mô tả chuyển tiếp ZONE bên dưới là kế hoạch ban đầu đã được thay thế. Thiếu key/điểm cửa hàng/đơn giá sẽ yêu cầu cấu hình thay vì lấy phí khu vực cũ. Xem [hướng dẫn vận hành hiện tại](./GOONG_SHIPPING.vi.md).

**1. Phạm vi và nguyên tắc**

- Áp dụng gợi ý địa chỉ tại checkout, sổ địa chỉ tài khoản, tạo đơn thủ công và địa chỉ cửa hàng trong `/admin/settings`.
- Thay lựa chọn khu vực giao bằng một địa chỉ nhận đã xác định được vị trí và phí ship tự tính.
- Dùng quãng đường di chuyển một chiều từ cửa hàng tới người nhận. Goong cung cấp quãng đường; Fleurious quy định đơn giá.
- Một dịch vụ tính phí dùng chung cho website, đơn Zalo/Facebook/Instagram/tại cửa hàng và luồng đặt lại.
- Phí giao, tổng tiền, QR SePay và công nợ COD dùng cùng số liệu đã chốt trong đơn.
- Giữ ngày giao, khung giờ, giới hạn sức chứa và giờ Hà Nội hiện tại.
- Đơn cũ giữ nguyên số tiền đã ghi nhận; biểu phí mới chỉ áp dụng khi báo giá/tạo đơn mới.

**2. Hiện trạng đã kiểm tra trong mã nguồn**

| Điểm tích hợp | Hiện tại | Cần thay đổi |
| --- | --- | --- |
| `src/lib/commerce.ts` | `quote()` lấy `DeliveryZone.fee`; báo giá chưa nhận địa chỉ | Nhận và xác thực shipping quote do server phát hành |
| `src/lib/admin-orders.ts` | Dùng lại nghiệp vụ quote nhưng phụ thuộc `zoneId` | Dùng chung phí theo quãng đường với checkout |
| `src/components/customer-features.tsx` | Checkout và sổ địa chỉ nhập chuỗi địa chỉ, chọn khu vực | Dùng bộ nhập địa chỉ chung, bỏ chọn khu vực khi bật chế độ mới |
| `src/components/admin-order-create.tsx` | Địa chỉ nhập tự do, phí lấy theo khu vực; đã có báo giá tự động | Đưa lựa chọn địa chỉ và shipping quote vào luồng tự tính hiện có |
| `src/components/admin-dashboard.tsx` | Settings có địa chỉ dạng text; Giao hàng có CRUD khu vực và slot | Bổ sung cấu hình phí theo km; giữ quản lý slot; khu vực cũ chuyển sang dữ liệu lịch sử |
| `src/lib/order-reorder.ts` | Sao chép địa chỉ và `zoneId` của đơn trước | Tái xác nhận địa điểm và tính phí mới theo cấu hình hiện hành |
| Prisma `Address`, `Order` | Có `address`, `zoneId`; chưa có tọa độ/quãng đường | Bổ sung dữ liệu vị trí và snapshot phí; cho `zoneId` nullable |

**3. Goong và cấu hình key**

Dùng REST API V2: Autocomplete để tìm địa chỉ, Place Detail để lấy vị trí, Distance Matrix để lấy chiều dài tuyến. Cập nhật kiểm chứng API thật: V2 hiện từ chối `motorcycle`; adapter ánh xạ lựa chọn hai bánh sang profile `bike`, ô tô sang `car`. Tài liệu V2 và API đang mô tả phương tiện chưa nhất quán; xem ghi nhận thực tế và cách cập nhật adapter tại [hướng dẫn vận hành](./GOONG_SHIPPING.vi.md). Khoảng cách đọc từ `distance.value` theo mét, không phân tích chuỗi hiển thị. [Autocomplete V2](https://help.goong.io/kb/rest-api-v2/autocomplete-rest-api-v2/autocomplete-v2/), [Place Detail V2](https://help.goong.io/kb/rest-api-v2/place-detail-rest-api-v2/place-detail-place-detail-v2/), [Distance Matrix V2](https://help.goong.io/kb/rest-api-v2/distance-matrix-rest-api-v2/distance-matrix-v2/).

- ENV server: `GOONG_API_KEY`, cấu hình riêng local/preview/production; không dùng tiền tố `NEXT_PUBLIC_`.
- Browser chỉ gọi API của Fleurious. Server gọi cố định `https://rsapi.goong.io`; không nhận URL upstream từ client.
- `/admin/settings` hiển thị trạng thái đã/chưa cấu hình, lỗi kết nối/quota được diễn giải dễ hiểu; không trả key trong bootstrap hay log.
- Giới hạn key cần phù hợp với nơi gọi thực tế là backend. Goong có thiết lập hạn chế URL/IP; xác minh cấu hình tài khoản khi nhận key. [Hướng dẫn key](https://help.goong.io/kb/tai-lieu-bo-sung/luu-y/mot-so-luu-y-khi-su-dung-goong/).
- MVP không bắt buộc bản đồ tương tác, không cần tải map SDK cho mọi trường nhập. Chọn ghim trên bản đồ có thể bổ sung sau bằng key bản đồ riêng nếu cần.

**4. Cấu hình trong `/admin/settings`**

Tạo nhóm “Giao hoa theo quãng đường”, có bản xem thử địa chỉ → khoảng cách → phí. Lưu cấu hình có version để tránh hai admin ghi đè nhau.

| Trường | Hành vi đề xuất |
| --- | --- |
| Chế độ tính phí | Theo khu vực cũ trong giai đoạn chuyển đổi; theo quãng đường khi cấu hình đã sẵn sàng |
| Địa chỉ xuất phát | Gợi ý Goong, chọn và xác nhận địa điểm cửa hàng; lưu vị trí phía server |
| Đơn giá ship/km | Số nguyên VNĐ, tối thiểu 0; 0 chỉ có hiệu lực nếu admin chủ động cấu hình miễn phí |
| Phương tiện | Xe máy mặc định; tùy chọn ô tô nếu vận hành thực tế cần |
| Khoảng cách giao tối đa | Tùy chọn giới hạn theo tuyến đường; để trống nếu chưa áp dụng, không tự giả định một mốc kinh doanh |
| Làm tròn tiền | Mặc định tới 1đ để bám sát công thức yêu cầu; có thể chọn làm tròn lên từng 1.000đ |
| Phí tối thiểu | Tùy chọn, mặc định 0/tắt; không cộng ngầm |
| Nhập phí theo thỏa thuận | Phân quyền Owner/Manager, bắt buộc lý do, dùng cho đơn thủ công |

Địa chỉ hiển thị của cửa hàng và vị trí xuất phát phải được lưu đồng bộ. Không dùng địa chỉ chung “Hà Nội, Việt Nam” làm điểm tính phí. Khi bật chế độ mới, yêu cầu có key hợp lệ, địa chỉ cửa hàng đã xác nhận và đơn giá hợp lệ.

Tách version chính sách giao hàng khỏi các thay đổi hội viên/thông tin khác: sửa nội dung cửa hàng không làm mất hiệu lực toàn bộ báo giá ship nếu vị trí và biểu phí không đổi.

**5. Công thức tính tiền**

Mặc định:

```text
phí_giao = round(khoảng_cách_mét × đơn_giá_VNĐ_mỗi_km / 1000)
tổng_đơn = tiền_hoa − ưu_đãi_tiền_hoa + phí_giao
```

Ví dụ minh họa, không phải đơn giá mặc định: 4.750 m × 5.000đ/km = 23.750đ. Nếu admin chọn làm tròn lên từng 1.000đ thì phí là 24.000đ.

- Tính bằng giá trị mét gốc và số học chính xác; không lấy số km đã làm tròn trên giao diện để nhân tiền.
- Giao diện đánh dấu khoảng cách hiển thị là xấp xỉ nếu rút gọn chữ số.
- Nếu bật phí tối thiểu: áp dụng phí tối thiểu trước bước làm tròn. Lưu cả quy tắc lẫn kết quả vào snapshot.
- Không làm tròn lên nguyên km theo mặc định; không nhân đôi quãng đường.
- Ưu đãi hội viên/voucher hiện tại vẫn giảm tiền hoa. Miễn/giảm phí ship là một chính sách riêng nếu triển khai sau.
- Điểm nhận trùng điểm cửa hàng có thể trả khoảng cách 0 hợp lệ. Phân biệt rõ giá trị 0 với lỗi thiếu tuyến/kết quả không hợp lệ.
- Thời lượng di chuyển chỉ là tham khảo, không thay thế lịch giao hoặc cam kết giờ giao.

**6. Bộ nhập địa chỉ dùng chung**

Tạo `AddressAutocomplete` cùng thiết kế Burgundy/cream, dùng tại mọi trường nhập địa chỉ đã liệt kê.

- Gợi ý sau ít nhất 4 ký tự, debounce khoảng 350 ms; tối đa 5 kết quả.
- Ưu tiên tìm quanh cửa hàng, hỗ trợ kết quả theo địa giới mới; có thể hiển thị địa danh cũ làm thông tin tham chiếu khi Goong trả về.
- Một kết quả gồm tên/số nhà và dòng địa chỉ phụ; chọn bằng chạm, phím mũi tên, Enter, Escape; hỗ trợ screen reader bằng combobox/listbox.
- Chỉ gọi Place Detail khi người dùng chọn kết quả. Server xác minh place ID, lấy địa chỉ chuẩn hóa và tọa độ; không tin tọa độ do browser tự gửi.
- Tách “Địa điểm giao hoa” khỏi “Số căn hộ/tầng/cổng vào/hướng dẫn thêm”. Địa chỉ giao lưu đủ cả hai, nhưng tiền ship gắn với điểm giao đã xác nhận.
- Nếu gõ sửa địa chỉ chính sau khi chọn: hủy lựa chọn và phí cũ ngay, yêu cầu chọn lại. Chỉnh ghi chú căn hộ không gọi lại tuyến đường nếu vị trí không đổi.
- Chọn đúng cổng vào khi kết quả có nhiều lối vào. Mở rộng Children API/chọn ghim ở giai đoạn sau nếu dữ liệu thực tế cần.
- Hủy request gợi ý cũ, bỏ qua phản hồi đến sai thứ tự; kết quả địa chỉ A không được ghi đè địa chỉ B.
- Dropdown nằm đúng trên modal tạo đơn thủ công, không tràn viewport/bàn phím mobile; không thêm thuộc tính vào DOM trước hydration.
- Các địa chỉ chỉ được hiển thị như footer, nội dung đơn, thông tin trên thiệp không biến thành ô nhập.

**7. Hành trình checkout**

1. Người mua nhập/chọn địa điểm hoặc chọn địa chỉ đã lưu.
2. Server xác nhận vị trí, tính tuyến cửa hàng → địa điểm nhận và phát hành shipping quote.
3. Tự cập nhật quãng đường, đơn giá, phí ship và tổng đơn trong phần tổng tiền; không thêm nút kiểm tra thủ công.
4. Hiển thị đầy đủ trạng thái: chưa chọn địa chỉ, đang tìm, đang tính ship, đã có phí, ngoài phạm vi, cần thử lại.
5. Trong lúc chưa có báo giá hợp lệ, dòng phí hiện “Chọn địa chỉ để tính phí”/“Đang tính phí…”, tổng tiền ghi tạm tính phù hợp; không hiển thị 0đ như đã miễn phí.
6. Chỉ cho xác nhận đặt khi địa chỉ, shipping quote, báo giá tổng đơn và các điều kiện slot/tồn kho đều hợp lệ.
7. Khi bấm đặt, server kiểm tra lại quyền sở hữu quote, địa chỉ, hiệu lực, version và tổng tiền trước khi tạo đơn.

Ví dụ cách hiển thị sau khi chọn địa chỉ:

```text
Giao đến: [địa chỉ đã xác nhận]
Quãng đường dự kiến: khoảng 4,75 km
Đơn giá: 5.000đ/km
Phí giao hoa: 23.750đ
```

Sổ địa chỉ mới lưu cả điểm giao và thông tin bổ sung. Địa chỉ cũ chưa có tọa độ vẫn giữ nguyên nội dung; khi dùng ở checkout cần xác nhận lại bằng gợi ý, không tự chọn kết quả đầu tiên.

**8. Tạo đơn thủ công và phân quyền**

- Bỏ chọn khu vực, dùng đúng bộ địa chỉ và cùng bảng phí như phía khách.
- Báo giá tự động sau khi chọn địa chỉ, đổi địa điểm hoặc đổi thông tin ảnh hưởng tới tổng đơn.
- Admin thấy địa chỉ xuất phát, địa chỉ nhận, quãng đường, đơn giá, phí và tổng tiền.
- Giữ nguyên các nguồn bán, trạng thái ban đầu, COD/SePay, thời hạn thanh toán và ưu đãi hiện có.
- Owner/Manager có thể chọn “Phí giao theo thỏa thuận”, nhập số tiền và lý do; lưu phí tự động tham khảo nếu có, phí thực thu, người duyệt và thời điểm.
- Khi Goong lỗi hoặc khách chỉ cung cấp địa chỉ không tra được: người có quyền có thể nhập địa chỉ tự do và phí đã thỏa thuận. Đơn ghi rõ phương thức tính thủ công; không hiển thị một quãng đường chưa được xác thực.
- Các role khác không tự có quyền tạo đơn hay sửa phí; giữ chính sách quyền hiện hành.
- QR chuyển khoản, ảnh QR tải gửi khách, công nợ COD và số tiền webhook đối soát đều sử dụng tổng đơn đã chốt với phí này.

**9. Luồng server và chống sửa giá**

Đề xuất các đầu API nội bộ, dùng POST JSON để địa chỉ tìm kiếm không xuất hiện trong URL browser/API nội bộ:

| API | Vai trò |
| --- | --- |
| `/api/locations/autocomplete` | Proxy gợi ý địa chỉ, trả danh sách tối giản |
| `/api/locations/resolve` | Xác nhận place ID; phát hành định danh lựa chọn địa chỉ gắn phiên |
| `/api/shipping/quote` | Tính/đọc tuyến, áp biểu phí server, lưu shipping quote |
| `/api/checkout/quote` | Tính tiền hoa/ưu đãi/slot và nhận phí từ shipping quote hợp lệ |
| `/api/admin/orders/quote` | Báo giá đơn thủ công, bổ sung nhánh phí thỏa thuận có quyền |
| `/api/admin/settings/delivery` | Đọc/lưu cấu hình có version và quyền settings |

- Server phát hành ID báo giá khó đoán; client không quyết định tiền ship, khoảng cách hay tọa độ xuất phát.
- Khách không đăng nhập được gắn phiên guest qua cookie HTTP-only cùng ngữ cảnh đặt hàng; quote của phiên khác không dùng được.
- Với đơn thủ công, chủ thể phát hành/dùng quote là nhân viên đang tạo đơn; `customerId` là người mua được gắn riêng. Không nhầm quyền sở hữu quote với user của đơn khi gọi chung `createOrderTx()`.
- Gắn quote với địa điểm nhận chuẩn hóa, cửa hàng xuất phát, phương tiện và version chính sách. Địa chỉ nhận trong đơn được dựng từ dữ liệu đã xác minh cùng phần chi tiết bổ sung.
- TTL đề xuất của shipping quote: 10 phút. Đây là chính sách ứng dụng, không phải giới hạn do Goong công bố.
- Đổi địa điểm, phương tiện hoặc biểu phí làm mất hiệu lực quote chưa sử dụng để đặt đơn; thay giỏ/ưu đãi dùng lại phí ship còn hợp lệ nếu điểm giao không đổi.
- Chỉ gọi Goong trước transaction giữ tồn kho/slot. `quote()`/`createOrderTx()` trong transaction chỉ đọc và xác minh dữ liệu đã có, không chờ HTTP bên ngoài.
- Trong transaction tạo đơn: kiểm tra version chính sách/quote, hạn quote, địa chỉ, chủ phiên, tổng tiền; sau đó giữ tồn kho, slot và ưu đãi bằng logic hiện có.
- Nếu tổng tiền thay đổi: trả lỗi có hướng dẫn xem lại, cập nhật báo giá và yêu cầu người mua xác nhận lại; không tự thanh toán một số tiền mới.
- Thông báo khác biệt giữa “báo giá ship hết hiệu lực trước khi đặt” và “đơn đã tạo hết hạn thanh toán”; TTL quote không hủy một đơn đã tạo.
- Replay idempotency của đơn đã tạo phải trả đơn cũ trước khi kiểm tra quote hết hạn, không tạo thêm đơn hoặc thu thêm phí.
- Quote không giữ tồn kho hay sức chứa; các kiểm tra cạnh tranh vẫn thực hiện lúc tạo đơn.

**10. Dữ liệu và chuyển đổi**

Đề xuất cấu trúc, cần hoàn thiện migration trước khi code UI phụ thuộc dữ liệu mới:

| Phần | Dữ liệu cần lưu |
| --- | --- |
| `Address` hiện có | Bổ sung provider, place ID, địa chỉ chuẩn hóa, thông tin bổ sung, lat/lng `Decimal(10,7)`, thời điểm xác minh; `zoneId` nullable |
| Địa chỉ được resolve | ID ngẫu nhiên gắn phiên/user, dữ liệu điểm được server xác nhận và hạn dùng; có thể dùng token ký thay row tạm nếu phù hợp |
| `ShippingQuote` mới | Chủ phiên, vị trí đầu/cuối, quãng đường mét, thời lượng giây, phương tiện, đơn giá, quy tắc làm tròn, phí, policy version, thời điểm và hạn báo giá |
| `Order` hiện có | Giữ `address`, `deliveryFee`, `total`; thêm phương thức `ZONE`/`DISTANCE`/`MANUAL`, snapshot địa chỉ đầu/cuối/quãng đường/đơn giá/quy tắc, quote reference; `zoneId` nullable |
| Cấu hình giao hàng | Điểm xuất phát, biểu phí, phương tiện, giới hạn và version riêng; đồng bộ địa chỉ cửa hàng trong transaction |
| Cache tuyến, nếu được phép | Khóa có thứ tự điểm đi → điểm đến, vehicle và phiên bản provider; lưu dữ liệu tối thiểu cùng TTL |

Các đơn không có phương thức mới được hiểu là `ZONE`. Không suy ngược quãng đường của đơn cũ từ tiền ship và không thay số tiền cũ.

Trình tự chuyển đổi:

1. Migration bổ sung trường nullable/default để bản hiện tại vẫn chạy.
2. Hoàn thiện service, UI và kiểm thử bằng Goong giả lập.
3. Khi có key: kiểm tra API thật, xác nhận điểm cửa hàng, đặt đơn giá và thử một bộ địa chỉ gần/xa/ngõ/chung cư.
4. Bật theo quãng đường cho các đơn mới; bỏ dropdown khu vực ở checkout, sổ địa chỉ và tạo đơn thủ công.
5. Bảng khu vực cũ giữ phục vụ lịch sử; màn Giao hàng tập trung vào khung giờ/sức chứa. Không cho client gửi `zoneId` để ép áp dụng giá cũ khi chế độ mới đã bật.
6. Luồng đặt lại dùng địa điểm đã lưu làm gợi ý, xác nhận và lấy phí hiện hành; giá, slot và ưu đãi cũng được kiểm tra lại.

**11. Lỗi, hiệu năng, chi phí và bảo mật**

| Tình huống | Xử lý |
| --- | --- |
| Chưa có key/địa điểm cửa hàng | Settings hiển thị việc còn thiếu; không bật chế độ tính mới |
| Không tìm được địa chỉ chính xác | Cho sửa từ khóa, chọn địa điểm phù hợp và thêm chỉ dẫn; hỗ trợ qua cửa hàng nếu vẫn không xác định được |
| Không có tuyến hợp lệ | Không phát hành phí tự động; thông báo đổi địa chỉ/liên hệ cửa hàng |
| Ngoài giới hạn giao | Nêu giới hạn và khoảng cách; chặn checkout tự động, admin xử lý thỏa thuận theo quyền |
| API timeout/mất mạng/hết quota/key lỗi | Giữ dữ liệu người dùng đã nhập, cho thử lại; dùng quote còn hiệu lực cho đúng điểm nếu đã có; admin có nhánh thủ công có kiểm soát |
| Người dùng sửa địa chỉ khi đang tính | Bỏ phản hồi cũ, không dùng phí của địa chỉ trước |
| Quote hết hạn/cấu hình vừa đổi | Tự xin báo giá mới; chặn tạo đơn cho tới khi giá mới được xác nhận |
| Đơn đã tạo, sau đó đổi biểu phí/cửa hàng | Giữ snapshot và số tiền của đơn; QR đang chờ thanh toán không bị đổi số tiền |

- Debounce, giới hạn số kết quả và chỉ lấy detail khi chọn để giảm số lần gọi. Tối ưu không đồng nghĩa tất cả thao tác tìm kiếm được Goong tính là một request.
- Rate limit theo IP/phiên hoặc user và giới hạn toàn hệ thống; kiểm tra Origin và quyền ở endpoint phù hợp.
- Timeout hữu hạn, retry có giới hạn cho lỗi tạm thời; không retry liên tục với key sai/hết quota.
- Cache chia sẻ phù hợp môi trường Vercel, ưu tiên hạ tầng MySQL/Redis đã có thay vì chỉ cache trong bộ nhớ từng instance.
- TTL cache route đề xuất ban đầu 5–10 phút, cần xác minh quyền lưu/điều kiện tài khoản Goong trước khi bật. Tài liệu kỹ thuật đã đọc chưa đủ để kết luận một thời hạn lưu API được phép.
- Không cache response lỗi thành một tuyến 0 m. Giữ chiều đi/đến riêng vì đường một chiều có thể làm hai chiều khác nhau.
- Đổi đơn giá vẫn có thể tái sử dụng quãng đường cache hợp lệ, nhưng phải áp lại chính sách và phát hành quote mới.
- Ghi số request/lỗi/thời gian phản hồi; không ghi key hay toàn bộ địa chỉ cá nhân trong log chung. Không đưa địa chỉ/tọa độ người nhận vào API tra cứu đơn công khai.
- API tìm địa chỉ chỉ gửi dữ liệu cần tìm vị trí; không gửi tên, điện thoại, lời nhắn thiệp. Cập nhật mô tả sử dụng dữ liệu địa chỉ cho người dùng.
- Không gọi Goong khi poll thanh toán, đổi trạng thái Kanban, mở QR hay đổi số lượng sản phẩm mà điểm giao không đổi và quote ship còn hiệu lực.
- Tính ship không cần lịch cron mới. TTL/thu dọn bản ghi dùng cơ chế vận hành sẵn có.

**12. Các phần code dự kiến**

- `src/lib/goong.ts`: client REST V2, validate response, timeout và ánh xạ lỗi.
- `src/lib/shipping.ts`: công thức, policy, xác thực quote, snapshot và cache route.
- `src/lib/shipping-settings.ts`: cấu hình/version/quyền/settings readiness.
- `src/components/ui/address-autocomplete.tsx`: combobox địa chỉ dùng chung.
- `src/components/use-shipping-quote.ts`: debounce/cancel/bỏ kết quả cũ và quản lý trạng thái phí.
- `src/components/shipping-summary.tsx`: cùng cách hiển thị quãng đường/đơn giá/phí cho khách và admin.
- Cập nhật commerce, admin-orders, checkout quote, checkout, tạo đơn thủ công, địa chỉ tài khoản, order-reorder, chi tiết đơn, settings, bootstrap/types và Prisma migrations.
- Cập nhật bộ giả lập/test fixture hiện đang phụ thuộc `zoneId` và `zone.fee`.

**13. Thứ tự làm và tiêu chí bàn giao**

| Chặng | Kết quả cần có |
| --- | --- |
| 1. Nền tảng dữ liệu | Migration tương thích, policy và công thức chính xác, bộ Goong mock |
| 2. Cấu hình & API | Lưu điểm cửa hàng, REST proxy, quote có TTL/quyền/version, lỗi rõ ràng |
| 3. Địa chỉ & giao diện | Dùng autocomplete tại cả bốn nơi; phí tự cập nhật, đủ trạng thái, mobile/PWA |
| 4. Tạo đơn & tiền | Dùng chung quote cho web/admin, giữ idempotency, snapshot, SePay và COD |
| 5. Chuyển đổi & kiểm thử thật | Bật bằng key thật, xác minh tuyến và đơn giá, bỏ chọn khu vực cho đơn mới |

Bộ kiểm thử trọng tâm:

- Công thức với mét lẻ, 0 m hợp lệ, đơn giá 0 chủ động, phí tối thiểu/làm tròn tùy chọn; số liệu lớn và dữ liệu API thiếu/sai.
- Giả mạo tọa độ/phí, quote của user/guest khác, quote hết hạn, policy đổi giữa báo giá và tạo đơn; không được vượt sang mode khu vực cũ.
- Request địa chỉ tới sai thứ tự, gõ lại sau khi chọn, chọn địa chỉ đã lưu/cũ, thiếu số nhà, ngoài phạm vi và không có tuyến.
- Tạo đồng thời và replay không giữ tồn kho/slot/ưu đãi hai lần; timeout Goong không giữ khóa transaction lâu.
- Web/admin cùng địa điểm/cấu hình có cùng phí; override bị chặn khi thiếu quyền/lý do và được ghi audit.
- SePay QR/webhook dùng chính xác tổng đã chốt; tiền COD/công nợ đúng; thay settings không đổi đơn cũ.
- Đặt lại đơn hết hạn/đã giao lấy phí mới và không sửa đơn nguồn.
- Dropdown trong modal, bàn phím/VoiceOver, hydration, gõ tiếng Việt và Chrome/WebKit ở 320/390/900/desktop.
- Kiểm thử API thật sau khi có key: một số địa chỉ cửa hàng do người dùng xác nhận, tuyến gần/xa, đường một chiều, địa giới cũ/mới, chung cư và ngõ.

Hoàn tất khi khách và admin cùng nhìn thấy phí ship tự động từ địa chỉ đã chọn, đơn mới không còn phụ thuộc lựa chọn khu vực, dữ liệu đơn cũ nguyên vẹn, key không lộ và luồng thanh toán/tồn kho/slot tiếp tục vượt kiểm thử hồi quy.
