import React, { useRef, useState, useEffect } from 'react'
import { toast } from 'react-toastify'
import Tooltip from './Tooltip'
import api from '../services/api'

// Helpers to render color-coded tag capsules on media
const hexToRgba = (hex, alpha = 1) => {
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

const getContrastingTextColor = (hexColor) => {
  try {
    if (!hexColor || !hexColor.startsWith('#')) return '#000000';
    const r = parseInt(hexColor.substr(1, 2), 16);
    const g = parseInt(hexColor.substr(3, 2), 16);
    const b = parseInt(hexColor.substr(5, 2), 16);
    const yiq = ((r * 299) + (g * 587) + (b * 114)) / 1000;
    return (yiq >= 128) ? '#000000' : '#FFFFFF';
  } catch (_) {
    return '#000000';
  }
};

const ItemCard = ({ item, onClick, onContextMenu, onDelete, onTagClick }) => {
  const [showPreview, setShowPreview] = useState(false)
  const [isHover, setIsHover] = useState(false)
  const hoverTimerRef = useRef(null)
  const videoRef = useRef(null)
  const progressRef = useRef(0)
  const getImageUrl = (item) => {
    const ct = (item.content_type || '').toLowerCase();
    if (ct.startsWith('image')) {
      return item.thumbnail_path ? `/uploads/thumbnails/${item.thumbnail_path}` : `/uploads/${item.file_path}`;
    }
    if (ct.startsWith('video')) {
      // For videos, only use generated thumbnail; fallback to a neutral placeholder
      if (item.thumbnail_path) return `/uploads/thumbnails/${item.thumbnail_path}`;
      return 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 250"><rect width="400" height="250" fill="#e5e7eb"/></svg>';
    }
    return null;
  }

  const handleCardClick = () => {
    onClick?.(item)
  }

  const handleContextMenu = (e) => {
    e.preventDefault()
    e.stopPropagation()
    onContextMenu?.(e, item)
  }

  const isVideo = (item.content_type || '').toLowerCase().startsWith('video')
  const [fav, setFav] = useState(!!item.is_favorite)
  useEffect(() => { setFav(!!item.is_favorite) }, [item.id, item.is_favorite])

  const handleToggleFavorite = async (e) => {
    e.stopPropagation()
    try {
      const res = await api.toggleFavorite(item.id)
      const newFav = typeof res?.data?.is_favorite === 'number' ? !!res.data.is_favorite : !fav
      setFav(newFav)
      toast.success(newFav ? '已加入收藏' : '已取消收藏')
    } catch (err) {
      toast.error('操作失败')
    }
  }

  useEffect(() => {
    if (isVideo && showPreview && videoRef.current) {
      try {
        if (progressRef.current > 0) videoRef.current.currentTime = progressRef.current
        videoRef.current.muted = true
        videoRef.current.play().catch(() => {})
      } catch (_) {}
    }
  }, [showPreview, isVideo])

  // 图片/视频内容
  if ((item.content_type || '').startsWith('image') || (item.content_type || '').startsWith('video')) {
    return (
      <div
        className="item-card"
        onClick={handleCardClick}
        onContextMenu={handleContextMenu}
        onMouseEnter={() => {
          setIsHover(true)
          if (isVideo) {
            if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current)
            hoverTimerRef.current = setTimeout(() => {
              setShowPreview(true)
            }, 500)
          }
        }}
        onMouseLeave={() => {
          setIsHover(false)
          if (hoverTimerRef.current) { clearTimeout(hoverTimerRef.current); hoverTimerRef.current = null }
          if (showPreview) {
            try { 
              if (videoRef.current) { 
                progressRef.current = videoRef.current.currentTime || 0
                videoRef.current.pause()
              }
            } catch (_) {}
            setShowPreview(false)
          }
        }}
      >
        {!isVideo || !showPreview ? (
          <img
            className="item-card__image"
            src={getImageUrl(item)}
            alt={item.title}
            loading="lazy"
          />
        ) : (
          <video
            ref={videoRef}
            className="item-card__image item-card__video"
            src={item.file_path ? `/uploads/${item.file_path}` : ''}
            poster={item.thumbnail_path ? `/uploads/thumbnails/${item.thumbnail_path}` : undefined}
            muted
            playsInline
            autoPlay
            loop
            preload="metadata"
          />
        )}
        <button
          type="button"
          className="item-card__delete"
          title="删除"
          onClick={(e) => { e.stopPropagation(); onDelete?.(item) }}
        >
          ×
        </button>
        <Tooltip text={fav ? '取消收藏' : '收藏'} wrapperClassName='item-card__fav-wrap'>
          <button
            type="button"
            className="item-card__fav"
            aria-label={fav ? '取消收藏' : '收藏'}
            onClick={handleToggleFavorite}
          >
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill={fav ? '#f59e0b' : '#ffffff'} width="16" height="16">
              <path d="M11.48 3.499a.562.562 0 011.04 0l2.125 5.111a.563.563 0 00.475.345l5.518.442c.499.04.701.663.321.988l-4.204 3.57a.563.563 0 00-.182.557l1.285 5.385a.562.562 0 01-.84.61l-4.73-2.727a.563.563 0 00-.563 0l-4.73 2.727a.562.562 0 01-.84-.61l1.285-5.385a.563.563 0 00-.182-.557L2.54 10.385a.562.562 0 01.321-.988l5.518-.442a.563.563 0 00.475-.345l2.125-5.111z" />
            </svg>
          </button>
        </Tooltip>
        {isHover && (item.tags && item.tags.length > 0) && (
          <div className='item-card__tag-overlay' onClick={(e)=>e.stopPropagation()}>
            {(item.tags || []).slice(0, 4).map((tag) => {
              const base = hexToRgba(tag.color || '#6b7280', 0.5); // base alpha
              const hover = hexToRgba(tag.color || '#6b7280', 0.6); // hover alpha
              const fg = getContrastingTextColor(tag.color || '#6b7280');
              return (
                <span
                  key={tag.id}
                  className='item-card__tag'
                  style={{
                    '--tag-bg': base,
                    '--tag-bg-hover': hover,
                    color: fg,
                    border: '1px solid rgba(255,255,255,0.35)', // subtle light border for glass feel
                    boxShadow: '0 2px 6px rgba(0,0,0,0.12)',      // soft elevation to separate from media
                    backdropFilter: 'saturate(160%) blur(2px)',   // glass effect (reduced blur)
                    WebkitBackdropFilter: 'saturate(160%) blur(2px)'
                  }}
                  onClick={(e)=>{ e.stopPropagation(); onTagClick?.(tag); }}
                >
                  {tag.name}
                </span>
              );
            })}
          </div>
        )}
      </div>
    )
  }

  // 文本内容：使用TextCard组件处理
  return null // 文本内容由TextCard组件处理
}

export default ItemCard