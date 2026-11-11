// Cấu hình app.
// GOOGLE_CLIENT_ID: tạo ở Google Cloud Console → APIs & Services → Credentials →
// "OAuth client ID" loại "Web application". Xem README.md để biết từng bước.
// Có thể để trống và nhập trong app (nút ⚙ Cài đặt) — giá trị sẽ lưu trên trình duyệt.
window.APP_CONFIG = {
  GOOGLE_CLIENT_ID: "",
  // Tên file dữ liệu trong thư mục ẩn appDataFolder của Google Drive
  DRIVE_FILE_NAME: "flashcards-data.json",
  // Tự động đồng bộ lại mỗi N giây khi đang mở app
  AUTO_SYNC_SECONDS: 60,
};
