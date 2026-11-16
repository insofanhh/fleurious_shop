# Fleurious — Kiểm tra PageSpeed và thiết lập Google Search

Ngày kiểm tra: 16/11/2026. Website: https://fleurious-shop.vercel.app/.

Phạm vi: kiểm tra production, đối chiếu mã nguồn và tài liệu Google. Đây là báo cáo và kế hoạch cải thiện; chưa sửa mã nguồn ứng dụng, chưa deploy hoặc thao tác tài khoản Google Search Console/Business Profile trong lượt này.

## Cập nhật bản sửa local — 16/11/2026

Sau khi người dùng phản ánh PageSpeed vẫn thiếu title, đã triển khai hai hạng mục P0 ở local:

- Metadata dùng title tuyệt đối không rỗng cho trang chủ, trang nội dung, collection và sản phẩm; đồng bộ Open Graph/Twitter. Nội dung CMS có tên/mô tả riêng, các luồng tài khoản/đơn hàng vẫn noindex.
- Màn loading giữ tối thiểu một chiều cao viewport để `closing-note` không xuất hiện giữa màn hình rồi bị nội dung streamed đẩy xuống ở lần tải đầu trang chủ.

Xác minh trên production build local với database kiểm thử tách biệt: 3 ca hồi quy metadata đạt; typecheck/build thành công; title có trong HTML của 8 trang mẫu và cập nhật khi chuyển trang; không ghi nhận lỗi JavaScript trong hai viewport 1350/390 px. Lighthouse desktop local cho SEO 100 và CLS khoảng 0,0021. Điểm Performance local là 95 nhưng không so trực tiếp với production 78 vì khác môi trường mạng/dữ liệu.

Đây chưa phải kết quả đo lại production. Các phần canonical, soft 404, llms/ARD, ảnh responsive và những hạng mục khác trong báo cáo dưới đây chưa được triển khai bởi bản sửa này. Các số liệu ở mục 1 là baseline production trước sửa.

## 1. Kết quả kiểm tra thật

Lighthouse 13.6.0, desktop, một lần chạy với simulated throttling:

| Hạng mục | Kết quả |
| --- | --- |
| Performance | 78 |
| Accessibility | 91 |
| SEO | 92 |
| CLS | 0,3224 |
| LCP | Khoảng 1,5 giây trong cấu hình desktop này |
| TBT | Khoảng 10 ms |
| Ảnh có thể tiết kiệm | Khoảng 1.453 KiB theo ước tính Lighthouse |
| Chữ chưa đủ tương phản | `.mini-calendar > p`: 4,44:1, yêu cầu audit 4,5:1 |

Đây là số đo lab tại một thời điểm, không phải Core Web Vitals thực địa từ Search Console/CrUX hoặc bằng chứng thứ hạng. Một lần kiểm tra Playwright độc lập ghi nhận desktop CLS khoảng 0,344; mobile 390 px không phát sinh shift trong cửa sổ đo ban đầu. Không suy từ đó rằng mọi thiết bị mobile đều đạt.

Kiểm tra HTTP và HTML production:

| URL | Phản hồi quan sát |
| --- | --- |
| `/` | 200 HTML, thiếu `<title>`, không có canonical; một H1 |
| `/` với User-Agent Googlebot/Twitterbot | Vẫn thiếu `<title>` trong toàn bộ HTML trả về |
| `/about` | Thiếu `<title>` và canonical |
| `/flowers` | Có title “Tìm một bó hoa · Fleurious”; chưa có canonical |
| `/flowers/burgundy-whisper` | Có title, description và JSON-LD `Product`/`AggregateOffer`; chưa có canonical |
| `/llms.txt` | 200 `text/html`, nội dung là trang lỗi có dấu hiệu 404/noindex |
| `/.well-known/ard.json` | 200 `text/html`, không phải JSON, nội dung là trang lỗi |
| URL kiểm tra không tồn tại | 200 HTML chứa trang lỗi/noindex; cần xử lý trạng thái HTTP |
| `/robots.txt` | 200, có khai báo sitemap và các vùng hạn chế crawl |
| `/sitemap.xml` | 200 XML, 16 URL tại thời điểm kiểm tra |

