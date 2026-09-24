// utils/menu.js —— 食谱数据访问层
// 全项目只有这个文件直接与云开发交互：
//   读：直接查数据库（集合安全规则为「所有用户可读、客户端不可写」）
//   写：只能经云函数 menuAdmin（服务端校验管理员 openid）
// 将来若换成自建后端接口，只需改这一个文件。
const env = require('./env.js')

const COLLECTION = env.COLLECTION
const FUNCTION_NAME = env.FUNCTION_NAME
const PAGE_SIZE = 20 // 小程序端单次查询上限
const MAX_LOOP = 5 // 最多翻 5 页（100 条/天），一天 5 个餐次足够

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

function db() {
  return wx.cloud.database()
}

/* ---------------- 读：按日期取图片记录 ---------------- */

// 取某一天的全部记录，按 sort 升序
function listByDate(date) {
  return new Promise(function (resolve, reject) {
    if (!isCloudReady()) {
      reject(new Error('云开发未就绪'))
      return
    }
    const all = []
    let loop = 0

    const step = function (skip) {
      db()
        .collection(COLLECTION)
        .where({ date: date })
        .orderBy('sort', 'asc')
        .skip(skip)
        .limit(PAGE_SIZE)
        .get()
        .then(function (res) {
          const rows = (res && res.data) || []
          for (let i = 0; i < rows.length; i++) all.push(rows[i])
          loop++
          if (rows.length === PAGE_SIZE && loop < MAX_LOOP) {
            step(skip + PAGE_SIZE)
          } else {
            resolve(all)
          }
        })
        .catch(reject)
    }

    step(0)
  })
}

// 取多天记录（管理端用）
function listByDates(dates) {
  const list = dates || []
  if (!list.length) return Promise.resolve([])
  return Promise.all(list.map(listByDate)).then(function (groups) {
    let all = []
    for (let i = 0; i < groups.length; i++) {
      all = all.concat(groups[i])
    }
    return all
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

// 当前用户身份：{ openid, isAdmin }
function whoami() {
  return call('whoami').then(function (res) {
    return {
      openid: (res && res.openid) || '',
      isAdmin: !!(res && res.isAdmin)
    }
  })
}

// 新增图片记录（仅管理员可用，服务端会再校验一次）
function addPhotos(items) {
  return call('add', { items: items || [] })
}

// 删除图片记录（同时删除云存储文件），仅管理员可用
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
  addPhotos: addPhotos,
  removePhoto: removePhoto,
  previewUrls: previewUrls
}
