const express = require('express');
const crypto = require('crypto');
const path = require('path');
const Database = require('better-sqlite3');
const { authenticateToken } = require('./auth');
const router = express.Router();

// 使用认证中间件
router.use(authenticateToken);

// 初始化数据库连接
const DB_FILE = process.env.DB_FILE || path.join(process.env.DATA_DIR || './data', 'app.sqlite');
const db = new Database(DB_FILE);

// Lightweight migration to ensure new columns exist on older databases.
function ensureShareColumns() {
  try {
    const cols = db.pragma("table_info(shares)");
    const hasSegmentsJson = cols.some(c => c.name === 'segments_json');
    const hasSegmentsSnapshot = cols.some(c => c.name === 'segments_snapshot');
    if (!hasSegmentsJson) {
      db.exec("ALTER TABLE shares ADD COLUMN segments_json TEXT");
    }
    if (!hasSegmentsSnapshot) {
      db.exec("ALTER TABLE shares ADD COLUMN segments_snapshot TEXT");
    }
  } catch (e) {
    // If the table doesn't exist yet, initDb script will create it.
    // Avoid crashing the server route; only log for visibility.
    try { console.warn('shares.js: ensureShareColumns warning:', e && e.message || e); } catch(_) {}
  }
}
ensureShareColumns();

// 生成唯一的分享key
const generateShareKey = () => {
  const bytes = crypto.randomBytes(8);
  return bytes.toString('hex').toUpperCase();
};

// 获取我的分享列表
router.get('/', (req, res) => {
  try {
    const { page = 1, page_size = 20, is_active, item_id } = req.query;

    let query = `
      SELECT s.id, s.share_key, s.item_id, s.title, s.description,
             s.is_active, s.expires_at, s.view_count, s.created_at, s.updated_at,
             (s.password IS NOT NULL) AS has_password,
             i.title as item_title, i.content_type as item_type
      FROM shares s
      INNER JOIN items i ON s.item_id = i.id
    `;

    let conditions = [];
    let params = [];

    query += ` WHERE 1=1`;

    // 按激活状态过滤
    if (is_active !== undefined) {
      conditions.push(`s.is_active = ?`);
      params.push(parseInt(is_active));
    }

    if (item_id !== undefined) {
      conditions.push(`s.item_id = ?`);
      params.push(parseInt(item_id));
    }

    if (conditions.length > 0) {
      query += ` AND ${conditions.join(' AND ')}`;
    }

    // 排序：最新创建的在前
    query += ` ORDER BY s.created_at DESC`;

    // 分页
    const limit = Math.min(parseInt(page_size), 100);
    const offset = (parseInt(page) - 1) * limit;
    query += ` LIMIT ? OFFSET ?`;
    params.push(limit, offset);

    const shares = db.prepare(query).all(params);

    // 获取总数
    let countQuery = `SELECT COUNT(*) as total FROM shares s WHERE 1=1`;
    const countParams = [];
    if (is_active !== undefined) {
      countQuery += ` AND s.is_active = ?`;
      countParams.push(parseInt(is_active));
    }
    if (item_id !== undefined) {
      countQuery += ` AND s.item_id = ?`;
      countParams.push(parseInt(item_id));
    }
    const totalResult = db.prepare(countQuery).get(countParams);

    res.json({
      success: true,
      data: {
        shares,
        total: totalResult.total,
        page: parseInt(page),
        page_size: limit,
        total_pages: Math.ceil(totalResult.total / limit)
      }
    });

  } catch (error) {
    console.error('Get shares error:', error);
    res.status(500).json({
      error: { code: 'DATABASE_ERROR', message: '获取分享列表失败' }
    });
  }
});

