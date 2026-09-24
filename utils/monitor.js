// utils/monitor.js —— 园区监控数据层（对接接口都集中在这一个文件里）
//
// 客户端只用下面 4 个方法，将来换后端 / 换监控云平台，**只改这个文件**，页面不用动：
//   isReady()            -> boolean                            是否已接入（未接入时页面显示「正在对接中」）
//   getCameras()         -> Promise<Camera[]>                  摄像头列表
//   getPlayUrl(cameraId) -> Promise<{url,type,expireAt}>        取播放地址（每次实时取，不在本地缓存）
//   openWindowText()     -> string                             开放时段文案
//
// Camera = { id: string, name: string, place: string, online: boolean }
// 接入方式在 utils/env.js 的 MONITOR.MODE 里切换：'off' | 'cloud' | 'http'
// 后端接口契约（返回结构）见 docs/monitor-api.md
const env = require('./env.js')

const CFG = (env && env.MONITOR) || {}
const MODE = CFG.MODE || 'off'
const API = CFG.API || ''
const FUNCTION = CFG.FUNCTION || 'monitor'
const TOKEN_KEY = CFG.TOKEN_KEY || 'monitor_token'
const WINDOW_TEXT = CFG.WINDOW_TEXT || '每日 08:00-17:00 开放'

/* ---------------- 状态 ---------------- */

function isCloudReady() {
  try {
    const app = getApp()
    return !!(app && app.globalData && app.globalData.cloudReady)
  } catch (e) {
    return false
  }
}

// 是否已经接入（没接入时页面不发任何请求）
function isReady() {
  if (MODE === 'cloud') return isCloudReady()
  if (MODE === 'http') return !!API
  return false
}

function openWindowText() {
  return WINDOW_TEXT
}

/* ---------------- 取数据（统一出口） ---------------- */

function getCameras() {
  if (!isReady()) return Promise.resolve([])

  if (MODE === 'cloud') {
    return callCloud('cameras').then(normalizeCameras)
  }
  return request('/cameras').then(normalizeCameras)
}

function getPlayUrl(cameraId) {
  const id = cameraId || ''
  if (!isReady() || !id) {
    return Promise.resolve({ url: '', type: 'hls', expireAt: 0 })
  }

  if (MODE === 'cloud') {
    return callCloud('play', { id: id }).then(normalizePlay)
  }
  return request('/play?id=' + encodeURIComponent(id)).then(normalizePlay)
}

/* ---------------- 云函数方式 ---------------- */

function callCloud(action, data) {
  return new Promise(function (resolve, reject) {
    wx.cloud.callFunction({
      name: FUNCTION,
      data: Object.assign({ action: action }, data || {}),
      success: function (res) {
        const result = (res && res.result) || {}
        if (result.ok === false) {
          reject(new Error(result.msg || '服务暂时不可用'))
          return
        }
        resolve(result)
      },
      fail: function (err) {
        reject(new Error((err && err.errMsg) || '云函数调用失败'))
      }
    })
  })
}

/* ---------------- 自建后端方式 ---------------- */

function request(path) {
  return new Promise(function (resolve, reject) {
    const header = { 'content-type': 'application/json' }
    // 需要鉴权的场景：家长登录后把令牌放进 storage，这里自动带上
    try {
      const token = wx.getStorageSync(TOKEN_KEY)
      if (token) header.Authorization = 'Bearer ' + token
    } catch (e) {
      // 读不到令牌就按未登录处理，由后端返回错误
    }

    wx.request({
      url: API + path,
      method: 'GET',
      header: header,
      success: function (res) {
        const body = res && res.data
        if (res.statusCode !== 200 || (body && body.code && body.code !== 0)) {
          reject(new Error((body && (body.msg || body.message)) || '服务返回错误'))
          return
        }
        resolve(body)
      },
      fail: function (err) {
        reject(new Error((err && err.errMsg) || '网络请求失败'))
      }
    })
  })
}

/* ---------------- 返回值归一化 ---------------- */
// 兼容几种常见返回结构：裸数组 / {list:[]} / {data:[]} / {data:{list:[]}}
function pickList(res) {
  if (!res) return []
  if (Array.isArray(res)) return res
  if (Array.isArray(res.list)) return res.list
  if (res.data) {
    if (Array.isArray(res.data)) return res.data
    if (Array.isArray(res.data.list)) return res.data.list
  }
  return []
}

function normalizeCameras(res) {
  const list = pickList(res)
  return list
    .map(function (item, index) {
      if (!item) return null
      return {
        id: String(item.id || item.cameraId || item.deviceSerial || index),
        name: item.name || item.title || ('摄像头 ' + (index + 1)),
        place: item.place || item.location || '',
        online: item.online !== false // 缺省视为在线，避免误显离线
      }
    })
    .filter(function (item) {
      return !!item
    })
}

// 兼容：{url,type,expireAt} / {data:{...}} / 直接是字符串地址
function normalizePlay(res) {
  let data = res
  if (data && data.data && typeof data.data === 'object') data = data.data
  if (typeof data === 'string') data = { url: data }

  const url = (data && (data.url || data.playUrl || data.hls || data.m3u8)) || ''
  const type = (data && data.type) || (/\.m3u8(\?|$)/i.test(url) ? 'hls' : 'mp4')
  let expireAt = (data && (data.expireAt || data.expiresAt)) || 0
  if (expireAt && expireAt < 1e12) expireAt = expireAt * 1000 // 兼容秒级时间戳

  return {
    url: url,
    type: type,
    expireAt: expireAt
  }
}

module.exports = {
  isReady: isReady,
  getCameras: getCameras,
  getPlayUrl: getPlayUrl,
  openWindowText: openWindowText
}
