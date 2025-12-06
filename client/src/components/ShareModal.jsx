import React, { useEffect, useMemo, useState } from 'react'
import { toast } from 'react-toastify'
import api from '../services/api'

// 简单的分享弹窗：时间限制、密码、片段多选；创建或复用有效链接并可复制
const ShareModal = ({ isOpen, onClose, itemId }) => {
  const [loading, setLoading] = useState(false)
  const [segments, setSegments] = useState([]) // [{title, content}]
  const [selected, setSelected] = useState([]) // index list
  const [password, setPassword] = useState('')
  const [expiry, setExpiry] = useState('permanent') // 'permanent'|'30d'|'15d'|'7d'
  const [existingShare, setExistingShare] = useState(null) // latest effective share
  const [creating, setCreating] = useState(false)
  const [sharesLoading, setSharesLoading] = useState(false)
  const [shares, setShares] = useState([]) // 当前 item 的全部分享

  const canShare = isOpen && !!itemId

  useEffect(() => {
    if (!canShare) return
    let cancelled = false
    ;(async () => {
      try {
        setLoading(true)
        // 拉取已保存内容，解析片段
        const r = await api.getItem(itemId)
        const content = r?.data?.content || ''
        let segs = []
        try {
          const parsed = JSON.parse(content || '[]')
          if (Array.isArray(parsed) && parsed.length > 0) segs = parsed.map(s => ({ title: s.title || '', content: s.content || '' }))
        } catch (_) {}
        if (segs.length === 0) segs = [{ title: '', content: content || '' }]
        if (cancelled) return
        setSegments(segs)
        setSelected(segs.map((_, i) => i))

        // 取该条目的最近一次且仍有效的分享
        // 拉取当前 item 的全部分享（最多 100 条）
        setSharesLoading(true)
        const list = await api.getShares({ item_id: itemId, page_size: 100 })
        const arr = (list?.data?.shares || [])
        const now = Date.now()
        const firstValid = arr.find(sh => sh.is_active && (!sh.expires_at || new Date(sh.expires_at).getTime() > now))
        setExistingShare(firstValid || null)
        if (!cancelled) setShares(arr)
      } catch (e) {
        console.error('Load share modal data failed', e)
      } finally {
        setLoading(false)
        setSharesLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [canShare, itemId])

  const link = useMemo(() => existingShare ? (window.location.origin + '/s/' + existingShare.share_key) : '' , [existingShare])

  const refreshShares = async () => {
    if (!itemId) return
    try {
      setSharesLoading(true)
      const list = await api.getShares({ item_id: itemId, page_size: 100 })
      const arr = (list?.data?.shares || [])
      setShares(arr)
      const now = Date.now()
      const firstValid = arr.find(sh => sh.is_active && (!sh.expires_at || new Date(sh.expires_at).getTime() > now))
      setExistingShare(firstValid || null)
    } catch (e) {
      setShares([])
    } finally {
      setSharesLoading(false)
    }
  }

  const computeExpiryISO = () => {
    if (expiry === 'permanent') return null
    const days = expiry === '30d' ? 30 : (expiry === '15d' ? 15 : 7)
    const dt = new Date()
    dt.setDate(dt.getDate() + days)
    return dt.toISOString()
  }

  const toggleIndex = (idx) => {
    setSelected(prev => prev.includes(idx) ? prev.filter(i => i !== idx) : [...prev, idx].sort((a,b)=>a-b))
  }

  const onCreateShare = async () => {
    if (!itemId) return
    if (selected.length === 0) { try { toast.info('请至少选择一个片段') } catch(_){}; return }
    try {
      setCreating(true)
      const payload = {
        item_id: itemId,
        password: (password || '').trim() || null,
        expires_at: computeExpiryISO(),
        segment_indices: selected
      }
      const r = await api.createShare(payload)
      const s = r?.data
      if (s?.share_key) {
        setExistingShare(s)
        const url = window.location.origin + '/s/' + s.share_key
        try {
          if (navigator.clipboard && window.isSecureContext) await navigator.clipboard.writeText(url)
          else {
            const ta = document.createElement('textarea'); ta.value = url; ta.setAttribute('readonly',''); ta.style.position='fixed'; ta.style.top='-1000px'; ta.style.left='-1000px';
            document.body.appendChild(ta); ta.focus(); ta.select(); document.execCommand('copy'); document.body.removeChild(ta);
          }
          try { toast.success('分享链接已复制') } catch(_){}
        } catch(_) {}
      }
    } catch (e) {
      try { toast.error(e?.response?.data?.error?.message || '创建分享失败') } catch(_){}
    } finally { setCreating(false) }
  }

  const onUpdateShare = async () => {
    if (!itemId || !existingShare) return;
    if (selected.length === 0) { try { toast.info('请至少选择一个片段') } catch(_){}; return }
    try {
      setCreating(true);
      const payload = {
        expires_at: computeExpiryISO(),
        segment_indices: selected
      };
      const r = await api.updateShare(existingShare.id, payload);
      const s = r?.data;
      if (s?.id) {
        setExistingShare(s);
        try { toast.success('已更新分享'); } catch(_){}
        await refreshShares();
      }
    } catch (e) {
      try { toast.error(e?.response?.data?.error?.message || '更新分享失败') } catch(_){}
    } finally { setCreating(false) }
  };

  if (!isOpen) return null

  return (
    <div className="modal-backdrop">
      <div className="modal" role="dialog" aria-modal="true" style={{ maxWidth: 720 }}>
        <div className="modal-header">
          <h3>分享设置</h3>
          <button className="modal-close" onClick={onClose}>&times;</button>
        </div>
        <div className="modal-body">
          {loading ? (
            <div style={{ padding: '16px' }}>加载中...</div>
          ) : (
            <>
              {existingShare && (
                <div className="form-group" style={{ background:'#f9fafb', border:'1px solid #e5e7eb', borderRadius:8, padding:12 }}>
                  <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', gap:8, flexWrap:'wrap' }}>
                    <div>
                      <div style={{ fontWeight:600, marginBottom:4 }}>已生成分享链接</div>
                      <div style={{ wordBreak:'break-all', fontSize:12, color:'#6b7280' }}>{link}</div>
                    </div>
                    <div style={{ display:'flex', gap:8 }}>
                      <button
                        className="btn btn--secondary"
                        onClick={async () => {
                          try {
                            const url = link;
                            if (!url) return;
                            if (navigator.clipboard && window.isSecureContext) {
                              await navigator.clipboard.writeText(url)
                            } else {
                              const ta = document.createElement('textarea');
                              ta.value = url;
                              ta.setAttribute('readonly','');
                              ta.style.position='fixed';
                              ta.style.top='-1000px';
                              ta.style.left='-1000px';
                              document.body.appendChild(ta);
                              ta.focus();
                              ta.select();
                              document.execCommand('copy');
                              document.body.removeChild(ta);
                            }
                            try { toast.success('已复制'); } catch(_){}
                          } catch (e) {
                            try { toast.error('复制失败'); } catch(_){}
                          }
                        }}
                      >复制</button>
                      <button className="btn" onClick={onCreateShare}>重新生成</button>
                    </div>
                  </div>
                </div>
              )}

              {/* 当前提示词的所有分享链接列表 */}
              <div className="form-group">
                <label className="form-label">该内容的分享链接</label>
                {sharesLoading ? (
                  <div style={{ padding:'8px 0', color:'#6b7280' }}>加载中…</div>
                ) : (shares.length === 0 ? (
                  <div style={{ padding:'8px 0', color:'#6b7280' }}>暂无分享链接</div>
                ) : (
                  <div style={{ border:'1px solid #e5e7eb', borderRadius:8, overflow:'hidden' }}>
                    <div style={{ display:'grid', gridTemplateColumns:'1.6fr .9fr .9fr .7fr .7fr .9fr .9fr', gap:0, background:'#f9fafb', borderBottom:'1px solid #e5e7eb', padding:'8px 12px', fontWeight:600, fontSize:12, color:'#374151' }}>
                      <div>链接</div>
                      <div>状态</div>
                      <div>有效期</div>
                      <div>密码</div>
                      <div>查看</div>
                      <div>创建时间</div>
                      <div>操作</div>
                    </div>
                    <div>
                      {shares.map((sh) => {
                        const now = Date.now();
                        const expired = !!(sh.expires_at && new Date(sh.expires_at).getTime() <= now);
                        const statusLabel = expired ? '已过期' : (sh.is_active ? '已启用' : '已禁用');
                        const linkText = window.location.origin + '/s/' + sh.share_key;
                        const expiryLabel = sh.expires_at ? new Date(sh.expires_at).toLocaleDateString() : '永久';
                        return (
                          <div key={sh.id} style={{ display:'grid', gridTemplateColumns:'1.6fr .9fr .9fr .7fr .7fr .9fr .9fr', gap:0, alignItems:'center', padding:'8px 12px', borderBottom:'1px solid #f3f4f6', fontSize:12 }}>
                            <div style={{ wordBreak:'break-all' }}>{linkText}</div>
                            <div style={{ color: expired ? '#dc2626' : (sh.is_active ? '#16a34a' : '#6b7280') }}>{statusLabel}</div>
                            <div>{expiryLabel}</div>
                            <div>{sh.password ? '已设置' : '未设置'}</div>
                            <div>{sh.view_count ?? 0}</div>
                            <div>{new Date(sh.created_at).toLocaleDateString()}</div>
                            <div style={{ display:'flex', gap:6, flexWrap:'wrap' }}>
                              <button className='btn btn--secondary' onClick={async ()=>{
                                try {
                                  if (navigator.clipboard && window.isSecureContext) await navigator.clipboard.writeText(linkText)
                                  else {
                                    const ta=document.createElement('textarea'); ta.value=linkText; ta.setAttribute('readonly',''); ta.style.position='fixed'; ta.style.top='-1000px'; document.body.appendChild(ta); ta.focus(); ta.select(); document.execCommand('copy'); document.body.removeChild(ta);
                                  }
                                  toast.success('已复制')
                                } catch(_) { toast.error('复制失败') }
                              }}>复制</button>
                              <button className='btn btn--danger' onClick={async ()=>{
                                try{ await api.deleteShare(sh.id); toast.success('已删除'); refreshShares(); }catch(e){ toast.error('删除失败') }
                              }}>删除</button>
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                ))}
              </div>

              <div className="form-group">
                <label className="form-label">时间限制</label>
                <div style={{ display:'flex', gap:12, flexWrap:'wrap' }}>
                  <label className="radio"><input type="radio" name="expiry" checked={expiry==='permanent'} onChange={() => setExpiry('permanent')} /> 永久</label>
                  <label className="radio"><input type="radio" name="expiry" checked={expiry==='30d'} onChange={() => setExpiry('30d')} /> 30天</label>
                  <label className="radio"><input type="radio" name="expiry" checked={expiry==='15d'} onChange={() => setExpiry('15d')} /> 15天</label>
                  <label className="radio"><input type="radio" name="expiry" checked={expiry==='7d'} onChange={() => setExpiry('7d')} /> 7天</label>
                </div>
              </div>

              <div className="form-group">
                <label className="form-label">密码（可选）</label>
                <input type="text" className="form-input" value={password} onChange={e => setPassword(e.target.value)} placeholder="留空则不设密码" />
              </div>

              <div className="form-group">
                <label className="form-label">提示词片段（至少选择一个）</label>
                <div style={{ display:'flex', flexDirection:'column', gap:8, maxHeight: 260, overflow:'auto', border:'1px solid #e5e7eb', borderRadius:8, padding:8 }}>
                  {segments.map((s, idx) => (
                    <label key={idx} style={{ display:'flex', gap:8, alignItems:'center' }}>
                      <input type="checkbox" checked={selected.includes(idx)} onChange={() => toggleIndex(idx)} />
                      <div style={{ fontWeight:600, whiteSpace:'pre-wrap', wordBreak:'break-word' }}>{s.title || `片段 ${idx+1}`}</div>
                    </label>
                  ))}
                </div>
                <div style={{ marginTop:8 }}>
                  <button type="button" className="btn btn--secondary" onClick={() => setSelected(segments.map((_,i)=>i))}>全选</button>
                  <button type="button" className="btn btn--secondary" style={{ marginLeft:8 }} onClick={() => setSelected([])}>全不选</button>
                </div>
              </div>
            </>
          )}
        </div>
        <div className="modal-footer">
          <button className="btn btn--secondary" onClick={onClose} disabled={creating || loading}>取消</button>
          {existingShare ? (
            <button className="btn btn--primary" onClick={onUpdateShare} disabled={creating || loading}>{creating ? '更新中...' : '更新分享'}</button>
          ) : (
            <button className="btn btn--primary" onClick={onCreateShare} disabled={creating || loading}>{creating ? '生成中...' : '分享'}</button>
          )}
        </div>
      </div>
      <style jsx>{`
        .modal-backdrop{position:fixed;inset:0;background:rgba(0,0,0,.35);display:flex;align-items:center;justify-content:center;z-index:50}
        .modal{background:#fff;border-radius:12px;box-shadow:0 10px 30px rgba(0,0,0,.15);width:92vw;max-width:800px}
        .modal-header{display:flex;justify-content:space-between;align-items:center;padding:16px 20px;border-bottom:1px solid #f3f4f6}
        .modal-body{padding:16px 20px}
        .modal-footer{display:flex;justify-content:flex-end;gap:8px;padding:16px 20px;border-top:1px solid #f3f4f6}
        .modal-close{border:none;background:transparent;font-size:22px;cursor:pointer}
      `}</style>
    </div>
  )
}

export default ShareModal
