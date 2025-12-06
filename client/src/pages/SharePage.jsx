import React, { useState, useEffect } from 'react'
import { useParams } from 'react-router-dom'
import { useQuery } from 'react-query'
import api from '../services/api'
import { toast } from 'react-toastify'
import LoadingSpinner from '../components/LoadingSpinner'

const SharePage = () => {
  const { shareKey } = useParams()
  const [password, setPassword] = useState('')
  const [isPasswordRequired, setIsPasswordRequired] = useState(false)
  const [isVerifying, setIsVerifying] = useState(false)

  const { data: shareData, isLoading, error, refetch } = useQuery(
    ['publicShare', shareKey],
    () => api.getPublicShare(shareKey),
    {
      retry: false,
      onError: (error) => {
        if (error.response?.status === 401) {
          setIsPasswordRequired(true)
        }
      }
    }
  )

  const handlePasswordSubmit = async (e) => {
    e.preventDefault()
    if (!password.trim()) return

    setIsVerifying(true)
    try {
      await api.verifySharePassword(shareKey, password)
      setIsPasswordRequired(false)
      refetch()
    } catch (error) {
      alert('密码错误，请重试')
    } finally {
      setIsVerifying(false)
    }
  }

  if (isLoading) {
    return <LoadingSpinner message="加载分享内容..." />
  }

  if (error && !isPasswordRequired) {
    return (
      <div className="share-error">
        <div className="error-content">
          <svg className="error-icon" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
          </svg>
          <h1 className="error-title">分享链接不存在或已过期</h1>
          <p className="error-message">
            {error.response?.status === 404 ? '分享链接不存在或已被删除' : '分享链接已过期或暂时不可用'}
          </p>
        </div>
      </div>
    )
  }

  if (isPasswordRequired) {
    return (
      <div className="share-password">
        <div className="password-container">
          <div className="password-card">
            <div className="password-header">
              <svg className="lock-icon" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-7.5a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v7.5a2.25 2.25 0 002.25 2.25z" />
              </svg>
              <h1 className="password-title">此内容受密码保护</h1>
              <p className="password-subtitle">请输入访问密码查看内容</p>
            </div>
            
            <form className="password-form" onSubmit={handlePasswordSubmit}>
              <input
                type="password"
                className="password-input"
                placeholder="请输入访问密码"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={isVerifying}
                autoFocus
              />
              <button
                type="submit"
                className="password-button"
                disabled={isVerifying || !password.trim()}
              >
                {isVerifying ? '验证中...' : '访问内容'}
              </button>
            </form>
          </div>
        </div>
      </div>
    )
  }

  const share = shareData?.data
  if (!share) return null

  const getMediaUrl = (item) => {
    if (item.content_type === 'image' || item.content_type === 'video') {
      return item.thumbnail_path ? `/uploads/thumbnails/${item.thumbnail_path}` : `/uploads/${item.file_path}`
    }
    return null
  }

  return (
    <div className="share-page">
      {/* 顶部栏 */}
      <header className="share-header">
        <div className="share-header-content">
          <div className="share-brand">
            <div className="brand-logo">
              <svg className="logo-icon" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z" />
              </svg>
              <span className="brand-text">Prompt Collector</span>
            </div>
          </div>
          <div className="share-actions">
            <button className="share-action-button" onClick={async () => {
              try {
                const url = window.location.origin + '/s/' + shareKey;
                if (navigator.clipboard && window.isSecureContext) {
                  await navigator.clipboard.writeText(url);
                } else {
                  const ta = document.createElement('textarea');
                  ta.value = url; ta.setAttribute('readonly',''); ta.style.position='fixed'; ta.style.top='-1000px';
                  document.body.appendChild(ta); ta.focus(); ta.select(); document.execCommand('copy'); document.body.removeChild(ta);
                }
                toast.success('已复制');
              } catch (e) {
                toast.error('复制失败');
              }
            }}>
              <svg className="icon" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M15.666 3.888A2.25 2.25 0 0013.5 2.25h-3c-1.03 0-1.9.693-2.166 1.638m7.332 0c.055.194.084.4.084.612v0a.75.75 0 01-.75.75H9a.75.75 0 01-.75-.75v0c0-.212.03-.418.084-.612m7.332 0c.646.049 1.288.11 1.927.184 1.1.128 1.907 1.077 1.907 2.185V19.5a2.25 2.25 0 01-2.25 2.25H6.375a2.25 2.25 0 01-2.25-2.25V6.257c0-1.108.806-2.057 1.907-2.185a48.208 48.208 0 011.927-.184" />
              </svg>
              复制链接
            </button>
          </div>
        </div>
      </header>

      {/* 主要内容 */}
      <main className="share-main">
        <div className="share-container">
          <div className="share-content">
            {/* 标题和描述 */}
            <div className="content-header">
              <h1 className="content-title">{share.title || share.item.title}</h1>
              {share.description && (
                <p className="content-description">{share.description}</p>
              )}
            </div>

            {/* 媒体内容 */}
            {(share.item.content_type === 'image' || share.item.content_type === 'video') && (
              <div className="media-container">
                {share.item.content_type === 'image' ? (
                  <img
                    src={getMediaUrl(share.item)}
                    alt={share.item.title}
                    className="media-image"
                  />
                ) : (
                  <video
                    src={`/uploads/${share.item.file_path}`}
                    controls
                    className="media-video"
                    poster={getMediaUrl(share.item)}
                  >
                    您的浏览器不支持视频播放
                  </video>
                )}
              </div>
            )}

            {/* 文本内容 */}
            <div className="text-content">
              <pre className="content-text">{share.item.content}</pre>
            </div>

            {/* 标签在分享页不展示（分享页为单向展示，不含交互） */}

            {/* 底部信息 */}
            <div className="content-footer">
              <div className="content-meta">
                <span className="content-type">
                  {share.item.content_type === 'text' && '📝 文本'}
                  {share.item.content_type === 'image' && '🖼️ 图片'}
                  {share.item.content_type === 'video' && '🎬 视频'}
                </span>
                <span className="content-date">
                  分享于 {new Date(share.created_at).toLocaleDateString('zh-CN')}
                </span>
              </div>
            </div>
          </div>
        </div>
      </main>

      {/* 底部 */}
      <footer className="share-footer">
        <div className="footer-content">
          <p className="footer-text">
            由 <strong>Prompt Collector</strong> 强力驱动
          </p>
        </div>
      </footer>

      <style jsx>{`
        .share-page {
          min-height: 100vh;
          background: #fafafa;
          display: flex;
          flex-direction: column;
        }

        .share-header {
          background: white;
          border-bottom: 1px solid #e5e7eb;
          padding: 16px 0;
        }

        .share-header-content {
          max-width: 800px;
          margin: 0 auto;
          padding: 0 24px;
          display: flex;
          justify-content: space-between;
          align-items: center;
        }

        .share-brand {
          display: flex;
          align-items: center;
        }

        .brand-logo {
          display: flex;
          align-items: center;
          gap: 8px;
        }

        .logo-icon {
          width: 24px;
          height: 24px;
          color: #2563eb;
        }

        .brand-text {
          font-size: 1.125rem;
          font-weight: 700;
          color: #1f2937;
        }

        .share-actions {
          display: flex;
          gap: 8px;
        }

        .share-action-button {
          display: flex;
          align-items: center;
          gap: 6px;
          padding: 8px 16px;
          background: #f3f4f6;
          border: none;
          border-radius: 6px;
          color: #374151;
          font-size: 0.875rem;
          cursor: pointer;
          transition: all 0.2s ease;
        }

        .share-action-button:hover {
          background: #e5e7eb;
        }

        .share-action-button .icon {
          width: 16px;
          height: 16px;
        }

        .share-main {
          flex: 1;
          padding: 32px 0;
        }

        .share-container {
          max-width: 800px;
          margin: 0 auto;
          padding: 0 24px;
        }

        .share-content {
          background: white;
          border-radius: 16px;
          padding: 32px;
          box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);
        }

        .content-header {
          margin-bottom: 24px;
        }

        .content-title {
          font-size: 1.875rem;
          font-weight: 700;
          color: #1f2937;
          margin-bottom: 8px;
          line-height: 1.3;
        }

        .content-description {
          font-size: 1rem;
          color: #6b7280;
          line-height: 1.6;
        }

        .media-container {
          margin-bottom: 24px;
          border-radius: 12px;
          overflow: hidden;
        }

        .media-image, .media-video {
          width: 100%;
          height: auto;
          display: block;
        }

        .text-content {
          margin-bottom: 24px;
        }

        .content-text {
          font-family: inherit;
          font-size: 1rem;
          line-height: 1.7;
          color: #374151;
          white-space: pre-wrap;
          word-wrap: break-word;
        }

        .content-tags {
          display: flex;
          flex-wrap: wrap;
          gap: 8px;
          margin-bottom: 24px;
        }

        .content-tag {
          display: inline-block;
          padding: 6px 12px;
          border-radius: 16px;
          font-size: 0.875rem;
          font-weight: 500;
        }

        .content-footer {
          border-top: 1px solid #f3f4f6;
          padding-top: 16px;
        }

        .content-meta {
          display: flex;
          justify-content: space-between;
          align-items: center;
          font-size: 0.875rem;
          color: #9ca3af;
        }

        .share-footer {
          background: white;
          border-top: 1px solid #e5e7eb;
          padding: 16px 0;
        }

        .footer-content {
          max-width: 800px;
          margin: 0 auto;
          padding: 0 24px;
          text-align: center;
        }

        .footer-text {
          font-size: 0.875rem;
          color: #6b7280;
        }

        /* 密码验证页面样式 */
        .share-password {
          min-height: 100vh;
          background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 20px;
        }

        .password-container {
          width: 100%;
          max-width: 400px;
        }

        .password-card {
          background: white;
          border-radius: 16px;
          padding: 48px 32px;
          box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.1);
          text-align: center;
        }

        .password-header {
          margin-bottom: 32px;
        }

        .lock-icon {
          width: 48px;
          height: 48px;
          color: #6b7280;
          margin: 0 auto 16px;
        }

        .password-title {
          font-size: 1.5rem;
          font-weight: 700;
          color: #1f2937;
          margin-bottom: 8px;
        }

        .password-subtitle {
          color: #6b7280;
          font-size: 0.875rem;
        }

        .password-form {
          display: flex;
          flex-direction: column;
          gap: 16px;
        }

        .password-input {
          width: 100%;
          padding: 12px 16px;
          border: 1px solid #d1d5db;
          border-radius: 8px;
          font-size: 0.875rem;
          text-align: center;
        }

        .password-input:focus {
          outline: none;
          border-color: #2563eb;
          box-shadow: 0 0 0 3px rgba(37, 99, 235, 0.1);
        }

        .password-button {
          width: 100%;
          padding: 12px 24px;
          background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
          color: white;
          border: none;
          border-radius: 8px;
          font-size: 0.875rem;
          font-weight: 600;
          cursor: pointer;
          transition: all 0.2s ease;
        }

        .password-button:hover:not(:disabled) {
          transform: translateY(-1px);
          box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);
        }

        .password-button:disabled {
          opacity: 0.6;
          cursor: not-allowed;
          transform: none;
        }

        /* 错误页面样式 */
        .share-error {
          min-height: 100vh;
          display: flex;
          align-items: center;
          justify-content: center;
          background: #fafafa;
          padding: 20px;
        }

        .error-content {
          text-align: center;
          max-width: 400px;
        }

        .error-icon {
          width: 64px;
          height: 64px;
          color: #dc2626;
          margin: 0 auto 24px;
        }

        .error-title {
          font-size: 1.5rem;
          font-weight: 700;
          color: #1f2937;
          margin-bottom: 16px;
        }

        .error-message {
          color: #6b7280;
          line-height: 1.6;
        }

        @media (max-width: 768px) {
          .share-header-content, .share-container, .footer-content {
            padding: 0 16px;
          }

          .share-content {
            padding: 24px;
          }

          .content-title {
            font-size: 1.5rem;
          }

          .content-meta {
            flex-direction: column;
            gap: 8px;
            align-items: flex-start;
          }
        }
      `}</style>
    </div>
  )
}

export default SharePage
