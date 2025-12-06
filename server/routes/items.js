const express = require('express');
const multer = require('multer');
const sharp = require('sharp');
const ffmpeg = require('fluent-ffmpeg');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const Database = require('better-sqlite3');
const { authenticateToken } = require('./auth');
const { updateTagUsageCount } = require('./tags');
const router = express.Router();

router.use(authenticateToken);

const DB_FILE = process.env.DB_FILE || path.join(process.env.DATA_DIR || './data', 'app.sqlite');
const db = new Database(DB_FILE);
try { db.pragma('journal_mode = WAL'); db.pragma('synchronous = NORMAL'); db.pragma('busy_timeout = 5000'); db.pragma('foreign_keys = ON'); } catch (_) {}

const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(process.env.DATA_DIR || './data', 'uploads');
const THUMBNAIL_DIR = path.join(UPLOAD_DIR, 'thumbnails');
const TEMP_DIR = path.join(UPLOAD_DIR, 'tmp');
[ TEMP_DIR ].forEach(dir => { if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true }); });
const LOG_DIR = path.join(process.env.DATA_DIR || './data', 'logs');

[UPLOAD_DIR, THUMBNAIL_DIR].forEach(dir => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
});
if (!fs.existsSync(LOG_DIR)) {
  try { fs.mkdirSync(LOG_DIR, { recursive: true }); } catch (_) {}
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `${uuidv4()}${ext}`);
  }
});
// Restrict single-file upload to videos only (image uploads use items-media routes)
const videoFileFilter = (req, file, cb) => {
  if (file && typeof file.mimetype === 'string' && file.mimetype.startsWith('video/')) return cb(null, true);
  const err = new Error('只支持上传视频文件');
  err.code = 'FILE_TYPE_NOT_ALLOWED_VIDEO';
  return cb(err, false);
};

const uploadVideoOnly = multer({
  storage,
  fileFilter: videoFileFilter,
  limits: { fileSize: parseInt(process.env.MAX_VIDEO_SIZE) || 100 * 1024 * 1024 }
});

const generateThumbnail = async (filePath, filename, contentType) => {
  try {
    if (contentType.startsWith('image/')) {
      const thumbnailFilename = `thumb_${path.parse(filename).name}.webp`;
      const thumbnailPath = path.join(THUMBNAIL_DIR, thumbnailFilename);
      await sharp(filePath)
        .resize(parseInt(process.env.THUMBNAIL_WIDTH) || 400, null, { withoutEnlargement: true, fit: 'inside' })
        .webp({ quality: 80 })
        .toFile(thumbnailPath);
      return thumbnailFilename;
    } else if (contentType.startsWith('video/')) {
      // Extract a frame at 1s for video thumbnail; fallback to 0.1 if short
      const base = `thumb_${path.parse(filename).name}`;
      const outName = `${base}.jpg`;
      const outPath = path.join(THUMBNAIL_DIR, outName);
      await new Promise((resolve) => {
        try {
          ffmpeg(filePath)
            .on('end', resolve)
            .on('error', (err) => { console.error('FFmpeg thumbnail error:', err); resolve(); })
            .screenshots({ count: 1, timemarks: ['1'], filename: outName, folder: THUMBNAIL_DIR, size: `${parseInt(process.env.THUMBNAIL_WIDTH) || 400}x?` });
        } catch (e) { console.error('FFmpeg not available:', e); resolve(); }
      });
      // If jpg created, optionally convert to webp for consistency
      try {
        if (fs.existsSync(outPath)) {
          const webpName = `${base}.webp`;
          const webpPath = path.join(THUMBNAIL_DIR, webpName);
          await sharp(outPath).webp({ quality: 80 }).toFile(webpPath);
          try { fs.unlinkSync(outPath); } catch (_) {}
          return webpName;
        }
      } catch (e) { console.error('Video thumbnail post-process error:', e); }
      return null;
    }
    return null;
  } catch (error) {
    console.error('Generate thumbnail error:', error);
    return null;
  }
};

// Normalize content_type to top-level category
function normalizeContentType(t) {
  if (!t) return null;
  const low = String(t).toLowerCase();
  if (low.startsWith('text')) return 'text';
  if (low.startsWith('image')) return 'image';
  if (low.startsWith('video')) return 'video';
  return low;
}

// --- Video processing helpers (transcode + resize + retry) ---
function logTranscode(message) {
  try {
    const line = `[${new Date().toISOString()}] ${message}
`;
    fs.appendFileSync(path.join(LOG_DIR, 'transcode.log'), line);
  } catch (_) {}
}

