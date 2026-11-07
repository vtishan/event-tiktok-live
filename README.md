# Event TikTok Live

Công cụ Node.js theo dõi sự kiện TikTok LIVE theo thời gian thực qua WebSocket.

## Tính năng

- Kết nối phòng LIVE bằng username, link hồ sơ hoặc link LIVE TikTok.
- Nhận và hiển thị bình luận, quà tặng, lượt thích, người mới vào phòng, follow, share và số người xem.
- Giải mã frame protobuf, hỗ trợ payload gzip và tự động gửi heartbeat/ACK.
- Lọc sự kiện trùng lặp và xử lý combo quà tặng.
- Có thể bật dữ liệu frame thô bằng biến môi trường `TIKTOK_RAW=1`.

## Yêu cầu

- Node.js 18 trở lên.
- Kết nối Internet tới TikTok.
- Các package `ws` và `tiktok-live-proto`.

## Cài đặt

```bash
npm install ws tiktok-live-proto
```

## Sử dụng

Chạy bằng username:

```bash
node tiktoklive.js @username
```

Hoặc chạy bằng link TikTok LIVE:

```bash
node tiktoklive.js https://www.tiktok.com/@username/live
```

Nếu không truyền tham số, chương trình sẽ hỏi link hoặc username trong terminal. Dùng `Ctrl+C` để dừng theo dõi.

## Biến môi trường

- `TIKTOK_USERNAME`: username hoặc link dùng khi không truyền tham số dòng lệnh.
- `TIKTOK_WS_URL`: URL WebSocket tùy chỉnh (tùy chọn).
- `TIKTOK_RAW=1`: in frame thô nhận được từ TikTok.

## Ghi chú

TikTok có thể thay đổi API hoặc yêu cầu kết nối theo từng thời điểm. Công cụ chỉ dùng để theo dõi dữ liệu của phòng LIVE mà bạn có quyền truy cập và cần tuân thủ điều khoản của TikTok.
