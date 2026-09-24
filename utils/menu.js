// utils/menu.js —— 食谱数据访问层（含本地缓存）
// 全项目只有这个文件与云开发交互，页面只调用这里导出的函数。
//   读：走云函数（list），并带本地缓存 —— 页面可以「先把上次的数据画出来，再静默刷新」，
//       这样切换页面时不会一直转圈等网络。
//   写：走云函数（add / remove），服务端会校验管理员，客户端没有任何直接写库的代码。
// 将来若换成自建后端，只需改这一个文件。
const env = require('./env.js')

const FUNCTION_NAME = env.FUNCTION_NAME
const LIST_TTL = 10 * 60 * 1000 // 图片列表缓存有效期：10 分钟
const WHOAMI_TTL = 30 * 60 * 1000 // 身份缓存有效期：30 分钟
const KEY_LIST = 'menu_list_v1_'
const KEY_WHOAMI = 'menu_whoami_v1'

/* ---------------- 云开发状态 ---------------- */

function isCloudReady() {
  try {
    const app = getApp()
    return !!(app && app.globalData && app.globalData.cloudReady)
  } catch (e) {
    return false
  }
}

function cloudError() {
  try {
    const app = getApp()
    return (app && app.globalData && app.globalData.cloudError) || ''
  } catch (e) {
    return ''
  }
}

/* ---------------- 云函数调用 ---------------- */

function callOnce(action, data) {
  return new Promise(function (resolve, reject) {
    if (!isCloudReady()) {
      reject(new Error(cloudError() || '云开发未就绪'))
      return
    }
    wx.cloud.callFunction({
      name: FUNCTION_NAME,
      data: Object.assign({ action: action }, data || {}),
      success: function (res) {
        resolve((res && res.result) || {})
      },
      fail: function (err) {
        reject(err)
      }
    })
  })
}

// 云函数偶发超时（冷启动、容器抖动）时自动重试一次：
// 第二次通常能命中已经热好的容器，能救回一部分「第一次必卡」的情况
function call(action, data) {
  return callOnce(action, data).catch(function (err) {
    const msg = (err && (err.errMsg || err.message)) || ''
    if (!/-501002|ESOCKETTIMEDOUT|timeout|超时|网络|fail to fetch/i.test(msg)) {
      throw err
    }
    return callOnce(action, data)
  })
}

/* ---------------- 本地缓存工具 ---------------- */

function readStore(key, ttl) {
  try {
    const value = wx.getStorageSync(key)
    if (value && value.time && Date.now() - value.time < ttl) return value
  } catch (e) {
    // 读缓存失败按「没有缓存」处理
  }
  return null
}

function writeStore(key, data) {
  try {
    wx.setStorageSync(key, { time: Date.now(), data: data })
  } catch (e) {
    // 写缓存失败不影响主流程
  }
}

function removeStore(key) {
  try {
    wx.removeStorageSync(key)
  } catch (e) {
    // 忽略
  }
}

/* ---------------- 读 ---------------- */

function normalizeDates(dates) {
  return (dates || []).filter(function (d) {
    return typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d)
  })
}

// 不走缓存，直接问云端
function listByDates(dates) {
  const valid = normalizeDates(dates)
  if (!valid.length) return Promise.resolve([])
  return call('list', { dates: valid }).then(function (res) {
    return (res && res.rows) || []
  })
}

function listByDate(date) {
  return listByDates([date])
}

// 作废某几天的列表缓存（管理端上传/删除后调用，保证列表立刻是最新的）
function clearListCache(dates) {
  const valid = normalizeDates(dates)
  if (!valid.length) return
  removeStore(KEY_LIST + valid.join('_'))
}

// 带缓存的读取，返回 Promise<{ rows, cached }>
//   cached = true  表示给的是本地缓存（同时后台在刷新，刷新完会调用 onFresh）
//   onFresh(rows)  后台刷新拿到新数据时回调，页面可以静默替换
function loadDates(dates, onFresh) {
  const valid = normalizeDates(dates)
  if (!valid.length) return Promise.resolve({ rows: [], cached: false })

  const key = KEY_LIST + valid.join('_')
  const hit = readStore(key, LIST_TTL)

  const refresh = function () {
    return listByDates(valid).then(function (rows) {
      writeStore(key, rows)
      if (onFresh) onFresh(rows)
      return rows
    })
  }

  if (hit) {
    // 有缓存：立刻把缓存给页面，同时在后台静默刷新（失败也不影响已显示的内容）
    refresh().catch(function () {})
    return Promise.resolve({ rows: hit.data || [], cached: true })
  }

  return refresh().then(function (rows) {
    return { rows: rows, cached: false }
  })
}