function ffprobeMeta(filePath) {
  return new Promise((resolve) => {
    try {
      ffmpeg.ffprobe(filePath, (err, data) => {
        if (err) { resolve({}); return; }
        const v = (data && data.streams || []).find(s => s.codec_type === 'video') || {};
        const tags = v.tags || {};
        const rotate = Number(tags.rotate || v.rotate || 0) || 0;
        resolve({ width: v.width, height: v.height, rotate, codec_name: v.codec_name });
      });
    } catch (e) { resolve({}); }
  });
}

async function processVideoToStandard(inputPath) {
  const meta = await ffprobeMeta(inputPath);
  const rawW = Number(meta.width) || 0;
  const rawH = Number(meta.height) || 0;
  // If we can't detect a valid video stream, treat as unsupported format
  if (!rawW || !rawH) {
    const e = new Error('Unsupported or unreadable video format');
    e.code = 'VIDEO_FORMAT_NOT_SUPPORTED';
    throw e;
  }
  const rotate = Number(meta.rotate) || 0;

  // Adjust orientation by rotate tag
  const isRotated = Math.abs(rotate) === 90 || Math.abs(rotate) === 270;
  const width = isRotated ? rawH : rawW;
  const height = isRotated ? rawW : rawH;
  const landscape = width >= height;

  const targetW = parseInt(process.env.VIDEO_TARGET_WIDTH_LANDSCAPE || '640', 10);
  const targetH = parseInt(process.env.VIDEO_TARGET_HEIGHT_PORTRAIT || '720', 10);

  // Build scale filter; don't upscale
  let vf = [];
  if (landscape) {
    if (width > targetW) vf.push(`scale=${targetW}:-2`); // -2 keeps even dimension
  } else {
    if (height > targetH) vf.push(`scale=-2:${targetH}`);
  }
  vf.push('setsar=1');

  const outName = `v_${uuidv4()}.mp4`;
  const outPath = path.join(UPLOAD_DIR, outName);

  const preset = (process.env.VIDEO_PRESET || 'veryfast');
  const crf = String(process.env.VIDEO_CRF || 24);

  async function runOnce() {
    return new Promise((resolve, reject) => {
      try {
        let cmd = ffmpeg(inputPath)
          .videoCodec('libx264')
          .audioCodec('aac')
          .outputOptions(['-movflags', '+faststart', '-pix_fmt', 'yuv420p', '-preset', preset, '-crf', crf])
          .on('end', () => resolve())
          .on('error', (err) => reject(err));
        if (vf.length > 0) cmd = cmd.videoFilters(vf.join(','));
        cmd.save(outPath);
      } catch (e) { reject(e); }
    });
  }

  function isUnsupportedError(err) {
    const msg = String(err && err.message || '').toLowerCase();
    return (
      msg.includes('invalid data found') ||
      msg.includes('unknown format') ||
      msg.includes('unsupported codec') ||
      msg.includes('could not find codec parameters') ||
      msg.includes('moov atom not found') ||
      msg.includes('decoder') && msg.includes('not found') ||
      msg.includes('not a valid')
    );
  }

  // retry up to 3 times with backoff
  const maxRetry = 3;
  for (let i = 1; i <= maxRetry; i++) {
    try {
      await runOnce();
      break;
    } catch (e) {
      // If it's an unsupported format error, don't retry, bubble up a specific code
      if (isUnsupportedError(e)) {
        const ex = new Error('Unsupported video format');
        ex.code = 'VIDEO_FORMAT_NOT_SUPPORTED';
        throw ex;
      }
      logTranscode(`Transcode failed (attempt ${i}/${maxRetry}) for ${path.basename(inputPath)}: ${e && e.message || e}`);
      // Clean partial output if exists
      try { if (fs.existsSync(outPath)) fs.unlinkSync(outPath); } catch (_) {}
      if (i === maxRetry) throw e;
      await new Promise(r => setTimeout(r, 300 * i));
    }
  }

  let size = 0;
  try { size = fs.statSync(outPath).size; } catch (_) {}
  return { outName, outPath, size };
}

const getAllDescendantFolderIds = (startFolderId) => {
    const stmt = db.prepare(`
        WITH RECURSIVE folder_tree(id) AS (
            SELECT id FROM folders WHERE id = ?
            UNION ALL
            SELECT f.id FROM folders f
            JOIN folder_tree ft ON f.parent_id = ft.id
        )
        SELECT id FROM folder_tree;
    `);
    const rows = stmt.all(startFolderId);
    return rows.map(row => row.id);
};