// 获取单个分享详情
router.get('/:id', (req, res) => {
  try {
    const { id } = req.params;

    const share = db.prepare(`
      SELECT s.*,
             i.title as item_title, i.content as item_content,
             i.content_type as item_type, i.file_path, i.file_name,
             i.thumbnail_path, i.created_at as item_created_at
      FROM shares s
      INNER JOIN items i ON s.item_id = i.id
      WHERE s.id = ?
    `).get(id);

    if (!share) {
      return res.status(404).json({
        error: { code: 'SHARE_NOT_FOUND', message: '分享不存在' }
      });
    }

    // 获取内容的标签
    const tags = db.prepare(`
      SELECT t.id, t.name, t.color
      FROM tags t
      INNER JOIN item_tags it ON t.id = it.tag_id
      WHERE it.item_id = ?
      ORDER BY t.name
    `).all(share.item_id);

    res.json({
      success: true,
      data: { ...share, tags }
    });

  } catch (error) {
    console.error('Get share error:', error);
    res.status(500).json({
      error: { code: 'DATABASE_ERROR', message: '获取分享详情失败' }
    });
  }
});

// 创建分享链接
router.post('/', (req, res) => {
  try {
    const { item_id, title, description, password, expires_at, segment_indices } = req.body;

    if (!item_id) {
      return res.status(400).json({
        error: { code: 'INVALID_ITEM_ID', message: '内容ID不能为空' }
      });
    }

    // 验证内容是否存在
    const item = db.prepare('SELECT id, title, content, content_type FROM items WHERE id = ?').get(item_id);
    if (!item) {
      return res.status(404).json({
        error: { code: 'ITEM_NOT_FOUND', message: '内容不存在' }
      });
    }

    // 生成唯一的分享key
    let shareKey;
    let existingShare;
    do {
      shareKey = generateShareKey();
      existingShare = db.prepare('SELECT id FROM shares WHERE share_key = ?').get(shareKey);
    } while (existingShare);

    const now = new Date().toISOString();

    // 验证过期时间
    let expiryTime = null;
    if (expires_at) {
      const expiryDate = new Date(expires_at);
      if (isNaN(expiryDate.getTime())) {
        return res.status(400).json({
          error: { code: 'INVALID_EXPIRY', message: '过期时间格式无效' }
        });
      }
      if (expiryDate.getTime() <= Date.now()) {
        return res.status(400).json({
          error: { code: 'EXPIRY_IN_PAST', message: '过期时间不能早于当前时间' }
        });
      }
      expiryTime = expiryDate.toISOString();
    }

    // Build segments selection and snapshot for stable share content
    let indices = [];
    let snapshot = [];
    try {
      const segments = JSON.parse(item.content || '[]');
      if (Array.isArray(segments) && segments.length > 0) {
        if (Array.isArray(segment_indices) && segment_indices.length > 0) {
          // sanitize indices (unique, in range, ascending by original order)
          const max = segments.length - 1;
          const uniq = Array.from(new Set(segment_indices.map(n => parseInt(n)).filter(n => !isNaN(n) && n >= 0 && n <= max)));
          indices = uniq;
        } else {
          indices = segments.map((_, i) => i);
        }
        // At least one segment required
        if (indices.length === 0) {
          return res.status(400).json({ error: { code: 'NO_SEGMENT_SELECTED', message: '至少选择一个提示词片段' } });
        }
        snapshot = indices.map(i => ({ title: segments[i]?.title || '', content: segments[i]?.content || '' }));
      } else {
        // No structured segments: fallback to single segment from raw content
        if (Array.isArray(segment_indices) && segment_indices.length > 0) {
          // ignore invalid indices, treat as single segment content
        }
        indices = [0];
        snapshot = [{ title: item.title || '', content: item.content || '' }];
      }
    } catch (_) {
      // content not JSON, snapshot as single segment
      indices = [0];
      snapshot = [{ title: item.title || '', content: item.content || '' }];
    }

    const insertShare = db.prepare(`
      INSERT INTO shares (share_key, item_id, title, description, password,
                         is_active, expires_at, view_count, created_at, updated_at,
                         segments_json, segments_snapshot)
      VALUES (?, ?, ?, ?, ?, 1, ?, 0, ?, ?, ?, ?)
    `);

    const result = insertShare.run(
      shareKey,
      item_id,
      title || item.title,
      description || '',
      password || null,
      expiryTime,
      now,
      now,
      JSON.stringify(indices),
      JSON.stringify(snapshot)
    );

    // 获取创建的分享
    const newShare = db.prepare(`
      SELECT id, share_key, item_id, title, description, is_active,
             expires_at, view_count, created_at, updated_at,
             segments_json, segments_snapshot
      FROM shares WHERE id = ?
    `).get(result.lastInsertRowid);

    res.status(201).json({
      success: true,
      data: newShare
    });

  } catch (error) {
    console.error('Create share error:', error);
    res.status(500).json({
      error: { code: 'DATABASE_ERROR', message: '创建分享失败' }
    });
  }
});

