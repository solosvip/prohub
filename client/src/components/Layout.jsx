import React, { useState, useMemo, useEffect } from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useQuery, useMutation, useQueryClient } from 'react-query';
import api from '../services/api';
import FolderTree from './FolderTree';
import InputModal from './InputModal';
import ConfirmModal from './ConfirmModal';
import CreationView from './CreationView';
import FolderEditModal from './FolderEditModal';

const Layout = () => {
  const { logout } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [activeFilter, setActiveFilter] = useState('text');
  const [activeFolderId, setActiveFolderId] = useState(null);
  const [expandedFolders, setExpandedFolders] = useState({});
  const [isInputModalOpen, setIsInputModalOpen] = useState(false);
  const [currentParentId, setCurrentParentId] = useState(null);

  const [view, setView] = useState('home');
  const [selectedItem, setSelectedItem] = useState(null);
  const [modalMode, setModalMode] = useState('create');
  const [defaultCreationType, setDefaultCreationType] = useState('text');

  const [confirmModal, setConfirmModal] = useState({
    isOpen: false,
    title: '',
    message: '',
    onConfirm: null,
    type: 'warning',
    confirmText: '确认',
    cancelText: '取消'
  });

  const [editModal, setEditModal] = useState({ open: false, folder: null });

  const { data: foldersData, isLoading: isLoadingFolders } = useQuery('folders', () => api.getFolders());

  useEffect(() => {
    if (location.pathname === '/' && foldersData?.data && activeFolderId === null) {
      const textFolder = (foldersData?.data || []).find(f => f.parent_id === null && f.type === 'text');
      if (textFolder) {
        setActiveFolderId(textFolder.id);
        setActiveFilter('text');
      }
    }
  }, [location.pathname, foldersData, activeFolderId]);

  const createFolderMutation = useMutation((data) => api.createFolder(data), {
    onSuccess: (result) => {
      queryClient.invalidateQueries('folders');
      if (result?.data?.id) {
        setActiveFolderId(result.data.id);
      }
    },
    onError: (error) => {
      showErrorMessage(`创建文件夹失败: ${error.response?.data?.error?.message || error.message}`);
    }
  });

  const updateFolderMutation = useMutation(({ id, data }) => api.updateFolder(id, data), {
    onSuccess: () => {
      queryClient.invalidateQueries('folders');
    },
    onError: (error) => {
      showErrorMessage(`重命名文件夹失败: ${error.response?.data?.error?.message || error.message}`);
    }
  });

  const deleteFolderMutation = useMutation((id) => api.deleteFolder(id), {
    onSuccess: (data, id) => {
      queryClient.invalidateQueries('folders');
      setActiveFolderId(prevId => prevId === id ? null : prevId);
    },
    onError: (error) => {
      showErrorMessage(`删除文件夹失败: ${error.response?.data?.error?.message || error.message}`);
    }
  });

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

  const isActive = (path) => {
    if (path === '/') return location.pathname === '/';
    return location.pathname.startsWith(path);
  };

  const handleSelectFolder = (folder) => {
    if (!folder) return;
    navigate('/');
    setActiveFilter(folder.type || 'all');
    setActiveFolderId(folder.id);
  };

  const handleToggleFolder = (folderId) => {
    setExpandedFolders(prev => ({ ...prev, [folderId]: !prev[folderId] }));
  };

  const handleOpenCreationView = (mode = 'create', item = null) => {
    setModalMode(mode);
    setSelectedItem(item);
    setView('creation');
  };

  const handleCloseCreationView = () => {
    setView('home');
    setSelectedItem(null);
  };

  

  const handleEditFolder = (folder) => { setEditModal({ open: true, folder }); };
  const closeEditModal = () => setEditModal({ open: false, folder: null });
  const saveFolderMeta = async (payload) => { const { folder } = editModal; if (!folder) return; await updateFolderMutation.mutateAsync({ id: folder.id, data: { name: (payload.name ?? folder.name), parent_id: (payload.parent_id ?? folder.parent_id) } }); closeEditModal(); };
  const moveFolder = async (src, target) => { try { await updateFolderMutation.mutateAsync({ id: src.id, data: { name: src.name, parent_id: target.id } }); setActiveFolderId(target.id); } catch (e) {} };
  const deleteFolderRecursive = async () => { const { folder } = editModal; if (!folder) return; await api.deleteFolderRecursive(folder.id); closeEditModal(); };
  const transferDeleteFolder = async (targetId) => { const { folder } = editModal; if (!folder) return; await api.transferDeleteFolder(folder.id, targetId); closeEditModal(); };

  const handleAddSubFolder = (parentId) => {
    setCurrentParentId(parentId);
    setIsInputModalOpen(true);
  };

  const handleConfirmCreateFolder = (name) => {
    createFolderMutation.mutate({ name, parent_id: currentParentId });
    setIsInputModalOpen(false);
    setCurrentParentId(null);
  };

  const showErrorMessage = (message) => {
    setConfirmModal({ isOpen: true, title: '操作失败', message, type: 'danger', onConfirm: () => {}, confirmText: '确定', cancelText: '' });
  };

  const showConfirmDialog = ({ title, message, onConfirm, type = 'warning', confirmText = '确认', cancelText = '取消' }) => {
    setConfirmModal({ isOpen: true, title, message, onConfirm, type, confirmText, cancelText });
  };

  const closeConfirmModal = () => {
    setConfirmModal({ isOpen: false, title: '', message: '', onConfirm: null, type: 'warning' });
  };

  const handleInlineRenameFolder = (folder, newName) => {
    if (!newName || newName.trim() === folder.name) return;
    updateFolderMutation.mutate({ id: folder.id, data: { name: newName.trim(), parent_id: folder.parent_id } });
  };

  const handleDeleteFolder = (folder) => {
    showConfirmDialog({
      title: '删除文件夹',
      message: `确定要删除文件夹 "${folder.name}" 吗？此操作不可撤销。`,
      type: 'danger',
      confirmText: '删除',
      onConfirm: () => deleteFolderMutation.mutate(folder.id)
    });
  };

  const handleCreateFile = (folder) => {
    setDefaultCreationType(folder.type || 'text');
    setActiveFolderId(folder.id);
    handleOpenCreationView('create', null);
  };

  const { displayTree, uncategorizedFolder } = useMemo(() => {
    const dbFolders = foldersData?.data || [];
    const uncategorized = dbFolders.find(f => f.parent_id === null && !f.type);
    const regularFolders = dbFolders.filter(f => !(f.parent_id === null && !f.type));


    regularFolders.sort((a, b) => { const order = { text: 0, image: 1, video: 2 }; const ia = (order[a.type] ?? 99); const ib = (order[b.type] ?? 99); if (ia  !== ib) return ia - ib; return (a.name ||  '').localeCompare(b.name || ''); });
    return { displayTree: regularFolders, uncategorizedFolder: uncategorized };
  }, [foldersData]);

  return (
    <>
      <div className="app-layout">
        <aside className="sidebar">
          <div className="sidebar__logo">Prompt Collector</div>
          <div className="sidebar__group">
            <ul className="nav-list">
              <li className="nav-item">
                <a onClick={() => handleOpenCreationView('create', null)}>
                  <svg className="icon" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z" /></svg>
                  创建
                </a>
              </li>
            </ul>
          </div>

          <div className="sidebar__group">
            {isLoadingFolders ? <p>Loading...</p> : (
              <FolderTree 
                folders={displayTree} 
                activeFolderId={activeFolderId}
                onFolderClick={handleSelectFolder} 
                onAddSubfolder={handleAddSubFolder}
                onEditFolder={handleEditFolder}
                onDeleteFolder={handleDeleteFolder}
                onCreateFile={handleCreateFile}
                onMoveFolder={moveFolder}
              />
            )}
          </div>
          <div className="sidebar__group" style={{ marginTop: 'auto' }}>
            <ul className="nav-list">
              <li className={`nav-item ${isActive('/stats') ? 'active' : ''}`}>
                <a onClick={() => navigate('/stats')}>
                   <svg className="icon" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z" /></svg>
                  统计
                </a>
              </li>
              <li className="nav-item">
                <a onClick={handleLogout}>
                  <svg className="icon" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M17.982 18.725A7.488 7.488 0 0 0 12 15.75a7.488 7.488 0 0 0-5.982 2.975m11.963 0a9 9 0 1 0-11.963 0m11.963 0A8.966 8.966 0 0 0 12 21a8.966 8.966 0 0 1-5.982-2.275M15 9.75a3 3 0 1 1-6 0 3 3 0 0 1 6 0z" /></svg>
                  退出登录
                </a>
              </li>
            </ul>
          </div>
        </aside>
        <main className="content-area">
          {view === 'creation' ? (
            <CreationView
              onCancel={handleCloseCreationView}
              item={selectedItem}
              mode={modalMode}
              defaultFolderId={activeFolderId}
              defaultType={defaultCreationType}
              onCreated={(newItem) => { setSelectedItem(newItem); setModalMode('edit'); }}
            />
          ) : (
            <Outlet context={{ 
              activeFilter, 
              setActiveFilter, 
              activeFolderId, 
              setActiveFolderId,
              handleOpenModal: handleOpenCreationView,
              handleCloseModal: handleCloseCreationView,
              isModalOpen: view === 'creation',
              selectedItem,
              modalMode
            }} />
          )}
        </main>
      </div>
      <InputModal 
        isOpen={isInputModalOpen}
        onClose={() => setIsInputModalOpen(false)}
        onSubmit={handleConfirmCreateFolder}
        title={currentParentId ? "新建子文件夹" : "新建文件夹"}
        placeholder="请输入文件夹名称"
      />
      
      <ConfirmModal
        isOpen={confirmModal.isOpen}
        onClose={closeConfirmModal}
        onConfirm={confirmModal.onConfirm}
        title={confirmModal.title}
        message={confirmModal.message}
        type={confirmModal.type}
        confirmText={confirmModal.confirmText}
        cancelText={confirmModal.cancelText}
      />

      <FolderEditModal
        isOpen={editModal.open}
        folder={editModal.folder}
        foldersTree={displayTree}
        onClose={closeEditModal}
        onSave={saveFolderMeta}
        onDeleteRecursive={deleteFolderRecursive}
        onTransferDelete={transferDeleteFolder}
      />
    </>
  )
}
export default Layout