// 后台预热：首页显示时调用，这样第一次进「今日食谱」就不用等网络
// 不阻塞、失败静默；缓存还新鲜时不会重复请求
function prefetchToday() {
  if (!isCloudReady()) return
  const d = new Date()
  const pad = function (n) {
    return n < 10 ? '0' + n : '' + n
  }
  const date = d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate())
  const key = KEY_LIST + date
  if (readStore(key, LIST_TTL)) return
  listByDates([date])
    .then(function (rows) {
      writeStore(key, rows)
    })
    .catch(function () {
      // 预热失败无所谓
    })
}

// 把记录按餐次分组，只返回有图片的餐次（保持早餐→晚餐顺序）
function groupByMeal(rows, meals) {
  const dict = {}
  const source = rows || []
  for (let i = 0; i < source.length; i++) {
    const row = source[i]
    if (!row || !row.fileID) continue
    if (!dict[row.meal]) dict[row.meal] = []
    dict[row.meal].push({
      id: row._id,
      fileID: row.fileID,
      sort: row.sort || 0
    })
  }

  const order = meals || []
  const result = []
  for (let i = 0; i < order.length; i++) {
    const meal = order[i]
    const photos = dict[meal.key]
    if (photos && photos.length) {
      result.push({
        key: meal.key,
        name: meal.name,
        time: meal.time,
        photos: photos
      })
    }
  }
  return result
}

/* ---------------- 身份（带缓存） ---------------- */

// { openid, isAdmin, initialized }：一定走云端，同时更新缓存
function whoami() {
  return call('whoami').then(function (res) {
    const data = {
      openid: (res && res.openid) || '',
      isAdmin: !!(res && res.isAdmin),
      initialized: !!(res && res.initialized)
    }
    writeStore(KEY_WHOAMI, data)
    return data
  })
}

// 同步读身份缓存（30 分钟内有效），没有则返回 null
function cachedWhoami() {
  const hit = readStore(KEY_WHOAMI, WHOAMI_TTL)
  return hit ? hit.data : null
}

function clearWhoamiCache() {
  removeStore(KEY_WHOAMI)
}

/* ---------------- 写（仅管理员） ---------------- */

// 首次一键成为管理员（服务端只允许在还没有管理员时执行一次）
function initAdmin() {
  return call('init').then(function (res) {
    // 身份变了，缓存必须作废
    clearWhoamiCache()
    return res
  })
}

function addPhotos(items) {
  return call('add', { items: items || [] })
}

function removePhoto(id) {
  return call('remove', { id: id })
}

/* ---------------- 临时链接（预览用） ---------------- */

// 把 fileID 换成 https 临时链接；失败时回退成原 fileID（<image> 支持直接渲染 cloud:// ）
function previewUrls(fileIDs) {
  return new Promise(function (resolve) {
    const ids = (fileIDs || []).filter(function (id) {
      return !!id
    })
    if (!ids.length || !isCloudReady()) {
      resolve(ids)
      return
    }
    wx.cloud.getTempFileURL({
      fileList: ids.slice(0, 50),
      success: function (res) {
        const list = (res && res.fileList) || []
        const urls = list.map(function (item) {
          return item.tempFileURL || item.fileID
        })
        resolve(urls.length ? urls : ids)
      },
      fail: function () {
        resolve(ids)
      }
    })
  })
}

module.exports = {
  isCloudReady: isCloudReady,
  cloudError: cloudError,
  listByDate: listByDate,
  listByDates: listByDates,
  clearListCache: clearListCache,
  loadDates: loadDates,
  prefetchToday: prefetchToday,
  groupByMeal: groupByMeal,
  whoami: whoami,
  cachedWhoami: cachedWhoami,
  clearWhoamiCache: clearWhoamiCache,
  initAdmin: initAdmin,
  addPhotos: addPhotos,
  removePhoto: removePhoto,
  previewUrls: previewUrls
}
