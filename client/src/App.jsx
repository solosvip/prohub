import React from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import { useAuth } from './contexts/AuthContext'
import Layout from './components/Layout'
import LoginPage from './pages/LoginPage'
import HomePage from './pages/HomePage'
import SearchPage from './pages/SearchPage'
import StatsPage from './pages/StatsPage'
import SharePage from './pages/SharePage'
import SnakeGame from './pages/SnakeGame'
import LoadingSpinner from './components/LoadingSpinner'

function App() {
  const { user, loading } = useAuth()

  if (loading) {
    return <LoadingSpinner />
  }

  return (
    <Routes>
      {/* 公开分享页面 - 无需登录 */}
      <Route path="/share/:shareKey" element={<SharePage />} />
      
      {/* Snake Game - 无需登录 */}
      <Route path="/snake" element={<SnakeGame />} />
      
      {/* 需要登录的页面 */}
      {user ? (
        <Route path="/" element={<Layout />}>
          <Route index element={<HomePage />} />
          <Route path="search" element={<SearchPage />} />
          <Route path="stats" element={<StatsPage />} />
        </Route>
      ) : (
        <>
          <Route path="/login" element={<LoginPage />} />
          <Route path="*" element={<Navigate to="/login" replace />} />
        </>
      )}
      
      {/* 已登录用户访问登录页时重定向到首页 */}
      {user && <Route path="/login" element={<Navigate to="/" replace />} />}
      
      {/* 404页面 */}
      <Route path="*" element={<Navigate to={user ? "/" : "/login"} replace />} />
    </Routes>
  )
}

export default App
