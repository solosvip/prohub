import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from 'react-query'
import { ToastContainer, cssTransition } from 'react-toastify'
const FadeToast = cssTransition({
  enter: 'rt-fade-in',
  exit: 'rt-fade-out',
  duration: [150, 120],
});
import App from './App.jsx'
import { AuthProvider } from './contexts/AuthContext'
import 'react-toastify/dist/ReactToastify.css'
import './index.css'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 2,
      staleTime: 5 * 60 * 1000, // 5 minutes
    },
  },
})

ReactDOM.createRoot(document.getElementById('root')).render(
  // 临时移除 StrictMode 以测试是否能解决页面跳动问题
  // <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <AuthProvider>
          <App />
          <ToastContainer
            position="bottom-right"
            autoClose={1000}           
            hideProgressBar={true}     
            transition={FadeToast}
            newestOnTop={false}
            closeOnClick
            rtl={false}
            pauseOnFocusLoss={false}
            draggable={false}
            pauseOnHover={false}
          />
        </AuthProvider>
      </BrowserRouter>
    </QueryClientProvider>
  // </React.StrictMode>,
)
