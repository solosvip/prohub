const express = require('express');
const multer = require('multer');
const sharp = require('sharp');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const Database = require('better-sqlite3');
const { authenticateToken } = require('./auth');

const router = express.Router();
router.use(authenticateToken);

const DB_FILE = process.env.DB_FILE || path.join(process.env.DATA_DIR || './data', 'app.sqlite');
const db = new Database(DB_FILE);
try { db.pragma('journal_mode = WAL'); db.pragma('synchronous = NORMAL'); db.pragma('busy_timeout = 5000'); db.pragma('foreign_keys = ON'); } catch (_) {}

// Ensure table for multi-image per item
try {
  db.exec(`
    CREATE TABLE IF NOT EXISTS item_media (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      item_id INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
      file_path TEXT NOT NULL,
      thumbnail_path TEXT,
      width INTEGER,
      height INTEGER,
      mime TEXT,
      size INTEGER,
      sort_order INTEGER DEFAULT 0,
      is_cover INTEGER DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_item_media_item_id ON item_media(item_id);
    CREATE INDEX IF NOT EXISTS idx_item_media_sort ON item_media(item_id, sort_order);
  `);
} catch (e) { console.error('Ensure item_media table error:', e); }

const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(process.env.DATA_DIR || './data', 'uploads');
const THUMBNAIL_DIR = path.join(UPLOAD_DIR, 'thumbnails');
const TEMP_DIR = path.join(UPLOAD_DIR, 'tmp');
[ TEMP_DIR ].forEach(dir => { if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true }); });
[UPLOAD_DIR, THUMBNAIL_DIR].forEach(dir => { if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true }); });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `${uuidv4()}${ext}`);
  }
});

const uploadMedia = multer({
  storage,
  fileFilter: (req, file, cb) => {
    if (file.mimetype && file.mimetype.startsWith('image/')) return cb(null, true);
    const err = new Error('只支持上传图片文件');
    err.code = 'FILE_TYPE_NOT_ALLOWED_IMAGE';
    return cb(err, false);
  },
  limits: { fileSize: Number(process.env.MAX_IMAGE_SIZE) || 10 * 1024 * 1024 }
});

async function processAndStoreImage(tempFilePath) {
  const base = uuidv4();
  const mainName = `${base}.webp`;
  const thumbName = `thumb_${base}.webp`;
  const mainPath = path.join(UPLOAD_DIR, mainName);
  const thumbPath = path.join(THUMBNAIL_DIR, thumbName);

  let meta;
  try { meta = await sharp(tempFilePath).metadata(); } catch (e) { meta = {}; }
  const needResize = (meta?.width || 0) > 1080;

  let pipeline = sharp(tempFilePath).rotate();
  if (needResize) {
    pipeline = pipeline.resize({ width: 1080, fit: 'inside', withoutEnlargement: true, fastShrinkOnLoad: true });
  }
  const mainInfo = await pipeline.webp({ quality: 80, effort: 5 }).toFile(mainPath);

  await sharp(tempFilePath)
    .rotate()
    .resize({ width: 400, fit: 'inside', withoutEnlargement: true, fastShrinkOnLoad: true })
    .webp({ quality: 72, effort: 4 })
    .toFile(thumbPath);

  try { fs.unlinkSync(tempFilePath); } catch (e) {}

  return {
    file_path: mainName,
    thumbnail_path: thumbName,
    width: mainInfo.width || meta.width || null,
    height: mainInfo.height || meta.height || null,
    mime: 'image/webp',
    size: mainInfo.size || null
  };
}

function getCurrentMediaCount(itemId) {
  const row = db.prepare('SELECT COUNT(1) AS c FROM item_media WHERE item_id = ?').get(itemId);
  return row?.c || 0;
}

