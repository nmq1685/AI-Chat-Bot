# AI-Chat-Bot

## AI provider

Lệnh `/chat` (hoặc lệnh prefix `!c`/`!chat`) hỗ trợ OpenAI và Google Gemini. Chọn provider và model trong `.env`:

```env
AI_PROVIDER=google
AI_MODEL=gemini-2.0-flash
GOOGLE_API_KEY=your_google_api_key
OPENAI_API_KEY=your_openai_api_key
```

Đặt `AI_PROVIDER=openai` để dùng OpenAI; khi đó `AI_MODEL` phải là model OpenAI bạn muốn sử dụng, ví dụ `gpt-5`. Đặt `AI_PROVIDER=google` để dùng Gemini; khi đó `AI_MODEL` phải là model Gemini tương ứng.

## Database

Bot sẽ thử kết nối MySQL khi khởi động. Nếu MySQL không kết nối được, bot tự động dùng SQLite tại `data/bot.sqlite`.

Biến môi trường tùy chọn:

- `DB_TYPE=mysql` (mặc định) hoặc `DB_TYPE=sqlite` để chọn backend trực tiếp.
- `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME` cho MySQL.
- `SQLITE_PATH` để đổi đường dẫn file SQLite; có thể dùng `:memory:` khi test.