Chưa truy cập Search Console nên chưa kết luận được website đã xác minh, đã được index bao nhiêu URL hoặc đang xếp hạng từ khóa nào.

## 2. Nguyên nhân và việc cần sửa

### P0 — Metadata thiếu title

`src/app/[[...slug]]/page.tsx`, `generateMetadata()` luôn trả `title: names[slug[0]]`. Trang chủ có `slug[0]` không tồn tại; `/about`, `/delivery`, `/privacy`, collection và nhiều trang nội dung không nằm trong bảng `names`. Giá trị `undefined` được truyền xuống bộ resolve metadata và title trở thành chuỗi trống, thay vì dùng fallback mong muốn từ root layout.

`og:title` không thay thế `<title>`. Đây là một lỗi gốc xuất hiện trong cả audit accessibility lẫn SEO, không phải hai lỗi riêng. Kết quả đã được xác nhận bằng HTML thô và `document.title` sau hydration, nên không chỉ là trường hợp metadata streaming đến muộn.

Hướng sửa:

- Trang chủ có title tuyệt đối rõ ràng, ví dụ **Fleurious | Hoa tươi Mỹ Đình, giao hoa tại Hà Nội**, sau khi xác nhận địa bàn phục vụ thực tế.
- Trang chưa có title riêng phải bỏ thuộc tính `title` khỏi metadata hoặc trả fallback hợp lệ; không truyền `undefined` như một title cụ thể.
- Sản phẩm lấy tên, loại hoa/dịp tặng và mô tả đúng hàng bán. Bài viết/trang nội dung lấy title và đoạn mô tả riêng từ CMS.
- Bổ sung metadata cho collection, trang chăm hoa, giao hàng, đổi trả và giới thiệu; giữ noindex cho trang giao dịch/tài khoản.
- Title, description, H1 và nội dung phải cùng chủ đề, không nhồi nhiều địa danh/từ khóa vào một title.

