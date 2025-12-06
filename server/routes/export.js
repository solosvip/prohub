const express = require('express');
const path = require('path');
const Database = require('better-sqlite3');
const { authenticateToken } = require('./auth');

const router = express.Router();
router.use(authenticateToken);

const DB_FILE = process.env.DB_FILE || path.join(process.env.DATA_DIR || './data', 'app.sqlite');
const db = new Database(DB_FILE);

// Build a simple JSON export that can be imported into a future multi-user edition
router.get('/json', (req, res) => {
  try {
    const includeShares = String(req.query.includeShares || '0') === '1';

    const folders = db.prepare(`
      SELECT id, name, parent_id, type, created_at, updated_at
      FROM folders ORDER BY id ASC
    `).all();

    const tags = db.prepare(`
      SELECT id, name, color, usage_count, created_at, updated_at
      FROM tags ORDER BY id ASC
    `).all();

    const items = db.prepare(`
      SELECT id, title, content, content_type, file_path, file_name, file_size, thumbnail_path,
             folder_id, is_favorite, created_at, updated_at
      FROM items ORDER BY id ASC
    `).all();

    // Map item -> tags
    const itemTagRows = db.prepare(`SELECT item_id, tag_id FROM item_tags`).all();
    const tagById = new Map(tags.map(t => [t.id, t]));
    const itemTags = new Map();
    for (const r of itemTagRows) {
      if (!itemTags.has(r.item_id)) itemTags.set(r.item_id, []);
      const t = tagById.get(r.tag_id);
      if (t) itemTags.get(r.item_id).push(t);
    }

    // item_media table is optional on older DBs
    let itemMedias = [];
    try {
      itemMedias = db.prepare(
        `SELECT id, item_id, file_path, thumbnail_path, width, height, mime, size, sort_order, is_cover, created_at, updated_at FROM item_media ORDER BY item_id ASC, sort_order ASC, id ASC`
      ).all();
    } catch (_) {}

    // shares (optional export)
    let shares = [];
    if (includeShares) {
      try {
        shares = db.prepare(`
          SELECT id, share_key, item_id, title, description, is_active, expires_at, view_count, created_at, updated_at
          FROM shares ORDER BY id ASC
        `).all();
      } catch (_) {}
    }

    // Collect all referenced files for pre-import check
    const fileSet = new Set();
    const addFile = (f) => { if (f) fileSet.add(String(f)); };
    for (const it of items) { addFile(it.file_path); addFile(it.thumbnail_path); }
    for (const m of itemMedias) { addFile(m.file_path); addFile(m.thumbnail_path); }

    const normalizeContentType = (t) => {
      if (!t) return null;
      const low = String(t).toLowerCase();
      if (low.startsWith('text')) return 'text';
      if (low.startsWith('image')) return 'image';
      if (low.startsWith('video')) return 'video';
      return low;
    };

    const exportData = {
      meta: {
        app: 'prompt-collector',
        export_version: 1,
        exported_at: new Date().toISOString()
      },
      folders: folders.map(f => ({
        legacy_id: f.id,
        name: f.name,
        parent_legacy_id: f.parent_id,
        type: f.type || null,
        created_at: f.created_at,
        updated_at: f.updated_at
      })),
      tags: tags.map(t => ({
        legacy_id: t.id,
        name: t.name,
        color: t.color,
        usage_count: t.usage_count || 0,
        created_at: t.created_at,
        updated_at: t.updated_at
      })),
      items: items.map(it => {
        const relatedTags = itemTags.get(it.id) || [];
        const cover = (it.file_path || it.thumbnail_path) ? { file_path: it.file_path || null, thumbnail_path: it.thumbnail_path || null } : null;
        return {
          legacy_id: it.id,
          title: it.title,
          content_type: normalizeContentType(it.content_type),
          content: it.content,
          folder_legacy_id: it.folder_id || null,
          is_favorite: !!it.is_favorite,
          tag_legacy_ids: relatedTags.map(t => t.id),
          tag_names: relatedTags.map(t => t.name),
          cover,
          file_path: it.file_path || null,
          thumbnail_path: it.thumbnail_path || null,
          file_name: it.file_name || null,
          file_size: it.file_size || null,
          created_at: it.created_at,
          updated_at: it.updated_at
        };
      }),
      item_media: itemMedias.map(m => ({
        legacy_id: m.id,
        item_legacy_id: m.item_id,
        file_path: m.file_path,
        thumbnail_path: m.thumbnail_path || null,
        width: m.width || null,
        height: m.height || null,
        mime: m.mime || null,
        size: m.size || null,
        sort_order: m.sort_order || 0,
        is_cover: !!m.is_cover,
        created_at: m.created_at,
        updated_at: m.updated_at
      })),
      shares: includeShares ? shares.map(s => ({
        legacy_id: s.id,
        share_key: s.share_key,
        item_legacy_id: s.item_id,
        title: s.title,
        description: s.description,
        is_active: !!s.is_active,
        expires_at: s.expires_at,
        view_count: s.view_count || 0,
        created_at: s.created_at,
        updated_at: s.updated_at
      })) : [],
      files: Array.from(fileSet)
    };

    const filename = `prompt-collector-export-${new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14)}.json`;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    // Pretty print for readability
    res.send(JSON.stringify(exportData, null, 2));
  } catch (error) {
    console.error('Export json error:', error);
    res.status(500).json({ error: { code: 'EXPORT_FAILED', message: '导出失败' } });
  }
});

module.exports = router;

