# Fleurious — Phân tích lỗi llms.txt / ARD và kế hoạch khắc phục

Ngày kiểm tra: 16/11/2026, giờ Hà Nội. Production: https://fleurious-shop.vercel.app/.

Trạng thái cập nhật: đã sửa HTTP 404 ở local theo phạm vi người dùng chốt sau phân tích; chưa commit/push hoặc deploy. Các phần bên dưới lưu lại kết quả production và kế hoạch ban đầu.

## Cập nhật triển khai local

- Thêm layout kiểm tra route tại `src/app/[[...slug]]/layout.tsx`, nằm ngoài ranh giới loading của cùng segment. Chuyển loading từ root xuống segment; admin vẫn có loading riêng dùng chung `PageLoading` và animation thương hiệu.
- `src/lib/storefront-route.ts` xác định URL hợp lệ theo cấu trúc, trạng thái sản phẩm, taxonomy và CMS. React cache chia sẻ dữ liệu trong một lượt render giữa layout/metadata/page, tránh kiểm tra và truy vấn sản phẩm lặp lại.
- Sản phẩm/bài viết ẩn, collection không tồn tại hoặc bị ẩn, taxonomy size bị dùng như collection và URL có đoạn dư trả 404. Giữ các dịp tặng tích hợp sẵn đang có bộ lọc và liên kết thật; vẫn từ chối nếu taxonomy tương ứng được tạo rồi ẩn.
- Không tạo llms.txt hoặc manifest ARD trong phạm vi sửa này. Các đường dẫn chưa tồn tại, gồm `/llms.txt`, `/.well-known/ard.json` và `/.well-known/ai-catalog.json`, trả 404 qua bộ xác định route chung. Chưa cần thêm endpoint riêng như phương án ban đầu.
- Luồng đơn hàng/QR/hóa đơn riêng tư vẫn xác thực và kiểm tra dữ liệu tại API được bảo vệ, không công khai truy vấn thông tin riêng để kiểm tra URL.
- `npm run test:http` đã thành công: build/TypeScript và 184 ca kiểm thử, gồm 5 nhóm HTTP trên server Next production local với database `_test`. Có GET/HEAD, User-Agent Googlebot, dữ liệu đang hoạt động/bị ẩn, URL sai và tài nguyên SEO/PWA/xác minh Google.
- Playwright kiểm tra hai viewport 390 và 1350 px: HTTP 404 đúng, điều hướng client và liên kết quay lại trang hoa hoạt động, không có lỗi JavaScript. CLS quan sát tương ứng khoảng 0,00025 và 0,00176; đây là số đo local với dữ liệu kiểm thử, không phải kết quả production hoặc CrUX.

Để thay đổi có hiệu lực trên website công khai cần push/deploy rồi kiểm tra lại domain production. Không coi kết quả local là xác nhận PageSpeed production đã cập nhật.

## 1. Kết luận từ kiểm tra thực tế

| URL | HTTP | Content-Type | Nội dung thực nhận |
| --- | --- | --- | --- |
| `/llms.txt` | 200 | `text/html; charset=utf-8` | HTML trang không tìm thấy, có dấu hiệu `NEXT_HTTP_ERROR_FALLBACK;404` |
| `/.well-known/ard.json` | 200 | `text/html; charset=utf-8` | Cùng loại HTML lỗi, không phải JSON |

Hai file/route này chưa tồn tại trong mã nguồn. Không phải đã có file nhưng người viết quên H1 hay sai dấu phẩy JSON.

Luồng gây lỗi:

1. Request thiếu tài nguyên rơi vào `src/app/[[...slug]]/page.tsx`.
2. Catch-all kiểm tra nội dung trong database rồi gọi `notFound()`.
3. Ranh giới streaming của `src/app/loading.tsx` cho phép gửi response trước khi kiểm tra hoàn tất.
4. HTML not-found được trả về trong response đã có HTTP 200.
5. Lighthouse tin rằng tài nguyên đã tồn tại: đọc HTML như Markdown nên báo thiếu H1/link; parse HTML như JSON nên gặp ký tự `<` của `<!DOCTYPE...>`.