[Google: title links](https://developers.google.com/search/docs/appearance/title-link).

### P0 — CLS chủ yếu do loading và phần cuối trang

Audit gán khoảng **0,3213 trong tổng 0,3224** cho `body > section.closing-note`. Filmstrip cho thấy lúc khoảng 1.125 ms, trang hiển thị logo loading và khối “Vì ai cũng xứng đáng có những ngày nở hoa” ngay bên dưới. Khi trang chủ tải xong, toàn bộ nội dung dài được chèn phía trước và đẩy khối này xuống dưới màn hình.

Mã liên quan:

- `src/app/loading.tsx`: fallback loading dùng chung.
- `src/app/globals.css`: `.page-loading { min-height: 55vh; }`.
- `src/components/shell.tsx`: `closing-note` và footer nằm ngoài phần nội dung đang chờ tải.

Hướng sửa theo thứ tự:

1. Bố trí lại ranh giới loading/streaming để lần tải đầu trang công khai không vẽ phần cuối trang ở vị trí tạm thời. Cân nhắc render nội dung trang chủ cùng shell, hoặc skeleton có hình học ổn định theo trang, chỉ hiển thị footer khi phần nội dung tương ứng đã sẵn sàng.
2. Không sửa bằng cách thêm khoảng trắng khổng lồ hoặc ẩn toàn bộ nội dung cho tới khi JavaScript chạy. Google và người dùng vẫn cần nhận HTML có nội dung hữu ích.
3. Giữ animation opacity theo yêu cầu, tránh animation làm đổi chiều cao/margin/top của bố cục. Việc tắt toàn bộ animation không giải quyết đúng nguyên nhân đã đo.
4. Sau khi sửa loading, đo tiếp font và masonry. Font có đóng góp nhỏ trong lần đo này. `MasonryGrid` còn có bước đổi CSS Grid sang absolute positioning sau mount; cần giữ sẵn hình học ảnh, tránh thay chiều cao khung khi ảnh/font tải xong.
5. Dùng `next/font/local` hoặc preload font cần thiết, subset Việt/Latin và fallback font có metrics phù hợp. Giữ chiều rộng/cao hoặc aspect ratio đúng cho từng ảnh.

Mục tiêu CLS không quá 0,1 ở percentile 75 của lượt xem thực tế, theo riêng mobile/desktop. Cần đo lại sau thay đổi, không coi tiêu chí này là kết quả đã đạt. [Google/web.dev: tối ưu CLS](https://web.dev/articles/optimize-cls).

### P1 — URL thiếu tài nguyên trả HTML 200

Catch-all route và `notFound()` sau khi streaming bắt đầu khiến các URL thiếu tài nguyên trả nội dung lỗi với HTTP 200. Đây là lý do parser ARD gặp ký tự `<`, còn audit llms.txt báo thiếu H1 và link: công cụ đang đọc trang HTML lỗi, không phải một file tài liệu đúng định dạng.

- Kiểm tra URL hợp lệ và tài nguyên đặc biệt trước khi response bắt đầu streaming, hoặc cấu trúc lại route để trả HTTP 404 thật cho tài nguyên thiếu. Khi triển khai cần kiểm tra cả status và body, không chỉ thấy giao diện “404”.
- Kiểm tra URL collection không tồn tại và các đoạn đường dẫn dư; không trả danh sách sản phẩm chung cho mọi URL tùy ý.
- `llms.txt` là phần bổ sung tùy chọn: nếu xây dựng, dùng Markdown UTF-8 có H1, giới thiệu ngắn và link công khai chính xác; không liệt kê API quản trị/đơn hàng/tài khoản.
- ARD chỉ nên triển khai theo đúng đặc tả của công cụ cần hỗ trợ, mô tả tài nguyên thực sự có. Nếu không dùng, tài nguyên vắng mặt cần phản hồi đúng, không dựng JSON giả để làm xanh audit.

Google nói không cần tạo file AI hoặc markup đặc biệt để xuất hiện trong AI features. Các mục này không thay thế title, nội dung, link, sitemap, robots hay bảo vệ truy cập; không có cơ sở để cam kết chúng giúp tăng hạng Google. [Google: AI features](https://developers.google.com/search/docs/appearance/ai-features), [HTTP và soft 404](https://developers.google.com/crawling/docs/troubleshooting/http-status-codes).

### P1 — Canonical, danh mục và infinite scroll

- Các trang mẫu chưa có `<link rel="canonical">`. Cần canonical tuyệt đối, thống nhất với link nội bộ và sitemap trên một tên miền chính.
- Tham số sắp xếp, tìm kiếm và bộ lọc cần chính sách crawl/index riêng. Trang danh mục có giá trị tìm kiếm nên có URL ổn định, nội dung riêng; không sinh hàng loạt tổ hợp bộ lọc để index.
- `/flowers` đang render tám sản phẩm đầu rồi mở rộng bằng IntersectionObserver. Giữ infinite scroll cho người dùng nhưng bổ sung URL phân trang mà bot truy cập trực tiếp được, nội dung SSR và liên kết `<a href>` tới các trang tiếp theo.
- Mỗi trang phân trang cần canonical tới chính nó; không canonical mọi trang về trang đầu. Các trang đích địa phương/dịp tặng cần URL canonical riêng khi có nội dung khác biệt thực sự.
- Sitemap hiện có 16 URL, bao gồm sản phẩm. Bổ sung collection/bài viết hữu ích, lọc URL trùng, chỉ thêm URL indexable; `lastModified` phải phản ánh cập nhật thật thay vì thời gian mỗi request.

[Google: cấu trúc URL thương mại điện tử](https://developers.google.com/search/docs/specialty/ecommerce/designing-a-url-structure-for-ecommerce-sites), [phân trang và tải thêm](https://developers.google.com/search/docs/specialty/ecommerce/pagination-and-incremental-page-loading).

### P1 — Ảnh, mã tải ban đầu và tương phản

- Lighthouse ước tính có thể giảm khoảng 1.453 KiB ảnh. Ví dụ ảnh dịp sinh nhật có kích thước nguồn 1.200 × 1.138 px trong khi khung hiển thị nhỏ hơn nhiều. WebP vẫn có thể quá nặng nếu gửi sai kích thước/nén.
- Dùng ảnh responsive với `srcset/sizes` hoặc `next/image` và cấu hình nguồn Blob chính xác. Ảnh hero/LCP được ưu tiên; ảnh dưới màn hình lazy load; không eager/preload toàn bộ danh sách.
- Giữ aspect ratio phù hợp ảnh thật để việc tải ảnh không làm thay đổi chiều cao card. Nếu ảnh sản phẩm có kích thước khác nhau, lưu dimensions lúc upload để phục vụ masonry ổn định.
- Root layout hiện nạp toàn bộ sản phẩm/content và nhiều trạng thái phụ trợ cho mọi trang; storefront nhập chung các màn tài khoản/checkout. Tách bundle theo route, chỉ lấy dữ liệu cần thiết cho màn đang mở; cache dữ liệu công khai có cơ chế invalidation. Không cache chung dữ liệu người dùng, tồn kho giữ chỗ hoặc báo giá.
- Audit ước tính 71 KiB JS và 12 KiB CSS chưa dùng. Đây là cơ hội tối ưu sau CLS/title; không cần viết lại toàn bộ ứng dụng chỉ từ ước tính này.
- Chỉnh màu dòng `.mini-calendar > p` đậm hơn hoặc nền khác để đạt ít nhất 4,5:1 cho chữ thường cỡ nhỏ; đo trên màu nền thực tế sau compositing.

### P1 — Dữ liệu có cấu trúc và nội dung thương hiệu

Đã có Product/AggregateOffer ở trang sản phẩm, nên không bắt đầu từ số không. Cần kiểm tra bằng Rich Results Test trước khi khẳng định đủ điều kiện xuất hiện nâng cao.

- Thêm `Organization` và loại hình phù hợp `Florist`/`LocalBusiness`, tên, logo, địa chỉ/giờ mở cửa thật và liên hệ thống nhất trên website/Business Profile.
- Thêm `BreadcrumbList` đúng breadcrumb hiển thị.
- Rà Product/Offer hoặc ProductGroup theo các size: SKU, giá VNĐ, tồn thực tế, URL và hình ảnh đúng. AggregateOffer hiện có không tự đảm bảo đủ mọi yêu cầu merchant listing.
- Chỉ thêm aggregate rating/review từ đánh giá thật đã được duyệt và đang hiển thị; không tự tạo sao/đánh giá cho thương hiệu.
- Bổ sung chính sách giao, phí theo km/min/max, khoảng thời gian giao, thay hoa khi hết hàng, hỗ trợ và đổi trả phù hợp vận hành thực tế. Không khai một mức ship cố định sai sự thật để qua kiểm tra Merchant Center.

[Google: schema cho ecommerce](https://developers.google.com/search/docs/specialty/ecommerce/include-structured-data-relevant-to-ecommerce), [merchant listing](https://developers.google.com/search/docs/appearance/structured-data/merchant-listing).

## 3. Thiết lập Google Search Console

### Chốt tên miền chính

`fleurious-shop.vercel.app` vẫn có thể được index. Có thể chọn tên miền thương hiệu riêng trước khi đầu tư nội dung lâu dài; bản thân đuôi miền không thay thế chất lượng SEO.

Khi đổi miền:

1. Gắn domain trong Vercel, cấu hình DNS theo hướng dẫn của dự án và kiểm tra HTTPS.
2. Chọn đúng một host chính, chuyển host phụ và URL Vercel bằng redirect vĩnh viễn 301/308 có giữ path/query; tránh vòng lặp hoặc redirect toàn bộ sản phẩm về trang chủ.
3. Cập nhật `APP_URL`, canonical, sitemap, ảnh chia sẻ và link nội bộ rồi deploy.
4. Đồng bộ webhook SePay, Google OAuth callback, cron và các cấu hình phụ thuộc domain. Giữ redirect cho link QR/card đã in.

### Xác minh quyền sở hữu

Vào [Google Search Console](https://search.google.com/search-console/).

**Với tên miền do cửa hàng quản lý DNS:** chọn Domain property, nhập miền không có `https://`, thêm đúng bản ghi DNS TXT mà Google cấp, chờ DNS có hiệu lực rồi Verify. Giữ TXT sau khi xác minh.

**Với URL Vercel hiện tại:** chọn URL-prefix property, nhập chính xác `https://fleurious-shop.vercel.app/`. Không dùng Domain property cho toàn bộ `vercel.app`.

Cách HTML file:

1. Chọn phương thức HTML file; tải file Google cung cấp.
2. Đặt file nguyên tên và nguyên nội dung vào `public/`, commit/deploy.
3. Mở URL file trên production, kiểm tra nó trả nội dung xác minh thật, không phải HTML từ catch-all hoặc màn đăng nhập.
4. Bấm Verify, giữ file sau khi xác minh.

Hoặc dùng HTML meta tag theo hướng dẫn Google. Với Next.js có thể thêm `metadata.verification.google` trong `src/app/layout.tsx` và một biến server chứa mã xác minh; đây là thay đổi code cần triển khai, không phải một biến ENV đã có sẵn trong dự án. Kiểm tra meta tag trong `<head>` của HTML production trước khi Verify.

[Google: xác minh quyền sở hữu](https://support.google.com/webmasters/answer/9008080?hl=vi).

### Gửi sitemap và kiểm tra URL

1. Search Console → Sitemaps → gửi `sitemap.xml` cho đúng property. Sitemap hiện tại: https://fleurious-shop.vercel.app/sitemap.xml.
2. URL Inspection: kiểm tra trang chủ, danh mục và một vài sản phẩm chủ lực. Chạy Test Live URL; kiểm tra Google có nhận nội dung, title, canonical và ảnh không.
3. Sau khi sửa và deploy, Request Indexing các URL quan trọng. Không gửi lại liên tục để mong được ưu tiên; gửi yêu cầu không bảo đảm index hoặc thứ hạng.
4. Theo dõi Page indexing: lỗi server, soft 404, duplicate canonical, crawled/discovered but not indexed. Theo dõi sitemap đã đọc thành công, không chỉ đã submit.
5. Kiểm tra các báo cáo Product snippets/Merchant listings nếu Google phát hiện markup tương ứng.
6. Giữ trang giao dịch/tài khoản ngoài sitemap. Cân đối robots/noindex đúng mục đích: robots.txt ngăn crawl, không bảo đảm ngăn URL xuất hiện; bot không đọc được meta noindex khi bị chặn crawl. Đăng nhập/phân quyền tiếp tục là lớp bảo vệ dữ liệu riêng tư.

[Google: bắt đầu Search Console](https://developers.google.com/search/docs/monitor-debug/search-console-start), [noindex và robots](https://developers.google.com/search/docs/crawling-indexing/block-indexing).

## 4. Tăng cơ hội có thứ hạng tốt cho Fleurious

### SEO địa phương trước từ khóa quá rộng

Nhóm từ khóa đề xuất là giả thuyết ban đầu, chưa phải kết quả đo search volume hay độ khó:

| Nhóm | Ví dụ | Trang phù hợp |
| --- | --- | --- |
| Thương hiệu | Fleurious, Fleurious hoa | Trang chủ, giới thiệu, Business Profile |
| Khu vực cửa hàng thật | shop hoa Mỹ Đình, cửa hàng hoa Mỹ Đình | Trang cửa hàng/dịch vụ với địa chỉ và hình ảnh thật |
| Dịp tặng + địa phương | hoa sinh nhật Mỹ Đình, hoa chúc mừng Hà Nội | Collection có sản phẩm, giá và hướng dẫn chọn |
| Sản phẩm | bó hoa hồng đỏ, hoa tulip tặng sinh nhật | Danh mục/sản phẩm đúng mẫu bán |
| Hướng dẫn | cách giữ hoa hồng tươi lâu, chọn hoa tặng sinh nhật | Bài tư vấn có ảnh và kinh nghiệm thực tế |

Không cam kết “top từ hoa” từ việc sửa Lighthouse. Từ “hoa” quá rộng, ý định tìm kiếm rất khác nhau. Ưu tiên tìm kiếm có nhu cầu mua và nằm trong vùng phục vụ thật.

### Google Business Profile

Vào [Google Business Profile](https://www.google.com/business/) để tìm/nhận quyền quản lý hoặc tạo hồ sơ hợp lệ của cửa hàng.

- Dùng đúng tên thương hiệu trên bảng hiệu; không thêm chuỗi từ khóa vào tên doanh nghiệp.
- Chọn danh mục chính phù hợp như Florist/Cửa hàng hoa nếu giao diện có lựa chọn đó.
- Địa chỉ, số điện thoại, website, giờ mở cửa và ngày lễ phải đúng và thống nhất với website.
- Nếu không tiếp khách tại địa chỉ, chọn mô hình doanh nghiệp phục vụ theo khu vực khi đủ điều kiện; không khai cửa hàng tiếp khách hoặc địa chỉ ảo không có thật.
- Hoàn tất phương thức xác minh mà Google cấp; không mặc định luôn có lựa chọn postcard/SMS.
- Đưa ảnh cửa hàng, bảng hiệu, người bó hoa, mẫu hoa thật và thông tin phục vụ.
- Xin đánh giá từ khách đã mua theo cách trung thực, phản hồi cả nhận xét tích cực và tiêu cực. Không mua đánh giá, không thưởng đổi lấy đánh giá tích cực.

Google mô tả xếp hạng địa phương dựa chủ yếu vào mức phù hợp, khoảng cách và độ nổi bật. Không có thiết lập để trả tiền hoặc yêu cầu tăng thứ hạng tự nhiên. [Nguyên tắc Business Profile](https://support.google.com/business/answer/3038177?hl=vi), [xếp hạng địa phương](https://support.google.com/business/answer/7091).

### Nội dung, uy tín và sản phẩm

- Hoàn thiện ảnh hoa thật, tên/mô tả riêng, loại hoa, kích thước, giá, hướng dẫn chăm và điều kiện thay hoa. Nội dung seed hoặc một câu cảm xúc chưa đủ để khách chọn mua.
- Xây từng trang hữu ích cho dịp tặng hoặc vùng giao thực tế. Không tạo hàng chục trang chỉ thay tên phường/quận với cùng nội dung.
- Từ bài chăm hoa liên kết tới danh mục/sản phẩm liên quan; từ sản phẩm liên kết tới cách chăm và giao hàng bằng anchor rõ nghĩa.
- Thu hút giới thiệu tự nhiên từ khách hàng và đối tác địa phương thực tế. Không mua gói backlink hoặc tạo đánh giá giả để tăng tín hiệu.
- Có thể thiết lập [Merchant Center](https://merchants.google.com/) và free listings sau khi xác minh website, thông tin cửa hàng và nguồn dữ liệu sản phẩm đúng; giá/tồn/ship phải khớp landing page. Đây là một kênh đủ điều kiện hiển thị bổ sung, không phải bảo đảm top organic.

[Google: nội dung hữu ích](https://developers.google.com/search/docs/fundamentals/creating-helpful-content), [free listings](https://support.google.com/merchants/answer/13889434?hl=vi).

## 5. Lộ trình đề xuất và tiêu chí đánh giá

| Chặng | Công việc | Tiêu chí |
| --- | --- | --- |
| 1 — Nền tảng kỹ thuật | Title/fallback, loading CLS, HTTP 404 thật, canonical, tương phản, ảnh responsive | Không còn lỗi thiếu title; mục tiêu CLS <= 0,1; URL lỗi đúng status; ảnh/alt/schema không sai |
| 2 — Google và nhận diện | Domain chính, Search Console, sitemap, Business Profile, schema thương hiệu/sản phẩm | Google đọc được URL chính; xác minh quyền sở hữu; thông tin cửa hàng thống nhất |
| 3 — Nội dung mua hàng | Danh mục dịp tặng/địa phương, sản phẩm thật, chăm hoa, review thật, link nội bộ | Mỗi trang giải quyết nhu cầu cụ thể, không nội dung rỗng/lặp |
| 4 — Tối ưu bằng dữ liệu | Search Console theo query/page/device; GA4 có consent theo đơn hàng | Tăng lượt hiển thị/click không thương hiệu có liên quan và số đơn; giảm vấn đề index/UX |

Lịch theo dõi đề xuất: kiểm tra kỹ thuật sau mỗi deploy; xem query/page trong Search Console hằng tuần; đánh giá nội dung và chuyển đổi theo tháng. Giai đoạn 30/60/90 ngày là các mốc rà soát công việc, không phải lời hứa đạt top trong thời hạn đó.

Core Web Vitals thực địa cần đủ lượt truy cập và thời gian tích lũy. Google không bảo đảm thứ hạng cao chỉ từ điểm kỹ thuật tốt. [Google: page experience](https://developers.google.com/search/docs/appearance/page-experience), [Core Web Vitals](https://developers.google.com/search/docs/appearance/core-web-vitals).
