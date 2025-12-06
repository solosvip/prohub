const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const { authenticateToken } = require('./auth');

const router = express.Router();
router.use(authenticateToken);

// Resolve dirs from env; fallback to server/data under this file
const ROOT_DATA = process.env.DATA_DIR || path.join(__dirname, '../data');
const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(ROOT_DATA, 'uploads');
const TEMP_DIR = path.join(UPLOAD_DIR, 'tmp');
const TTL_MIN = parseInt(process.env.TEMP_FILE_TTL_MINUTES || '30', 10) || 30; // minutes

// Ensure dirs exist
[ROOT_DATA, UPLOAD_DIR, TEMP_DIR].forEach(d => { try { if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true }); } catch (_) {} });

function cleanupExpired() {
  // Remove files older than TTL in tmp dir
  try {
    const now = Date.now();
    const maxAge = TTL_MIN * 60 * 1000;
    const files = fs.existsSync(TEMP_DIR) ? fs.readdirSync(TEMP_DIR) : [];
    for (const f of files) {
      const p = path.join(TEMP_DIR, f);
      try {
        const st = fs.statSync(p);
        if (st.isFile() && (now - st.mtimeMs) > maxAge) {
          try { fs.unlinkSync(p); } catch (_) {}
        }
      } catch (_) {}
    }
  } catch (e) {
    // best-effort; ignore
  }
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, TEMP_DIR),
  filename: (req, file, cb) => {
    const safeExt = path.extname(file.originalname || '').slice(0, 16) || '';
    cb(null, `${uuidv4()}${safeExt}`);
  }
});

const imageFilter = (req, file, cb) => {
  if (file && file.mimetype && file.mimetype.startsWith('image/')) return cb(null, true);
  const err = new Error('Only image files are allowed');
  err.code = 'FILE_TYPE_NOT_ALLOWED_IMAGE';
  return cb(err, false);
};

const videoFilter = (req, file, cb) => {
  if (file && file.mimetype && file.mimetype.startsWith('video/')) return cb(null, true);
  const err = new Error('Only video files are allowed');
  err.code = 'FILE_TYPE_NOT_ALLOWED_VIDEO';
  return cb(err, false);
};

const uploadImage = multer({ storage, fileFilter: imageFilter, limits: { fileSize: Number(process.env.MAX_IMAGE_SIZE) || 10 * 1024 * 1024 } });
const uploadVideo = multer({ storage, fileFilter: videoFilter, limits: { fileSize: Number(process.env.MAX_VIDEO_SIZE) || 100 * 1024 * 1024 } });

// Upload temp images (max 20) => returns array of { id, url, mime, size, name, created_at }
router.post('/image', (req, res) => {
  cleanupExpired();
  uploadImage.array('files', 20)(req, res, async (err) => {
    if (err) {
      if (err.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ error: { code: 'FILE_TOO_LARGE_IMAGE', message: '图片过大（≤10MB）' } });
      if (err.code === 'FILE_TYPE_NOT_ALLOWED_IMAGE') return res.status(415).json({ error: { code: 'FILE_TYPE_NOT_ALLOWED_IMAGE', message: '只允许上传图片' } });
      return res.status(400).json({ error: { code: 'UPLOAD_ERROR', message: err.message || '上传失败' } });
    }
    try {
      const files = req.files || [];
      if (files.length === 0) return res.status(400).json({ error: { code: 'NO_FILE', message: '未选择文件' } });
      const now = new Date().toISOString();
      const list = files.map(f => ({ id: f.filename, url: `/uploads/tmp/${f.filename}`, mime: f.mimetype, size: f.size, name: f.originalname, created_at: now }));
      res.json({ success: true, data: list });
    } catch (e) {
      return res.status(500).json({ error: { code: 'UPLOAD_ERROR', message: '上传失败' } });
    }
  });
});

// Upload temp video (single)
router.post('/video', (req, res) => {
  cleanupExpired();
  uploadVideo.single('file')(req, res, async (err) => {
    if (err) {
      if (err.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ error: { code: 'FILE_TOO_LARGE_VIDEO', message: '视频过大（≤100MB）' } });
      if (err.code === 'FILE_TYPE_NOT_ALLOWED_VIDEO') return res.status(415).json({ error: { code: 'FILE_TYPE_NOT_ALLOWED_VIDEO', message: '只允许上传视频' } });
      return res.status(400).json({ error: { code: 'UPLOAD_ERROR', message: err.message || '上传失败' } });
    }
    try {
      if (!req.file) return res.status(400).json({ error: { code: 'NO_FILE', message: '未选择文件' } });
      const now = new Date().toISOString();
      const f = req.file;
      res.json({ success: true, data: { id: f.filename, url: `/uploads/tmp/${f.filename}`, mime: f.mimetype, size: f.size, name: f.originalname, created_at: now } });
    } catch (e) {
      return res.status(500).json({ error: { code: 'UPLOAD_ERROR', message: '上传失败' } });
    }
  });
});

// Delete one temp file
router.delete('/:type/:id', (req, res) => {
  try {
    const { id } = req.params;
    if (!id || id.includes('/') || id.includes('..')) return res.status(400).json({ error: { code: 'INVALID_ID', message: '非法ID' } });
    const p = path.join(TEMP_DIR, id);
    if (fs.existsSync(p)) { try { fs.unlinkSync(p); } catch (_) {} }
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: { code: 'DELETE_ERROR', message: '删除失败' } });
  }
});

module.exports = router;
