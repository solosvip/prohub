const express = require('express');
const path = require('path');
const Database = require('better-sqlite3');
const router = express.Router();

const DB_FILE = process.env.DB_FILE || path.join(process.env.DATA_DIR || './data', 'app.sqlite');
const db = new Database(DB_FILE);

function ensureShareColumns() {
  try {
    const cols = db.pragma('table_info(shares)');
    if (!cols.some(c => c.name === 'segments_snapshot')) {
      db.exec('ALTER TABLE shares ADD COLUMN segments_snapshot TEXT');
    }
  } catch (e) {
    try { console.warn('share-html.js: ensureShareColumns warning:', (e && e.message) || e); } catch(_) {}
  }
}
ensureShareColumns();

// External JS for share page (avoid inline scripts blocked by CSP)
router.get('/share.js', (req, res) => {
  try {
    const js = `
(function(){
  function toast(msg){
    try{
      var t=document.createElement('div');
      t.className='toast';
      t.textContent=msg;
      document.body.appendChild(t);
      setTimeout(function(){t.style.opacity='0';},1200);
      setTimeout(function(){try{document.body.removeChild(t)}catch(e){}},1800);
    }catch(e){}
  }
  function fallbackCopy(str){
    try{
      var ta=document.createElement('textarea');
      ta.value=str; ta.setAttribute('readonly',''); ta.style.position='fixed'; ta.style.top='-1000px';
      document.body.appendChild(ta); ta.select();
      var ok=false; try{ ok=document.execCommand('copy'); }catch(_){ ok=false; }
      document.body.removeChild(ta);
      return !!ok;
    }catch(_){ return false; }
  }
  function copyByIndex(idx){
    try{
      var el = document.getElementById('seg-'+idx);
      var txt = el ? el.innerText : '';
      if (navigator.clipboard && window.isSecureContext) {
        navigator.clipboard.writeText(txt)
          .then(function(){ toast('片段已复制'); })
          .catch(function(){ var ok=fallbackCopy(txt); toast(ok? '片段已复制' : '复制失败'); });
      } else {
        var ok = fallbackCopy(txt);
        toast(ok? '片段已复制' : '复制失败');
      }
    }catch(e){}
  }
  function bind(){
    try{
      var list = document.querySelectorAll('.seg-copy');
      list.forEach(function(b){
        var idx = b.getAttribute('data-idx');
        b.addEventListener('click', function(e){ e.preventDefault(); copyByIndex(idx); });
        try { b.addEventListener('touchstart', function(e){ e.preventDefault(); copyByIndex(idx); }, { passive:false }); } catch(_){ }
        b.setAttribute('aria-label','复制本段');
      });
    }catch(_){ }
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bind);
  } else {
    bind();
  }
})();
`;
    res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
    return res.send(js);
  } catch (e) {
    res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
    return res.send('');
  }
});

function validateShare(share) {
  if (!share) return { valid: false, error: { code: 'SHARE_NOT_FOUND', message: '分享不存在' } };
  if (!share.is_active) return { valid: false, error: { code: 'SHARE_INACTIVE', message: '分享已被禁用' } };
  if (share.expires_at) {
    const expiryDate = new Date(share.expires_at);
    if (expiryDate.getTime() <= Date.now()) return { valid: false, error: { code: 'SHARE_EXPIRED', message: '分享已过期' } };
  }
  return { valid: true };
}

