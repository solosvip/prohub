import axios from 'axios'
import { toast } from 'react-toastify'

const API_BASE_URL = '/api'

class ApiService {
  constructor() {
    this.client = axios.create({
      baseURL: API_BASE_URL,
      headers: {
        'Content-Type': 'application/json',
      },
    })

    // 请求拦截器
    this.client.interceptors.request.use(
      (config) => {
        const token = localStorage.getItem('token')
        if (token) {
          config.headers.Authorization = `Bearer ${token}`
        }
        return config
      },
      (error) => {
        return Promise.reject(error)
      }
    )

    // 响应拦截器
    this.client.interceptors.response.use(
      (response) => response.data,
      (error) => {
        const status = error?.response?.status
        const code = error?.response?.data?.error?.code
        const serverMsg = error?.response?.data?.error?.message
        const url = error?.config?.url || ''

        // 仅在上传相关 API 的错误时提示
        const isUploadApi = /\/api\/items\/.+\/media$/.test(url) || /\/api\/items\/upload$/.test(url)
        if (isUploadApi && (status === 415 || status === 413 || status === 400 || status === 500)) {
          // 优先按后端统一错误码展示用户文案；没有 code 再兜底 serverMsg/路径判断
          const map = {
            FILE_TYPE_NOT_ALLOWED_IMAGE: '只支持上传图片文件',
            FILE_TYPE_NOT_ALLOWED_VIDEO: '只支持上传视频文件',
            FILE_TOO_LARGE_IMAGE: '图片大小超过限制（≤10MB）',
            FILE_TOO_LARGE_VIDEO: '视频大小超过限制（≤100MB）',
            NO_FILE: '未选择文件',
            UPLOAD_ERROR: '文件上传失败，请稍后重试',
            VIDEO_FORMAT_NOT_SUPPORTED: '视频格式不支持，请转换为 MP4（H.264）后再上传',
          }

          let userMsg = map[code]
          if (!userMsg) {
            // 没有标准 code 时的兜底：用服务端文案或根据路径推断
            userMsg = serverMsg
            if (!userMsg) {
              const isImageCtx = /\/items\/.+\/media$/.test(url)
              const isVideoCtx = /\/items\/upload$/.test(url)
              if (status === 415) {
                userMsg = isImageCtx ? '只支持上传图片文件' : (isVideoCtx ? '只支持上传视频文件' : '不支持的文件类型')
              } else if (status === 413) {
                userMsg = isImageCtx ? '图片大小超过限制（≤10MB）' : (isVideoCtx ? '视频大小超过限制（≤100MB）' : '文件大小超过限制')
              } else if (status === 400) {
                userMsg = '未选择文件'
              } else if (status === 500) {
                userMsg = '文件上传失败，请稍后重试'
              }
            }
          }
          if (userMsg) { try { toast.error(userMsg) } catch (_) {} }
        }

        if (status === 401) {
          // Token过期或无效，清除本地存储并重定向到登录页
          localStorage.removeItem('token')
          window.location.href = '/login'
        }
        return Promise.reject(error)
      }
    )
  }

  // 基础HTTP方法
  async get(url, config = {}) {
    return this.client.get(url, config)
  }

  async post(url, data = {}, config = {}) {
    return this.client.post(url, data, config)
  }

  async put(url, data = {}, config = {}) {
    return this.client.put(url, data, config)
  }

  async delete(url, config = {}) {
    return this.client.delete(url, config)
  }

  // 认证相关
  async login(credentials) {
    return this.post('/auth/login', credentials)
  }

  async logout() {
    return this.post('/auth/logout')
  }

  async verifyToken() {
    return this.get('/auth/verify')
  }

  // 文件夹相关
  async getFolders() {
    return this.get('/folders')
  }

  async createFolder(data) {
    return this.post('/folders', data)
  }

  async updateFolder(id, data) {
    return this.put(`/folders/${id}`, data)
  }

  async deleteFolder(id) {
    return this.delete(`/folders/${id}`)
  }

  // 标签相关
  async getTags() {
    return this.get('/tags')
  }

  async getTagSuggestions(params = {}) {
    return this.get('/tags/suggestions', { params })
  }

  async getTagsByText(params = {}) {
    return this.get('/tags/match-by-text', { params });
  }

  async createTag(data) {
    return this.post('/tags', data)
  }

  async updateTag(id, data) {
    return this.put(`/tags/${id}`, data)
  }

  async deleteTag(id) {
    return this.delete(`/tags/${id}`)
  }

  // 内容相关
  async getItems(params = {}) {
    return this.get('/items', { params })
  }

  async getItem(id) {
    return this.get(`/items/${id}`)
  }

  async createItem(data) {
    return this.post('/items', data)
  }