// 更新分享信息
router.put('/:id', (req, res) => {
  try {
    const { id } = req.params;
    const { title, description, password, expires_at, is_active, segment_indices } = req.body;

    // 验证分享是否存在
    const existingShare = db.prepare('SELECT id FROM shares WHERE id = ?').get(id);
    if (!existingShare) {
      return res.status(404).json({
        error: { code: 'SHARE_NOT_FOUND', message: '分享不存在' }
      });
    }

    // 验证过期时间
    let expiryTime = null;
    if (expires_at !== undefined) {
      if (expires_at === null) {
        expiryTime = null;
      } else {
        const expiryDate = new Date(expires_at);
        if (isNaN(expiryDate.getTime())) {
          return res.status(400).json({
            error: { code: 'INVALID_EXPIRY', message: '过期时间格式无效' }
          });
        }
        if (expiryDate.getTime() <= Date.now()) {
          return res.status(400).json({
            error: { code: 'EXPIRY_IN_PAST', message: '过期时间不能早于当前时间' }
          });
        }
        expiryTime = expiryDate.toISOString();
      }
    }

    const now = new Date().toISOString();

    // If segment_indices provided, rebuild snapshot
    let updatedSegmentsJson;
    let updatedSnapshot;
    if (segment_indices !== undefined) {
      const item = db.prepare('SELECT id, title, content FROM items WHERE id = (SELECT item_id FROM shares WHERE id = ?)').get(id);
      if (item) {
        try {
          const segments = JSON.parse(item.content || '[]');
          if (Array.isArray(segments) && segments.length > 0) {
            const max = segments.length - 1;
            const uniq = Array.isArray(segment_indices) ? Array.from(new Set(segment_indices.map(n => parseInt(n)).filter(n => !isNaN(n) && n >= 0 && n <= max))) : [];
            const indices = (uniq.length > 0) ? uniq : segments.map((_, i) => i);
            if (indices.length === 0) {
              return res.status(400).json({ error: { code: 'NO_SEGMENT_SELECTED', message: '至少选择一个提示词片段' } });
            }
            updatedSegmentsJson = JSON.stringify(indices);
            updatedSnapshot = JSON.stringify(indices.map(i => ({ title: segments[i]?.title || '', content: segments[i]?.content || '' })));
          } else {
            updatedSegmentsJson = JSON.stringify([0]);
            updatedSnapshot = JSON.stringify([{ title: item.title || '', content: item.content || '' }]);
          }
        } catch (_) {
          updatedSegmentsJson = JSON.stringify([0]);
          updatedSnapshot = JSON.stringify([{ title: item.title || '', content: item.content || '' }]);
        }
      }
    }

    const updateShare = db.prepare(`
      UPDATE shares
      SET title = ?, description = ?, password = ?, expires_at = ?,
          is_active = ?, updated_at = ?,
          segments_json = COALESCE(?, segments_json),
          segments_snapshot = COALESCE(?, segments_snapshot)
      WHERE id = ?
    `);

    updateShare.run(
      title !== undefined ? title : db.prepare('SELECT title FROM shares WHERE id = ?').get(id).title,
      description !== undefined ? description : db.prepare('SELECT description FROM shares WHERE id = ?').get(id).description,
      password !== undefined ? password : db.prepare('SELECT password FROM shares WHERE id = ?').get(id).password,
      expiryTime !== undefined ? expiryTime : db.prepare('SELECT expires_at FROM shares WHERE id = ?').get(id).expires_at,
      is_active !== undefined ? (is_active ? 1 : 0) : db.prepare('SELECT is_active FROM shares WHERE id = ?').get(id).is_active,
      now,
      updatedSegmentsJson,
      updatedSnapshot,
      id
    );

    // 获取更新后的分享
    const updatedShare = db.prepare(`
      SELECT id, share_key, item_id, title, description, is_active,
             expires_at, view_count, created_at, updated_at,
             segments_json, segments_snapshot
      FROM shares WHERE id = ?
    `).get(id);

    res.json({
      success: true,
      data: updatedShare
    });

  } catch (error) {
    console.error('Update share error:', error);
    res.status(500).json({
      error: { code: 'DATABASE_ERROR', message: '更新分享失败' }
    });
  }
});