router.get('/', async (req, res) => {
  try {
    const { q, folder_id, tag_id, is_favorite, content_type, sort = 'updated_at', order = 'desc', page = 1, page_size = 50 } = req.query;

    // --- DEBUG 1: Log a clear separator for each request ---
    console.log('\n==================================================');
    console.log(`[DEBUG] New GET /api/items request received at ${new Date().toISOString()}`);
    // --- DEBUG 2: Log the incoming folder_id ---
    console.log(`[DEBUG] Received folder_id: ${folder_id}`);

    let query = `
      SELECT DISTINCT i.id, i.title, i.content, i.content_type, i.file_path, 
             i.file_name, i.file_size, i.thumbnail_path, i.folder_id, 
             i.is_favorite, i.created_at, i.updated_at
      FROM items i
    `;
    
    let conditions = [];
    let params = [];

    if (tag_id) {
      query += ` LEFT JOIN item_tags it ON i.id = it.item_id`;
    }

    query += ` WHERE 1=1`;

    if (q && q.trim()) {
      conditions.push(`(i.title LIKE ? OR i.content LIKE ?)`);
      const searchTerm = `%${q.trim()}%`;
      params.push(searchTerm, searchTerm);
    }

    if (folder_id) {
        const folderIds = getAllDescendantFolderIds(folder_id);
        // --- DEBUG 3: Log the result of the recursive query ---
        console.log(`[DEBUG] Descendant folder IDs found: [${folderIds.join(', ')}]`);

        if (folderIds.length > 0) {
            const placeholders = folderIds.map(() => '?').join(',');
            conditions.push(`i.folder_id IN (${placeholders})`);
            params.push(...folderIds);
        } else {
            conditions.push('1=0');
        }
    }

    if (tag_id) {
      conditions.push(`it.tag_id = ?`);
      params.push(tag_id);
    }
    if (content_type) {
      const map = { text: 'text%', image: 'image%', video: 'video%' };
      const like = map[content_type];
      if (like) {
        conditions.push(`i.content_type LIKE ?`);
        params.push(like);
      }
    }

    if (is_favorite !== undefined) {
      conditions.push(`i.is_favorite = ?`);
      params.push(parseInt(is_favorite));
    }

    if (conditions.length > 0) {
      query += ` AND ${conditions.join(' AND ')}`;
    }

    const allowedSorts = ['created_at', 'updated_at', 'title'];
    const finalSort = allowedSorts.includes(sort) ? sort : 'updated_at';
    const finalOrder = ['asc', 'desc'].includes(order.toLowerCase()) ? order.toLowerCase() : 'desc';
    query += ` ORDER BY i.${finalSort} ${finalOrder.toUpperCase()}`;

    // --- DEBUG 4: Log the final query and params before pagination ---
    console.log(`[DEBUG] Final SQL Query (before pagination): ${query}`);
    console.log(`[DEBUG] Params (before pagination): ${JSON.stringify(params)}`);

    const limit = Math.min(parseInt(page_size), 100);
    const offset = (parseInt(page) - 1) * limit;
    query += ` LIMIT ? OFFSET ?`;
    params.push(limit, offset);

    const items = db.prepare(query).all(params);

    const itemsWithTags = items.map(item => {
      const tags = db.prepare(`
        SELECT t.id, t.name, t.color FROM tags t 
        INNER JOIN item_tags it ON t.id = it.tag_id 
        WHERE it.item_id = ? ORDER BY it.rowid ASC
      `).all(item.id);
      return { ...item, tags };
    });

    let countQuery = `SELECT COUNT(DISTINCT i.id) as total FROM items i`;
    if (tag_id) countQuery += ` LEFT JOIN item_tags it ON i.id = it.item_id`;
    countQuery += ` WHERE 1=1`;
    if (conditions.length > 0) countQuery += ` AND ${conditions.join(' AND ')}`;
    const countParams = params.slice(0, -2);
    const totalResult = db.prepare(countQuery).get(countParams);

    res.json({
      success: true,
      data: {
        items: itemsWithTags,
        total: totalResult.total,
        page: parseInt(page),
        page_size: limit,
        total_pages: Math.ceil(totalResult.total / limit)
      }
    });

  } catch (error) {
    console.error('Get items error:', error);
    res.status(500).json({ error: { code: 'DATABASE_ERROR', message: '获取内容失败' } });
  }
});

