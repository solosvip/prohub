const express = require('express');
const path = require('path');
const Database = require('better-sqlite3');
const router = express.Router();

// 初始化数据库连接
const DB_FILE = process.env.DB_FILE || path.join(process.env.DATA_DIR || './data', 'app.sqlite');
const db = new Database(DB_FILE);


// Ensure new share columns exist for older DBs
function ensureShareColumns() {
  try {
    const cols = db.pragma('table_info(shares)');
    const hasSegmentsJson = cols.some(c => c.name === 'segments_json');
    const hasSegmentsSnapshot = cols.some(c => c.name === 'segments_snapshot');
    if (!hasSegmentsJson) { db.exec('ALTER TABLE shares ADD COLUMN segments_json TEXT'); }
    if (!hasSegmentsSnapshot) { db.exec('ALTER TABLE shares ADD COLUMN segments_snapshot TEXT'); }
  } catch (e) {
    try { console.warn('public-share.js: ensureShareColumns warning:', (e && e.message) || e); } catch(_) {}
  }
}
ensureShareColumns();

// 密码比较函数（支持明文和bcrypt）
const comparePassword = async (inputPassword, storedPassword) => {
  if (!storedPassword) {
    return true; // 无密码保护的分享
  }

  if (storedPassword.startsWith('$2b$') || storedPassword.startsWith('$2a$')) {
    // bcrypt密码
    try {
      const bcrypt = require('bcrypt');
      return await bcrypt.compare(inputPassword, storedPassword);
    } catch (error) {
      console.error('Bcrypt comparison error:', error);
      return false;
    }
  } else {
    // 明文密码
    return inputPassword === storedPassword;
  }
};

// 验证分享是否有效
const validateShare = (share) => {
  if (!share) {
    return { valid: false, error: { code: 'SHARE_NOT_FOUND', message: '分享不存在' } };
  }

  if (!share.is_active) {
    return { valid: false, error: { code: 'SHARE_INACTIVE', message: '分享已被禁用' } };
  }

  if (share.expires_at) {
    const expiryDate = new Date(share.expires_at);
    if (expiryDate.getTime() <= Date.now()) {
      return { valid: false, error: { code: 'SHARE_EXPIRED', message: '分享已过期' } };
    }
  }

  return { valid: true };
};

// 获取分享详细信息（包括内容）
router.get('/:shareKey', async (req, res) => {
  try {
    const { shareKey } = req.params;
    const { password } = req.query;

    // 查找分享信息
    const share = db.prepare(`
      SELECT s.*,
             i.title as item_title, i.content as item_content,
             i.content_type as item_type, i.file_path, i.file_name,
             i.file_size, i.thumbnail_path, i.folder_id,
             i.created_at as item_created_at, i.updated_at as item_updated_at
      FROM shares s
      INNER JOIN items i ON s.item_id = i.id
      WHERE s.share_key = ?
    `).get(shareKey);

    // 验证分享有效性
    const validation = validateShare(share);
    if (!validation.valid) {
      return res.status(404).json(validation.error);
    }

    // 检查密码保护
    if (share.password) {
      if (!password) {
        return res.status(401).json({
          error: { code: 'PASSWORD_REQUIRED', message: '需要输入密码' },
          need_password: true
        });
      }

      const passwordValid = await comparePassword(password, share.password);
      if (!passwordValid) {
        return res.status(401).json({
          error: { code: 'INVALID_PASSWORD', message: '密码错误' },
          need_password: true
        });
      }
    }


    // Always display latest text segments from item content (ignore stored snapshot)
    let selectedSegments = [];
    try {
      const segs = JSON.parse(share.item_content || '[]');
      if (Array.isArray(segs) && segs.length > 0) {
        selectedSegments = segs.map(s => ({ title: s.title || '', content: s.content || '' }));
      } else {
        selectedSegments = [{ title: share.item_title || '', content: share.item_content || '' }];
      }
    } catch (_) {
      selectedSegments = [{ title: share.item_title || '', content: share.item_content || '' }];
    }

    
    
    
    // Compose text content from selected segments for text-type
    let composedText = '';
    if (String(share.item_type || '').startsWith('text')) {
      const NL = String.fromCharCode(10);
      composedText = selectedSegments
        .map(s => (s.title ? [s.title, (s.content || '')].join(NL) : (s.content || '')))
        .join(NL + NL)
        .trim();
    }

    // 获取标签信息



    const tags = db.prepare(`
      SELECT t.id, t.name, t.color
      FROM tags t
      INNER JOIN item_tags it ON t.id = it.tag_id
      WHERE it.item_id = ?
      ORDER BY t.name
    `).all(share.item_id);

    // 获取文件夹信息
    let folder = null;
    if (share.folder_id) {
      folder = db.prepare('SELECT id, name FROM folders WHERE id = ?').get(share.folder_id);
    }

    // 增加访问次数
    db.prepare('UPDATE shares SET view_count = view_count + 1 WHERE id = ?')
      .run(share.id);

    // 返回分享内容（隐藏敏感信息）
    const response = {
      success: true,
      data: {
        share_info: {
          title: share.title || share.item_title,
          description: share.description,
          created_at: share.created_at,
          expires_at: share.expires_at,
          view_count: share.view_count + 1, // 包含本次访问
          has_password: !!share.password
        },
        item: {
          title: share.item_title,
          content: composedText || share.item_content,
          content_type: share.item_type,
          file_name: share.file_name,
          file_size: share.file_size,
          thumbnail_path: share.thumbnail_path,
          created_at: share.item_created_at,
          updated_at: share.item_updated_at
        },
        tags,
        segments: selectedSegments,
        folder
      }
    };

    res.json(response);

  } catch (error) {
    console.error('Get share content error:', error);
    res.status(500).json({
      error: { code: 'INTERNAL_ERROR', message: '获取分享内容失败' }
    });
  }
});