// Upload multiple images as medias for an item (max 20)
router.post('/:id/media', (req, res) => {
  // invoke multer manually to catch and format errors
  uploadMedia.array('files', 20)(req, res, async (err) => {
    if (err) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(413).json({ error: { code: 'FILE_TOO_LARGE_IMAGE', message: '图片大小超过限制（≤10MB）' } });
      }
      if (err.code === 'FILE_TYPE_NOT_ALLOWED_IMAGE') {
        return res.status(415).json({ error: { code: 'FILE_TYPE_NOT_ALLOWED_IMAGE', message: '只支持上传图片文件' } });
      }
      return res.status(400).json({ error: { code: 'UPLOAD_ERROR', message: err.message || '图片上传失败' } });
    }
    try {
      const { id } = req.params;
      const item = db.prepare('SELECT id FROM items WHERE id = ?').get(id);
      if (!item) return res.status(404).json({ error: { code: 'ITEM_NOT_FOUND', message: '数据不存在' } });

      if (!req.files || req.files.length === 0) {
        return res.status(400).json({ error: { code: 'NO_FILE', message: '未选择文件' } });
      }

      const current = getCurrentMediaCount(id);
      const files = req.files || [];
      if (current + files.length > 20) {
        return res.status(400).json({ error: { code: 'MEDIA_LIMIT_EXCEEDED', message: '每个条目最多 20 张图片' } });
      }

    const now = new Date().toISOString();
    const inserted = [];

    for (const f of files) {
      try {
        const processed = await processAndStoreImage(f.path);
        const sort = getCurrentMediaCount(id);
        const stmt = db.prepare('INSERT INTO item_media (item_id, file_path, thumbnail_path, width, height, mime, size, sort_order, is_cover, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
        const result = stmt.run(id, processed.file_path, processed.thumbnail_path, processed.width, processed.height, processed.mime, processed.size, sort, 0, now, now);
        inserted.push({ id: result.lastInsertRowid, ...processed, sort_order: sort });
      } catch (e) { console.error('Process image failed:', e); }
    }

    // Ensure there is a cover and items table carries cover paths for list view
    try {
      const hasCover = db.prepare('SELECT 1 FROM item_media WHERE item_id = ? AND is_cover = 1 LIMIT 1').get(id);
      if (!hasCover) {
        const cover = db.prepare('SELECT id, file_path, thumbnail_path FROM item_media WHERE item_id = ? ORDER BY sort_order ASC, id ASC LIMIT 1').get(id);
        if (cover) {
          db.prepare('UPDATE item_media SET is_cover = 1 WHERE id = ?').run(cover.id);
          db.prepare('UPDATE items SET file_path = ?, thumbnail_path = ?, updated_at = ? WHERE id = ?').run(cover.file_path, cover.thumbnail_path, now, id);
        }
      }
    } catch (e) {
      console.error('Ensure cover after upload failed:', e);
    }

      res.json({ success: true, data: inserted });
    } catch (error) {
      console.error('Upload medias error:', error);
      return res.status(500).json({ error: { code: 'UPLOAD_ERROR', message: '图片上传失败' } });
    }
  });
});

// Delete one media
router.delete('/:id/media/:mediaId', (req, res) => {
  try {
    const { id, mediaId } = req.params;
    const media = db.prepare('SELECT file_path, thumbnail_path FROM item_media WHERE id = ? AND item_id = ?').get(mediaId, id);
    if (!media) return res.status(404).json({ error: { code: 'MEDIA_NOT_FOUND', message: '图片不存在' } });
    db.prepare('DELETE FROM item_media WHERE id = ? AND item_id = ?').run(mediaId, id);
    try { fs.unlinkSync(path.join(UPLOAD_DIR, media.file_path)); } catch (e) {}
    try { if (media.thumbnail_path) fs.unlinkSync(path.join(THUMBNAIL_DIR, media.thumbnail_path)); } catch (e) {}

    // Re-evaluate cover after deletion
    try {
      const now = new Date().toISOString();
      const next = db.prepare('SELECT id, file_path, thumbnail_path FROM item_media WHERE item_id = ? ORDER BY sort_order ASC, id ASC LIMIT 1').get(id);
      if (next) {
        db.prepare('UPDATE item_media SET is_cover = CASE WHEN id = ? THEN 1 ELSE 0 END WHERE item_id = ?').run(next.id, id);
        db.prepare('UPDATE items SET file_path = ?, thumbnail_path = ?, updated_at = ? WHERE id = ?').run(next.file_path, next.thumbnail_path, now, id);
      } else {
        // No medias left; clear cover fields
        db.prepare('UPDATE items SET file_path = NULL, thumbnail_path = NULL, updated_at = ? WHERE id = ?').run(now, id);
      }
    } catch (e) {
      console.error('Update cover after delete failed:', e);
    }

    res.json({ success: true });
  } catch (error) {
    console.error('Delete media error:', error);
    res.status(500).json({ error: { code: 'DATABASE_ERROR', message: '删除失败' } });
  }
});