router.get('/:id', (req, res) => {
  try {
    const { id } = req.params;
    const item = db.prepare(`SELECT * FROM items WHERE id = ?`).get(id);
    if (!item) {
      return res.status(404).json({ error: { code: 'ITEM_NOT_FOUND', message: '内容不存在' } });
    }
    const tags = db.prepare(`
      SELECT t.id, t.name, t.color FROM tags t 
      INNER JOIN item_tags it ON t.id = it.tag_id 
      WHERE it.item_id = ? ORDER BY it.rowid ASC
    `).all(id);

    // Also return medias for image items so editor can render saved images
    const medias = db.prepare(`
      SELECT id, file_path, thumbnail_path, width, height, mime, size, sort_order, is_cover
      FROM item_media 
      WHERE item_id = ? 
      ORDER BY sort_order ASC, id ASC
    `).all(id);

    res.json({ success: true, data: { ...item, tags, medias } });
  } catch (error) {
    console.error('Get item error:', error);
    res.status(500).json({ error: { code: 'DATABASE_ERROR', message: '获取内容失败' } });
  }
});

router.post('/upload', (req, res) => {
  uploadVideoOnly.single('file')(req, res, async (err) => {
    if (err) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(413).json({ error: { code: 'FILE_TOO_LARGE_VIDEO', message: '视频大小超过限制（≤100MB）' } });
      }
      // 来自 fileFilter 的错误
      if (err.code === 'FILE_TYPE_NOT_ALLOWED_VIDEO') {
        return res.status(415).json({ error: { code: 'FILE_TYPE_NOT_ALLOWED_VIDEO', message: '只支持上传视频文件' } });
      }
      return res.status(400).json({ error: { code: 'UPLOAD_ERROR', message: err.message || '文件上传失败' } });
    }
    try {
      if (!req.file) {
        return res.status(400).json({ error: { code: 'NO_FILE', message: '未选择文件' } });
      }
      const { title, content, folder_id, tag_ids, is_favorite } = req.body;
      const file = req.file;

      // Transcode + resize with retry; output mp4; then generate thumbnail from processed file
      let processed;
      try {
        processed = await processVideoToStandard(file.path);
      } catch (e) {
        logTranscode(`Final failure for file ${file.filename}: ${e && e.message || e}`);
        if (e && e.code === 'VIDEO_FORMAT_NOT_SUPPORTED') {
          return res.status(415).json({ error: { code: 'VIDEO_FORMAT_NOT_SUPPORTED', message: '视频格式不支持，请转换为 MP4（H.264）后再上传' } });
        }
        return res.status(500).json({ error: { code: 'UPLOAD_ERROR', message: '文件上传失败' } });
      }

      const thumbnailPath = await generateThumbnail(processed.outPath, processed.outName, 'video/mp4');
      const now = new Date().toISOString();

      const result = db.prepare(`
        INSERT INTO items (title, content, content_type, file_path, file_name, file_size, thumbnail_path, folder_id, is_favorite, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        title || '',
        content || '',
        'video',
        processed.outName,
        file.originalname,
        processed.size,
        thumbnailPath,
        folder_id || null,
        is_favorite ? 1 : 0,
        now, now
      );

      // remove original uploaded file to save space
      try { if (file.path && fs.existsSync(file.path)) fs.unlinkSync(file.path); } catch (_) {}

      const itemId = result.lastInsertRowid;
      if (tag_ids && Array.isArray(tag_ids)) {
        const insertTag = db.prepare('INSERT INTO item_tags (item_id, tag_id) VALUES (?, ?)');
        tag_ids.forEach(tagId => { if (tagId) insertTag.run(itemId, tagId); });
        updateTagUsageCount(tag_ids);
      }

      const newItem = db.prepare(`SELECT * FROM items WHERE id = ?`).get(itemId);
      res.status(201).json({ success: true, data: newItem });
    } catch (error) {
      if (req.file) try { fs.unlinkSync(req.file.path); } catch (e) { console.error('File cleanup error:', e); }
      console.error('Upload error:', error);
      res.status(500).json({ error: { code: 'UPLOAD_ERROR', message: '文件上传失败' } });
    }
  });
});

router.post('/', (req, res) => {
  try {
    const { title, content, folder_id, tag_ids, is_favorite, content_type } = req.body;
    if (!title || !title.trim()) return res.status(400).json({ error: { code: 'INVALID_TITLE', message: '标题不能为空' } });
    if (!content || !content.trim()) return res.status(400).json({ error: { code: 'INVALID_CONTENT', message: '内容不能为空' } });

    const now = new Date().toISOString();
    const result = db.prepare(`
      INSERT INTO items (title, content, content_type, folder_id, is_favorite, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      title.trim(),
      content.trim(),
      normalizeContentType(content_type) || 'text',
      folder_id || null,
      is_favorite ? 1 : 0,
      now, now
    );

    const itemId = result.lastInsertRowid;
    if (tag_ids && tag_ids.length > 0) {
      const insertTag = db.prepare('INSERT INTO item_tags (item_id, tag_id) VALUES (?, ?)');
      tag_ids.forEach(tagId => { if (tagId) insertTag.run(itemId, tagId); });
      updateTagUsageCount(tag_ids);
    }

    const newItem = db.prepare(`SELECT * FROM items WHERE id = ?`).get(itemId);
    const tags = db.prepare(`SELECT t.id, t.name, t.color FROM tags t INNER JOIN item_tags it ON t.id = it.tag_id WHERE it.item_id = ? ORDER BY t.name`).all(itemId);
    res.status(201).json({ success: true, data: { ...newItem, tags } });

  } catch (error) {
    console.error('Create item error:', error);
    res.status(500).json({ error: { code: 'DATABASE_ERROR', message: '创建内容失败' } });
  }
});

router.put('/:id', (req, res) => {
  try {
    const { id } = req.params;
    const { title, content, folder_id, tag_ids, is_favorite, content_type } = req.body;

    if (!db.prepare('SELECT id FROM items WHERE id = ?').get(id)) {
      return res.status(404).json({ error: { code: 'ITEM_NOT_FOUND', message: '内容不存在' } });
    }
    if (!title || !title.trim()) {
      return res.status(400).json({ error: { code: 'INVALID_TITLE', message: '标题不能为空' } });
    }

    const now = new Date().toISOString();
    db.prepare(`
      UPDATE items
      SET title = ?, content = ?, folder_id = ?, is_favorite = ?, updated_at = ?, content_type = ?
      WHERE id = ?
    `).run(title.trim(), content || '', folder_id || null, is_favorite ? 1 : 0, now, normalizeContentType(content_type), id);

    if (tag_ids && Array.isArray(tag_ids)) {
    const oldTagRows = db.prepare('SELECT tag_id FROM item_tags WHERE item_id = ?').all(id) || [];
    const oldTagIds = oldTagRows.map(r => r.tag_id);
      db.prepare('DELETE FROM item_tags WHERE item_id = ?').run(id);
      if (tag_ids.length > 0) {
        const insertTagStmt = db.prepare('INSERT INTO item_tags (item_id, tag_id) VALUES (?, ?)');
        tag_ids.forEach(tagId => { if (tagId) insertTagStmt.run(id, tagId); });
      }
        updateTagUsageCount([...oldTagIds, ...(tag_ids || [])]);
    }

    const updatedItem = db.prepare(`SELECT * FROM items WHERE id = ?`).get(id);
    const tags = db.prepare(`SELECT t.id, t.name, t.color FROM tags t INNER JOIN item_tags it ON t.id = it.tag_id WHERE it.item_id = ? ORDER BY t.name`).all(id);
    res.json({ success: true, data: { ...updatedItem, tags } });

  } catch (error) {
    console.error('Update item error:', error);
    res.status(500).json({ error: { code: 'DATABASE_ERROR', message: '更新内容失败' } });
  }
});

router.post('/:id/favorite', (req, res) => {
  try {
    const { id } = req.params;
    const item = db.prepare('SELECT is_favorite FROM items WHERE id = ?').get(id);
    if (!item) {
      return res.status(404).json({ error: { code: 'ITEM_NOT_FOUND', message: '内容不存在' } });
    }
    const newFavoriteStatus = item.is_favorite ? 0 : 1;
    db.prepare('UPDATE items SET is_favorite = ?, updated_at = ? WHERE id = ?').run(newFavoriteStatus, new Date().toISOString(), id);
    res.json({ success: true, data: { is_favorite: newFavoriteStatus } });
  } catch (error) {
    console.error('Toggle favorite error:', error);
    res.status(500).json({ error: { code: 'DATABASE_ERROR', message: '切换收藏状态失败' } });
  }
});

// 删除条目下的视频（仅媒体，不删条目）
router.delete('/:id/video', (req, res) => {
  try {
    const { id } = req.params;
    const item = db.prepare('SELECT id, file_path, thumbnail_path FROM items WHERE id = ?').get(id);
    if (!item) return res.status(404).json({ error: { code: 'ITEM_NOT_FOUND', message: '内容不存在' } });

    const now = new Date().toISOString();
    db.prepare('UPDATE items SET file_path = NULL, thumbnail_path = NULL, updated_at = ? WHERE id = ?').run(now, id);

    // Delete files on disk (best effort)
    try { if (item.file_path) fs.unlinkSync(path.join(UPLOAD_DIR, item.file_path)); } catch (_) {}
    try { if (item.thumbnail_path) fs.unlinkSync(path.join(THUMBNAIL_DIR, item.thumbnail_path)); } catch (_) {}

    const updated = db.prepare('SELECT * FROM items WHERE id = ?').get(id);
    res.json({ success: true, data: updated });
  } catch (error) {
    console.error('Delete video error:', error);
    res.status(500).json({ error: { code: 'DATABASE_ERROR', message: '删除视频失败' } });
  }
});

// 替换条目下的视频（仅媒体），支持同时更新部分字段
router.post('/:id/video', (req, res) => {
  uploadVideoOnly.single('file')(req, res, async (err) => {
    if (err) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(413).json({ error: { code: 'FILE_TOO_LARGE_VIDEO', message: '视频大小超过限制（≤100MB）' } });
      }
      if (err.code === 'FILE_TYPE_NOT_ALLOWED_VIDEO') {
        return res.status(415).json({ error: { code: 'FILE_TYPE_NOT_ALLOWED_VIDEO', message: '只支持上传视频文件' } });
      }
      return res.status(400).json({ error: { code: 'UPLOAD_ERROR', message: err.message || '文件上传失败' } });
    }
    try {
      const { id } = req.params;
      const item = db.prepare('SELECT id, file_path, thumbnail_path FROM items WHERE id = ?').get(id);
      if (!item) return res.status(404).json({ error: { code: 'ITEM_NOT_FOUND', message: '内容不存在' } });
      if (!req.file) return res.status(400).json({ error: { code: 'NO_FILE', message: '未选择文件' } });

      const file = req.file;
      let processed;
      try {
        processed = await processVideoToStandard(file.path);
      } catch (e) {
        logTranscode(`Replace failure for item ${id}, file ${file.filename}: ${e && e.message || e}`);
        if (e && e.code === 'VIDEO_FORMAT_NOT_SUPPORTED') {
          return res.status(415).json({ error: { code: 'VIDEO_FORMAT_NOT_SUPPORTED', message: '视频格式不支持，请转换为 MP4（H.264）后再上传' } });
        }
        return res.status(500).json({ error: { code: 'UPLOAD_ERROR', message: '文件上传失败' } });
      }

      // New thumbnail from processed file
      const thumbnailPath = await generateThumbnail(processed.outPath, processed.outName, 'video/mp4');
      const now = new Date().toISOString();

      // Optional metadata updates
      const { title, content, folder_id, tag_ids, is_favorite } = req.body || {};
      const hasTitle = typeof title === 'string' && title.trim();
      const hasContent = typeof content === 'string';
      const hasFolder = typeof folder_id !== 'undefined';
      const hasFav = typeof is_favorite !== 'undefined';

      let sql = 'UPDATE items SET file_path = ?, file_name = ?, file_size = ?, thumbnail_path = ?, content_type = ?, updated_at = ?';
      const params = [processed.outName, file.originalname, processed.size, thumbnailPath, 'video', now];
      if (hasTitle) { sql += ', title = ?'; params.push(title.trim()); }
      if (hasContent) { sql += ', content = ?'; params.push(content); }
      if (hasFolder) { sql += ', folder_id = ?'; params.push(folder_id || null); }
      if (hasFav) { sql += ', is_favorite = ?'; params.push(is_favorite ? 1 : 0); }
      sql += ' WHERE id = ?'; params.push(id);
      db.prepare(sql).run(params);

      // Update tags if provided
      if (tag_ids && Array.isArray(tag_ids)) {
        const oldTagRows = db.prepare('SELECT tag_id FROM item_tags WHERE item_id = ?').all(id) || [];
        const oldTagIds = oldTagRows.map(r => r.tag_id);
        db.prepare('DELETE FROM item_tags WHERE item_id = ?').run(id);
        if (tag_ids.length > 0) {
          const insertTagStmt = db.prepare('INSERT INTO item_tags (item_id, tag_id) VALUES (?, ?)');
          tag_ids.forEach(tagId => { if (tagId) insertTagStmt.run(id, tagId); });
        }
        updateTagUsageCount([...oldTagIds, ...(tag_ids || [])]);
      }

      // Delete old files and temp upload
      try { if (item.file_path) fs.unlinkSync(path.join(UPLOAD_DIR, item.file_path)); } catch (_) {}
      try { if (item.thumbnail_path) fs.unlinkSync(path.join(THUMBNAIL_DIR, item.thumbnail_path)); } catch (_) {}
      try { if (file.path && fs.existsSync(file.path)) fs.unlinkSync(file.path); } catch (_) {}

      const updated = db.prepare('SELECT * FROM items WHERE id = ?').get(id);
      res.json({ success: true, data: updated });
    } catch (error) {
      console.error('Replace video error:', error);
      return res.status(500).json({ error: { code: 'UPLOAD_ERROR', message: '文件上传失败' } });
    }
  });
});