// 验证分享密码
router.post('/:shareKey/verify', async (req, res) => {
  try {
    const { shareKey } = req.params;
    const { password } = req.body;

    if (!password) {
      return res.status(400).json({
        error: { code: 'PASSWORD_REQUIRED', message: '密码不能为空' }
      });
    }

    // 查找分享信息
    const share = db.prepare(`
      SELECT id, password, is_active, expires_at
      FROM shares
      WHERE share_key = ?
    `).get(shareKey);

    // 验证分享有效性
    const validation = validateShare(share);
    if (!validation.valid) {
      return res.status(404).json(validation.error);
    }

    // 验证密码
    const passwordValid = await comparePassword(password, share.password);
    if (!passwordValid) {
      return res.status(401).json({
        error: { code: 'INVALID_PASSWORD', message: '密码错误' }
      });
    }

    res.json({
      success: true,
      message: '密码验证成功'
    });

  } catch (error) {
    console.error('Verify share password error:', error);
    res.status(500).json({
      error: { code: 'INTERNAL_ERROR', message: '密码验证失败' }
    });
  }
});

// 获取分享基本信息（不包含内容）
router.get('/:shareKey/info', (req, res) => {
  try {
    const { shareKey } = req.params;

    const share = db.prepare(`
      SELECT s.id, s.title, s.description, s.created_at, s.expires_at,
             s.view_count, s.password IS NOT NULL AS has_password,
             i.content_type as item_type, i.file_name,
             i.created_at as item_created_at, i.id as item_id
      FROM shares s
      INNER JOIN items i ON s.item_id = i.id
      WHERE s.share_key = ?
    `).get(shareKey);

    const validation = validateShare(share);
    if (!validation.valid) {
      return res.status(404).json(validation.error);
    }

    const tags = db.prepare(`
      SELECT t.id, t.name, t.color
      FROM tags t
      INNER JOIN item_tags it ON t.id = it.tag_id
      WHERE it.item_id = ?
      ORDER BY t.name
    `).all(share.item_id);

    res.json({
      success: true,
      data: {
        title: share.title,
        description: share.description,
        content_type: share.item_type,
        file_name: share.file_name,
        created_at: share.created_at,
        expires_at: share.expires_at,
        view_count: share.view_count,
        has_password: !!share.has_password,
        item_created_at: share.item_created_at,
        tags
      }
    });

  } catch (error) {
    console.error('Get share info error:', error);
    res.status(500).json({
      error: { code: 'INTERNAL_ERROR', message: '获取分享信息失败' }
    });
  }
});

