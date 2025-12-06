const Database = require('better-sqlite3');
const path = require('path');
require('dotenv').config();

const DATA_DIR = process.env.DATA_DIR || './data';
const DB_FILE = process.env.DB_FILE || path.join(DATA_DIR, 'app.sqlite');

console.log(`准备清空数据库中的标签: ${DB_FILE}`);

const db = new Database(DB_FILE);

try {
  console.log('开始执行清空操作...');
  
  const clearTagsTransaction = db.transaction(() => {
    // 必须先删除关联表中的数据
    const itemTagsResult = db.prepare('DELETE FROM item_tags').run();
    console.log(`从 'item_tags' 表中删除了 ${itemTagsResult.changes} 条关联记录。`);

    // 然后删除主表中的数据
    const tagsResult = db.prepare('DELETE FROM tags').run();
    console.log(`从 'tags' 表中删除了 ${tagsResult.changes} 个标签。`);
  });

  clearTagsTransaction();

  console.log('✅ 所有标签及关联数据已成功删除。');

} catch (error) {
  console.error('❌ 清空标签失败:', error);
  process.exit(1);
} finally {
  db.close();
}
