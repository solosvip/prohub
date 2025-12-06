const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const path = require('path');
const fs = require('fs');
require('dotenv').config({ path: require('path').join(__dirname, '.env') });

const app = express();
const PORT = process.env.PORT || 3000;

// 确保数据目录存在
const DATA_DIR = (() => { const raw = process.env.DATA_DIR || './data'; return require('path').isAbsolute(raw) ? raw : require('path').join(__dirname, raw); })();
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

const UPLOAD_DIR = (() => { const raw = process.env.UPLOAD_DIR || path.join(DATA_DIR, 'uploads'); return path.isAbsolute(raw) ? raw : path.join(__dirname, raw); })();
if (!fs.existsSync(UPLOAD_DIR)) { fs.mkdirSync(UPLOAD_DIR, { recursive: true }); }
const THUMB_DIR = path.join(UPLOAD_DIR, 'thumbnails');
const TEMP_DIR = path.join(UPLOAD_DIR, 'tmp');
[THUMB_DIR, TEMP_DIR].forEach(d => { if (!fs.existsSync(d)) { try { fs.mkdirSync(d, { recursive: true }); } catch(_){} } });

// 中间件
app.use(helmet({
  crossOriginResourcePolicy: { policy: "cross-origin" }
}));
app.use(cors());
app.use(morgan('combined'));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// 静态文件服务 - 上传的文件
app.use('/uploads', express.static(UPLOAD_DIR));

// API 路由
app.use('/api/auth', require('./routes/auth'));
app.use('/api/folders', require('./routes/folders'));
app.use('/api/tags', require('./routes/tags'));
app.use('/api/items', require('./routes/items'));
app.use('/api/items', require('./routes/items-media'));
app.use('/api/preview', require('./routes/preview'));
app.use('/api/search', require('./routes/search'));
// 分享系统路由
app.use('/api/shares', require('./routes/shares'));
// 分享页（SSR HTML，用于对外与SEO）
app.use('/s', require('./routes/share-html'));
// 统计分析路由
app.use('/api/stats', require('./routes/stats'));
// 数据导出
app.use('/api/export', require('./routes/export'));

// 公开分享路由 (无需认证)
app.use('/share', require('./routes/public-share'));

// 生产环境下服务前端静态文件
if (process.env.NODE_ENV === 'production') {
  const clientBuildPath = path.join(__dirname, '../client/dist');
  app.use(express.static(clientBuildPath));
  
  // 处理 React Router 的客户端路由
  app.get('*', (req, res) => {
    if (req.path.startsWith('/api/') || req.path.startsWith('/uploads/') || req.path.startsWith('/share/')) {
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'API endpoint not found' } });
    }
    res.sendFile(path.join(clientBuildPath, 'index.html'));
  });
}

// 全局错误处理
app.use((err, req, res, next) => {
  console.error('Error:', err);
  
  if (err.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({
      error: {
        code: 'FILE_TOO_LARGE',
        message: '文件大小超出限制'
      }
    });
  }
  
  res.status(500).json({
    error: {
      code: 'INTERNAL_ERROR',
      message: process.env.NODE_ENV === 'development' ? err.message : '内部服务器错误'
    }
  });
});

// 404 处理
app.use((req, res) => {
  res.status(404).json({
    error: {
      code: 'NOT_FOUND',
      message: '请求的资源不存在'
    }
  });
});

app.listen(PORT, () => {
  console.log(`🚀 服务器运行在端口 ${PORT}`);
  console.log(`📁 数据目录: ${DATA_DIR}`);
  console.log(`📁 上传目录: ${UPLOAD_DIR}`);
  console.log(`🌍 环境: ${process.env.NODE_ENV || 'development'}`);
});


