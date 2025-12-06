const express = require('express');
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');
const { authenticateToken } = require('./auth');
const router = express.Router();

// 使用认证中间件
router.use(authenticateToken);

const DB_FILE = process.env.DB_FILE || path.join(process.env.DATA_DIR || './data', 'app.sqlite');
const db = new Database(DB_FILE);

const formatDate = (date) => date.toISOString().split('T')[0];

const getDaysAgo = (days) => {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return formatDate(date);
};

router.get('/all', (req, res) => {
  try {
    // 1. Overview Stats (formerly GET /)
    const overview = db.prepare(`
      SELECT
        (SELECT COUNT(*) FROM items) as total_items,
        (SELECT COUNT(*) FROM items WHERE is_favorite = 1) as favorite_items,
        (SELECT COUNT(*) FROM folders) as total_folders,
        (SELECT COUNT(*) FROM tags) as total_tags,
        (SELECT COUNT(*) FROM shares) as total_shares
    `).get();
    // 统一把具体格式归并为三类: text/image/video
    const rawTypes = db.prepare(`SELECT content_type FROM items`).all();
    const bucket = { text: 0, image: 0, video: 0 };
    rawTypes.forEach(r => {
      const t = String(r.content_type || '').toLowerCase();
      if (t.startsWith('text')) bucket.text++;
      else if (t.startsWith('image')) bucket.image++;
      else if (t.startsWith('video')) bucket.video++;
    });
    const contentTypes = [
      { content_type: 'text', count: bucket.text },
      { content_type: 'image', count: bucket.image },
      { content_type: 'video', count: bucket.video }
    ];

    // 2. Timeline Stats (formerly GET /timeline)
    const timelineDays = 30;
    const content_trend = db.prepare(`
        SELECT DATE(created_at) as period, COUNT(*) as items_created
        FROM items
        WHERE created_at >= datetime('now', '-${timelineDays} days')
        GROUP BY DATE(created_at)
        ORDER BY period DESC
    `).all();

    // 3. Storage Stats (formerly GET /storage)
    const storageOverview = db.prepare(`
      SELECT
        SUM(CASE WHEN file_size IS NOT NULL THEN file_size ELSE 0 END) as total_file_size
      FROM items
    `).get();

    // 4. Tags Stats (formerly GET /tags)
    const tagsUsage = db.prepare(`
        SELECT t.id, t.name, t.color, t.usage_count
        FROM tags t
        WHERE t.usage_count > 0
        ORDER BY t.usage_count DESC
        LIMIT 12
    `).all();

    const finalData = {
      success: true,
      data: {
        overview: overview,
        content_types: contentTypes,
        timeline: {
          content_trend: content_trend
        },
        storage: {
          overview: storageOverview
        },
        tags: {
          usage_stats: tagsUsage
        }
      }
    };

    res.json(finalData);

  } catch (error) {
    console.error('Get all stats error:', error);
    res.status(500).json({
      error: { code: 'DATABASE_ERROR', message: '获取所有统计数据失败' }
    });
  }
});

module.exports = router;