Next.js xác nhận `notFound()` trước streaming trả 404, sau streaming giữ 200 và thêm noindex. Chỉ đổi giao diện trang 404 hoặc thêm noindex sẽ không đổi được status đã gửi. [Next.js: not-found](https://nextjs.org/docs/app/api-reference/file-conventions/not-found).

Service worker hiện không có quy tắc biến hai đường dẫn này thành HTML; chưa có bằng chứng cache PWA là nguyên nhân. Hai lỗi này độc lập với bản sửa title và CLS trước đó.

## 2. Phương án đề xuất cho Fleurious

Triển khai `llms.txt` thực sự có ích; ARD trả 404 thật ở giai đoạn hiện tại. Website chưa có tài nguyên agent công khai được công bố để cần dựng manifest ARD.

`llms.txt` là quy ước tùy chọn. Lighthouse đánh dấu N/A nếu không cung cấp và trả 404; nếu cung cấp thì cần tài liệu Markdown có giới thiệu và liên kết hữu ích. [Chrome: audit llms.txt](https://developer.chrome.com/docs/lighthouse/agentic-browsing/llms-txt).

ARD mô tả các tài nguyên cho tác nhân AI khám phá trước khi sử dụng, ví dụ agent, MCP, skill hoặc API có descriptor phù hợp. Đây không phải bản sao sitemap. Đặc tả hiện dùng object gốc chứa mảng `entries`; mỗi entry có `identifier`, `displayName`, `type` và một trong `url`/`data`. [Đặc tả ARD](https://agenticresourcediscovery.org/spec/).

Đã đối chiếu Lighthouse 13.6 cài tại máy: audit `ard-schema` trả N/A khi không có tín hiệu khai báo ARD và endpoint trả lỗi phía client như 404. Vì vậy mục tiêu nghiệm thu ARD hiện tại là **N/A đúng nghĩa**, không phải dựng manifest rỗng hoặc khai báo khả năng chưa có để lấy điểm.

## 3. Kế hoạch triển khai

### Bước 1 — Tách các endpoint tài nguyên khỏi catch-all

- Thêm `src/app/llms.txt/route.ts`, trả response văn bản trực tiếp, không render React và không phụ thuộc database.
- Thêm `src/app/.well-known/ard.json/route.ts`, trả `new Response(..., { status: 404 })` trực tiếp trong giai đoạn chưa hỗ trợ ARD. Không dùng trang React + `notFound()` cho endpoint này.
- Kiểm tra các đường dẫn khám phá ARD cũ mà phiên bản Lighthouse đang probe, gồm `/.well-known/ai-catalog.json`; tài nguyên không hỗ trợ phải trả 404 thật, không tiếp tục nhận HTML 200.
- Chỉ xử lý đúng endpoint/namespace cần thiết sau khi rà soát route. Không dùng quy tắc chặn mọi URL có dấu chấm hay chặn toàn bộ `/.well-known/*`, vì có thể ảnh hưởng tài nguyên hiện tại/tương lai.
- Kiểm tra HTML, HTTP Link header và robots không quảng bá `rel="ard"`, `rel="ai-catalog"` hoặc `Agentmap` tới tài nguyên không tồn tại.

Đầu ra: các request máy đọc không đi qua shell, loading hoặc truy vấn CMS. Không cần migration database hay key dịch vụ mới.

### Bước 2 — Nội dung llms.txt

- H1: `# Fleurious`.
- Đoạn tóm tắt ngắn: thương hiệu hoa, cách xem sản phẩm và tìm chính sách; chỉ ghi địa bàn/dịch vụ đã xác minh.
- Nhóm H2 chứa Markdown links tới trang chủ, danh sách hoa, giới thiệu, giao hàng, chăm hoa và hội viên nếu các trang tương ứng đang công khai và hoạt động.
- Mỗi link có mô tả ngắn, URL tuyệt đối cùng origin chuẩn từ cấu hình `APP_URL`. Production phải dùng HTTPS, không xuất link localhost/preview hoặc suy host từ header người gọi.
- Trả `Content-Type: text/plain; charset=utf-8`, nội dung Markdown UTF-8; không có HTML/loading, chuyển hướng đăng nhập hoặc cookie phiên.
- Không đưa dữ liệu khách, mã QR giữ chuỗi, link đơn hàng riêng, thông tin ngân hàng/API quản trị hoặc bí mật vào tài liệu.
- Giữ ngắn, ổn định; không nhúng toàn bộ danh mục và giá có thể thay đổi vào một file tĩnh. Dùng cache công khai có thời hạn ngắn và xác minh sau deploy để tránh nội dung cũ kéo dài.

Định dạng theo [đề xuất llms.txt](https://llmstxt.org/). Bản v2 khuyến nghị bản Markdown của nội dung đích; chỉ thêm các URL `.md` khi endpoint đó thực sự được triển khai. Giai đoạn đầu dẫn tới trang HTML công khai thật, không tự chế link Markdown.

### Bước 3 — Khắc phục rộng hơn các URL không tồn tại

Đây là hạng mục riêng có tác động SEO rộng hơn hai audit trong ảnh:

- Lập bảng route hợp lệ theo độ sâu: trang cố định, sản phẩm, collection, CMS và các luồng riêng tư. Hiện catch-all có thể chấp nhận đoạn đường dẫn dư hoặc collection không tồn tại.
- Thiết kế lại vị trí kiểm tra route/sự tồn tại dữ liệu để hoàn tất trước ranh giới streaming gửi response. Cân nhắc tách route và đặt loading ở phần nội dung sau kiểm tra; phải kiểm chứng trên production build vì thay đổi vị trí `notFound()` đơn thuần có thể vẫn nằm dưới Suspense của loading cha.
- Giữ loading có hình học ổn định để không tái phát CLS đã sửa. Không vô hiệu hóa toàn bộ streaming chỉ để xử lý hai endpoint tĩnh.
- Không kỳ vọng `global-not-found` tự xử lý URL đã khớp catch-all; nó phục vụ đường dẫn không match route.
- URL sai phải trả HTTP 404 thật; URL hợp lệ vẫn có metadata và nội dung như trước. Kiểm tra cả lượt tải trực tiếp và chuyển trang trong ứng dụng.

### Bước 4 — Kiểm thử và triển khai

1. Kiểm thử response thực trên production build local: status, Content-Type, body, redirect và GET/HEAD nhất quán; các kiểm tra này bắt lỗi mà test hàm tạo chuỗi không phát hiện được.
2. Với llms: có H1 Markdown, có Markdown link và nội dung đủ ý; từng link đích trả trang công khai hợp lệ. Không chỉ kiểm tra HTTP 200 vì có thể lại là soft 404.
3. Với ARD: endpoint và đường dẫn legacy không hỗ trợ trả 404 thật; không có tín hiệu quảng bá tới chúng. Chạy audit `llms-txt` và `ard-schema`, đối chiếu kết quả N/A cho ARD theo phiên bản Lighthouse sử dụng.
4. Kiểm tra hồi quy `/`, `/flowers`, sản phẩm, collection, CMS, robots, sitemap, file xác minh Google, manifest PWA và service worker; kiểm tra route giả, sản phẩm không tồn tại và URL có đoạn dư.
5. Chạy typecheck, test liên quan và build. Sau khi có yêu cầu triển khai, push/deploy rồi kiểm tra lại HTTP của chính domain production; ghi commit/deployment và thời điểm đo.
6. Chạy báo cáo Lighthouse mới có nhóm Agentic browsing; chỉ chạy nhóm SEO/Performance thông thường có thể không bao gồm hai audit này. Đối chiếu ngày giờ báo cáo, không dùng lại kết quả cũ.

## 4. Tiêu chí nghiệm thu

| Đối tượng | Kết quả mong đợi |
| --- | --- |
| `/llms.txt` | 200, văn bản UTF-8 chứa Markdown, có H1 và link thật; audit đạt |
| `/.well-known/ard.json` | 404 trực tiếp; audit ARD N/A khi không có khai báo hỗ trợ |
| Đường dẫn ARD legacy không hỗ trợ | 404 trực tiếp; không phải HTML lỗi 200 |
| URL trang/sản phẩm/collection không hợp lệ | 404 HTTP sau khi hoàn tất bước xử lý soft 404 tổng thể |
| Trang và tài nguyên hợp lệ | Hoạt động bình thường, không mất metadata, sitemap, xác minh Google hoặc PWA |
| Hiệu năng | Không thêm JavaScript client cho llms/ARD; không tái phát CLS do thay đổi loading |

## 5. Khi nào mới triển khai ARD đầy đủ?

Chỉ mở giai đoạn này nếu cần cung cấp khả năng thật cho trợ lý AI, chẳng hạn tra danh mục/chính sách qua giao diện chỉ đọc có tài liệu rõ ràng. Trước tiên thiết kế tài nguyên, descriptor, giới hạn truy cập và kiểm thử; sau đó mới xuất manifest `entries`, kiểm schema/conformance và quảng bá `rel="ard"`. Đặc tả còn phát triển nên khóa phiên bản/schema khi triển khai.

Không khai báo API thanh toán, admin hoặc đơn hàng cá nhân thành khả năng công khai. Manifest hợp lệ cũng không tự cung cấp quyền truy cập hay bảo đảm khả năng sử dụng của tài nguyên đích.

## 6. Kỳ vọng đúng về Google và PageSpeed

Hai cảnh báo trong ảnh thuộc khả năng khám phá tài nguyên cho tác nhân AI. Sửa chúng không trực tiếp làm ảnh nhẹ hơn, giảm LCP/CLS hay bảo đảm tăng điểm Performance/thứ hạng Google. Google nói không cần tạo thêm file AI hoặc schema đặc biệt để xuất hiện trong AI features. [Google Search Central](https://developers.google.com/search/docs/appearance/ai-features).

Tiếp tục ưu tiên nội dung, title/canonical, status HTTP, dữ liệu sản phẩm, ảnh và trải nghiệm trang theo báo cáo SEO hiện có. Báo cáo này không kết luận các hạng mục đó đã được xử lý chỉ vì hai audit llms/ARD hết đỏ.
