# Sản phẩm, danh mục, size và ảnh

- Slug tự sinh từ tên sản phẩm, bỏ dấu tiếng Việt và ký tự đặc biệt. Khi người quản trị sửa slug thủ công, đổi tên không ghi đè slug đó. Nút “Tạo lại từ tên” bật lại tự sinh. Sửa sản phẩm giữ nguyên slug hiện có để tránh đổi liên kết ngoài ý muốn; trùng slug được báo lỗi.
- “Danh mục & size” quản lý chung CATEGORY, SIZE, OCCASION, COLOR và COLLECTION với bộ lọc từng nhóm. Form sản phẩm thêm nhanh danh mục/size rồi chọn ngay, không cần đóng form. Mục thêm nhanh được lưu riêng ngay khi nhấn “Thêm & chọn”.
- SIZE là danh mục tên dùng chung; mỗi sản phẩm giữ riêng SKU, giá, tồn và lượng đang giữ. Đổi tên size dùng chung cập nhật tên biến thể hiện tại, giữ nguyên ID/SKU/giá/tồn. Ẩn một size ngăn chọn cho biến thể mới; các biến thể đang dùng vẫn được giữ để xử lý đơn và lịch sử. Migration `20261115090000_size_catalogue` nhập các tên size đang có vào danh mục, không tạo lại biến thể.
- Công tắc ở bảng sản phẩm gọi PATCH `/api/admin/products/:id/visibility`, chỉ cập nhật `active`, kiểm tra quyền `products`, ghi audit và phát `catalog.changed`. Không gửi lại toàn bộ sản phẩm từ dữ liệu bảng cũ. WebSocket/Socket.IO cập nhật catalog phía client.

## Ảnh Vercel Blob

Theo [hướng dẫn server upload của Vercel](https://vercel.com/docs/vercel-blob/server-upload), ảnh mới đi qua API đã đăng nhập và kiểm tra quyền, tối đa 4 MB, JPG/PNG/WebP, tối đa 40 megapixel. Server đọc giới hạn body, xác minh và tối ưu bằng Sharp, bỏ metadata, chuyển WebP rộng tối đa 1600px rồi lưu vào public Blob. URL trả về được lưu cùng sản phẩm/nội dung/danh mục.

Store `fleurious-images` ở `sin1` đã nối Production và Development. `BLOB_READ_WRITE_TOKEN` nằm trong Vercel Environment Variables và file `.env.local`/`.env.deploy.local` được gitignore; không gửi token cho client. Khởi động lại server local sau khi đổi biến môi trường. Khi deploy, migration và phiên bản code mới cần được áp dụng cùng nhau.

Ảnh tĩnh `/images/...` và ảnh cũ `/media/...` vẫn đọc qua đường dẫn hiện có. Thay đổi này chuyển các lần upload mới sang Blob, không tự di chuyển hoặc xóa các ảnh cũ. Công cụ chọn ảnh QR giữ chuỗi chỉ giải mã tại thiết bị, không đẩy QR riêng tư lên Blob.

Kiểm tra: bộ test tích hợp database riêng `_test`, form desktop/mobile Chromium/WebKit, và upload/đọc thật qua Blob SDK. Ảnh thử đã xóa sau kiểm tra; kết quả giao diện trong `output/catalog-review/` không commit.
