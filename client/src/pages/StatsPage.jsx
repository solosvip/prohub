import React, { useState, useMemo } from 'react'
import { useQuery, useQueryClient } from 'react-query'
import { Chart as ChartJS, CategoryScale, LinearScale, BarElement, Title, Tooltip, Legend, ArcElement } from 'chart.js'
import { Bar, Doughnut } from 'react-chartjs-2'
import api from '../services/api'
import LoadingSpinner from '../components/LoadingSpinner'
import './StatsPage.css';
import './StatsTagsPatch.css';
import ConfirmModal from '../components/ConfirmModal'

ChartJS.register(CategoryScale, LinearScale, BarElement, Title, Tooltip, Legend, ArcElement)

const StatsPage = () => {
  const [showAllTags, setShowAllTags] = useState(false)
  const [activeTab, setActiveTab] = useState('overview')
  const queryClient = useQueryClient()

  const { data: allStatsData, isLoading: statsLoading } = useQuery('allStats_v2', () => api.getAllStats())
  const { data: sharesData, isLoading: sharesLoading, refetch: refetchShares } = useQuery('shares', () => api.getShares(), { enabled: activeTab === 'shares' })

  // 获取全部标签（已按 usage_count 降序返回）
  const { data: tagsData, isLoading: tagsLoading, refetch: refetchTags } = useQuery('tags', () => api.getTags(), { staleTime: 300000 })

  // 使用useMemo来避免在每次渲染时都重新计算
  const { overview, contentTypes, timeline, storage, topTags, shares } = useMemo(() => {
    const data = allStatsData?.data || {};
    const shares = sharesData?.data?.shares || [];
    return {
      overview: data.overview || {},
      contentTypes: data.content_types || [],
      timeline: data.timeline?.content_trend || [],
      storage: data.storage?.overview || {},
      topTags: data.tags?.usage_stats || [],
      shares: shares
    };
  }, [allStatsData, sharesData]);

  // 删除标签确认状态
  const [deleteState, setDeleteState] = useState({ open: false, tag: null, loading: false })
  const requestDeleteTag = (tag) => setDeleteState({ open: true, tag, loading: false })
  const closeDeleteModal = () => setDeleteState({ open: false, tag: null, loading: false })
  const performDeleteTag = async () => {
    const tag = deleteState.tag
    if (!tag) return
    try {
      setDeleteState(s => ({ ...s, loading: true }))
      await api.deleteTag(tag.id)
      // 刷新标签与统计（总标签数）
      refetchTags()
      queryClient.invalidateQueries('allStats_v2')
      // 这里不用等待，触发后台刷新
      try { (await import('react-toastify')).toast.success('已删除') } catch(_) {}
    } catch (e) {
      try { (await import('react-toastify')).toast.error(e?.response?.data?.error?.message || '删除失败') } catch(_) {}
    } finally {
      closeDeleteModal()
    }
  }

  // Edit & delete modal state for shares
  const [editing, setEditing] = useState(null) // share object
  const [editLoading, setEditLoading] = useState(false)
  const [editExpiry, setEditExpiry] = useState('permanent')
  const [editPassword, setEditPassword] = useState('')
  const [editActive, setEditActive] = useState(true)

  const openEdit = (share) => {
    setEditing(share)
    setEditActive(!!share.is_active)
    setEditPassword(share.password || '')
    if (!share.expires_at) setEditExpiry('permanent')
    else {
      const now = Date.now()
      const remain = new Date(share.expires_at).getTime() - now
      const d = Math.round(remain / (1000*3600*24))
      // 近似映射
      setEditExpiry(d > 22 ? '30d' : (d > 10 ? '15d' : '7d'))
    }
  }

  const computeExpiryISO = () => {
    if (editExpiry === 'permanent') return null
    const days = editExpiry === '30d' ? 30 : (editExpiry === '15d' ? 15 : 7)
    const dt = new Date(); dt.setDate(dt.getDate() + days); return dt.toISOString()
  }

  const submitEdit = async () => {
    if (!editing) return
    try {
      setEditLoading(true)
      await api.updateShare(editing.id, {
        password: (editPassword || '').trim() || null,
        expires_at: computeExpiryISO(),
        is_active: !!editActive
      })
      setEditing(null)
      refetchShares()
      try { (await import('react-toastify')).toast.success('已更新分享') } catch(_) {}
    } catch (e) {
      try { (await import('react-toastify')).toast.error(e?.response?.data?.error?.message || '更新失败') } catch(_) {}
    } finally { setEditLoading(false) }
  }

  const deleteShare = async (share) => {
    if (!share) return
    if (!confirm('确定删除该分享？此操作不可撤销')) return
    try {
      await api.deleteShare(share.id)
      refetchShares()
      try { (await import('react-toastify')).toast.success('已删除') } catch(_) {}
    } catch (e) {
      try { (await import('react-toastify')).toast.error('删除失败') } catch(_) {}
    }
  }

  // 内容类型分布图表数据
  const contentTypeData = useMemo(() => {
    const labels = contentTypes.map(item => ({ 'text': '文本', 'image': '图片', 'video': '视频' }[item.content_type] || item.content_type));
    const data = contentTypes.map(item => item.count);
    return {
        labels: labels,
        datasets: [{
            data: data,
            backgroundColor: ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6'],
            borderWidth: 0
        }]
    };
  }, [contentTypes]);

  // 时间趋势图表数据
  const timelineChartData = useMemo(() => {
      const sortedTimeline = [...timeline].sort((a, b) => new Date(a.period) - new Date(b.period));
      return {
        labels: sortedTimeline.map(item => item.period),
        datasets: [{
            label: '创建数量',
            data: sortedTimeline.map(item => item.items_created),
            backgroundColor: '#3b82f6',
            borderRadius: 4
        }]
    };
  }, [timeline]);

  const formatFileSize = (bytes) => {
    if (!bytes || bytes === 0) return '0 B'
    const k = 1024
    const sizes = ['B', 'KB', 'MB', 'GB']
    const i = Math.floor(Math.log(bytes) / Math.log(k))
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]
  }
  
  if (statsLoading) {
    return <LoadingSpinner message="加载统计数据..." />
  }

  const handleExport = async () => {
    try {
      const r = await api.exportJson(false);
      const blob = r; // interceptor returns data
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      const ts = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
      a.href = url;
      a.download = `prompt-collector-export-${ts}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      try { (await import('react-toastify')).toast.success('导出成功'); } catch (_) {}
    } catch (e) {
      try { (await import('react-toastify')).toast.error('导出失败'); } catch (_) {}
    }
  };

  return (
    <div className="stats-page">
      <header className="content-header">
        <h1 style={{ fontSize: '1.5rem', fontWeight: '700', color: '#1f2937' }}>数据统计</h1>
        <div className="tab-buttons">
          <button
            className={`tab-button ${activeTab === 'overview' ? 'active' : ''}`}
            onClick={() => setActiveTab('overview')}
          >
            概览
          </button>
          <button
            className={`tab-button ${activeTab === 'shares' ? 'active' : ''}`}
            onClick={() => setActiveTab('shares')}
          >
            分享管理
          </button>
          <button
            className="tab-button"
            onClick={handleExport}
            title="导出为 JSON 数据包"
          >
            导出
          </button>
        </div>
      </header>

      <div className="stats-content">
        {activeTab === 'overview' ? (
          <>
            {/* 概览卡片 */}
            <div className="stats-grid">
              <div className="stat-card">
                <div className="stat-icon">
                  <svg className="icon" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
                  </svg>
                </div>
                <div className="stat-content">
                  <div className="stat-number">{overview.total_items || 0}</div>
                  <div className="stat-label">总内容数</div>
                </div>
              </div>

              <div className="stat-card">
                <div className="stat-icon">
                  <svg className="icon" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M11.48 3.499a.562.562 0 011.04 0l2.125 5.111a.563.563 0 00.475.345l5.518.442c.499.04.701.663.321.988l-4.204 3.602a.563.563 0 00-.182.557l1.285 5.385a.562.562 0 01-.84.61l-4.725-2.885a.563.563 0 00-.586 0L6.982 20.54a.562.562 0 01-.84-.61l1.285-5.386a.562.562 0 00-.182-.557l-4.204-3.602a.563.563 0 01.321-.988l5.518-.442a.563.563 0 00.475-.345L11.48 3.5z" />
                  </svg>
                </div>
                <div className="stat-content">
                  <div className="stat-number">{overview.favorite_items || 0}</div>
                  <div className="stat-label">收藏内容</div>
                </div>
              </div>

              <div className="stat-card">
                <div className="stat-icon">
                  <svg className="icon" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9.568 3H5.25A2.25 2.25 0 003 5.25v4.318c0 .597.237 1.17.659 1.591l9.581 9.581c.699.699 1.78.872 2.607.33a18.095 18.095 0 005.223-5.223c.542-.827.369-1.908-.33-2.607L11.16 3.66A2.25 2.25 0 009.568 3z" />
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 6h.008v.008H6V6z" />
                  </svg>
                </div>
                <div className="stat-content">
                  <div className="stat-number">{overview.total_tags || 0}</div>
                  <div className="stat-label">标签数量</div>
                </div>
              </div>

              <div className="stat-card">
                <div className="stat-icon">
                  <svg className="icon" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M20.25 6.375c0 2.278-3.694 4.125-8.25 4.125S3.75 8.653 3.75 6.375m16.5 0c0-2.278-3.694-4.125-8.25-4.125S3.75 4.097 3.75 6.375m16.5 0v11.25c0 2.278-3.694 4.125-8.25 4.125s-8.25-1.847-8.25-4.125V6.375m16.5 0v3.75m-16.5-3.75v3.75m16.5 0v3.75C20.25 16.153 16.556 18 12 18s-8.25-1.847-8.25-4.125v-3.75m16.5 0c0 2.278-3.694 4.125-8.25 4.125s-8.25-1.847-8.25-4.125" />
                  </svg>
                </div>
                <div className="stat-content">
                  <div className="stat-number">{formatFileSize(storage.total_file_size || 0)}</div>
                  <div className="stat-label">存储空间</div>
                </div>
              </div>
            </div>

            {/* 图表区域 */}
            <div className="charts-grid">
              <div className="chart-card">
                <h3 className="chart-title">内容类型分布</h3>
                <div className="chart-container">
                  <Doughnut 
                    data={contentTypeData}
                    options={{
                      responsive: true,
                      maintainAspectRatio: false,
                      plugins: {
                        legend: {
                          position: 'bottom'
                        }
                      }
                    }}
                  />
                </div>
              </div>

              <div className="chart-card">
                <h3 className="chart-title">创建趋势</h3>
                <div className="chart-container">
                  <Bar
                    data={timelineChartData}
                    options={{
                      responsive: true,
                      maintainAspectRatio: false,
                      plugins: {
                        legend: {
                          display: false
                        }
                      },
                      scales: {
                        y: {
                          beginAtZero: true
                        }
                      }
                    }}
                  />
                </div>
              </div>
            </div>

            {/* 标签管理 */}
            <div className="tags-section">
              <div className="tags-header">
                <h3 className="section-title">标签管理</h3>
                {(!tagsLoading && (tagsData?.data?.length || 0) > 20) && (
                  <button
                    className="tag-toggle-btn"
                    onClick={() => setShowAllTags(v => !v)}
                    title={showAllTags ? '收起' : '展开'}
                  >
                    {showAllTags ? '收起' : '展开'}
                  </button>
                )}
              </div>
              <div className="tags-list">
                {tagsLoading ? (
                  <LoadingSpinner message="加载标签..." />
                ) : (
                  <>
                    {(() => {
                      const all = tagsData?.data || []
                      const list = showAllTags ? all : all.slice(0, 20)
                      return list.map((tag, index) => (
                        <div key={tag.id} className="tag-item">
                          <span className="tag-rank">#{index + 1}</span>
                          <span className="tag-name" style={{ color: tag.color }}>{tag.name}</span>
                          <span className="tag-count">{tag.usage_count} 次使用</span>
                          <button
                            className="tag-delete"
                            title="删除标签"
                            onClick={() => requestDeleteTag(tag)}
                          >
                            ×
                          </button>
                        </div>
                      ))
                    })()}
                  </>
                )}
              </div>
            </div>
          </>
        ) : (
          /* 分享管理 */
          <div className="shares-management">
            <div className="shares-header">
              <h3 className="section-title">我的分享链接</h3>
              <p className="section-subtitle">管理你的所有分享链接，控制访问权限</p>
            </div>

            {sharesLoading ? (
              <LoadingSpinner message="加载分享数据..." />
            ) : shares.length === 0 ? (
              <div className="empty-state">
                <div style={{ textAlign: 'center', padding: '48px', color: '#6b7280' }}>
                  <svg className="icon" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor" style={{ width: '48px', height: '48px', margin: '0 auto 16px' }}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M7.217 10.907a2.25 2.25 0 100 2.186m0-2.186c.18.324.283.696.283 1.093s-.103.77-.283 1.093m0-2.186l9.566-5.314m-9.566 7.5l9.566 5.314m0 0a2.25 2.25 0 103.935 2.186 2.25 2.25 0 00-3.935-2.186zm0-12.814a2.25 2.25 0 103.933-2.185 2.25 2.25 0 00-3.933 2.185z" />
                  </svg>
                  <h3 style={{ marginBottom: '8px', fontSize: '1.125rem', fontWeight: '600' }}>还没有分享链接</h3>
                  <p style={{ fontSize: '0.875rem' }}>在内容卡片上点击分享按钮来创建分享链接</p>
                </div>
              </div>
            ) : (
              <div className="shares-list">
                {shares.map((share) => (
                  <div key={share.id} className="share-item">
                    <div className="share-content">
                      <h4 className="share-title">{share.title}</h4>
                      <p className="share-description">{share.description}</p>
                      <div className="share-meta">
                        <span className="share-status">
                          {share.is_active ? (
                            <><span className="status-dot active"></span> 已启用</>
                          ) : (
                            <><span className="status-dot inactive"></span> 已禁用</>
                          )}
                        </span>
                        <span className="share-views">{share.view_count} 次查看</span>
                        {share.password && <span className="share-protected">🔒 密码保护</span>}
                      </div>
                    </div>
                    <div className="share-actions">
                      <button className="action-button" title="复制链接" onClick={async ()=>{ try { await navigator.clipboard.writeText(window.location.origin + '/s/' + share.share_key); (await import('react-toastify')).toast.success('已复制'); } catch(_) {} }}>
                        <svg className="icon" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M15.666 3.888A2.25 2.25 0 0013.5 2.25h-3c-1.03 0-1.9.693-2.166 1.638m7.332 0c.055.194.084.4.084.612v0a.75.75 0 01-.75.75H9a.75.75 0 01-.75-.75v0c0-.212.03-.418.084-.612m7.332 0c.646.049 1.288.11 1.927.184 1.1.128 1.907 1.077 1.907 2.185V19.5a2.25 2.25 0 01-2.25 2.25H6.375a2.25 2.25 0 01-2.25-2.25V6.257c0-1.108.806-2.057 1.907-2.185a48.208 48.208 0 011.927-.184" />
                        </svg>
                      </button>
                      <button className="action-button" title="编辑" onClick={()=>openEdit(share)}>
                        <svg className="icon" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0115.75 21H5.25A2.25 2.25 0 013 18.75V8.25A2.25 2.25 0 015.25 6H10" />
                        </svg>
                      </button>
                      <button className="action-button danger" title="删除" onClick={()=>deleteShare(share)}>
                        <svg className="icon" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
                        </svg>
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {editing && (
        <div className="modal-backdrop">
          <div className="modal" role="dialog" aria-modal="true" style={{ maxWidth: 560 }}>
            <div className="modal-header">
              <h3>编辑分享</h3>
              <button className="modal-close" onClick={()=>setEditing(null)}>&times;</button>
            </div>
            <div className="modal-body">
              <div className="form-group">
                <label className="form-label">时间限制</label>
                <div style={{ display:'flex', gap:12, flexWrap:'wrap' }}>
                  <label className="radio"><input type="radio" name="edit_exp" checked={editExpiry==='permanent'} onChange={()=>setEditExpiry('permanent')} /> 永久</label>
                  <label className="radio"><input type="radio" name="edit_exp" checked={editExpiry==='30d'} onChange={()=>setEditExpiry('30d')} /> 30天</label>
                  <label className="radio"><input type="radio" name="edit_exp" checked={editExpiry==='15d'} onChange={()=>setEditExpiry('15d')} /> 15天</label>
                  <label className="radio"><input type="radio" name="edit_exp" checked={editExpiry==='7d'} onChange={()=>setEditExpiry('7d')} /> 7天</label>
                </div>
              </div>
              <div className="form-group">
                <label className="form-label">密码（可选）</label>
                <input type="text" className="form-input" value={editPassword} onChange={e=>setEditPassword(e.target.value)} placeholder="留空则不设密码" />
              </div>
              <div className="form-group">
                <label className="form-label">启用状态</label>
                <label className="radio"><input type="checkbox" checked={editActive} onChange={e=>setEditActive(e.target.checked)} /> 启用</label>
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn--secondary" onClick={()=>setEditing(null)} disabled={editLoading}>取消</button>
              <button className="btn btn--primary" onClick={submitEdit} disabled={editLoading}>{editLoading ? '保存中...' : '保存'}</button>
            </div>
          </div>
          <style jsx>{`
            .modal-backdrop{position:fixed;inset:0;background:rgba(0,0,0,.35);display:flex;align-items:center;justify-content:center;z-index:50}
            .modal{background:#fff;border-radius:12px;box-shadow:0 10px 30px rgba(0,0,0,.15);width:92vw;max-width:640px}
            .modal-header{display:flex;justify-content:space-between;align-items:center;padding:16px 20px;border-bottom:1px solid #f3f4f6}
            .modal-body{padding:16px 20px}
            .modal-footer{display:flex;justify-content:flex-end;gap:8px;padding:16px 20px;border-top:1px solid #f3f4f6}
            .modal-close{border:none;background:transparent;font-size:22px;cursor:pointer}
          `}</style>
        </div>
      )}


      {/* 删除标签确认弹窗 */}
      <ConfirmModal
        isOpen={deleteState.open}
        onClose={closeDeleteModal}
        onConfirm={performDeleteTag}
        title='删除标签'
        message={deleteState.tag ? `确定要删除标签「${deleteState.tag.name}」吗？此操作不可恢复。` : ''}
        confirmText='删除'
        type='danger'
      />
    </div>
  )
}

export default StatsPage




