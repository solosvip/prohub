import React, { useState } from 'react'
import './ImageDetailModal.css'

const ImageDetailModal = ({ isOpen, onClose, item = null }) => {
  const [currentImageIndex, setCurrentImageIndex] = useState(0)
  const [isEditing, setIsEditing] = useState(false)

  // 获取图片URL的辅助函数
  const getImageUrl = (item) => {
    if (!item) return null

    if (item.content_type === 'image') {
      // 图片详情模态框优先显示原图，而不是缩略图
      if (item.file_path) {
        return `/uploads/${item.file_path}`
      }
      if (item.thumbnail_path) {
        return `/uploads/thumbnails/${item.thumbnail_path}`
      }
    } else if (item.content_type === 'video') {
      if (item.file_path) {
        return `/uploads/${item.file_path}`
      }
    }
    return null
  }

  // 表单状态
  const [formData, setFormData] = useState({
    title: '',
    content: '',
    folder_id: '',
    tag_ids: [],
    is_favorite: false
  })

  // 初始化表单数据
  React.useEffect(() => {
    if (item) {
      setFormData({
        title: item.title || '',
        content: item.content || '',
        folder_id: item.folder_id || '',
        tag_ids: item.tags?.map(tag => tag.id) || [],
        is_favorite: item.is_favorite || false
      })
    }
  }, [item])

  if (!isOpen || !item) return null

  // 模拟图片组数据（后续需要从API获取）
  const imageGroup = [item] // 暂时只有一张图片，后续支持多张

  const handlePrevImage = () => {
    setCurrentImageIndex((prev) => (prev - 1 + imageGroup.length) % imageGroup.length)
  }

  const handleNextImage = () => {
    setCurrentImageIndex((prev) => (prev + 1) % imageGroup.length)
  }

  const handleInputChange = (e) => {
    const { name, value, type, checked } = e.target
    setFormData(prev => ({
      ...prev,
      [name]: type === 'checkbox' ? checked : value
    }))
  }

  const handleSave = () => {
    // TODO: 调用API保存修改
    console.log('保存修改:', formData)
    setIsEditing(false)
  }

  const handleDelete = () => {
    // TODO: 调用API删除
    console.log('删除内容:', item.id)
    onClose()
  }

  const handleShare = () => {
    // TODO: 实现分享功能
    console.log('分享内容:', item.id)
  }

  const currentImage = imageGroup[currentImageIndex]

  return (
    <div className="image-detail-modal-overlay">
      <div className="image-detail-modal" onClick={(e) => e.stopPropagation()}>
        {/* 关闭按钮 */}
        <button className="image-detail-modal-close" onClick={onClose}>
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>

        <div className="image-detail-modal-content">
          {/* 左侧图片区域 */}
          <div className="image-detail-modal-left">
            <div className="image-detail-modal-image-container">
              {currentImage.content_type === 'image' ? (
                (() => {
                  const imageUrl = getImageUrl(currentImage)
                  return imageUrl ? (
                    <img
                      src={imageUrl}
                      alt={currentImage.title}
                      className="image-detail-modal-image"
                      onError={(e) => {
                        e.target.style.display = 'none'
                        // 可以在这里添加错误提示
                      }}
                    />
                  ) : (
                    <div className="image-placeholder">
                      <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor" style={{ width: '48px', height: '48px', color: '#9ca3af' }}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="m2.25 15.75 5.159-5.159a2.25 2.25 0 0 1 3.182 0l5.159 5.159m-1.5-1.5 1.409-1.409a2.25 2.25 0 0 1 3.182 0l2.909 2.909m-18 3.75h16.5a1.5 1.5 0 0 0 1.5-1.5V6a1.5 1.5 0 0 0-1.5-1.5H3.75A1.5 1.5 0 0 0 2.25 6v12a1.5 1.5 0 0 0 1.5 1.5Zm10.5-11.25h.008v.008h-.008V8.25Zm.375 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Z" />
                      </svg>
                      <p style={{ color: '#9ca3af', marginTop: '8px' }}>图片加载失败</p>
                    </div>
                  )
                })()
              ) : (
                (() => {
                  const videoUrl = getImageUrl(currentImage)
                  return videoUrl ? (
                    <video
                      src={videoUrl}
                      controls
                      className="image-detail-modal-video"
                      onError={(e) => {
                        e.target.style.display = 'none'
                      }}
                    />
                  ) : (
                    <div className="image-placeholder">
                      <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor" style={{ width: '48px', height: '48px', color: '#9ca3af' }}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="m15.75 10.5 4.72-4.72a.75.75 0 0 1 1.28.53v11.38a.75.75 0 0 1-1.28.53l-4.72-4.72M4.5 18.75h9a2.25 2.25 0 0 0 2.25-2.25V7.5a2.25 2.25 0 0 0-2.25-2.25h-9A2.25 2.25 0 0 0 2.25 7.5v9a2.25 2.25 0 0 0 2.25 2.25Z" />
                      </svg>
                      <p style={{ color: '#9ca3af', marginTop: '8px' }}>视频加载失败</p>
                    </div>
                  )
                })()
              )}

              {/* 图片导航箭头 */}
              {imageGroup.length > 1 && (
                <>
                  <button
                    className="image-detail-modal-nav prev"
                    onClick={handlePrevImage}
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
                    </svg>
                  </button>
                  <button
                    className="image-detail-modal-nav next"
                    onClick={handleNextImage}
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" d="m8.25 4.5 7.5 7.5-7.5 7.5" />
                    </svg>
                  </button>
                </>
              )}

              {/* 图片指示器 */}
              {imageGroup.length > 1 && (
                <div className="image-detail-modal-indicators">
                  {imageGroup.map((_, index) => (
                    <button
                      key={index}
                      className={`indicator ${index === currentImageIndex ? 'active' : ''}`}
                      onClick={() => setCurrentImageIndex(index)}
                    />
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* 右侧信息区域 */}
          <div className="image-detail-modal-right">
            <div className="image-detail-modal-info">
              {/* 标题 */}
              {isEditing ? (
                <input
                  type="text"
                  name="title"
                  value={formData.title}
                  onChange={handleInputChange}
                  className="image-detail-modal-title-input"
                  placeholder="输入标题..."
                />
              ) : (
                <h2 className="image-detail-modal-title">{item.title}</h2>
              )}

              {/* 提示词内容 */}
              {isEditing ? (
                <textarea
                  name="content"
                  value={formData.content}
                  onChange={handleInputChange}
                  className="image-detail-modal-content-input"
                  placeholder="输入提示词内容..."
                  rows={6}
                />
              ) : (
                <div className="image-detail-modal-content">
                  <h3>提示词</h3>
                  <p>{item.content || '暂无提示词内容'}</p>
                </div>
              )}

              {/* 分类信息 */}
              <div className="image-detail-meta">
                <span className="meta-label">分类:</span>
                <span className="meta-value">{item.folder?.name || '未分类'}</span>
              </div>

              {/* 标签 */}
              <div className="image-detail-modal-tags">
                <h4>标签</h4>
                <div className="tags-container">
                  {item.tags && item.tags.length > 0 ? (
                    item.tags.map((tag) => (
                      <span
                        key={tag.id}
                        className="tag"
                        style={{ backgroundColor: tag.color + '20', color: tag.color }}
                      >
                        {tag.name}
                      </span>
                    ))
                  ) : (
                    <span className="no-tags">暂无标签</span>
                  )}
                </div>
              </div>

              {/* 操作按钮 */}
              <div className="image-detail-modal-actions">
                {isEditing ? (
                  <div className="edit-actions">
                    <button className="btn btn--primary" onClick={handleSave}>
                      保存
                    </button>
                    <button className="btn btn--secondary" onClick={() => setIsEditing(false)}>
                      取消
                    </button>
                  </div>
                ) : (
                  <div className="view-actions">
                    <button
                      className={`action-btn ${item.is_favorite ? 'active' : ''}`}
                      onClick={handleShare}
                      title="分享"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M7.217 10.907a2.25 2.25 0 100 2.186m0-2.186c.18.324.283.696.283 1.093s-.103.77-.283 1.093m0-2.186l9.566-5.314m-9.566 7.5l9.566 5.314m0 0a2.25 2.25 0 103.935 2.186 2.25 2.25 0 00-3.935-2.186zm0-12.814a2.25 2.25 0 103.933-2.185 2.25 2.25 0 00-3.933 2.185z" />
                      </svg>
                    </button>
                    <button
                      className={`action-btn ${item.is_favorite ? 'active' : ''}`}
                      title={item.is_favorite ? '取消收藏' : '收藏'}
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" fill={item.is_favorite ? 'currentColor' : 'none'} viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M11.48 3.499a.562.562 0 011.04 0l2.125 5.111a.563.563 0 00.475.345l5.518.442c.499.04.701.663.321.988l-4.204 3.602a.563.563 0 00-.182.557l1.285 5.385a.562.562 0 01-.84.61l-4.725-2.885a.563.563 0 00-.586 0L6.982 20.54a.562.562 0 01-.84-.61l1.285-5.386a.562.562 0 00-.182-.557l-4.204-3.602a.563.563 0 01.321-.988l5.518-.442a.563.563 0 00.475-.345L11.48 3.5z" />
                      </svg>
                    </button>
                    <button
                      className="action-btn edit-btn"
                      onClick={() => setIsEditing(true)}
                      title="编辑"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L10.582 16.07a4.5 4.5 0 0 1-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 0 1 1.13-1.897l8.932-8.931Zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0 1 15.75 21H5.25A2.25 2.25 0 0 1 3 18.75V8.25A2.25 2.25 0 0 1 5.25 6h10.5A2.25 2.25 0 0 1 18 8.25v4.75Z" />
                      </svg>
                    </button>
                    <button
                      className="action-btn delete-btn"
                      onClick={handleDelete}
                      title="删除"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0" />
                      </svg>
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

export default ImageDetailModal