const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const sharp = require('sharp');
const ffmpeg = require('fluent-ffmpeg');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const DB_FILE = process.env.DB_FILE || path.join(DATA_DIR, 'app.sqlite');
const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(DATA_DIR, 'uploads');
const THUMBNAIL_DIR = path.join(UPLOAD_DIR, 'thumbnails');

if (!fs.existsSync(THUMBNAIL_DIR)) fs.mkdirSync(THUMBNAIL_DIR, { recursive: true });

const db = new Database(DB_FILE);

async function makeThumb(videoPath, baseName) {
  const jpg = path.join(THUMBNAIL_DIR, `${baseName}.jpg`);
  const webp = path.join(THUMBNAIL_DIR, `${baseName}.webp`);
  await new Promise((resolve) => {
    try {
      ffmpeg(videoPath)
        .on('end', resolve)
        .on('error', (err) => { console.error('FFmpeg error:', err.message); resolve(); })
        .screenshots({ count: 1, timemarks: ['1'], filename: `${baseName}.jpg`, folder: THUMBNAIL_DIR, size: `${parseInt(process.env.THUMBNAIL_WIDTH) || 400}x?` });
    } catch (e) { console.error('FFmpeg not available:', e.message); resolve(); }
  });
  if (fs.existsSync(jpg)) {
    await sharp(jpg).webp({ quality: 80 }).toFile(webp);
    try { fs.unlinkSync(jpg); } catch (_) {}
    return path.basename(webp);
  }
  return null;
}

(async () => {
  try {
    const rows = db.prepare("SELECT id, file_path FROM items WHERE content_type LIKE 'video%' AND file_path IS NOT NULL AND (thumbnail_path IS NULL OR thumbnail_path = '')").all();
    let ok = 0, fail = 0;
    for (const r of rows) {
      const full = path.join(UPLOAD_DIR, r.file_path);
      if (!fs.existsSync(full)) { console.warn('Missing video file for item', r.id); fail++; continue; }
      const base = `thumb_${path.parse(r.file_path).name}`;
      const thumb = await makeThumb(full, base);
      if (thumb) {
        db.prepare('UPDATE items SET thumbnail_path = ?, updated_at = ? WHERE id = ?').run(thumb, new Date().toISOString(), r.id);
        ok++;
      } else {
        fail++;
      }
    }
    console.log(`Done. Updated: ${ok}, Failed: ${fail}`);
    db.close();
  } catch (e) {
    console.error('Backfill failed:', e);
    process.exit(1);
  }
})();