// 删除条目（同时清理文件与媒体）
router.delete('/:id', (req, res) => {
  try {
    const { id } = req.params;
    const item = db.prepare('SELECT id, file_path, thumbnail_path FROM items WHERE id = ?').get(id);
    if (!item) return res.status(404).json({ error: { code: 'ITEM_NOT_FOUND', message: '内容不存在' } });

    // Collect item_media files before deletion
    let medias = [];
    try {
      medias = db.prepare('SELECT file_path, thumbnail_path FROM item_media WHERE item_id = ?').all(id) || [];
    } catch (_) {}

    // Capture related tag ids for usage_count update
    const oldTagRows = db.prepare('SELECT tag_id FROM item_tags WHERE item_id = ?').all(id) || [];
    const oldTagIds = oldTagRows.map(r => r.tag_id);
    const tx = db.transaction(() => {
      db.prepare('DELETE FROM item_tags WHERE item_id = ?').run(id);
      db.prepare('DELETE FROM item_media WHERE item_id = ?').run(id);
      db.prepare('DELETE FROM items WHERE id = ?').run(id);
    });
    tx();

    // Delete files on disk (best effort)
    try { if (item.file_path) fs.unlinkSync(path.join(UPLOAD_DIR, item.file_path)); } catch (_) {}
    try { if (item.thumbnail_path) fs.unlinkSync(path.join(THUMBNAIL_DIR, item.thumbnail_path)); } catch (_) {}
    for (const m of medias) {
      try { if (m.file_path) fs.unlinkSync(path.join(UPLOAD_DIR, m.file_path)); } catch (_) {}
      try { if (m.thumbnail_path) fs.unlinkSync(path.join(THUMBNAIL_DIR, m.thumbnail_path)); } catch (_) {}
    }
    updateTagUsageCount(oldTagIds);

    res.json({ success: true });
  } catch (error) {
    console.error('Delete item error:', error);
    res.status(500).json({ error: { code: 'DATABASE_ERROR', message: '删除内容失败' } });
  }
});


