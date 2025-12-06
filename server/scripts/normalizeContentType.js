const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const DB_FILE = process.env.DB_FILE || path.join(DATA_DIR, 'app.sqlite');

function normalize(t) {
  if (!t) return null;
  const low = String(t).toLowerCase();
  if (low.startsWith('text')) return 'text';
  if (low.startsWith('image')) return 'image';
  if (low.startsWith('video')) return 'video';
  return low;
}

(function run() {
  const db = new Database(DB_FILE);
  const rows = db.prepare('SELECT id, content_type FROM items').all();
  const tx = db.transaction((batch) => {
    const upd = db.prepare('UPDATE items SET content_type = ?, updated_at = ? WHERE id = ?');
    const now = new Date().toISOString();
    batch.forEach(r => {
      const n = normalize(r.content_type);
      if (n && n !== r.content_type) {
        upd.run(n, now, r.id);
      }
    });
  });
  tx(rows);
  console.log(`Normalized ${rows.length} rows (only mismatched updated).`);
  db.close();
})();

