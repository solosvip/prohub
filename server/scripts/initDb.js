const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
require('dotenv').config();

const DATA_DIR = process.env.DATA_DIR || './data';
const DB_FILE = process.env.DB_FILE || path.join(DATA_DIR, 'app.sqlite');

// 确保数据目录存在
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

const db = new Database(DB_FILE);

// --- 迁移逻辑：为旧表添加type列并更新名称 ---
const migrate_folders = () => {
  try {
    const columns = db.pragma('table_info(folders)');
    const hasTypeColumn = columns.some(col => col.name === 'type');

    if (!hasTypeColumn) {
      console.log('迁移：为 `folders` 表添加 `type` 列...');
      db.exec('ALTER TABLE folders ADD COLUMN type TEXT');
      console.log('✅ `type` 列添加完成');
    }

    // 更新名称和类型
    console.log('迁移：更新顶级文件夹名称和类型...');
    const updateStmt = db.prepare('UPDATE folders SET name = ?, type = ? WHERE name = ? AND parent_id IS NULL');
    updateStmt.run('文本', 'text', '文本Prompt');
    updateStmt.run('图片', 'image', '图片Prompt');
    updateStmt.run('视频', 'video', '视频Prompt');
    console.log('✅ 顶级文件夹更新完成');

  } catch (error) {
    if (!error.message.includes('no such table')) {
      console.error('迁移失败:', error);
      throw error;
    }
  }
};


// 创建表结构
const initTables = () => {
  console.log('初始化数据库表...');

  // 确保外键启用
  try { db.pragma('foreign_keys = ON'); } catch (_) {}

  // 文件夹表
  db.exec(`
    CREATE TABLE IF NOT EXISTS folders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      parent_id INTEGER REFERENCES folders(id) ON DELETE SET NULL,
      type TEXT, -- 文件夹类型 (text, image, video)
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_folders_parent_id ON folders(parent_id);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_folders_unique_top_level_name ON folders(name) WHERE parent_id IS NULL;
  `);

  // 标签表
  db.exec(`
    CREATE TABLE IF NOT EXISTS tags (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      color TEXT,
      usage_count INTEGER DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);

  // 内容表
  db.exec(`
    CREATE TABLE IF NOT EXISTS items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      content TEXT,
      content_type TEXT, -- text | image | video
      file_path TEXT,
      file_name TEXT,
      file_size INTEGER,
      thumbnail_path TEXT,
      folder_id INTEGER REFERENCES folders(id) ON DELETE SET NULL,
      is_favorite INTEGER DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_items_folder_id ON items(folder_id);
    CREATE INDEX IF NOT EXISTS idx_items_updated_at ON items(updated_at);
    CREATE INDEX IF NOT EXISTS idx_items_content_type ON items(content_type);
  `);

  // 关联表：item_tags
  db.exec(`
    CREATE TABLE IF NOT EXISTS item_tags (
      item_id INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
      tag_id INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
      PRIMARY KEY (item_id, tag_id)
    );
    CREATE INDEX IF NOT EXISTS idx_item_tags_tag ON item_tags(tag_id);
  `);

  // 分享表
  db.exec(`
    CREATE TABLE IF NOT EXISTS shares (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      share_key TEXT NOT NULL UNIQUE,
      item_id INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
      title TEXT,
      description TEXT,
      password TEXT,
      is_active INTEGER DEFAULT 1,
      expires_at TEXT,
      view_count INTEGER DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_shares_item_id ON shares(item_id);
    CREATE INDEX IF NOT EXISTS idx_shares_active ON shares(is_active);
  `);

  // 全文索引（FTS5），与 items 表同步
  db.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS items_fts USING fts5(
      title,
      content,
      content='items',
      content_rowid='id'
    );

    -- 触发器：保持 items_fts 与 items 同步
    CREATE TRIGGER IF NOT EXISTS items_ai AFTER INSERT ON items BEGIN
      INSERT INTO items_fts(rowid, title, content) VALUES (new.id, new.title, new.content);
    END;
    CREATE TRIGGER IF NOT EXISTS items_ad AFTER DELETE ON items BEGIN
      INSERT INTO items_fts(items_fts, rowid, title, content) VALUES('delete', old.id, old.title, old.content);
    END;
    CREATE TRIGGER IF NOT EXISTS items_au AFTER UPDATE ON items BEGIN
      INSERT INTO items_fts(items_fts, rowid, title, content) VALUES('delete', old.id, old.title, old.content);
      INSERT INTO items_fts(rowid, title, content) VALUES (new.id, new.title, new.content);
    END;
  `);

  console.log('✅ 数据库表创建完成');
};

// 插入初始数据
const insertInitialData = () => {
  console.log('插入初始数据...');

  const insertFolder = db.prepare(`
    INSERT OR IGNORE INTO folders (name, parent_id, type, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?)
  `);

  const now = new Date().toISOString();

  insertFolder.run('文本', null, 'text', now, now);
  insertFolder.run('图片', null, 'image', now, now);
  insertFolder.run('视频', null, 'video', now, now);
  insertFolder.run('未归类', null, null, now, now);

  const insertTag = db.prepare(`
    INSERT OR IGNORE INTO tags (name, color, created_at, updated_at)
    VALUES (?, ?, ?, ?)
  `);

  const defaultTags = [
    { name: 'AI绘画', color: '#8b5cf6' },
    { name: '人物', color: '#ec4899' },
    { name: '风景', color: '#10b981' },
    { name: '创意', color: '#f59e0b' },
    { name: '商业', color: '#3b82f6' }
  ];

  defaultTags.forEach(tag => {
    insertTag.run(tag.name, tag.color, now, now);
  });

  console.log('✅ 初始数据插入完成');
};

// 初始化数据库
try {
  migrate_folders();
  initTables();
  insertInitialData();
  
  const uploadDir = process.env.UPLOAD_DIR || path.join(DATA_DIR, 'uploads');
  if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
  }
  
  const thumbnailDir = path.join(uploadDir, 'thumbnails');
  if (!fs.existsSync(thumbnailDir)) {
    fs.mkdirSync(thumbnailDir, { recursive: true });
  }

  console.log('🚀 数据库初始化完成！');
  console.log(`📁 数据库文件: ${DB_FILE}`);
  console.log(`📁 上传目录: ${uploadDir}`);

  db.close();
} catch (error) {
  console.error('❌ 数据库初始化失败:', error);
  process.exit(1);
}
