import React, { useMemo, useState, useEffect } from 'react';
import CustomSelect from './CustomSelect';

// Simple modal for folder edit: rename + change parent + delete options
const FolderEditModal = ({ isOpen, folder, foldersTree, onClose, onSave, onDeleteRecursive, onTransferDelete }) => {
  const [name, setName] = useState(folder?.name || '');
  const [parentId, setParentId] = useState(folder?.parent_id || null);
  const [transferTargetId, setTransferTargetId] = useState(null);
  const [busy, setBusy] = useState(false);

  // Update state when folder changes
  useEffect(() => {
    if (folder) {
      setName(folder.name || '');
      setParentId(folder.parent_id || null);
      setTransferTargetId(null);
    }
  }, [folder]);
  
  const sameTypeOptions = useMemo(() => {
    // Return empty if folder is null
    if (!folder) return [];
    // Build options tree of same type; exclude current folder and its descendants
    const build = (list) => list.filter(Boolean).map(f => ({ ...f, displayName: f.name, children: (f.children ? build(f.children) : []) }));
    const type = folder?.type;
    const forbidIds = new Set();
    // Collect subtree ids of current folder to prevent selecting its children as parent
    const collect = (f) => { if (!f) return; forbidIds.add(f.id); (f.children || []).forEach(collect); };
    // find current folder node in tree to collect descendants
    const dfsFind = (list) => {
      for (const f of list) { if (f.id === folder.id) return f; const r = dfsFind(f.children || []); if (r) return r; }
      return null;
    };
    const root = dfsFind(foldersTree);
    collect(root);
    const filterTree = (list) => {
      const out = [];
      for (const f of list) {
        if (f.type !== type) continue;
        if (forbidIds.has(f.id)) continue; // cannot choose itself or descendants
        const children = filterTree(f.children || []);
        out.push({ ...f, children });
      }
      return out;
    };
    return filterTree(build(foldersTree));
  }, [foldersTree, folder]);

  // Early return AFTER all hooks
  if (!isOpen || !folder) return null;

  return (
    <div className="modal-backdrop" style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.35)', zIndex:9999 }} onClick={() => !busy && onClose()}>
      <div className="modal-panel" onClick={(e)=>e.stopPropagation()} style={{ width: 420, maxWidth:'90vw', background:'#fff', color:'#111', borderRadius:8, boxShadow:'0 10px 30px rgba(0,0,0,0.2)', margin:'10vh auto', padding:20 }}>
        <h3 style={{ margin:'0 0 12px', fontSize:'16px', fontWeight:700 }}>编辑文件夹</h3>

        <div style={{ marginBottom:12 }}>
          <label style={{ display:'block', fontSize:12, color:'#6b7280', marginBottom:6 }}>名称</label>
          <div style={{ display:'flex', gap:8 }}>
            <input type="text" value={name} onChange={(e)=>setName(e.target.value)} disabled={busy} className="form-input" style={{ flex:1, padding:'8px 10px', border:'1px solid #e5e7eb', borderRadius:6 }} />
            <button className="btn btn--primary" disabled={busy || !name.trim()} onClick={async()=>{ setBusy(true); try { await onSave({ name: name.trim(), parent_id: parentId }); } finally { setBusy(false); } }}>保存</button>
          </div>
        </div>

        <div style={{ marginBottom:16 }}>
          <label style={{ display:'block', fontSize:12, color:'#6b7280', marginBottom:6 }}>选择上级文件夹（同类型）</label>
          <CustomSelect options={sameTypeOptions} value={parentId} onChange={setParentId} placeholder="选择文件夹" />
          <div style={{ marginTop:8 }}>
            <button className="btn btn--secondary" disabled={busy} onClick={async()=>{ setBusy(true); try { await onSave({ name: name.trim(), parent_id: parentId }); } finally { setBusy(false); } }}>保存</button>
          </div>
        </div>

        <div style={{ borderTop:'1px solid #eee', paddingTop:12, marginTop:12 }}>
          <div style={{ fontSize:12, color:'#b91c1c', marginBottom:8 }}>危险操作</div>
          <div style={{ fontSize:12, color:'#6b7280', marginBottom:10 }}>删除前请确认已检查内容；删除不可恢复。</div>
          <div style={{ display:'flex', gap:8, marginBottom:8 }}>
            <button className="btn btn--danger" disabled={busy} onClick={async()=>{ if (!confirm('确认直接删除该文件夹及其所有内容？此操作不可恢复。')) return; setBusy(true); try { await onDeleteRecursive(); } finally { setBusy(false); } }}>直接删除</button>
          </div>

          <div style={{ fontSize:12, color:'#374151', margin:'8px 0 6px' }}>或：选择一个目标文件夹，先转移内容与子文件夹，再删除本文件夹</div>
          <CustomSelect options={sameTypeOptions} value={transferTargetId} onChange={setTransferTargetId} placeholder="选择目标文件夹" />
          <div style={{ marginTop:8 }}>
            <button className="btn btn--secondary" disabled={busy || !transferTargetId} onClick={async()=>{ if (!confirm('确认先转移再删除？如目标下同名子文件夹会报错。')) return; setBusy(true); try { await onTransferDelete(transferTargetId); } finally { setBusy(false); } }}>转移后删除</button>
          </div>
        </div>

        <div style={{ marginTop:12, fontSize:12, color:'#6b7280' }}>文件夹支持拖拽管理</div>

        <div style={{ textAlign:'right', marginTop:12 }}>
          <button className="btn btn--secondary" disabled={busy} onClick={onClose}>关闭</button>
        </div>
      </div>
    </div>
  );
};

export default FolderEditModal;