// 删除分享
router.delete('/:id', (req, res) => {
  try {
    const { id } = req.params;

    // 验证分享是否存在
    const existingShare = db.prepare('SELECT id FROM shares WHERE id = ?').get(id);
    if (!existingShare) {
      return res.status(404).json({
        error: { code: 'SHARE_NOT_FOUND', message: '分享不存在' }
      });
    }

    // 删除分享（级联删除会自动处理）
    db.prepare('DELETE FROM shares WHERE id = ?').run(id);

    res.json({
      success: true,
      message: '分享已删除'
    });

  } catch (error) {
    console.error('Delete share error:', error);
    res.status(500).json({
      error: { code: 'DATABASE_ERROR', message: '删除分享失败' }
    });
  }
});

// 切换分享状态（启用/禁用）
router.post('/:id/toggle', (req, res) => {
  try {
    const { id } = req.params;

    const share = db.prepare('SELECT is_active FROM shares WHERE id = ?').get(id);
    if (!share) {
      return res.status(404).json({
        error: { code: 'SHARE_NOT_FOUND', message: '分享不存在' }
      });
    }

    const newStatus = share.is_active ? 0 : 1;
    const now = new Date().toISOString();

    db.prepare('UPDATE shares SET is_active = ?, updated_at = ? WHERE id = ?')
      .run(newStatus, now, id);

    res.json({
      success: true,
      data: { is_active: newStatus }
    });

  } catch (error) {
    console.error('Toggle share status error:', error);
    res.status(500).json({
      error: { code: 'DATABASE_ERROR', message: '切换分享状态失败' }
    });
  }
});

// 获取分享统计信息
router.get('/stats/overview', (req, res) => {
  try {
    const stats = db.prepare(`
      SELECT
        COUNT(*) as total_shares,
        COUNT(CASE WHEN is_active = 1 THEN 1 END) as active_shares,
        COUNT(CASE WHEN expires_at IS NOT NULL AND datetime(expires_at) < datetime('now') THEN 1 END) as expired_shares,
        SUM(view_count) as total_views,
        COUNT(CASE WHEN created_at >= datetime('now', '-7 days') THEN 1 END) as created_this_week,
        COUNT(CASE WHEN created_at >= datetime('now', '-30 days') THEN 1 END) as created_this_month
      FROM shares
    `).get();

    // 获取最近7天的分享创建趋势
    const trend = db.prepare(`
      SELECT
        DATE(created_at) as date,
        COUNT(*) as shares_created
      FROM shares
      WHERE created_at >= datetime('now', '-7 days')
      GROUP BY DATE(created_at)
      ORDER BY date DESC
    `).all();

    // 获取最受欢迎的分享
    const popular = db.prepare(`
      SELECT
        s.id, s.share_key, s.title, s.view_count,
        i.title as item_title, i.content_type
      FROM shares s
      INNER JOIN items i ON s.item_id = i.id
      WHERE s.is_active = 1
      ORDER BY s.view_count DESC
      LIMIT 5
    `).all();

    res.json({
      success: true,
      data: {
        overview: stats,
        trend,
        popular
      }
    });

  } catch (error) {
    console.error('Get share stats error:', error);
    res.status(500).json({
      error: { code: 'DATABASE_ERROR', message: '获取分享统计失败' }
    });
  }
});

module.exports = router;