// Create video item from temp file
router.post('/upload-from-temp', async (req, res) => {
  try {
    const { tempId, title, content, folder_id, tag_ids, is_favorite } = req.body || {};
    if (!tempId || /[\\/]/.test(tempId)) {
      return res.status(400).json({ error: { code: 'NO_FILE', message: '未选择文件' } });
    }
    const tempPath = path.join(TEMP_DIR, tempId);
    if (!fs.existsSync(tempPath)) {
      return res.status(400).json({ error: { code: 'NO_FILE', message: '未选择文件' } });
    }

    let processed;
    try {
      processed = await processVideoToStandard(tempPath);
    } catch (e) {
      if (e && e.code === 'VIDEO_FORMAT_NOT_SUPPORTED') {
        return res.status(415).json({ error: { code: 'VIDEO_FORMAT_NOT_SUPPORTED', message: '视频格式不支持，请转成 MP4(H.264)' } });
      }
      return res.status(500).json({ error: { code: 'UPLOAD_ERROR', message: '文件处理失败' } });
    }

    const thumbnailPath = await generateThumbnail(processed.outPath, processed.outName, 'video/mp4');
    const now = new Date().toISOString();

    const result = db.prepare(`
      INSERT INTO items (title, content, content_type, file_path, file_name, file_size, thumbnail_path, folder_id, is_favorite, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      title || '',
      content || '',
      'video',
      processed.outName,
      tempId, // keep original name reference in file_name field
      processed.size,
      thumbnailPath,
      folder_id || null,
      is_favorite ? 1 : 0,
      now, now
    );

    try { fs.unlinkSync(tempPath); } catch (_) {}

    const itemId = result.lastInsertRowid;
    if (tag_ids && Array.isArray(tag_ids)) {
      const insertTag = db.prepare('INSERT INTO item_tags (item_id, tag_id) VALUES (?, ?)');
      tag_ids.forEach(tagId => { if (tagId) insertTag.run(itemId, tagId); });
      updateTagUsageCount(tag_ids);
    }

    const newItem = db.prepare(`SELECT * FROM items WHERE id = ?`).get(itemId);
    res.status(201).json({ success: true, data: newItem });
  } catch (error) {
    console.error('Upload from temp error:', error);
    res.status(500).json({ error: { code: 'UPLOAD_ERROR', message: '文件处理失败' } });
  }
});

// Replace video from temp and optionally update fields
router.post('/:id/video-from-temp', async (req, res) => {
  try {
    const { id } = req.params;
    const { tempId, title, content, folder_id, tag_ids, is_favorite } = req.body || {};
    const item = db.prepare('SELECT id, file_path, thumbnail_path FROM items WHERE id = ?').get(id);
    if (!item) return res.status(404).json({ error: { code: 'ITEM_NOT_FOUND', message: '数据不存在' } });
    if (!tempId || /[\\/]/.test(tempId)) return res.status(400).json({ error: { code: 'NO_FILE', message: '未选择文件' } });

    const tempPath = path.join(TEMP_DIR, tempId);
    if (!fs.existsSync(tempPath)) return res.status(400).json({ error: { code: 'NO_FILE', message: '未选择文件' } });

    let processed;
    try {
      processed = await processVideoToStandard(tempPath);
    } catch (e) {
      if (e && e.code === 'VIDEO_FORMAT_NOT_SUPPORTED') {
        return res.status(415).json({ error: { code: 'VIDEO_FORMAT_NOT_SUPPORTED', message: '视频格式不支持，请转成 MP4(H.264)' } });
      }
      return res.status(500).json({ error: { code: 'UPLOAD_ERROR', message: '文件处理失败' } });
    }

    const thumbnailPath = await generateThumbnail(processed.outPath, processed.outName, 'video/mp4');
    const now = new Date().toISOString();

    let sql = 'UPDATE items SET file_path = ?, file_name = ?, file_size = ?, thumbnail_path = ?, content_type = ?, updated_at = ?';
    const params = [processed.outName, tempId, processed.size, thumbnailPath, 'video', now];
    if (typeof title === 'string' && title.trim()) { sql += ', title = ?'; params.push(title.trim()); }
    if (typeof content === 'string') { sql += ', content = ?'; params.push(content); }
    if (typeof folder_id !== 'undefined') { sql += ', folder_id = ?'; params.push(folder_id || null); }
    if (typeof is_favorite !== 'undefined') { sql += ', is_favorite = ?'; params.push(is_favorite ? 1 : 0); }
    sql += ' WHERE id = ?'; params.push(id);
    db.prepare(sql).run(params);

    if (tag_ids && Array.isArray(tag_ids)) {
      const oldTagRows = db.prepare('SELECT tag_id FROM item_tags WHERE item_id = ?').all(id) || [];
      const oldTagIds = oldTagRows.map(r => r.tag_id);
      db.prepare('DELETE FROM item_tags WHERE item_id = ?').run(id);
      if (tag_ids.length > 0) {
        const insertTagStmt = db.prepare('INSERT INTO item_tags (item_id, tag_id) VALUES (?, ?)');
        tag_ids.forEach(tagId => { if (tagId) insertTagStmt.run(id, tagId); });
      }
      updateTagUsageCount([...oldTagIds, ...(tag_ids || [])]);
    }

    try { if (item.file_path) fs.unlinkSync(path.join(UPLOAD_DIR, item.file_path)); } catch (_) {}
    try { if (item.thumbnail_path) fs.unlinkSync(path.join(THUMBNAIL_DIR, item.thumbnail_path)); } catch (_) {}
    try { fs.unlinkSync(tempPath); } catch (_) {}

    const updated = db.prepare('SELECT * FROM items WHERE id = ?').get(id);
    res.json({ success: true, data: updated });
  } catch (error) {
    console.error('Replace from temp error:', error);
    return res.status(500).json({ error: { code: 'UPLOAD_ERROR', message: '文件处理失败' } });
  }
});

module.exports = router;














