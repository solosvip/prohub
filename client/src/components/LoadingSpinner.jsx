import React from 'react'

const LoadingSpinner = ({ size = 'medium', message = '加载中...' }) => {
  const getSizeClass = () => {
    switch (size) {
      case 'small': return 'w-4 h-4'
      case 'large': return 'w-8 h-8'
      default: return 'w-6 h-6'
    }
  }

  return (
    <div className="loading">
      <div className="loading-spinner">
        <svg className={`animate-spin ${getSizeClass()}`} xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
        </svg>
        {message && <span style={{ marginLeft: '8px', fontSize: '0.875rem' }}>{message}</span>}
      </div>
    </div>
  )
}

export default LoadingSpinner