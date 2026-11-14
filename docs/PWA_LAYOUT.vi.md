# Bố cục và zoom trong PWA

Thanh điều hướng mobile cao 64 px, mỗi vùng bấm cao 46 px. `safe-area-inset-bottom` chỉ cộng vào khoảng cách bên ngoài (12 px + safe area), không cộng vào padding/chiều cao thanh. Footer, toast và nút quét QR sử dụng chung các biến khoảng cách; nút QR cách mép trên thanh 20 px.

Trong ứng dụng đã cài (`display-mode: standalone` hoặc `navigator.standalone` của iOS), `PwaViewport` giới hạn viewport ở scale 1 và chặn gesture pinch/trackpad zoom. CSS `touch-action: pan-x pan-y` giữ cuộn ngang/dọc, không cho pinch/double-tap zoom. Không chặn cuộn một ngón, không bật giới hạn viewport này cho tab web bình thường. Khi đổi route/chế độ hiển thị hoặc unmount, viewport và các listener được cập nhật/dọn đúng phạm vi.

Service worker public v3 xóa cache cũ sau khi bản mới được kích hoạt. Không tự ép reload phiên đang đặt hàng; có thể vào Hồ sơ → Cập nhật giao diện khi bản mới sẵn sàng. PWA card theo dõi updatefound/statechange để hiện nút cập nhật khi worker tải xong.

Đã kiểm tra DOM/layout ở viewport rộng 320 và 390 px: thanh luôn cao 64 px, không tràn ngang và nút QR cách thanh 20 px. Kiểm tra runtime mô phỏng xác nhận giới hạn chỉ áp dụng trong standalone, có hỗ trợ cờ standalone iOS, vẫn cho phép cuộn một ngón và khôi phục viewport/listener sau cleanup. Không coi mô phỏng này là kiểm thử trên iPhone vật lý.

Tham khảo: [W3C touch-action](https://www.w3.org/TR/pointerevents3/#the-touch-action-css-property), [Apple gesture events](https://developer.apple.com/library/archive/documentation/AppleApplications/Reference/SafariWebContent/HandlingEvents/HandlingEvents.html).
