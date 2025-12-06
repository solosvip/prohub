import React, { useEffect, useState } from 'react'
import { toast } from 'react-toastify'
import api from '../services/api'
import Tooltip from './Tooltip'

const TextCard = ({ item, onEdit, onDelete, onTagClick }) => {
  const formatDate = (dateString) => {
    const date = new Date(dateString)
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric'
    })
  }

  const getContrastingTextColor = (hexColor) => {
    if (!hexColor) return '#000000';
    const r = parseInt(hexColor.substr(1, 2), 16);
    const g = parseInt(hexColor.substr(3, 2), 16);
    const b = parseInt(hexColor.substr(5, 2), 16);
    const yiq = ((r * 299) + (g * 587) + (b * 114)) / 1000;
    return (yiq >= 128) ? '#000000' : '#FFFFFF';
  };

  // Render glass-like tag capsule using tag color with alpha
  const hexToRgba = (hex, alpha = 0.5) => {
    try {
      if (!hex) return `rgba(17,24,39,${alpha})`;
      let h = hex.trim();
      if (h.startsWith('#')) h = h.slice(1);
      if (h.length === 3) {
        const r = parseInt(h[0] + h[0], 16);
        const g = parseInt(h[1] + h[1], 16);
        const b = parseInt(h[2] + h[2], 16);
        return `rgba(${r},${g},${b},${alpha})`;
      }
      if (h.length === 6) {
        const r = parseInt(h.slice(0, 2), 16);
        const g = parseInt(h.slice(2, 4), 16);
        const b = parseInt(h.slice(4, 6), 16);
        return `rgba(${r},${g},${b},${alpha})`;
      }
    } catch (_) {}
    return `rgba(17,24,39,${alpha})`;
  };

  // Try to parse segmented content: [{ title, content }, ...]
  const parseSegments = (content) => {
    try {
      if (typeof content === 'string' && content.trim().startsWith('[') && content.trim().endsWith(']')) {
        const segs = JSON.parse(content);
        if (Array.isArray(segs) && segs.length > 0 && Object.prototype.hasOwnProperty.call(segs[0], 'content')) {
          return segs;
        }
      }
    } catch (_) {}
    return null;
  };

  const renderContent = (content) => {
    const segs = parseSegments(content);
    if (segs) return segs.map(seg => seg.content).join('\n\n');
    return content;
  };

  const handleCopyFirstSegment = async (e) => {
    e.stopPropagation();
    try {
      const segs = parseSegments(item.content);
      const text = segs && segs.length > 0 ? String(segs[0]?.content || '').trim() : String(item.content || '').trim();
      if (!text) { toast.error('没有可复制的内容'); return; }
      try { await navigator.clipboard.writeText(text); }
      catch (_) {
        const ta = document.createElement('textarea');
        ta.value = text; document.body.appendChild(ta); ta.select();
        try { document.execCommand('copy'); } finally { document.body.removeChild(ta); }
      }
      toast.success(segs ? '已复制第 1 段' : '已复制');
    } catch (err) {
      console.error('Copy failed:', err);
      toast.error('复制失败');
    }
  };

  const barBaseColor = (item.tags && item.tags.length > 0 ? item.tags[0].color : '#e0e0e0');
  const barStyle = {
    // Make the top bar semi-transparent, using the first tag color @ 0.5 alpha
    backgroundColor: hexToRgba(barBaseColor, 0.5)
  };

  const [fav, setFav] = useState(!!item.is_favorite)
  useEffect(() => { setFav(!!item.is_favorite) }, [item.id, item.is_favorite])

  const handleEditClick = (e) => { e.stopPropagation(); onEdit?.(); };
  const handleToggleFavorite = async (e) => {
    e.stopPropagation();
    try {
      const res = await api.toggleFavorite(item.id);
      const newFav = typeof res?.data?.is_favorite === 'number' ? !!res.data.is_favorite : !fav;
      setFav(newFav);
      toast.success(newFav ? '已加入收藏' : '已取消收藏');
    } catch (err) {
      toast.error('操作失败');
    }
  };

  return (
    <div className="crm-card" style={{ position: 'relative' }}>
      <div className="crm-priority-bar" style={barStyle}></div>
      <div className="card-title">{item.title}</div>
      <Tooltip text='点击编辑'>
        <div className="crm-inner" onClick={handleEditClick}>
          <div className="crm-desc" style={{ whiteSpace: 'pre-wrap' }}>{renderContent(item.content)}</div>
        </div>
      </Tooltip>
      <button
        type="button"
        className="card-delete-btn"
        title="删除"
        onClick={(e) => { e.stopPropagation(); onDelete?.(item) }}
      >
        ×
      </button>
      <div className="crm-top-row">
        {item.tags && item.tags.slice(0, 5).map((tag, index) => {
          const base = hexToRgba(tag.color || '#6b7280', 0.5);
          const hover = hexToRgba(tag.color || '#6b7280', 0.6);
          const fg = getContrastingTextColor(tag.color || '#6b7280');
          return (
            <span
              key={index}
              className="crm-status"
              style={{
                '--tag-bg': base,
                '--tag-bg-hover': hover,
                color: fg,
                border: '1px solid rgba(255,255,255,0.35)',
                boxShadow: '0 2px 6px rgba(0,0,0,0.12)',
                backdropFilter: 'saturate(160%) blur(2px)',
                WebkitBackdropFilter: 'saturate(160%) blur(2px)',
                cursor: 'pointer'
              }}
              onClick={(e) => { e.stopPropagation(); onTagClick?.(tag); }}
            >
              {tag.name || tag}
            </span>
          );
        })}
      </div>
      <div className="crm-bottom">
        <div className="crm-ico-group">
          <Tooltip text='复制'>
            <span className="crm-ico-label" onClick={handleCopyFirstSegment}>
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor">
                <path fillRule="evenodd" d="M7.502 6h7.128A3.375 3.375 0 0 1 18 9.375v9.375a3 3 0 0 0 3-3V6.108c0-1.505-1.125-2.811-2.664-2.94a48.972 48.972 0 0 0-.673-.05A3 3 0 0 0 15 1.5h-1.5a3 3 0 0 0-2.663 1.618c-.225.015-.45.032-.673.05C8.662 3.295 7.554 4.542 7.502 6ZM13.5 3A1.5 1.5 0 0 0 12 4.5h4.5A1.5 1.5 0 0 0 15 3h-1.5Z" clipRule="evenodd" />
                <path fillRule="evenodd" d="M3 9.375C3 8.339 3.84 7.5 4.875 7.5h9.75c1.036 0 1.875.84 1.875 1.875v11.25c0 1.035-.84 1.875-1.875 1.875h-9.75A1.875 1.875 0 0 1 3 20.625V9.375ZM6 12a.75.75 0 0 1 .75-.75h.008a.75.75 0 0 1 .75.75v.008a.75.75 0 0 1-.75.75H6.75a.75.75 0 0 1-.75-.75V12Zm2.25 0a.75.75 0 0 1 .75-.75h3.75a.75.75 0 0 1 0 1.5H9a.75.75 0 0 1-.75-.75ZM6 15a.75.75 0 0 1 .75-.75h.008a.75.75 0 0 1 .75.75v.008a.75.75 0 0 1-.75.75H6.75a.75.75 0 0 1-.75-.75V15Zm2.25 0a.75.75 0 0 1 .75-.75h3.75a.75.75 0 0 1 0 1.5H9a.75.75 0 0 1-.75-.75ZM6 18a.75.75 0 0 1 .75-.75h.008a.75.75 0 0 1 .75.75v.008a.75.75 0 0 1-.75.75H6.75a.75.75 0 0 1-.75-.75Z" clipRule="evenodd" />
              </svg>
            </span>
          </Tooltip>
          <Tooltip text='编辑'>
            <span className="crm-ico-label" onClick={handleEditClick}>
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor">
                <path fillRule="evenodd" d="M3 6a3 3 0 0 1 3-3h12a3 3 0 0 1 3 3v12a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3V6Zm14.25 6a.75.75 0 0 1-.22.53l-2.25 2.25a.75.75 0 1 1-1.06-1.06L15.44 12l-1.72-1.72a.75.75 0 1 1 1.06-1.06l2.25 2.25c.141.14.22.331.22.53Zm-10.28-.53a.75.75 0 0 0 0 1.06l2.25 2.25a.75.75 0 1 0 1.06-1.06L8.56 12l1.72-1.72a.75.75 0 1 0-1.06-1.06l-2.25 2.25Z" clipRule="evenodd" />
              </svg>
            </span>
          </Tooltip>
          <Tooltip text={fav ? '取消收藏' : '收藏'}>
            <span className="crm-ico-label" onClick={handleToggleFavorite}>
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill={fav ? '#f59e0b' : 'currentColor'}>
                <path d="M11.48 3.499a.562.562 0 011.04 0l2.125 5.111a.563.563 0 00.475.345l5.518.442c.499.04.701.663.321.988l-4.204 3.57a.563.563 0 00-.182.557l1.285 5.385a.562.562 0 01-.84.61l-4.73-2.727a.563.563 0 00-.563 0l-4.73 2.727a.562.562 0 01-.84-.61l1.285-5.385a.563.563 0 00-.182-.557L2.54 10.385a.562.562 0 01.321-.988l5.518-.442a.563.563 0 00.475-.345l2.125-5.111z" />
              </svg>
            </span>
          </Tooltip>
        </div>
        <div className="crm-date">{formatDate(item.updated_at || item.created_at)}</div>
      </div>
    </div>
  )
}

export default TextCard