// 记录分享访问（用于前端统计）
router.post('/:shareKey/view', (req, res) => {
  try {
    const { shareKey } = req.params;

    // 查找并验证分享
    const share = db.prepare(`
      SELECT id, is_active, expires_at
      FROM shares
      WHERE share_key = ?
    `).get(shareKey);

    const validation = validateShare(share);
    if (!validation.valid) {
      return res.status(404).json(validation.error);
    }

    // 增加访问次数
    db.prepare('UPDATE shares SET view_count = view_count + 1 WHERE id = ?')
      .run(share.id);

    // 获取更新后的访问次数
    const updatedShare = db.prepare('SELECT view_count FROM shares WHERE id = ?').get(share.id);

    res.json({
      success: true,
      data: {
        view_count: updatedShare.view_count
      }
    });

  } catch (error) {
    console.error('Record share view error:', error);
    res.status(500).json({
      error: { code: 'INTERNAL_ERROR', message: '记录访问失败' }
    });
  }
});

// 检查分享状态（用于前端验证）
router.get('/:shareKey/status', (req, res) => {
  try {
    const { shareKey } = req.params;

    // 查找分享状态
    const share = db.prepare(`
      SELECT id, is_active, expires_at, view_count, created_at
      FROM shares
      WHERE share_key = ?
    `).get(shareKey);

    const validation = validateShare(share);

    res.json({
      success: true,
      data: {
        valid: validation.valid,
        error: validation.valid ? null : validation.error,
        share_info: validation.valid ? {
          has_password: !!db.prepare('SELECT password FROM shares WHERE id = ?').get(share.id)?.password,
          view_count: share.view_count,
          created_at: share.created_at,
          expires_at: share.expires_at
        } : null
      }
    });

  } catch (error) {
    console.error('Check share status error:', error);
    res.status(500).json({
      error: { code: 'INTERNAL_ERROR', message: '检查分享状态失败' }
    });
  }
});

// 获取分享文件（用于文件下载）
router.get('/:shareKey/file/:filename', (req, res) => {
  try {
    const { shareKey, filename } = req.params;
    const { password } = req.query;

    // 查找分享信息
    const share = db.prepare(`
      SELECT s.*, i.file_path, i.file_name, i.content_type
      FROM shares s
      INNER JOIN items i ON s.item_id = i.id
      WHERE s.share_key = ? AND i.file_name = ?
    `).get(shareKey, filename);

    // 验证分享有效性
    const validation = validateShare(share);
    if (!validation.valid) {
      return res.status(404).json(validation.error);
    }

    // 检查密码保护
    if (share.password) {
      if (!password) {
        return res.status(401).json({
          error: { code: 'PASSWORD_REQUIRED', message: '需要输入密码' }
        });
      }

      comparePassword(password, share.password).then(passwordValid => {
        if (!passwordValid) {
          return res.status(401).json({
            error: { code: 'INVALID_PASSWORD', message: '密码错误' }
          });
        }

        // 发送文件
        sendFile(share, res);
      });
    } else {
      // 直接发送文件
      sendFile(share, res);
    }

  } catch (error) {
    console.error('Get share file error:', error);
    res.status(500).json({
      error: { code: 'INTERNAL_ERROR', message: '获取分享文件失败' }
    });
  }
});

// 发送文件的辅助函数
const sendFile = (share, res) => {
  try {
    const fs = require('fs');
    const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(process.env.DATA_DIR || './data', 'uploads');
    const filePath = path.join(UPLOAD_DIR, share.file_path);

    if (!fs.existsSync(filePath)) {
      return res.status(404).json({
        error: { code: 'FILE_NOT_FOUND', message: '文件不存在' }
      });
    }

    // 增加访问次数
    db.prepare('UPDATE shares SET view_count = view_count + 1 WHERE id = ?')
      .run(share.id);

    // 设置响应头
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(share.file_name)}"`);
    res.setHeader('Content-Type', getContentType(share.content_type));

    // 发送文件
    res.sendFile(filePath);
  } catch (error) {
    console.error('Send file error:', error);
    res.status(500).json({
      error: { code: 'FILE_SEND_ERROR', message: '发送文件失败' }
    });
  }
};

// 获取内容类型的MIME类型
const getContentType = (contentType) => {
  const mimeTypes = {
    'image/jpeg': 'image/jpeg',
    'image/jpg': 'image/jpeg',
    'image/png': 'image/png',
    'image/gif': 'image/gif',
    'image/webp': 'image/webp',
    'video/mp4': 'video/mp4',
    'video/avi': 'video/avi',
    'video/mov': 'video/quicktime',
    'video/quicktime': 'video/quicktime'
  };

  return mimeTypes[contentType] || 'application/octet-stream';
};

module.exports = router;
