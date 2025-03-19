// database.ts
import { Pool } from 'mysql2/promise';

export async function ensureConversationTables(pool: Pool): Promise<void> {
  const createConversationTableQuery = `
    CREATE TABLE IF NOT EXISTS conversation_history (
      id INT AUTO_INCREMENT PRIMARY KEY,
      user_id VARCHAR(255) NOT NULL,
      role ENUM('user', 'bot') NOT NULL,
      message TEXT NOT NULL,
      timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `;
  await pool.execute(createConversationTableQuery);
  console.log('Table `conversation_history` is ready.');
}

export async function addChatMessageToHistory(
  userId: string,
  role: 'user' | 'bot',
  message: string,
  pool: Pool
): Promise<void> {
  const query = `
    INSERT INTO conversation_history (user_id, role, message, timestamp)
    VALUES (?, ?, ?, NOW())
  `;
  await pool.execute(query, [userId, role, message]);
}

export async function getChatConversationHistory(
  userId: string,
  pool: Pool,
  limit: number = 10
): Promise<{ role: string; message: string }[]> {
  try {
    // Lấy ra các tin nhắn mới nhất theo thứ tự timestamp DESC, sau đó sắp xếp lại theo thứ tự ASC
    const query = `
      SELECT role, message FROM (
        SELECT role, message, timestamp
        FROM conversation_history
        WHERE user_id = ?
        ORDER BY timestamp DESC
        LIMIT ${limit}
      ) sub
      ORDER BY timestamp ASC
    `;
    const [rows] = await pool.execute(query, [userId]);
    return rows as { role: string; message: string }[];
  } catch (error) {
    console.error('Lỗi lấy lịch sử trò chuyện:', error);
    return [];
  }
}
