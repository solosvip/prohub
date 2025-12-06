const express = require('express');
const Database = require('better-sqlite3');
const path = require('path');
const { authenticateToken } = require('./auth');
const router = express.Router();

// 使用认证中间件
router.use(authenticateToken);

// 初始化数据库连接
const DB_FILE = process.env.DB_FILE || path.join(process.env.DATA_DIR || './data', 'app.sqlite');
const db = new Database(DB_FILE);

// 高级搜索
router.get('/', (req, res) => {
  try {
    const {
      q,
      content_type,
      folder_id,
      tag_ids,
      is_favorite,
      sort = 'updated_at',
      order = 'desc',
      page = 1,
      page_size = 50
    } = req.query;

    let query = `
      SELECT DISTINCT i.id, i.title, i.content, i.content_type, i.file_path, 
             i.file_name, i.file_size, i.thumbnail_path, i.folder_id, 
             i.is_favorite, i.created_at, i.updated_at
      FROM items i
    `;
    
    let conditions = [];
    let params = [];
    let joins = [];

    // 全文搜索
    if (q && q.trim()) {
      joins.push(`LEFT JOIN items_fts fts ON i.id = fts.rowid`);
      conditions.push(`fts MATCH ?`);
      params.push(q.trim());
    }

    // 标签搜索
    if (tag_ids) {
      const tagIdsArray = Array.isArray(tag_ids) ? tag_ids : [tag_ids];
      if (tagIdsArray.length > 0) {
        joins.push(`LEFT JOIN item_tags it ON i.id = it.item_id`);
        const placeholders = tagIdsArray.map(() => '?').join(',');
        conditions.push(`it.tag_id IN (${placeholders})`);
        params.push(...tagIdsArray);
      }
    }

    // 添加 JOIN 子句
    if (joins.length > 0) {
      query += ` ${joins.join(' ')}`;
    }

    query += ` WHERE 1=1`;

    // 内容类型过滤
    if (content_type) {
      conditions.push(`i.content_type = ?`);
      params.push(content_type);
    }

    // 文件夹过滤
    if (folder_id) {
      conditions.push(`i.folder_id = ?`);
      params.push(folder_id);
    }

    // 收藏状态过滤
    if (is_favorite !== undefined) {
      conditions.push(`i.is_favorite = ?`);
      params.push(parseInt(is_favorite));
    }

    if (conditions.length > 0) {
      query += ` AND ${conditions.join(' AND ')}`;
    }

    // 排序
    const allowedSorts = ['created_at', 'updated_at', 'title'];
    const allowedOrders = ['asc', 'desc'];
    const finalSort = allowedSorts.includes(sort) ? sort : 'updated_at';
    const finalOrder = allowedOrders.includes(order.toLowerCase()) ? order.toLowerCase() : 'desc';
    
    // 如果是全文搜索，按相关度排序
    if (q && q.trim()) {
      query += ` ORDER BY bm25(fts), i.${finalSort} ${finalOrder.toUpperCase()}`;
    } else {
      query += ` ORDER BY i.${finalSort} ${finalOrder.toUpperCase()}`;
    }

    // 分页
    const limit = Math.min(parseInt(page_size), 100);
    const offset = (parseInt(page) - 1) * limit;
    query += ` LIMIT ? OFFSET ?`;
    params.push(limit, offset);

    const items = db.prepare(query).all(params);

    // 获取每个项目的标签
    const itemsWithTags = items.map(item => {
      const tags = db.prepare(`
        SELECT t.id, t.name, t.color 
        FROM tags t 
        INNER JOIN item_tags it ON t.id = it.tag_id 
        WHERE it.item_id = ?
        ORDER BY t.name
      `).all(item.id);

      return { ...item, tags };
    });

    // 获取总数
    let countQuery = `SELECT COUNT(DISTINCT i.id) as total FROM items i`;
    if (joins.length > 0) {
      countQuery += ` ${joins.join(' ')}`;
    }
    countQuery += ` WHERE 1=1`;
    
    if (conditions.length > 0) {
      countQuery += ` AND ${conditions.join(' AND ')}`;
    }
    
    const countParams = params.slice(0, -2); // 移除 limit 和 offset 参数
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
    console.error('Search error:', error);
    res.status(500).json({
      error: { code: 'SEARCH_ERROR', message: '搜索失败' }
    });
  }
});

// 搜索建议
router.get('/suggestions', (req, res) => {
  try {
    const { q } = req.query;

    if (!q || q.trim().length < 2) {
      return res.json({
        success: true,
        data: []
      });
    }

    const searchTerm = `%${q.trim()}%`;
    
    // 搜索标题建议
    const titleSuggestions = db.prepare(`
      SELECT DISTINCT title as suggestion, 'title' as type
      FROM items 
      WHERE title LIKE ? 
      ORDER BY updated_at DESC 
      LIMIT 5
    `).all(searchTerm);

    // 搜索标签建议
    const tagSuggestions = db.prepare(`
      SELECT DISTINCT name as suggestion, 'tag' as type
      FROM tags 
      WHERE name LIKE ? 
      ORDER BY usage_count DESC 
      LIMIT 5
    `).all(searchTerm);

    const suggestions = [...titleSuggestions, ...tagSuggestions];

    res.json({
      success: true,
      data: suggestions
    });

  } catch (error) {
    console.error('Search suggestions error:', error);
    res.status(500).json({
      error: { code: 'SEARCH_ERROR', message: '获取搜索建议失败' }
    });
  }
});

module.exports = router;