  async updateItem(id, data) {
    return this.put(`/items/${id}`, data)
  }

  async deleteItem(id) {
    return this.delete(`/items/${id}`)
  }

  // 视频（单媒体）替换/删除
  async replaceVideo(id, file, data = {}, onProgress) {
    const formData = new FormData()
    formData.append('file', file)
    for (const key in data) {
      if (Object.prototype.hasOwnProperty.call(data, key)) {
        if (Array.isArray(data[key])) {
          data[key].forEach(v => formData.append(`${key}[]`, v))
        } else {
          formData.append(key, data[key])
        }
      }
    }
    return this.post(`/items/${id}/video`, formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
      onUploadProgress: onProgress
    })
  }

  async deleteVideo(id) {
    return this.delete(`/items/${id}/video`)
  }

  async toggleFavorite(id) {
    return this.post(`/items/${id}/favorite`)
  }

  async batchOperation(data) {
    return this.post('/items/batch', data)
  }

  // 文件上传
  async uploadFile(file, data, onProgress) {
    const formData = new FormData()
    formData.append('file', file)

    // 添加其他表单数据
    for (const key in data) {
      if (data.hasOwnProperty(key)) {
        // FormData需要特殊处理数组
        if (Array.isArray(data[key])) {
          data[key].forEach(value => {
            formData.append(`${key}[]`, value)
          })
        } else {
          formData.append(key, data[key])
        }
      }
    }

    return this.post('/items/upload', formData, {
      headers: {
        'Content-Type': 'multipart/form-data',
      },
      onUploadProgress: onProgress,
    })
  }

  // 搜索相关
  async search(params = {}) {
    return this.get('/search', { params })
  }

  async getSearchSuggestions(query) {
    return this.get('/search/suggestions', { params: { q: query } })
  }

  // 分享相关
  async getShares(params = {}) {
    // 支持按 item_id、is_active、分页等查询
    return this.get('/shares', { params })
  }

  async createShare(data) {
    return this.post('/shares', data)
  }

  async updateShare(id, data) {
    return this.put(`/shares/${id}`, data)
  }

  async deleteShare(id) {
    return this.delete(`/shares/${id}`)
  }
  
  async toggleShare(id) {
    return this.post(`/shares/${id}/toggle`)
  }

  async getShareStats(id) {
    return this.get(`/shares/${id}/stats`)
  }

  async batchShareOperation(data) {
    return this.post('/shares/batch', data)
  }

  // 公开分享相关（无需认证）
  async getPublicShare(shareKey) {
    return axios.get(`/share/${shareKey}`)
  }

  async verifySharePassword(shareKey, password) {
    return axios.post(`/share/${shareKey}/verify`, { password })
  }

  // 多媒体（图片）
  async uploadMedias(itemId, files, onProgress) {
    const formData = new FormData()
    Array.from(files).forEach(f => formData.append('files', f))
    return this.post('/items/' + itemId + '/media', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
      onUploadProgress: onProgress
    })
  }

  // 临时预览（上传到 /api/preview/tmp）
  async uploadPreviewImages(files, onProgress) {
    const formData = new FormData()
    Array.from(files).forEach(f => formData.append('files', f))
    return this.post('/preview/image', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
      onUploadProgress: onProgress
    })
  }

  async uploadPreviewVideo(file, onProgress) {
    const formData = new FormData()
    formData.append('file', file)
    return this.post('/preview/video', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
      onUploadProgress: onProgress
    })
  }

  async deletePreviewTemp(type, id) {
    // type: 'image'|'video'（服务端只校验 id 并从 tmp 删除）
    return this.delete(`/preview/${type}/${encodeURIComponent(id)}`)
  }

  async deleteMedia(itemId, mediaId) {
    return this.delete('/items/' + itemId + '/media/' + mediaId)
  }

  async updateMediaOrder(itemId, order) {
    // order: [{ id, sort_order }]
    return this.put('/items/' + itemId + '/media/order', { order })
  }

  // 统计接口
  async getAllStats() {
    return this.get('/stats/all');
  }

  // 数据导出（JSON 包）
  async exportJson(includeShares = false) {
    // 返回 Blob，用于触发浏览器下载
    return this.client.get('/export/json', {
      params: { includeShares: includeShares ? 1 : 0 },
      responseType: 'blob'
    });
  }

  // 目录操作
  async deleteFolderRecursive(id) {
    return this.delete(`/folders/${id}`, { params: { mode: 'recursive' } })
  }

  async transferDeleteFolder(id, targetFolderId) {
    return this.post(`/folders/${id}/transfer-delete`, { target_folder_id: targetFolderId })
  }
}

const api = new ApiService()
export default api




