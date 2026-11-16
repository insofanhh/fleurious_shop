# Bố cục sản phẩm so le

Tham khảo [Masonry của Pinterest Gestalt](https://github.com/pinterest/gestalt/blob/master/packages/gestalt/src/Masonry/README.md): các cột có cùng chiều rộng; card tiếp theo đi vào cột thấp nhất, ưu tiên cột trái khi bằng nhau.

`MasonryGrid` dùng chung ở trang chủ, danh sách hoa/bộ sưu tập/yêu thích và sản phẩm gợi ý. Mặc định 4 cột, 3 cột khi màn hình không quá 1100px, 2 cột trên mobile không quá 700px. Ảnh giữ tỷ lệ gốc; bỏ chiều cao và padding so le giả lập. Lưới đều vẫn có thể chọn bằng nút đổi bố cục; sắp xếp giá giữ lựa chọn hiện tại.

DOM giữ thứ tự dữ liệu để thao tác bàn phím, lọc và sắp xếp nhất quán. ResizeObserver đo lại khi ảnh, font, nội dung hoặc chiều rộng thay đổi; requestAnimationFrame gộp cập nhật. CSS Grid là fallback SSR/khi JavaScript chưa sẵn sàng. Container được đặt chiều cao theo card cuối cùng để nội dung bên dưới không chồng lên danh sách.

Kiểm tra: `node --import tsx --test tests/masonry.test.ts`; Chromium/WebKit ở 320/390/900/1280px, tỷ lệ ảnh, khoảng cách từng cột, chiều cao container, lọc/rỗng, giá tăng dần, đổi bố cục, yêu thích/thêm giỏ, đổi chiều cao nội dung, trang chủ/gợi ý. Kiểm tra thêm 8→16 card giữ vị trí các card trước đó. Ảnh và kết quả kiểm tra nằm trong `output/masonry-review/` (không commit).
