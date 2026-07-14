# AI-Chat-Bot

## Database

Bot sẽ thử kết nối MySQL khi khởi động. Nếu MySQL không kết nối được, bot tự động dùng SQLite tại `data/bot.sqlite`.

Biến môi trường tùy chọn:

- `DB_TYPE=mysql` (mặc định) hoặc `DB_TYPE=sqlite` để chọn backend trực tiếp.
- `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME` cho MySQL.
- `SQLITE_PATH` để đổi đường dẫn file SQLite; có thể dùng `:memory:` khi test.
