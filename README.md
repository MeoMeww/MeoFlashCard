# MeoCards — Flashcard web app (giống flashcards.world)

Web app tĩnh (HTML/CSS/JS thuần, không cần server), chạy được trên GitHub Pages.

## Tính năng
- **Đăng nhập Google** và **đồng bộ qua Google Drive** — dữ liệu lưu trong thư mục ẩn `appDataFolder` của Drive (người dùng không thấy, app khác không đọc được). Mở app trên máy khác, đăng nhập cùng tài khoản là có dữ liệu.
- Dùng được **khi chưa đăng nhập / offline** (lưu trên trình duyệt). Lần đầu đăng nhập, dữ liệu đó được gộp lên tài khoản.
- **Bộ thẻ (Set)**: tạo, sửa, nhân bản, xoá, tìm kiếm, xuất/nhập JSON, **Nhập nhanh** (dán từ Excel/Sheets/Quizlet: mỗi dòng `term<Tab>definition`).
- **Trình soạn thẻ** giống hình mẫu: `#số thẻ`, công tắc **Multiple choice**, nút xoá, ô **Term** / **Definition** có thanh định dạng:
  **B**, *I*, U, ~~S~~, `code` (Ctrl+E), khối code, màu chữ, tô sáng, **[...]** (ô trống / cloze — bôi đen chữ rồi bấm, khi học chữ đó bị ẩn), xoá định dạng; **Tags** (Add Tag, gợi ý tag đã dùng).
- **Multiple choice**: nhập các lựa chọn, tích ✓ đáp án đúng; Definition thành phần "Giải thích".
- **Học**: lật thẻ (Space, ← →), đánh dấu Đã thuộc / Chưa thuộc (1, 2), trộn, lọc theo tag, chỉ học thẻ chưa thuộc, hiện Definition trước.
- **Kiểm tra**: trắc nghiệm tự sinh đáp án nhiễu từ các thẻ khác, làm lại câu sai. Tiến độ học cũng được đồng bộ.

## Cài đặt Google (làm 1 lần, ~5 phút)
1. Vào https://console.cloud.google.com/ → tạo Project mới (vd. `MeoCards`).
2. **APIs & Services → Library** → tìm **Google Drive API** → **Enable**.
3. **APIs & Services → OAuth consent screen** (Google Auth Platform):
   - User type: **External**, điền tên app + email.
   - Scopes: thêm `.../auth/drive.appdata` (non-sensitive) cùng `openid`, `email`, `profile`.
   - Mục **Test users / Audience**: thêm các Gmail sẽ dùng app (khi app còn ở chế độ Testing). Muốn ai cũng dùng được thì bấm **Publish app** — vì `drive.appdata` không phải scope nhạy cảm nên thường không cần Google duyệt.
4. **APIs & Services → Credentials → Create credentials → OAuth client ID**
   - Application type: **Web application**
   - **Authorized JavaScript origins**: thêm địa chỉ app, ví dụ
     - `https://meomeww.github.io` (GitHub Pages — chỉ cần domain, không có đường dẫn)
     - `http://localhost:8000` (để chạy thử trên máy)
   - Tạo xong copy **Client ID** (`xxxx.apps.googleusercontent.com`).
5. Dán Client ID vào `config.js` (`GOOGLE_CLIENT_ID`) — hoặc mở app, bấm ⚙ và dán vào đó.

## Chạy thử trên máy
```bash
cd flashcard-app
python3 -m http.server 8000
# mở http://localhost:8000
```
(Không mở trực tiếp file `index.html` bằng `file://` — Google Sign-In cần http/https.)

## Đưa lên GitHub Pages
Tạo repo, đẩy toàn bộ thư mục lên nhánh `main`, vào **Settings → Pages → Deploy from branch → main / root**. Nhớ thêm domain Pages vào *Authorized JavaScript origins* ở bước 4.

## Ghi chú kỹ thuật
- File: `index.html`, `styles.css`, `app.js`, `config.js`.
- Dữ liệu Drive: 1 file `flashcards-data.json` trong `appDataFolder`.
- Đồng bộ: tự động ~1.5 giây sau mỗi thay đổi, mỗi 60 giây, và khi quay lại tab. Gộp theo từng bộ thẻ (bản sửa sau cùng thắng) và theo từng thẻ cho tiến độ học. Nếu sửa **cùng một bộ** trên 2 máy cùng lúc thì bản lưu sau sẽ thắng.
- Token Google (luồng trình duyệt) hết hạn sau ~1 giờ: khi đó dòng trạng thái hiện "⟳ Phiên Google hết hạn — bấm để kết nối lại", bấm 1 lần là xong (không cần nhập lại mật khẩu). Thay đổi trong lúc đó vẫn được lưu trên máy và đẩy lên khi kết nối lại.
