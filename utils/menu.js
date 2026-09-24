// utils/menu.js —— 食谱数据访问层
// 全项目只有这个文件与云开发交互，页面只调用这里导出的函数。
//   读：走云函数（list），所以数据库集合用默认权限即可，不用去控制台配规则
//   写：走云函数（add / remove），服务端会校验管理员，客户端没有任何直接写库的代码
// 将来若换成自建后端，只需改这一个文件。
const env = require('./env.js')

const FUNCTION_NAME = env.FUNCTION_NAME

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

function call(action, data) {
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

/* ---------------- 读 ---------------- */

// 取某一天的图片记录，按 sort 升序
function listByDate(date) {
  return listByDates([date])
}

// 取多天的图片记录
function listByDates(dates) {
  const valid = (dates || []).filter(function (d) {
    return typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d)
  })
  if (!valid.length) return Promise.resolve([])
  return call('list', { dates: valid }).then(function (res) {
    return (res && res.rows) || []
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

/* ---------------- 身份 ---------------- */

// { openid, isAdmin, initialized }
// initialized 表示「本园是否已经设置过管理员」，用于首次一键初始化
function whoami() {
  return call('whoami').then(function (res) {
    return {
      openid: (res && res.openid) || '',
      isAdmin: !!(res && res.isAdmin),
      initialized: !!(res && res.initialized)
    }
  })
}

// 首次一键成为管理员（服务端只允许在还没有管理员时执行一次）
function initAdmin() {
  return call('init')
}

/* ---------------- 写（仅管理员） ---------------- */

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
  groupByMeal: groupByMeal,
  whoami: whoami,
  initAdmin: initAdmin,
  addPhotos: addPhotos,
  removePhoto: removePhoto,
  previewUrls: previewUrls
}
