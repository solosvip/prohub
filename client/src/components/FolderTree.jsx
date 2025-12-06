import React, { useState } from 'react';
import ContextMenu from './ContextMenu';

const FolderTree = ({ folders, activeFolderId, onFolderClick, onAddSubfolder, onEditFolder, onDeleteFolder, onCreateFile, onMoveFolder }) => {
  const [expandedFolders, setExpandedFolders] = useState(new Set());
  const [dragging, setDragging] = useState(null);
  const [dragOver, setDragOver] = useState(null);
  const [contextMenu, setContextMenu] = useState({ visible: false, x: 0, y: 0, folder: null, isDeletable: true });
  const [editingFolder, setEditingFolder] = useState(null);
  const [editingName, setEditingName] = useState('');
  // Helpers to locate folders and avoid circular drops
  const findById = (list, id) => {
    for (const f of list) { if (f.id === id) return f; const r = findById(f.children || [], id); if (r) return r; }
    return null;
  };
  const isDescendant = (ancestorId, testId) => {
    const root = findById(folders, ancestorId); if (!root) return false;
    const stack = [...(root.children || [])];
    while (stack.length) { const n = stack.pop(); if (n.id === testId) return true; (n.children || []).forEach(c=>stack.push(c)); }
    return false;
  };
  const toggleFolder = (folderId) => {
    const newExpanded = new Set(expandedFolders);
    if (newExpanded.has(folderId)) {
      newExpanded.delete(folderId);
    } else {
      newExpanded.add(folderId);
    }
    setExpandedFolders(newExpanded);
  };

  const handleContextMenu = (e, folder) => {
    e.preventDefault();
    e.stopPropagation();
    const isProtected = folder.parent_id === null;
    const isDeletable =  !isProtected; 
    setContextMenu({
      visible: true,
      x: e.clientX,
      y: e.clientY,
      folder,
      isDeletable
    });
  };

  const handleContextMenuAction = (action) => {
    const { folder } = contextMenu;
    setContextMenu({ visible: false, x: 0, y: 0, folder: null, isDeletable: true });
    
    switch (action) {
      case 'edit':
        onEditFolder?.(folder);
        break;
      case 'newFile':
        onCreateFile?.(folder);
        break;
      case 'newFolder':
        onAddSubfolder?.(folder.id);
        break;
      case 'delete':
        onDeleteFolder?.(folder);
        break;
    }
  };

  const handleRename = (e) => {
    e.preventDefault();
    if (editingFolder && editingName.trim()) {
      onEditFolder?.(editingFolder, editingName.trim());
    }
    setEditingFolder(null);
    setEditingName('');
  };

  const renderFolder = (folder, level = 0) => {
    const isExpanded = expandedFolders.has(folder.id);
    const hasChildren = folder.children && folder.children.length > 0;
    const isActive = folder.id === activeFolderId;
    const isEditing = editingFolder && editingFolder.id === folder.id;

    return (
      <li key={folder.id} className={`nav-item-folder ${isActive ? 'active' : ''}`}>
        <a
          href="#"
          onClick={(e) => {
            e.preventDefault();
            onFolderClick?.(folder);
          }}
          onContextMenu={(e) => handleContextMenu(e, folder)}
                    draggable={folder.parent_id !== null}
          onDragStart={(e)=>{ if (folder.parent_id===null) return; setDragging(folder.id); e.dataTransfer.setData('text/plain', String(folder.id)); e.dataTransfer.effectAllowed='move'; }}
          onDragEnd={()=>{ setDragging(null); setDragOver(null); }}
          onDragOver={(e)=>{ if (!dragging) return; if (folder.id===dragging) return; const src = findById(folders, dragging); if (!src) return; if (src.type !== folder.type) { return; } if (isDescendant(dragging, folder.id)) { return; } e.preventDefault(); setDragOver(folder.id); }}
          onDragLeave={() => { if (dragOver===folder.id) setDragOver(null); }}
          onDrop={(e)=>{ e.preventDefault(); const sid = Number(e.dataTransfer.getData('text/plain')||dragging); if (!sid) return; if (sid===folder.id) return; const srcF = findById(folders, sid); if (!srcF) return; if (srcF.type !== folder.type) return; if (isDescendant(sid, folder.id)) return; setDragOver(null); onMoveFolder?.(srcF, folder); }}
          style={{ paddingLeft:  `${level * 10 + 8}px`, background: dragOver===folder.id ? "#f3f4f6" : "transparent" }} 
        >
          <button
            className="folder-toggle-btn"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              if (hasChildren) {
                toggleFolder(folder.id);
              }
            }}
            disabled={!hasChildren}
          >
            {hasChildren && (
              <svg className={`icon ${isExpanded ? 'expanded' : ''}`} viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z" clipRule="evenodd" />
              </svg>
            )}
          </button>
          
          <svg className="w-4 h-4 folder-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-5l-2-2H5a2 2 0 00-2 2z" />
          </svg>
          
          {isEditing ? (
            <form onSubmit={handleRename} className="rename-form">
              <input 
                type="text"
                value={editingName}
                onChange={(e) => setEditingName(e.target.value)}
                onBlur={handleRename}
                autoFocus
                className="rename-input"
              />
            </form>
          ) : (
            <span>{folder.name}</span>
          )}
        </a>
        
        {hasChildren && isExpanded && (
          <ul className="nav-list-folder">
            {folder.children.map(child => renderFolder(child, level + 1))}
          </ul>
        )}
      </li>
    );
  };

  return (
    <>
      <ul className="nav-list-folder">
        {folders.map(folder => renderFolder(folder, 0))}
      </ul>
      
      <ContextMenu
        isOpen={contextMenu.visible}
        position={{ x: contextMenu.x, y: contextMenu.y }}
        onClose={() => setContextMenu({ visible: false, x: 0, y: 0, folder: null, isDeletable: true })}
        onEdit={() => handleContextMenuAction('edit')}
        onNewFile={() => handleContextMenuAction('newFile')}
        onNewFolder={() => handleContextMenuAction('newFolder')}
        onSort={() => handleContextMenuAction('sort')}
        onDelete={() => handleContextMenuAction('delete')}
        isDeletable={contextMenu.isDeletable}
      />
    </>
  );
};

export default FolderTree;


