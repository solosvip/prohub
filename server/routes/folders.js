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

// 获取所有文件夹（树形结构）
router.get('/', (req, res) => {
  try {
    const folders = db.prepare(`
      SELECT id, name, parent_id, type, created_at, updated_at 
      FROM folders 
      ORDER BY name ASC
    `).all();

    const buildFolderTree = (folders) => {
      const folderMap = {};
      const tree = [];

      folders.forEach(folder => {
        folderMap[folder.id] = { ...folder, children: [] };
      });

      folders.forEach(folder => {
        if (folder.parent_id) {
          if (folderMap[folder.parent_id]) {
            folderMap[folder.parent_id].children.push(folderMap[folder.id]);
          }
        } else {
          tree.push(folderMap[folder.id]);
        }
      });

      return tree;
    };

    const folderTree = buildFolderTree(folders);

    console.log('--- DEBUG: folderTree to be sent ---');
    console.log(JSON.stringify(folderTree, null, 2));
    console.log('--- END DEBUG ---');

    res.json({
      success: true,
      data: folderTree
    });
  } catch (error) {
    console.error('Get folders error:', error);
    res.status(500).json({
      error: { code: 'DATABASE_ERROR', message: '获取文件夹失败' }
    });
  }
});

// 创建文件夹
router.post('/', (req, res) => {
  try {
    const { name, parent_id } = req.body;

    if (!name || name.trim().length === 0) {
      return res.status(400).json({
        error: { code: 'INVALID_NAME', message: '文件夹名称不能为空' }
      });
    }

    let parentFolder = null;
    if (parent_id) {
      parentFolder = db.prepare('SELECT id, type FROM folders WHERE id = ?').get(parent_id);
      if (!parentFolder) {
        return res.status(400).json({
          error: { code: 'PARENT_NOT_FOUND', message: '父文件夹不存在' }
        });
      }
    } else {
        return res.status(403).json({
            error: { code: 'FORBIDDEN', message: '不允许创建新的顶层文件夹' }
        });
    }

    const folderType = parentFolder ? parentFolder.type : null;

    const existingFolder = db.prepare(`
      SELECT id FROM folders 
      WHERE name = ? AND parent_id = ?
    `).get(name.trim(), parent_id);

    if (existingFolder) {
      return res.status(400).json({
        error: { code: 'DUPLICATE_NAME', message: '文件夹名称已存在' }
      });
    }

    const now = new Date().toISOString();
    const result = db.prepare(`
      INSERT INTO folders (name, parent_id, type, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(name.trim(), parent_id, folderType, now, now);

    const newFolder = db.prepare(`
      SELECT id, name, parent_id, type, created_at, updated_at 
      FROM folders WHERE id = ?
    `).get(result.lastInsertRowid);

    res.status(201).json({
      success: true,
      data: newFolder
    });

  } catch (error) {
    console.error('Create folder error:', error);
    res.status(500).json({
      error: { code: 'DATABASE_ERROR', message: '创建文件夹失败' }
    });
  }
});

// 更新文件夹
router.put('/:id', (req, res) => {
  try {
    const { id } = req.params;
    const { name, parent_id } = req.body;

    if (!name || name.trim().length === 0) {
      return res.status(400).json({
        error: { code: 'INVALID_NAME', message: '文件夹名称不能为空' }
      });
    }

    const folder = db.prepare('SELECT * FROM folders WHERE id = ?').get(id);
    if (!folder) {
      return res.status(404).json({
        error: { code: 'FOLDER_NOT_FOUND', message: '文件夹不存在' }
      });
    }

    let newType = folder.type;
    if (parent_id && parent_id !== folder.parent_id) {
      const parentExists = db.prepare('SELECT id, type FROM folders WHERE id = ?').get(parent_id);
      if (!parentExists) {
        return res.status(400).json({
          error: { code: 'PARENT_NOT_FOUND', message: '父文件夹不存在' }
        });
      }
      newType = parentExists.type; // 移动文件夹时，也更新其type

      if (parent_id === id) {
        return res.status(400).json({
          error: { code: 'CIRCULAR_REFERENCE', message: '不能将文件夹移动到自身' }
        });
      }
    }

    const existingFolder = db.prepare(`
      SELECT id FROM folders 
      WHERE name = ? AND parent_id IS ? AND id != ?
    `).get(name.trim(), parent_id || folder.parent_id, id);

    if (existingFolder) {
      return res.status(400).json({
        error: { code: 'DUPLICATE_NAME', message: '文件夹名称已存在' }
      });
    }

    const now = new Date().toISOString();
    db.prepare(`
      UPDATE folders 
      SET name = ?, parent_id = ?, type = ?, updated_at = ?
      WHERE id = ?
    `).run(name.trim(), parent_id || null, newType, now, id);


    // Cascade type change to all descendants if type changed
    if (newType  !== folder.type) { 
      const cascadeSql =  ` 
        WITH RECURSIVE subtree(id) AS (
          SELECT id FROM folders WHERE parent_id = ?
          UNION ALL
          SELECT f.id FROM folders f JOIN subtree s ON f.parent_id = s.id
        )
        UPDATE folders
        SET type = ?, updated_at = ?
        WHERE id IN (SELECT id FROM subtree)

       `; 
      db.prepare(cascadeSql).run(id, newType, now);
    }

    const updatedFolder = db.prepare(`
      SELECT id, name, parent_id, type, created_at, updated_at 
      FROM folders WHERE id = ?
    `).get(id);

    res.json({
      success: true,
      data: updatedFolder
    });

  } catch (error) {
    console.error('Update folder error:', error);
    res.status(500).json({
      error: { code: 'DATABASE_ERROR', message: '更新文件夹失败' }
    });
  }
});

// 删除文件夹
router.delete('/:id', (req, res) => {
  try {
    const { id } = req.params;

    const folder = db.prepare('SELECT * FROM folders WHERE id = ?').get(id);
    if (!folder) {
      return res.status(404).json({
        error: { code: 'FOLDER_NOT_FOUND', message: '文件夹不存在' }
      });
    }

    const isRoot = folder.parent_id === null;
    if (isRoot) {
      return res.status(403).json({
        error: { code: 'FORBIDDEN', message: 'Cannot delete protected root folder' }
      });
    }

    const childFolders = db.prepare('SELECT COUNT(*) as count FROM folders WHERE parent_id = ?').get(id);
    if (childFolders.count > 0) {
      return res.status(409).json({
        error: { code: 'FOLDER_NOT_EMPTY', message: '文件夹包含子文件夹，无法删除' }
      });
    }

    const items = db.prepare('SELECT COUNT(*) as count FROM items WHERE folder_id = ?').get(id);
    if (items.count > 0) {
      return res.status(409).json({
        error: { code: 'FOLDER_NOT_EMPTY', message: '文件夹包含内容，无法删除' }
      });
    }

    db.prepare('DELETE FROM folders WHERE id = ?').run(id);

    res.json({
      success: true,
      message: '文件夹删除成功'
    });

  } catch (error) {
    console.error('Delete folder error:', error);
    res.status(500).json({
      error: { code: 'DATABASE_ERROR', message: '删除文件夹失败' }
    });
  }
});


// --- Helpers for recursive operations and file cleanup ---
const fs = require('fs');
const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(process.env.DATA_DIR || './data', 'uploads');
const THUMB_DIR = path.join(UPLOAD_DIR, 'thumbnails');

function isDescendant(folderId, possibleAncestorId) {
  try {
    const row = db.prepare(`WITH RECURSIVE subtree(id) AS (
      SELECT id FROM folders WHERE parent_id = ?
      UNION ALL
      SELECT f.id FROM folders f JOIN subtree s ON f.parent_id = s.id
    ) SELECT 1 AS yes FROM subtree WHERE id = ? LIMIT 1`).get(possibleAncestorId, folderId);
    return !!(row && row.yes);
  } catch (_) { return false; }
}

function getSubtreeFolderIds(rootId) {
  const rows = db.prepare(`WITH RECURSIVE subtree(id) AS (
    SELECT ?
    UNION ALL
    SELECT f.id FROM folders f JOIN subtree s ON f.parent_id = s.id
  ) SELECT id FROM subtree`).all(rootId);
  return rows.map(r => r.id);
}

function gatherFilesForFolders(folderIds) {
  const files = [];
  if (!folderIds || folderIds.length === 0) return files;
  const inClause = folderIds.map(() => '?').join(',');
  const itemRows = db.prepare(`SELECT id, file_path, thumbnail_path FROM items WHERE folder_id IN (${inClause})`).all(...folderIds);
  for (const r of itemRows) {
    if (r.file_path) files.push(path.join(UPLOAD_DIR, r.file_path));
    if (r.thumbnail_path) files.push(path.join(THUMB_DIR, r.thumbnail_path));
  }
  try {
    const itemIds = itemRows.map(r => r.id);
    if (itemIds.length) {
      const inItem = itemIds.map(() => '?').join(',');
      const mediaRows = db.prepare(`SELECT file_path, thumbnail_path FROM item_media WHERE item_id IN (${inItem})`).all(...itemIds);
      for (const m of mediaRows) {
        if (m.file_path) files.push(path.join(UPLOAD_DIR, m.file_path));
        if (m.thumbnail_path) files.push(path.join(THUMB_DIR, m.thumbnail_path));
      }
    }
  } catch (_) {}
  return files;
}
// 递归删除（加 mode=recursive 启用），保留原空删逻辑
router.delete('/:id', (req, res) => {
  try {
    const { id } = req.params;
    const mode = String(req.query.mode || '').toLowerCase();
    const folder = db.prepare('SELECT * FROM folders WHERE id = ?').get(id);
    if (!folder) return res.status(404).json({ error: { code: 'FOLDER_NOT_FOUND', message: '文件夹不存在' } });
    if (folder.parent_id === null) return res.status(403).json({ error: { code: 'FORBIDDEN', message: '不允许删除受保护的根文件夹' } });

    if (mode !== 'recursive') {
      const childFolders = db.prepare('SELECT COUNT(*) as count FROM folders WHERE parent_id = ?').get(id);
      if (childFolders.count > 0) return res.status(409).json({ error: { code: 'FOLDER_NOT_EMPTY', message: '文件夹包含子文件夹，无法删除' } });
      const items = db.prepare('SELECT COUNT(*) as count FROM items WHERE folder_id = ?').get(id);
      if (items.count > 0) return res.status(409).json({ error: { code: 'FOLDER_NOT_EMPTY', message: '文件夹包含内容，无法删除' } });
      db.prepare('DELETE FROM folders WHERE id = ?').run(id);
      return res.json({ success: true, message: '文件夹删除成功' });
    }

    const ids = getSubtreeFolderIds(Number(id));
    const files = gatherFilesForFolders(ids);

    const tx = db.transaction(() => {
      const inClause = ids.map(() => '?').join(',');
      db.prepare(`DELETE FROM items WHERE folder_id IN (${inClause})`).run(...ids);
      db.prepare(`DELETE FROM folders WHERE id IN (${inClause})`).run(...ids);
    });
    tx();

    for (const f of files) { try { if (f && fs.existsSync(f)) fs.unlinkSync(f); } catch (_) {} }
    return res.json({ success: true, message: '文件夹及其内容已全部删除' });
  } catch (error) {
    console.error('Delete folder error:', error);
    return res.status(500).json({ error: { code: 'DATABASE_ERROR', message: '删除失败' } });
  }
});

// 转移内容与子文件夹后删除
router.post('/:id/transfer-delete', (req, res) => {
  try {
    const { id } = req.params;
    const { target_folder_id } = req.body || {};
    if (!target_folder_id) return res.status(400).json({ error: { code: 'INVALID_TARGET', message: '缺少目标文件夹' } });

    const src = db.prepare('SELECT id, name, parent_id, type FROM folders WHERE id = ?').get(id);
    const tgt = db.prepare('SELECT id, name, parent_id, type FROM folders WHERE id = ?').get(target_folder_id);
    if (!src) return res.status(404).json({ error: { code: 'FOLDER_NOT_FOUND', message: '文件夹不存在' } });
    if (!tgt) return res.status(404).json({ error: { code: 'TARGET_NOT_FOUND', message: '目标文件夹不存在' } });
    if (src.parent_id === null) return res.status(403).json({ error: { code: 'FORBIDDEN', message: '不允许操作受保护的根文件夹' } });
    if (src.type !== tgt.type) return res.status(400).json({ error: { code: 'TYPE_MISMATCH', message: '文件夹类型不一致' } });
    if (Number(id) === Number(target_folder_id)) return res.status(400).json({ error: { code: 'INVALID_TARGET', message: '目标不能是自身' } });
    if (isDescendant(Number(target_folder_id), Number(id))) return res.status(400).json({ error: { code: 'CIRCULAR_REFERENCE', message: '目标不能是其子孙' } });

    const childNames = db.prepare('SELECT name FROM folders WHERE parent_id = ?').all(id).map(r => r.name);
    if (childNames.length) {
      const placeholders = childNames.map(() => '?').join(',');
      const conflicts = db.prepare(`SELECT name FROM folders WHERE parent_id = ? AND name IN (${placeholders})`).all(target_folder_id, ...childNames).map(r => r.name);
      if (conflicts.length > 0) return res.status(409).json({ error: { code: 'NAME_CONFLICT', message: '目标下存在同名文件夹', details: conflicts } });
    }

    const now = new Date().toISOString();
    const tx = db.transaction(() => {
      db.prepare('UPDATE items SET folder_id = ?, updated_at = ? WHERE folder_id = ?').run(target_folder_id, now, id);
      db.prepare('UPDATE folders SET parent_id = ?, updated_at = ? WHERE parent_id = ?').run(target_folder_id, now, id);
      db.prepare('DELETE FROM folders WHERE id = ?').run(id);
    });
    tx();

    return res.json({ success: true });
  } catch (error) {
    console.error('Transfer-delete folder error:', error);
    return res.status(500).json({ error: { code: 'DATABASE_ERROR', message: '操作失败' } });
  }
});

module.exports = router;
