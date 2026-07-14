import fs from 'fs';
import path from 'path';
import mysql from 'mysql2/promise';
import sqlite3 from 'sqlite3';

export type DatabaseDialect = 'mysql' | 'sqlite';

export interface DatabaseConnection {
  readonly dialect: DatabaseDialect;
  execute<T = any>(sql: string, params?: unknown[]): Promise<[T, unknown]>;
}

class SqliteConnection implements DatabaseConnection {
  readonly dialect = 'sqlite' as const;

  private constructor(private readonly db: sqlite3.Database) {
    this.db.configure('busyTimeout', 5000);
  }

  static open(filename: string): Promise<SqliteConnection> {
    if (filename !== ':memory:') {
      fs.mkdirSync(path.dirname(filename), { recursive: true });
    }

    return new Promise((resolve, reject) => {
      const db = new sqlite3.Database(filename, (error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(new SqliteConnection(db));
      });
    });
  }

  execute<T = any>(sql: string, params: unknown[] = []): Promise<[T, unknown]> {
    const sqliteSql = sql
      .replace(/\bNOW\(\)/gi, 'CURRENT_TIMESTAMP')
      .replace(/\bENUM\s*\([^)]*\)/gi, 'TEXT');
    const isReadQuery = /^\s*(SELECT|PRAGMA|WITH)\b/i.test(sqliteSql);

    if (isReadQuery) {
      return new Promise((resolve, reject) => {
        this.db.all(sqliteSql, params as any[], (error, rows) => {
          if (error) {
            reject(error);
            return;
          }
          resolve([rows as T, undefined]);
        });
      });
    }

    return new Promise((resolve, reject) => {
      this.db.run(sqliteSql, params as any[], function (error) {
        if (error) {
          reject(error);
          return;
        }
        resolve([
          {
            affectedRows: this.changes ?? 0,
            insertId: this.lastID ?? 0,
          } as T,
          undefined,
        ]);
      });
    });
  }
}

class DatabaseRouter implements DatabaseConnection {
  private connection?: DatabaseConnection;
  private initialization?: Promise<void>;

  get dialect(): DatabaseDialect {
    return this.connection?.dialect ?? this.requestedDialect;
  }

  private get requestedDialect(): DatabaseDialect {
    const configured = (process.env.DB_TYPE ?? process.env.DB_DIALECT ?? 'mysql').toLowerCase();
    return configured === 'sqlite' ? 'sqlite' : 'mysql';
  }

  async initialize(): Promise<void> {
    if (!this.initialization) {
      this.initialization = this.connect();
    }
    await this.initialization;
  }

  async execute<T = any>(sql: string, params: unknown[] = []): Promise<[T, unknown]> {
    await this.initialize();
    return this.connection!.execute<T>(sql, params);
  }

  private async connect(): Promise<void> {
    if (this.requestedDialect === 'sqlite') {
      this.connection = await this.openSqlite();
      console.log(`Database: SQLite (${this.sqliteFilename()})`);
      return;
    }

    const mysqlPool = mysql.createPool({
      host: process.env.DB_HOST,
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      database: process.env.DB_NAME,
      port: process.env.DB_PORT ? Number.parseInt(process.env.DB_PORT, 10) : undefined,
      waitForConnections: true,
      connectionLimit: 5,
    });

    try {
      await mysqlPool.query('SELECT 1');
      this.connection = mysqlPool as unknown as DatabaseConnection;
      Object.defineProperty(this.connection, 'dialect', { value: 'mysql' });
      console.log('Database: MySQL');
    } catch (error) {
      console.error('Khong the ket noi MySQL, chuyen sang SQLite:', error);
      await mysqlPool.end().catch(() => undefined);
      this.connection = await this.openSqlite();
      console.log(`Database: SQLite fallback (${this.sqliteFilename()})`);
    }
  }

  private sqliteFilename(): string {
    const configured = process.env.SQLITE_PATH ?? path.join('data', 'bot.sqlite');
    return configured === ':memory:' ? configured : path.resolve(process.cwd(), configured);
  }

  private openSqlite(): Promise<DatabaseConnection> {
    return SqliteConnection.open(this.sqliteFilename());
  }
}

export const pool = new DatabaseRouter();

export async function ensureConversationTables(pool: DatabaseConnection): Promise<void> {
  const createConversationTableQuery = pool.dialect === 'sqlite'
    ? `
      CREATE TABLE IF NOT EXISTS conversation_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT NOT NULL,
        role TEXT NOT NULL CHECK (role IN ('user', 'bot')),
        message TEXT NOT NULL,
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `
    : `
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
  pool: DatabaseConnection
): Promise<void> {
  const query = `
    INSERT INTO conversation_history (user_id, role, message, timestamp)
    VALUES (?, ?, ?, CURRENT_TIMESTAMP)
  `;
  await pool.execute(query, [userId, role, message]);
}

export async function getChatConversationHistory(
  userId: string,
  pool: DatabaseConnection,
  limit: number = 10
): Promise<{ role: string; message: string }[]> {
  try {
    const safeLimit = Math.max(1, Math.floor(limit));
    const query = `
      SELECT role, message FROM (
        SELECT role, message, timestamp
        FROM conversation_history
        WHERE user_id = ?
        ORDER BY timestamp DESC
        LIMIT ${safeLimit}
      ) sub
      ORDER BY timestamp ASC
    `;
    const [rows] = await pool.execute<any[]>(query, [userId]);
    return rows as { role: string; message: string }[];
  } catch (error) {
    console.error('Loi lay lich su tro chuyen:', error);
    return [];
  }
}