// Update media order; first one will be treated as cover (is_cover=1)
router.put('/:id/media/order', (req, res) => {
  try {
    const { id } = req.params;
    const { order } = req.body || {};
    if (!Array.isArray(order) || order.length === 0) {
      return res.status(400).json({ error: { code: 'INVALID_ORDER', message: '排序数据无效' } });
    }
    const now = new Date().toISOString();
    const update = db.prepare('UPDATE item_media SET sort_order = ?, is_cover = ?, updated_at = ? WHERE id = ? AND item_id = ?');
    const tx = db.transaction((rows) => {
      rows.forEach((m, idx) => { update.run(idx, idx === 0 ? 1 : 0, now, m.id, id); });
    });
    tx(order);

    // Sync cover fields back to items table for list rendering
    try {
      const cover = db.prepare('SELECT file_path, thumbnail_path FROM item_media WHERE item_id = ? AND is_cover = 1 LIMIT 1').get(id);
      if (cover) {
        db.prepare('UPDATE items SET file_path = ?, thumbnail_path = ?, updated_at = ? WHERE id = ?').run(cover.file_path, cover.thumbnail_path, now, id);
      }
    } catch (e) {
      console.error('Sync cover to items failed:', e);
    }

    res.json({ success: true });
  } catch (error) {
    console.error('Update media order error:', error);
    res.status(500).json({ error: { code: 'DATABASE_ERROR', message: '排序保存失败' } });
  }
});


// Add medias from temp files (convert and store)
router.post('/:id/media-from-temp', async (req, res) => {
  try {
    const { id } = req.params;
    const { tempIds } = req.body || {};
    if (!Array.isArray(tempIds) || tempIds.length === 0) {
      return res.status(400).json({ error: { code: 'NO_TEMP_IDS', message: '没有临时文件' } });
    }
    const item = db.prepare('SELECT id FROM items WHERE id = ?').get(id);
    if (!item) return res.status(404).json({ error: { code: 'ITEM_NOT_FOUND', message: '数据不存在' } });

    const now = new Date().toISOString();
    const inserted = [];

    for (const tempId of tempIds) {
      try {
        if (!tempId || /[\\/]/.test(tempId)) continue;
        const p = path.join(TEMP_DIR, tempId);
        if (!fs.existsSync(p)) continue;
        const processed = await processAndStoreImage(p);
        const sort = getCurrentMediaCount(id);
        const stmt = db.prepare('INSERT INTO item_media (item_id, file_path, thumbnail_path, width, height, mime, size, sort_order, is_cover, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
        const result = stmt.run(id, processed.file_path, processed.thumbnail_path, processed.width, processed.height, processed.mime, processed.size, sort, 0, now, now);
        inserted.push({ tempId, id: result.lastInsertRowid });
      } catch (e) { console.error('Add from temp failed:', e); }
    }

    // Ensure cover exists and sync to items
    try {
      const hasCover = db.prepare('SELECT 1 FROM item_media WHERE item_id = ? AND is_cover = 1 LIMIT 1').get(id);
      if (!hasCover) {
        const cover = db.prepare('SELECT id, file_path, thumbnail_path FROM item_media WHERE item_id = ? ORDER BY sort_order ASC, id ASC LIMIT 1').get(id);
        if (cover) {
          db.prepare('UPDATE item_media SET is_cover = 1 WHERE id = ?').run(cover.id);
          db.prepare('UPDATE items SET file_path = ?, thumbnail_path = ?, updated_at = ? WHERE id = ?').run(cover.file_path, cover.thumbnail_path, now, id);
        }
      }
    } catch (e) { console.error('Ensure cover after temp import failed:', e); }

    return res.json({ success: true, data: inserted });
  } catch (error) {
    console.error('Media from temp error:', error);
    return res.status(500).json({ error: { code: 'DATABASE_ERROR', message: '导入失败' } });
  }
});

module.exports = router;


