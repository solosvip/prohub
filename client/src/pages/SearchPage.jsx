import React, { useState } from 'react'
import { useOutletContext } from 'react-router-dom'
import { useQuery } from 'react-query'
import api from '../services/api'
import ItemCard from '../components/ItemCard'
import LoadingSpinner from '../components/LoadingSpinner'

const SearchPage = () => {
  const { handleOpenModal } = useOutletContext()
  const [searchParams, setSearchParams] = useState({
    query: '',
    content_type: '',
    folder_id: '',
    tag_ids: [],
    is_favorite: '',
    sort: 'updated_at',
    order: 'desc'
  })

  const { data: searchResults, isLoading, error } = useQuery(
    ['search', searchParams],
    () => api.search(searchParams),
    {
      enabled: !!searchParams.query || !!searchParams.content_type || !!searchParams.folder_id || searchParams.tag_ids.length > 0 || !!searchParams.is_favorite,
      keepPreviousData: true
    }
  )

  const handleSearch = (e) => {
    e.preventDefault()
    // 搜索逻辑已通过 useQuery 自动触发
  }

  return (
    <div className="search-page">
      <header className="content-header">
        <h1 style={{ fontSize: '1.5rem', fontWeight: '700', color: '#1f2937' }}>高级搜索</h1>
      </header>

      <div className="search-content">
        {/* 搜索表单 */}
        <div className="search-form-container">
          <form className="search-form" onSubmit={handleSearch}>
            <div className="search-form-grid">
              <div className="form-group">
                <label className="form-label">搜索关键词</label>
                <input
                  type="text"
                  className="form-input"
                  placeholder="搜索标题和内容..."
                  value={searchParams.query}
                  onChange={(e) => setSearchParams(prev => ({ ...prev, query: e.target.value }))}
                />
              </div>

              <div className="form-group">
                <label className="form-label">内容类型</label>
                <select
                  className="form-select"
                  value={searchParams.content_type}
                  onChange={(e) => setSearchParams(prev => ({ ...prev, content_type: e.target.value }))}
                >
                  <option value="">全部类型</option>
                  <option value="text">文本</option>
                  <option value="image">图片</option>
                  <option value="video">视频</option>
                </select>
              </div>

              <div className="form-group">
                <label className="form-label">收藏状态</label>
                <select
                  className="form-select"
                  value={searchParams.is_favorite}
                  onChange={(e) => setSearchParams(prev => ({ ...prev, is_favorite: e.target.value }))}
                >
                  <option value="">全部</option>
                  <option value="1">已收藏</option>
                  <option value="0">未收藏</option>
                </select>
              </div>

              <div className="form-group">
                <label className="form-label">排序方式</label>
                <select
                  className="form-select"
                  value={`${searchParams.sort}_${searchParams.order}`}
                  onChange={(e) => {
                    const [sort, order] = e.target.value.split('_')
                    setSearchParams(prev => ({ ...prev, sort, order }))
                  }}
                >
                  <option value="updated_at_desc">最近更新</option>
                  <option value="updated_at_asc">最早更新</option>
                  <option value="created_at_desc">最近创建</option>
                  <option value="created_at_asc">最早创建</option>
                  <option value="title_asc">标题A-Z</option>
                  <option value="title_desc">标题Z-A</option>
                </select>
              </div>
            </div>
          </form>
        </div>

        {/* 搜索结果 */}
        <div className="search-results">
          {isLoading ? (
            <LoadingSpinner message="搜索中..." />
          ) : error ? (
            <div className="error">
              搜索失败: {error.response?.data?.error?.message || error.message}
            </div>
          ) : searchResults?.data?.items?.length > 0 ? (
            <>
              <div className="results-header">
                <p className="results-count">
                  找到 {searchResults.data.total} 个结果
                </p>
              </div>
              <div className="item-grid">
                {searchResults.data.items.map((item) => (
                  <ItemCard key={item.id} item={item} onClick={(it) => handleOpenModal("edit", it)} />
                ))}
              </div>
            </>
          ) : (
            <div className="empty-state">
              <div style={{ textAlign: 'center', padding: '48px', color: '#6b7280' }}>
                <svg className="icon" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor" style={{ width: '48px', height: '48px', margin: '0 auto 16px' }}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
                </svg>
                <h3 style={{ marginBottom: '8px', fontSize: '1.125rem', fontWeight: '600' }}>没有找到匹配的内容</h3>
                <p style={{ fontSize: '0.875rem' }}>尝试调整搜索条件或关键词</p>
              </div>
            </div>
          )}
        </div>
      </div>

      <style jsx>{`
        .search-page {
          flex: 1;
          display: flex;
          flex-direction: column;
        }

        .search-content {
          flex: 1;
          padding: 24px;
          overflow-y: auto;
        }

        .search-form-container {
          background: white;
          border-radius: 12px;
          padding: 24px;
          margin-bottom: 24px;
          box-shadow: 0 1px 3px 0 rgba(0, 0, 0, 0.1);
        }

        .search-form-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
          gap: 16px;
        }

        .form-group {
          display: flex;
          flex-direction: column;
          gap: 6px;
        }

        .form-label {
          font-size: 0.875rem;
          font-weight: 500;
          color: #374151;
        }

        .form-input, .form-select {
          padding: 8px 12px;
          border: 1px solid #d1d5db;
          border-radius: 6px;
          font-size: 0.875rem;
          color: #1f2937;
          background-color: #ffffff;
          transition: border-color 0.2s ease;
        }

        .form-input:focus, .form-select:focus {
          outline: none;
          border-color: #2563eb;
          box-shadow: 0 0 0 3px rgba(37, 99, 235, 0.1);
        }

        .search-results {
          min-height: 400px;
        }

        .results-header {
          margin-bottom: 16px;
        }

        .results-count {
          font-size: 0.875rem;
          color: #6b7280;
        }
      `}</style>
    </div>
  )
}

export default SearchPage