function escapeHtml(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

router.get('/:shareKey', (req, res) => {
  try {
    const { shareKey } = req.params;
    const share = db.prepare(`
      SELECT s.*, i.title AS item_title, i.content AS item_content,
             i.content_type AS item_type, i.file_path, i.thumbnail_path
      FROM shares s
      INNER JOIN items i ON s.item_id = i.id
      WHERE s.share_key = ?
    `).get(shareKey);

    const validation = validateShare(share);
    if (!validation.valid) {
      res.status(404).send(`<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>分享不可用</title><meta name="robots" content="noindex"></head><body><h1>分享链接不存在或已失效</h1></body></html>`);
      return;
    }

    // Compose selected segments for description and body (always use latest item content)
    let segments = [];
    try {
      const arr = JSON.parse(share.item_content || '[]');
      if (Array.isArray(arr) && arr.length) segments = arr.map(s => ({ title: s.title || '', content: s.content || '' }));
      else segments = [{ title: share.item_title || '', content: share.item_content || '' }];
    } catch(_) {
      segments = [{ title: share.item_title || '', content: share.item_content || '' }];
    }

    const plain = segments.map(s => (s.title ? (s.title + '\n' + (s.content || '')) : (s.content || ''))).join('\n\n');
    const description = plain.replace(/[\n\r]+/g, ' ').slice(0, 180);

    const baseUrl = `${req.protocol}://${req.get('host')}`;
    const canonical = `${baseUrl}/s/${encodeURIComponent(shareKey)}`;
    const title = escapeHtml(share.title || share.item_title || '分享内容');
    const contentType = String(share.item_type || 'text');
    const thumb = share.thumbnail_path ? `${baseUrl}/uploads/thumbnails/${share.thumbnail_path}` : '';
    const thumbRel = share.thumbnail_path ? `/uploads/thumbnails/${share.thumbnail_path}` : '';

    // JSON-LD by type
    let jsonLd = {};
    if (contentType.startsWith('text')) {
      jsonLd = {
        '@context': 'https://schema.org',
        '@type': 'Article',
        headline: title,
        description,
        mainEntityOfPage: canonical
      };
    } else if (contentType.startsWith('image')) {
      jsonLd = {
        '@context': 'https://schema.org',
        '@type': 'ImageObject',
        name: title,
        caption: description,
        contentUrl: thumb || canonical
      };
    } else if (contentType.startsWith('video')) {
      jsonLd = {
        '@context': 'https://schema.org',
        '@type': 'VideoObject',
        name: title,
        description,
        thumbnailUrl: thumb ? [thumb] : undefined
      };
    }

    // Minimal stylized HTML, content varies by type
    const styles = `
      :root{--bg:#0b0c0f;--surface:#111318;--card:#151821;--card2:#0f1116;--muted:#9aa3b2;--fg:#e6e9ef;--line:#23262f;--brand:#6ea8fe;--brand2:#9b8cff}
      @media (prefers-color-scheme: light){:root{--bg:#f7f8fb;--surface:#ffffff;--card:#ffffff;--card2:#f9fafb;--muted:#6b7280;--fg:#111827;--line:#e5e7eb;--brand:#2563eb;--brand2:#8b5cf6}}
      *{box-sizing:border-box}
      body{font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,Helvetica,Arial,PingFang SC,Microsoft YaHei,sans-serif;background:linear-gradient(180deg,var(--bg),var(--bg));color:var(--fg);margin:0}
      .wrap{max-width:920px;margin:0 auto;padding:32px 24px}
      header{display:flex;justify-content:space-between;align-items:flex-start;padding:8px 0 24px}
      h1{font-size:2rem;margin:0 0 10px;font-weight:800;letter-spacing:.2px}
      .desc{color:var(--muted);margin:0 0 18px;line-height:1.7}
      .link-copy{display:inline-flex;align-items:center;gap:8px;padding:10px 14px;border-radius:999px;background:linear-gradient(135deg,var(--brand),var(--brand2));color:#fff;text-decoration:none;border:none;cursor:pointer;box-shadow:0 8px 22px rgba(0,0,0,.12)}
      .panel{background:var(--card);border:1px solid var(--line);border-radius:16px;padding:20px 18px;box-shadow:0 8px 24px rgba(0,0,0,.10)}
      .panel-title{font-weight:700;color:var(--muted);font-size:.95rem}
      .segments{display:flex;gap:14px;flex-direction:column;margin-top:10px}
      .seg{background:var(--card2);border:1px solid var(--line);border-radius:14px;padding:14px 14px 16px}
      .seg-head{display:flex;align-items:center;gap:10px;justify-content:space-between;margin-bottom:10px}
      .seg-left{display:flex;align-items:center;gap:10px;min-width:0}
      .seg-index{flex:0 0 28px;height:28px;border-radius:8px;background:linear-gradient(135deg,var(--brand),var(--brand2));color:#fff;display:inline-flex;align-items:center;justify-content:center;font-weight:700;font-size:.9rem}
      .seg-title{margin:0;font-size:1rem;font-weight:700;letter-spacing:.2px;white-space:pre-wrap;word-break:break-word}
      .seg-copy{padding:6px 12px;border-radius:8px;border:1px solid var(--line);background:#fafafa;color:var(--fg);cursor:pointer;transition:background .15s, transform .05s}
      .seg-copy:hover{background:#f3f4f6}
      .seg-copy:active{transform:scale(.98)}
      .seg-body{color:var(--fg);line-height:1.9;white-space:pre-wrap}
      .grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:12px}
      img{width:100%;height:auto;border-radius:10px;display:block;border:1px solid var(--line)}
      video{width:100%;max-height:520px;border-radius:12px;background:#000;border:1px solid var(--line)}
      .toast{position:fixed;top:18px;right:18px;background:#111827;color:#fff;border:1px solid #374151;border-radius:10px;padding:10px 14px;z-index:9999;box-shadow:0 12px 30px rgba(0,0,0,.25);font-size:.9rem}
    `;

    let bodyContent = '';
    if (contentType.startsWith('text')) {
      bodyContent = `
        <div class="panel">
          <div class="panel-title">提示词内容（共 ${segments.length} 段）</div>
          <div class="segments">
            ${segments.map((s,i)=>`
              <section class="seg">
                <div class="seg-head">
                  <div class="seg-left">
                    <div class="seg-index">${i+1}</div>
                    <h3 class="seg-title">${escapeHtml(s.title||('片段 '+(i+1)))}</h3>
                  </div>
                  <button class="seg-copy" type="button" data-idx="${i}">复制</button>
                </div>
                <div class="seg-body" id="seg-${i}">${escapeHtml(s.content||'')}</div>
              </section>
            `).join('')}
          </div>
        </div>`;
    } else if (contentType.startsWith('image')) {
      // Image grid + segments（优先读取多图 item_media，其次回退到 items.file_path 封面）
      let mediaRows = [];
      try {
        mediaRows = db.prepare('SELECT file_path, thumbnail_path FROM item_media WHERE item_id = ? ORDER BY sort_order ASC, id ASC').all(share.item_id) || [];
      } catch (_) { mediaRows = []; }
      const imagesHtml = (mediaRows.length > 0
        ? mediaRows.map(m => `<img src="${m.thumbnail_path ? ('/uploads/thumbnails/' + m.thumbnail_path) : ('/uploads/' + m.file_path)}" alt="${title}"/>`).join('')
        : (share.file_path ? `<img src="/uploads/${share.file_path}" alt="${title}"/>` : '')
      );
      bodyContent = `
        <div class="panel">
          <div class="grid">${imagesHtml}</div>
        </div>
        <div class="panel" style="margin-top:16px">
          <div class="panel-title">提示词内容（共 ${segments.length} 段）</div>
          <div class="segments">
            ${segments.map((s,i)=>`
              <section class="seg">
                <div class="seg-head">
                  <div class="seg-left">
                    <div class="seg-index">${i+1}</div>
                    <h3 class="seg-title">${escapeHtml(s.title||('片段 '+(i+1)))}</h3>
                  </div>
                  <button class="seg-copy" type="button" data-idx="${i}">复制</button>
                </div>
                <div class="seg-body" id="seg-${i}">${escapeHtml(s.content||'')}</div>
              </section>
            `).join('')}
          </div>
        </div>`;
    } else {
      // video
      const videoUrl = share.file_path ? `/uploads/${share.file_path}` : '';
      bodyContent = `
        <div class="panel">
          ${videoUrl ? `<video src="${videoUrl}" controls ${thumbRel?`poster=\"${thumbRel}\"`:''}>您的浏览器不支持视频播放</video>` : ''}
        </div>
        <div class="panel" style="margin-top:16px">
          <div class="panel-title">提示词内容（共 ${segments.length} 段）</div>
          <div class="segments">
            ${segments.map((s,i)=>`
              <section class="seg">
                <div class="seg-head">
                  <div class="seg-left">
                    <div class="seg-index">${i+1}</div>
                    <h3 class="seg-title">${escapeHtml(s.title||('片段 '+(i+1)))}</h3>
                  </div>
                  <button class="seg-copy" type="button" data-idx="${i}">复制</button>
                </div>
                <div class="seg-body" id="seg-${i}">${escapeHtml(s.content||'')}</div>
              </section>
            `).join('')}
          </div>
        </div>`;
    }

    const html = `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <title>${title}</title>
  <meta name="description" content="${escapeHtml(description)}"/>
  <link rel="canonical" href="${canonical}"/>
  <meta property="og:title" content="${title}"/>
  <meta property="og:description" content="${escapeHtml(description)}"/>
  <meta property="og:type" content="${contentType.startsWith('video') ? 'video.other' : (contentType.startsWith('image') ? 'website' : 'article')}"/>
  ${thumb ? `<meta property=\"og:image\" content=\"${thumb}\"/>` : ''}
  <script type="application/ld+json">${JSON.stringify(jsonLd)}</script>
  <style>${styles}</style>
</head>
<body>
  <div class="wrap">
    <header>
      <h1>${title}</h1>
    </header>
    ${bodyContent}
  </div>
  <script src="/s/share.js"></script>
</body>
</html>`;

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.send(html);
  } catch (e) {
    console.error('share-html error:', e);
    return res.status(500).send('<!doctype html><html><head><meta charset="utf-8"><title>错误</title></head><body>服务器错误</body></html>');
  }
});

// External JS for share page (avoids inline scripts blocked by CSP)
// duplicate handler removed; single definition lives above

module.exports = router;
