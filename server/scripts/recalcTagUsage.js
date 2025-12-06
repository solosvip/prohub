const path = require('path');
const Database = require('better-sqlite3');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

// Use same path logic as server
const DB_FILE = process.env.DB_FILE || path.join(process.env.DATA_DIR || './data', 'app.sqlite');
const db = new Database(DB_FILE);

try {
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(r => r.name);
  if (!tables.includes('tags') || !tables.includes('item_tags')) {
    console.log('[tags:recalc] Skip: tables not found in DB =>', DB_FILE);
    process.exit(0);
  }
  const tx = db.transaction(() => {
    db.prepare(`UPDATE tags SET usage_count = (SELECT COUNT(*) FROM item_tags WHERE tag_id = tags.id)`).run();
  });
  tx();
  const top = db.prepare('SELECT id, name, usage_count FROM tags ORDER BY usage_count DESC, name ASC LIMIT 10').all();
  console.log('[tags:recalc] Done. Top sample:', top);
} catch (e) {
  console.error('[tags:recalc] Error:', e.message);
  process.exit(1);
} finally {
  try { db.close(); } catch (_) {}
}
