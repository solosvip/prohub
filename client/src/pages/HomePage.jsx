import React, { useState, useRef, useEffect } from 'react';
import { useQuery } from 'react-query';
import { useLocation, useNavigate, useOutletContext } from 'react-router-dom';
import api from '../services/api';
import ItemCard from '../components/ItemCard';
import TextCard from '../components/TextCard';
import ConfirmModal from '../components/ConfirmModal';
import LoadingSpinner from '../components/LoadingSpinner';
import ContextMenu from '../components/ContextMenu';

const HomePage = () => {
  const { 
    activeFilter, 
    activeFolderId, 
    handleOpenModal, 
    handleCloseModal, 
    isModalOpen, 
    selectedItem, 
    modalMode 
  } = useOutletContext();
  const location = useLocation();
  const navigate = useNavigate();
  const [searchQuery, setSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState('updated_at');
  const [sortOrder, setSortOrder] = useState('desc');
  // 仅显示收藏
  const [onlyFavorites, setOnlyFavorites] = useState(false);
  const [activeTag, setActiveTag] = useState(null); // { id, name }
  const contentHeaderRef = useRef(null);
  const scrollContainerRef = useRef(null);

  // 图片详情模态框状态

  // 右键菜单状态
  const [contextMenu, setContextMenu] = useState({
    isOpen: false,
    position: { x: 0, y: 0 },
    item: null
  });

  const [confirmDelete, setConfirmDelete] = useState({ open: false, item: null });

  // 获取内容列表
  const { data: itemsData, isLoading, error, refetch } = useQuery(
    ['items', activeFilter, activeFolderId, activeTag?.id || null, searchQuery, sortBy, sortOrder, onlyFavorites ? 'fav' : 'all'],
    () => {
      console.log('API调用参数:', {
        content_type: activeFilter === 'all' ? undefined : activeFilter,
        folder_id: activeTag ? undefined : (activeFolderId || undefined),
        tag_id: activeTag?.id || undefined,
        q: searchQuery || undefined,
        sort: sortBy,
        order: sortOrder,
        is_favorite: onlyFavorites ? 1 : undefined,
        page: 1,
        page_size: 50
      });
      
      return api.getItems({
        content_type: activeFilter === 'all' ? undefined : activeFilter,
        folder_id: activeTag ? undefined : (activeFolderId || undefined),
        tag_id: activeTag?.id || undefined,
        q: searchQuery || undefined,
        sort: sortBy,
        order: sortOrder,
        is_favorite: onlyFavorites ? 1 : undefined,
        page: 1,
        page_size: 50
      });
    },
    {
      keepPreviousData: true,
      onError: (error) => {
        console.error('useQuery错误:', error);
      },
      onSuccess: (data) => {
        console.log('useQuery成功:', data);
      }
    }
  );

  // 滚动时添加头部阴影效果
  useEffect(() => {
    const scrollContainer = scrollContainerRef.current;
    const contentHeader = contentHeaderRef.current;

    if (!scrollContainer || !contentHeader) return;

    const handleScroll = () => {
      if (scrollContainer.scrollTop > 10) {
        contentHeader.classList.add('scrolled');
      } else {
        contentHeader.classList.remove('scrolled');
      }
    };

    scrollContainer.addEventListener('scroll', handleScroll);
    return () => scrollContainer.removeEventListener('scroll', handleScroll);
  }, []);

  const handleSearch = (e) => {
    if (e.key === 'Enter') {
      refetch();
    }
  };

  const toggleSortOrder = () => {
    setSortOrder(prev => prev === 'desc' ? 'asc' : 'desc');
  };

  // 按标签筛选：在当前类型下过滤；不限制文件夹范围
  const handleTagClick = (tag) => {
    if (!tag) return;
    setActiveTag({ id: tag.id, name: tag.name });
  };
  const clearActiveTag = () => setActiveTag(null);

  // 处理弹窗相关操作
  const handleOpenCreateModal = () => {
    handleOpenModal('create', null);
  };

  const handleOpenEditModal = (item) => {
    handleOpenModal('edit', item);
  };

  // 处理图片点击
  const handleImageClick = (item) => {
    handleOpenEditModal(item);
  };

  // 关闭图片详情模态框
  // 处理右键菜单
  const handleContextMenu = (e, item) => {
    setContextMenu({
      isOpen: true,
      position: { x: e.clientX, y: e.clientY },
      item
    });
  };

  const handleCloseContextMenu = () => {
    setContextMenu(prev => ({ ...prev, isOpen: false }));
  };

  const requestDelete = (item) => {
    setConfirmDelete({ open: true, item });
  };

  const performDelete = async () => {
    const it = confirmDelete.item;
    if (!it) return;
    try {
      await api.deleteItem(it.id);
      setConfirmDelete({ open: false, item: null });
      setContextMenu(prev => ({ ...prev, isOpen: false }));
      refetch();
      try { (await import('react-toastify')).toast.success('已删除'); } catch (_) {}
    } catch (e) {
      console.error('Delete failed', e);
      try { (await import('react-toastify')).toast.error(e.response?.data?.error?.message || e.message); } catch (_) {}
    }
  };

  

  const items = itemsData?.data?.items || [];

  // 从侧栏"创建"读取路由状态打开内容创建弹窗
  useEffect(() => {
    if (location.state && location.state.openCreate) {
      handleOpenModal('create', null);
      // 清理 state，避免刷新或返回重复打开
      navigate('.', { replace: true, state: {} });
    }
  }, [location.state, navigate, handleOpenModal]);

  return (
    <>
      {/* 内容头部 - 严格按照UI原型 */}
      <header className="content-header" ref={contentHeaderRef}>
        <div className="search-bar">
          <svg className="icon" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor" style={{width:'20px', height:'20px'}}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
          </svg>
          <input 
            type="text" 
            className="input" 
            placeholder="搜索你的Prompt..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyPress={handleSearch}
          />
        </div>
        <div className="controls-group">
          <div className="separator" style={{ display:'none' }}></div>
          {/* 全部/收藏 切换：按钮文案显示“要切换到的状态”，默认展示全部，此时按钮显示“收藏” */}
          <button
            className="control-button"
            style={{fontWeight: 'bold', fontSize: '0.9rem'}}
            onClick={() => setOnlyFavorites(prev => !prev)}
            title={onlyFavorites ? '切换为显示全部' : '仅显示收藏'}
          >
            {onlyFavorites ? '全部' : '收藏'}
          </button>
          <button className="control-button" style={{fontWeight: 'bold', fontSize: '0.9rem', gap: '4px'}} onClick={toggleSortOrder}>
            {sortOrder === 'desc' ? '最新' : '最旧'}
            <svg className="icon" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="2" stroke="currentColor" style={{width:'16px', height: '16px'}}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
            </svg>
          </button>
          <button className="control-button" onClick={handleOpenCreateModal}>
            <svg className="icon" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
            </svg>
          </button>
        </div>
      </header>
      {activeTag && (
        <div style={{ padding: '0 24px 8px 24px' }}>
          <div style={{ display:'inline-flex', alignItems:'center', gap:'8px', background:'#EEF2FF', color:'#3730a3', border:'1px solid #E0E7FF', borderRadius:'16px', padding:'6px 10px', fontSize:'12px' }}>
            <span>标签筛选：</span>
            <strong>#{activeTag.name}</strong>
            <button onClick={clearActiveTag} style={{ border:'none', background:'transparent', color:'#6b7280', cursor:'pointer' }}>清除</button>
          </div>
        </div>
      )}

      {/* 瀑布流网格 */}
      <div className="item-grid-container" ref={scrollContainerRef}>
        {isLoading ? (
          <LoadingSpinner />
        ) : error ? (
          <div className="error">
            加载失败: {error.response?.data?.error?.message || error.message}
          </div>
        ) : items.length === 0 ? (
          <div className="empty-state">
            <div style={{ textAlign: 'center', padding: '48px', color: '#6b7280' }}>
              <svg className="icon" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor" style={{ width: '48px', height: '48px', margin: '0 auto 16px' }}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z" />
              </svg>
              <h3 style={{ marginBottom: '8px', fontSize: '1.125rem', fontWeight: '600' }}>还没有内容</h3>
              <p style={{ fontSize: '0.875rem' }}>点击右上角的 + 按钮开始创建你的第一个Prompt</p>
            </div>
          </div>
        ) : (
          <div className={activeFilter === 'text' ? 'text-grid' : 'item-grid'}>
            {items.map((item) => {
              const ct = (item.content_type || '').toLowerCase();
              const isText = ct.startsWith('text');
              return isText ? (
                <TextCard
                  key={item.id}
                  item={item}
                  onEdit={() => handleOpenEditModal(item)}
                  onTagClick={handleTagClick}
                  onDelete={() => requestDelete(item)}
                />
              ) : (
                <ItemCard
                  key={item.id}
                  item={item}
                  onClick={handleImageClick}
                  onContextMenu={handleContextMenu}
                  onTagClick={handleTagClick}
                  onDelete={() => requestDelete(item)}
                />
              );
            })}
          </div>
        )}
      </div>

      {/* 图片详情模态框 */}

      {/* 右键菜单 */}
      <ContextMenu
        isOpen={contextMenu.isOpen}
        position={contextMenu.position}
        onClose={handleCloseContextMenu}
        onEdit={() => handleOpenEditModal(contextMenu.item)}
        onDelete={() => requestDelete(contextMenu.item)}
        isDeletable={true}
        itemType="file"
      />

      <ConfirmModal
        isOpen={confirmDelete.open}
        onClose={() => setConfirmDelete({ open: false, item: null })}
        onConfirm={performDelete}
        title="删除内容"
        message={confirmDelete.item ? `确定要删除「${confirmDelete.item.title}」吗？此操作不可撤销。` : ''}
        confirmText="删除"
        type="danger"
      />
    </>
  );
};

export default HomePage;