// utils/album.js —— 班级相册数据层（本地先跑通，云端接口预留）
//
// 全项目只有这个文件与「相册」数据打交道，页面只调用这里导出的函数。
//   读：listAlbumsSync / listPhotosSync —— 同步拿本机缓存（页面立刻能画出来）
//       listAlbums / listPhotos         —— 拿最新数据（云端模式会走网络，返回 Promise）
//   写：createAlbum / updateAlbum / removeAlbum / pickAndUpload / removePhotos
//       —— 只有管理员会看到入口，页面已隐藏
//
// 两种模式（改一行 MODE 即可切换，页面代码完全不用动）：
//   'local' —— 相册和照片都记在本机（wx.setStorageSync）：现在就能演示；换手机不通用
//              照片用手机里选的原图临时地址显示，重启后可能失效（页面画灰色占位块）
//   'cloud' —— 走云函数 albumAdmin（集合 albums / album_photos / album_members）：
//              多人多机同步。照片本体传云存储（wx.cloud.uploadFile 直传），
//              云函数只登记 fileID 并负责删除。部署说明见 docs/album-cloud-setup.md
//
// 身份说明：本机体验管理员与「通知」共用同一把钥匙（见 utils/notice.js 的 KEY_LOCAL_ADMIN），
//           长按「我的」页底部版本号开一次即可，两个模块同时生效。
const env = require('./env.js')
const menu = require('./menu.js')
// 「谁是管理员」只有一份判断：云端 menuAdmin（menu.whoami）+ 本机体验标记
const notice = require('./notice.js')

const MODE = 'local'

const FUNCTION_NAME = env.ALBUM_FUNCTION || 'albumAdmin'

// 班级建议列表：选班级时按这个给按钮。云端只校验「非空且不超过 12 字」，
// 不设白名单 —— 万一园里要加「托班」「大一班」，这里加一个词就行，云端不用改。
const CLASSES = ['全园', '小班', '中班', '大班', '学前班']
const ALL_CLASS = '全园' // 全园相册任何班级的家长都能看到

const MAX_TITLE = 30 // 相册名最多多少字
const CLASS_MAX = 12 // 班级名最多多少字
const MAX_PHOTOS = 300 // 一个相册最多多少张（与云函数一致）
const MAX_PICK = 9 // 微信一次最多选 9 张
const MAX_BATCH = 30 // 一次最多上传 / 删除多少张（与云函数一致）

const KEY_ALBUMS = 'album_list_v1' // 相册列表（本机缓存）
const KEY_PHOTOS = 'album_photos_v1' // 照片记录（本机缓存，按 albumId 分组存一个数组）
const KEY_MY_CLASS = 'album_my_class_v1' // 家长自己选的班级
const KEY_SEEDED = 'album_seeded_v1' // 演示数据写过的标记（见 listAlbumsSync）

// 演示相册：本机第一次使用时自动写入。照片没有真图（项目不带图片资源），
// src 为空时页面画一块灰底 + 文字，管理员点「＋」就能换成真照片。
const DEFAULT_ALBUMS = [
  { id: 'a1', className: '中班', title: '春游去动物园', date: '2026-04-18', count: 6 },
  { id: 'a2', className: '中班', title: '手工课：春天的花', date: '2026-04-11', count: 4 },
  { id: 'a3', className: ALL_CLASS, title: '全园亲子运动会', date: '2026-04-15', count: 3 }
]

/* ---------------- 小工具 ---------------- */

function pad2(n) {
  return n < 10 ? '0' + n : '' + n
}

// 今天：'YYYY-MM-DD'
function todayText() {
  const d = new Date()
  return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate())
}

function trimText(v) {
  return String(v === undefined || v === null ? '' : v).replace(/^\s+|\s+$/g, '')
}

function nowId(prefix) {
  return (prefix || 'x') + Date.now() + Math.floor(Math.random() * 1000)
}

// 把任意来源的数据整理成一个相册
function normalizeAlbum(raw) {
  if (!raw || typeof raw !== 'object') return null
  const title = trimText(raw.title)
  if (!title) return null
  const id = trimText(raw.id || raw._id)
  if (!id) return null
  const className = trimText(raw.className) || ALL_CLASS
  return {
    id: id,
    className: className.length > CLASS_MAX ? className.slice(0, CLASS_MAX) : className,
    title: title,
    date: trimText(raw.date) || todayText(),
    cover: trimText(raw.cover),
    count: Math.max(0, Number(raw.count) || 0),
    createdAt: Number(raw.createdAt) || Date.now(),
    updatedAt: Number(raw.updatedAt) || Number(raw.createdAt) || Date.now()
  }
}

// 把任意来源的数据整理成一张照片
// src 给 <image> 直接用（云端是 cloud://，本地是手机临时路径）；src 为空时页面画占位块
function normalizePhoto(raw) {
  if (!raw || typeof raw !== 'object') return null
  const id = trimText(raw.id || raw._id)
  if (!id) return null
  const fileID = trimText(raw.fileID || raw.src)
  return {
    id: id,
    albumId: trimText(raw.albumId),
    fileID: fileID,
    src: fileID,
    label: trimText(raw.label),
    sort: Number(raw.sort) || Number(raw.createdAt) || 0,
    createdAt: Number(raw.createdAt) || Date.now(),
    local: raw.local === undefined ? fileID.indexOf('cloud://') !== 0 : !!raw.local
  }
}

// 相册排序：日期新的在前，其次刚更新的在前（与云函数同一套规则）
function sortAlbums(rows) {
  const list = (rows || []).slice()
  list.sort(function (a, b) {
    const da = String(a.date || '')
    const db = String(b.date || '')
    if (da !== db) return db.localeCompare(da)
    return (b.updatedAt || 0) - (a.updatedAt || 0)
  })
  return list
}

function sortPhotos(rows) {
  const list = (rows || []).slice()
  list.sort(function (a, b) {
    return (a.sort || 0) - (b.sort || 0)
  })
  return list
}

/* ---------------- 本机存储 ---------------- */

function readAlbumsRaw() {
  try {
    const value = wx.getStorageSync(KEY_ALBUMS)
    if (Array.isArray(value)) return value.map(normalizeAlbum).filter(Boolean)
  } catch (e) {
    // 读失败按「没有数据」处理
  }
  return []
}

function writeAlbumsRaw(rows) {
  try {
    wx.setStorageSync(KEY_ALBUMS, rows || [])
  } catch (e) {
    // 写失败不影响本页显示，下次读取会重新写入种子数据
  }
}

function readPhotosRaw() {
  try {
    const value = wx.getStorageSync(KEY_PHOTOS)
    if (Array.isArray(value)) return value.map(normalizePhoto).filter(Boolean)
  } catch (e) {
    // 读失败按「没有照片」处理
  }
  return []
}

function writePhotosRaw(rows) {
  try {
    wx.setStorageSync(KEY_PHOTOS, rows || [])
  } catch (e) {
    // 忽略
  }
}

function readMyClassRaw() {
  try {
    return trimText(wx.getStorageSync(KEY_MY_CLASS))
  } catch (e) {
    return ''
  }
}

function writeMyClassRaw(className) {
  try {
    if (className) {
      wx.setStorageSync(KEY_MY_CLASS, className)
    } else {
      wx.removeStorageSync(KEY_MY_CLASS)
    }
  } catch (e) {
    // 忽略
  }
}

// 「演示数据已经写过一次」的标记：只写在第一次，之后本机为空就是真的空
function hasSeeded() {
  try {
    return !!wx.getStorageSync(KEY_SEEDED)
  } catch (e) {
    return false
  }
}

function markSeeded() {
  try {
    wx.setStorageSync(KEY_SEEDED, 1)
  } catch (e) {
    // 写失败不影响使用，最多下次再写一遍演示数据
  }
}

// 演示数据：3 个相册 + 13 张「占位照片」（src 为空，页面画灰块）
function buildSeedAlbums() {
  const now = Date.now()
  return DEFAULT_ALBUMS.map(function (item, i) {
    return normalizeAlbum(
      Object.assign({}, item, {
        createdAt: now - i * 3600000,
        updatedAt: now - i * 3600000
      })
    )
  }).filter(Boolean)
}

function buildSeedPhotos() {
  const now = Date.now()
  const out = []
  DEFAULT_ALBUMS.forEach(function (album, ai) {
    const total = Number(album.count) || 0
    for (let i = 0; i < total; i++) {
      out.push(
        normalizePhoto({
          id: album.id + 'p' + (i + 1),
          albumId: album.id,
          fileID: '',
          label: '照片 ' + (i + 1),
          sort: now - (total - i) * 1000,
          createdAt: now - (total - i) * 1000,
          local: true
        })
      )
      out[out.length - 1].albumId = album.id
      out[out.length - 1].label = '照片 ' + (i + 1)
    }
    return ai
  })
  return out.filter(Boolean)
}

/* ---------------- 云开发状态 ---------------- */

function isCloudReady() {
  try {
    return !!menu.isCloudReady()
  } catch (e) {
    return false
  }
}

function cloudError() {
  try {
    return menu.cloudError() || ''
  } catch (e) {
    return ''
  }
}

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

// 偶发超时（冷启动）自动重试一次，与 utils/menu.js 同一套做法
function call(action, data) {
  return callOnce(action, data).catch(function (err) {
    const msg = (err && (err.errMsg || err.message)) || ''
    if (!/-501002|ESOCKETTIMEDOUT|timeout|超时|网络|fail to fetch/i.test(msg)) {
      throw err
    }
    return callOnce(action, data)
  })
}

/* ---------------- 家长的班级 ---------------- */

// 同步读：本机记的班级（没选过就是空字符串）
function myClassSync() {
  return readMyClassRaw()
}

// 拿班级：云端模式以云端为准（换手机也在），并写回本机
function myClass() {
  if (MODE !== 'cloud' || !isCloudReady()) {
    return Promise.resolve(myClassSync())
  }
  return call('myClass')
    .then(function (res) {
      const className = trimText(res && res.className)
      if (className) writeMyClassRaw(className)
      return className || myClassSync()
    })
    .catch(function () {
      return myClassSync()
    })
}

// 设置班级（任何家长都能设自己的，不需要管理员）
function setMyClass(className) {
  const name = trimText(className)
  if (!name) return Promise.resolve({ ok: false, msg: '请先选择班级' })
  if (name.length > CLASS_MAX) return Promise.resolve({ ok: false, msg: '班级名最多 ' + CLASS_MAX + ' 个字' })

  if (MODE === 'cloud' && isCloudReady()) {
    return call('setMyClass', { className: name })
      .then(function (res) {
        if (res && res.ok) {
          writeMyClassRaw(name)
          return { ok: true, className: name }
        }
        return { ok: false, msg: (res && res.msg) || '保存失败' }
      })
      .catch(function (err) {
        return { ok: false, msg: '保存失败：' + errText(err) }
      })
  }

  writeMyClassRaw(name)
  return Promise.resolve({ ok: true, className: name })
}

function errText(e) {
  if (!e) return '未知错误'
  return e.errMsg || e.message || String(e)
}

/* ---------------- 读：相册 ---------------- */

// 同步读：本机有数据就用本机数据；本机为空、而且演示数据还没写过时，才写入演示数据后再返回
// （老师把相册全删了就保持为空，不再把演示相册塞回来；想找回来用「恢复演示相册」）
// className 传了就只留「这个班 + 全园」的相册（家长视角）；不传就是全部（管理端视角）
function listAlbumsSync(className) {
  let rows = readAlbumsRaw()
  if (!rows.length && MODE === 'local' && !hasSeeded()) {
    rows = buildSeedAlbums()
    writeAlbumsRaw(rows)
    markSeeded()
    if (!readPhotosRaw().length) writePhotosRaw(buildSeedPhotos())
  }
  return filterByClass(sortAlbums(rows), className)
}

// 拿最新相册列表：本地模式 = 本机数据；云端模式 = 问云函数（并把结果存到本机当缓存）
function listAlbums(className) {
  if (MODE !== 'cloud' || !isCloudReady()) {
    return Promise.resolve(listAlbumsSync(className))
  }
  // 一次把全部相册拉回来（最多 100 个），再在本机按班级过滤，页面不用管这件事
  return call('listAlbums')
    .then(function (res) {
      const rows = ((res && res.albums) || []).map(normalizeAlbum).filter(Boolean)
      writeAlbumsRaw(rows)
      return filterByClass(sortAlbums(rows), className)
    })
    .catch(function () {
      return listAlbumsSync(className)
    })
}

// 班级过滤：不传 = 全部；传了 = 这个班 + 全园
function filterByClass(rows, className) {
  const name = trimText(className)
  if (!name) return rows || []
  return (rows || []).filter(function (row) {
    return row.className === name || row.className === ALL_CLASS
  })
}

// 从本机缓存里找一个相册（页面渲染用；找不到返回 null）
function getAlbum(albumId) {
  const id = trimText(albumId)
  if (!id) return null
  const rows = readAlbumsRaw()
  for (let i = 0; i < rows.length; i++) {
    if (rows[i].id === id) return rows[i]
  }
  return null
}

/* ---------------- 读：照片 ---------------- */

function photosOf(albumId) {
  const id = trimText(albumId)
  if (!id) return []
  return sortPhotos(
    readPhotosRaw().filter(function (row) {
      return row.albumId === id
    })
  )
}

// 同步读：某个相册里本机已缓存的照片
function listPhotosSync(albumId) {
  return photosOf(albumId)
}

// 拿照片：云端模式支持「下拉加载更多」（skip 从 0 开始，一次 60 张）
// 返回 Promise<{ ok, msg, album, photos, hasMore, total }>
function listPhotos(albumId, options) {
  const id = trimText(albumId)
  const opt = options || {}
  const skip = Math.max(0, Number(opt.skip) || 0)
  if (!id) return Promise.resolve({ ok: false, msg: '缺少相册 id', album: null, photos: [], hasMore: false, total: 0 })

  if (MODE !== 'cloud' || !isCloudReady()) {
    const album = getAlbum(id)
    const photos = photosOf(id)
    return Promise.resolve({
      ok: true,
      album: album,
      photos: photos,
      hasMore: false,
      total: album ? album.count : photos.length
    })
  }

  return call('listPhotos', { albumId: id, skip: skip })
    .then(function (res) {
      if (!res || !res.ok) {
        return {
          ok: false,
          msg: (res && res.msg) || '这个相册暂时打不开',
          album: getAlbum(id),
          photos: skip === 0 ? [] : photosOf(id),
          hasMore: false,
          total: 0
        }
      }
      const album = normalizeAlbum(res.album)
      if (album) {
        // 顺手把相册信息（数量 / 封面）更新到本机缓存
        const rows = readAlbumsRaw()
        let hit = false
        const next = rows.map(function (row) {
          if (row.id !== album.id) return row
          hit = true
          return album
        })
        if (!hit) next.push(album)
        writeAlbumsRaw(next)
      }

      const fresh = ((res.photos) || []).map(normalizePhoto).filter(Boolean)
      const kept = skip === 0 ? [] : photosOf(id)
      // 去重后合并（同一张照片可能被重复拉取）
      const merged = kept.slice()
      fresh.forEach(function (photo) {
        let dup = false
        for (let i = 0; i < merged.length; i++) {
          if (merged[i].id === photo.id) {
            dup = true
            break
          }
        }
        if (!dup) merged.push(photo)
      })
      // 只把当前这个相册的记录写回本机（别的相册的记录保持不动）
      const others = readPhotosRaw().filter(function (row) {
        return row.albumId !== id
      })
      writePhotosRaw(others.concat(merged))

      return {
        ok: true,
        album: album || getAlbum(id),
        photos: sortPhotos(merged),
        hasMore: !!res.hasMore,
        total: Number(res.total) || merged.length
      }
    })
    .catch(function (err) {
      return {
        ok: false,
        msg: '这个相册暂时打不开：' + errText(err),
        album: getAlbum(id),
        photos: photosOf(id),
        hasMore: false,
        total: 0
      }
    })
}

// 把 cloud:// 换成 https 临时链接（保存到手机、分享、previewImage 时才需要）
// 本地模式照片本来就是手机路径，原样返回
function tempUrls(fileIDs) {
  const ids = (Array.isArray(fileIDs) ? fileIDs : []).filter(function (id) {
    return typeof id === 'string' && id.indexOf('cloud://') === 0
  })
  const map = {}
  ids.forEach(function (id) {
    map[id] = id
  })
  if (!ids.length || MODE !== 'cloud' || !isCloudReady()) {
    return Promise.resolve({ ok: true, urls: map })
  }
  return call('tempUrls', { fileIDs: ids.slice(0, 50) })
    .then(function (res) {
      const urls = (res && res.urls) || []
      urls.forEach(function (item) {
        if (item && item.fileID && item.url) map[item.fileID] = item.url
      })
      return { ok: true, urls: map }
    })
    .catch(function () {
      // 拿不到临时链接时不报错：<image> 直接用 cloud:// 也能显示
      return { ok: true, urls: map }
    })
}

// 点开看大图（左右可以翻）：ids 是照片的 fileID/src 数组
function previewPhotos(fileIDs, current) {
  const ids = (Array.isArray(fileIDs) ? fileIDs : []).filter(Boolean)
  if (!ids.length) return Promise.resolve({ ok: false, msg: '没有可以看的照片' })

  const show = function (list, cur) {
    try {
      wx.previewImage({ urls: list, current: cur || list[0] })
      return { ok: true }
    } catch (e) {
      return { ok: false, msg: '打不开大图：' + errText(e) }
    }
  }

  if (MODE !== 'cloud' || !isCloudReady()) {
    return Promise.resolve(show(ids, current))
  }
  return tempUrls(ids).then(function (res) {
    const map = (res && res.urls) || {}
    const list = ids.map(function (id) {
      return map[id] || id
    })
    return show(list, map[current] || theCurrent(current, list))
  })
}

function theCurrent(current, list) {
  const cur = trimText(current)
  if (!cur) return list[0]
  const hit = list.indexOf(cur)
  return hit > -1 ? cur : list[0]
}

/* ---------------- 选图 / 上传 / 登记（仅管理员） ---------------- */

// 选照片：返回 Promise<{ ok, msg, paths }>
function pickPhotos(count) {
  const max = Math.min(MAX_PICK, Math.max(1, Number(count) || MAX_PICK))
  return new Promise(function (resolve) {
    const done = function (paths) {
      if (!paths.length) {
        resolve({ ok: false, msg: '没有选照片' })
        return
      }
      resolve({ ok: true, paths: paths })
    }

    if (wx.chooseMedia) {
      wx.chooseMedia({
        count: max,
        mediaType: ['image'],
        sourceType: ['album', 'camera'],
        sizeType: ['compressed'],
        success: function (res) {
          done(
            ((res && res.tempFiles) || [])
              .map(function (item) {
                return (item && item.tempFilePath) || ''
              })
              .filter(Boolean)
          )
        },
        fail: function (err) {
          resolve({ ok: false, msg: '取消或失败：' + errText(err) })
        }
      })
      return
    }

    // 老版本微信没有 chooseMedia，用 chooseImage 顶一下
    wx.chooseImage({
      count: max,
      sizeType: ['compressed'],
      sourceType: ['album', 'camera'],
      success: function (res) {
        done(((res && res.tempFilePaths) || []).filter(Boolean))
      },
      fail: function (err) {
        resolve({ ok: false, msg: '取消或失败：' + errText(err) })
      }
    })
  })
}

function extOf(path) {
  const m = /\.([a-zA-Z0-9]+)$/.exec(String(path || ''))
  const ext = m ? m[1].toLowerCase() : 'jpg'
  if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'heic'].indexOf(ext) < 0) return '.jpg'
  return '.' + ext
}

function uploadOne(albumId, path, index) {
  return new Promise(function (resolve, reject) {
    const cloudPath =
      'album/' + albumId + '/' + Date.now() + '_' + index + '_' + Math.floor(Math.random() * 100000) + extOf(path)
    wx.cloud.uploadFile({
      cloudPath: cloudPath,
      filePath: path,
      success: function (res) {
        const fileID = (res && res.fileID) || ''
        if (fileID) {
          resolve(fileID)
        } else {
          reject(new Error('上传成功但没拿到 fileID'))
        }
      },
      fail: function (err) {
        reject(err)
      }
    })
  })
}

// 把手机上选好的照片放进相册
//   云端模式：逐张传云存储 → 把 fileID 交给云函数登记
//   本地模式：直接把手机路径记在本机（页面立刻能看到）
// 返回 Promise<{ ok, msg, added, failed, album }
function uploadPhotos(albumId, paths) {
  const id = trimText(albumId)
  const list = (Array.isArray(paths) ? paths : []).filter(Boolean).slice(0, MAX_PICK)
  if (!id) return Promise.resolve({ ok: false, msg: '缺少相册 id' })
  if (!list.length) return Promise.resolve({ ok: false, msg: '没有要上传的照片' })

  const album = getAlbum(id)
  const already = album ? album.count : photosOf(id).length
  if (already + list.length > MAX_PHOTOS) {
    return Promise.resolve({ ok: false, msg: '这个相册最多放 ' + MAX_PHOTOS + ' 张，先删掉一些再传' })
  }

  if (MODE === 'cloud' && isCloudReady()) {
    return uploadAll(id, list)
  }

  // 本地模式：记在本机
  const now = Date.now()
  const photos = photosOf(id)
  const added = list.map(function (path, i) {
    return normalizePhoto({
      id: nowId('p'),
      albumId: id,
      fileID: path,
      label: '',
      sort: now + i,
      createdAt: now + i,
      local: true
    })
  })
  writePhotosRaw(
    readPhotosRaw().concat(added)
  )
  patchAlbumCount(id, photos.length + added.length, list[list.length - 1] || '')
  return Promise.resolve({ ok: true, added: added.length, failed: 0, album: getAlbum(id) })
}

// 逐张上传（串行：一张一张来，避免一下子把网络占满）
function uploadAll(albumId, paths) {
  const fileIDs = []
  const failed = []
  let chain = Promise.resolve()
  paths.forEach(function (path, i) {
    chain = chain.then(function () {
      return uploadOne(albumId, path, i)
        .then(function (fileID) {
          fileIDs.push(fileID)
        })
        .catch(function () {
          failed.push(path)
        })
    })
  })
  return chain.then(function () {
    if (!fileIDs.length) {
      return { ok: false, msg: '照片没能传上去，检查一下网络再试', added: 0, failed: failed.length, album: getAlbum(albumId) }
    }
    return call('addPhotos', { albumId: albumId, fileIDs: fileIDs }).then(function (res) {
      if (!res || !res.ok) {
        return {
          ok: false,
          msg: (res && res.msg) || '照片传上去了，但记账没成功，请再点一次',
          added: 0,
          failed: failed.length,
          album: getAlbum(albumId)
        }
      }
      clearAlbumsCache()
      clearPhotosCache()
      const album = normalizeAlbum(res.album) || getAlbum(albumId)
      if (album) writeAlbumBack(album)
      return {
        ok: true,
        added: Number(res.added) || fileIDs.length,
        failed: failed.length,
        album: album
      }
    })
  })
}

// 选照片 + 上传，一步到位（页面只调这一个）
function pickAndUpload(albumId, count) {
  return pickPhotos(count).then(function (res) {
    if (!res.ok) return { ok: false, msg: res.msg, added: 0, failed: 0 }
    return uploadPhotos(albumId, res.paths)
  })
}

// 删照片（可一次删多张）：返回 Promise<{ ok, msg, removed }>
function removePhotos(ids) {
  const list = (Array.isArray(ids) ? ids : []).filter(function (id) {
    return typeof id === 'string' && !!id
  })
  if (!list.length) return Promise.resolve({ ok: false, msg: '没有要删除的照片' })
  if (list.length > MAX_BATCH) return Promise.resolve({ ok: false, msg: '一次最多删 ' + MAX_BATCH + ' 张' })

  if (MODE === 'cloud' && isCloudReady()) {
    return call('removePhotos', { ids: list }).then(function (res) {
      if (res && res.ok) {
        clearAlbumsCache()
        clearPhotosCache()
        return { ok: true, removed: Number(res.removed) || list.length }
      }
      return { ok: false, msg: (res && res.msg) || '删除失败' }
    })
  }

  const rows = readPhotosRaw()
  const gone = rows.filter(function (row) {
    return list.indexOf(row.id) > -1
  })
  if (!gone.length) return Promise.resolve({ ok: false, msg: '这些照片已经不在了' })
  writePhotosRaw(
    rows.filter(function (row) {
      return list.indexOf(row.id) < 0
    })
  )
  const albumIds = []
  gone.forEach(function (row) {
    if (row.albumId && albumIds.indexOf(row.albumId) < 0) albumIds.push(row.albumId)
  })
  albumIds.forEach(function (albumId) {
    const album = getAlbum(albumId)
    if (!album) return
    const left = photosOf(albumId)
    const coverGone = gone.some(function (row) {
      return row.albumId === albumId && row.fileID === album.cover
    })
    patchAlbumCount(albumId, left.length, coverGone ? (left[0] ? left[0].fileID : '') : album.cover)
  })
  return Promise.resolve({ ok: true, removed: gone.length })
}

/* ---------------- 写：相册（仅管理员） ---------------- */

function createAlbum(input) {
  const draft = input || {}
  const className = trimText(draft.className)
  const title = trimText(draft.title)
  const date = trimText(draft.date)

  if (!className) return Promise.resolve({ ok: false, msg: '请先选择班级' })
  if (className.length > CLASS_MAX) return Promise.resolve({ ok: false, msg: '班级名最多 ' + CLASS_MAX + ' 个字' })
  if (!title) return Promise.resolve({ ok: false, msg: '请先填写相册名' })
  if (title.length > MAX_TITLE) return Promise.resolve({ ok: false, msg: '相册名最多 ' + MAX_TITLE + ' 个字' })

  if (MODE === 'cloud' && isCloudReady()) {
    return call('createAlbum', { className: className, title: title, date: date }).then(function (res) {
      if (!res || !res.ok) return { ok: false, msg: (res && res.msg) || '新建失败' }
      clearAlbumsCache()
      const album = normalizeAlbum(res.album)
      if (album) writeAlbumBack(album)
      return { ok: true, album: album }
    })
  }

  const now = Date.now()
  const album = normalizeAlbum({
    id: nowId('a'),
    className: className,
    title: title,
    date: date || todayText(),
    cover: '',
    count: 0,
    createdAt: now,
    updatedAt: now
  })
  writeAlbumsRaw(readAlbumsRaw().concat([album]))
  return Promise.resolve({ ok: true, album: album })
}

// 改相册：只改传进来的字段（相册名 / 班级 / 日期 / 封面）
function updateAlbum(input) {
  const draft = input || {}
  const id = trimText(draft.albumId || draft.id)
  if (!id) return Promise.resolve({ ok: false, msg: '缺少相册 id' })

  const patch = {}
  if (draft.title !== undefined) {
    const title = trimText(draft.title)
    if (!title) return Promise.resolve({ ok: false, msg: '相册名不能为空' })
    if (title.length > MAX_TITLE) return Promise.resolve({ ok: false, msg: '相册名最多 ' + MAX_TITLE + ' 个字' })
    patch.title = title
  }
  if (draft.className !== undefined) {
    const className = trimText(draft.className)
    if (!className) return Promise.resolve({ ok: false, msg: '班级不能为空' })
    if (className.length > CLASS_MAX) return Promise.resolve({ ok: false, msg: '班级名最多 ' + CLASS_MAX + ' 个字' })
    patch.className = className
  }
  if (draft.date !== undefined) patch.date = trimText(draft.date)
  if (draft.cover !== undefined) patch.cover = trimText(draft.cover)

  if (MODE === 'cloud' && isCloudReady()) {
    return call(
      'updateAlbum',
      Object.assign({ albumId: id }, patch)
    ).then(function (res) {
      if (!res || !res.ok) return { ok: false, msg: (res && res.msg) || '保存失败' }
      clearAlbumsCache()
      const album = normalizeAlbum(res.album)
      if (album) writeAlbumBack(album)
      return { ok: true, album: album }
    })
  }

  const rows = readAlbumsRaw()
  let hit = null
  const next = rows.map(function (row) {
    if (row.id !== id) return row
    hit = normalizeAlbum(Object.assign({}, row, patch, { updatedAt: Date.now() }))
    return hit
  })
  if (!hit) return Promise.resolve({ ok: false, msg: '这个相册已经不在了' })
  writeAlbumsRaw(next)
  return Promise.resolve({ ok: true, album: hit })
}

// 删相册：连带里面的照片记录一起删（云端由云函数顺带删云存储文件）
function removeAlbum(albumId) {
  const id = trimText(albumId)
  if (!id) return Promise.resolve({ ok: false, msg: '缺少相册 id' })

  if (MODE === 'cloud' && isCloudReady()) {
    return call('removeAlbum', { albumId: id }).then(function (res) {
      if (!res || !res.ok) return { ok: false, msg: (res && res.msg) || '删除失败' }
      clearAlbumsCache()
      clearPhotosCache()
      return { ok: true, removed: 1, photos: Number(res.photos) || 0 }
    })
  }

  const photos = photosOf(id)
  writePhotosRaw(
    readPhotosRaw().filter(function (row) {
      return row.albumId !== id
    })
  )
  writeAlbumsRaw(
    readAlbumsRaw().filter(function (row) {
      return row.id !== id
    })
  )
  return Promise.resolve({ ok: true, removed: 1, photos: photos.length })
}

// 把相册的「照片数量 / 封面」改掉（本地模式内部用）
function patchAlbumCount(albumId, count, cover) {
  const rows = readAlbumsRaw()
  const next = rows.map(function (row) {
    if (row.id !== albumId) return row
    const patch = { count: Math.max(0, Number(count) || 0), updatedAt: Date.now() }
    if (cover !== undefined) patch.cover = cover
    return Object.assign({}, row, patch)
  })
  writeAlbumsRaw(next)
}

function writeAlbumBack(album) {
  if (!album) return
  const rows = readAlbumsRaw()
  let hit = false
  const next = rows.map(function (row) {
    if (row.id !== album.id) return row
    hit = true
    return album
  })
  if (!hit) next.push(album)
  writeAlbumsRaw(next)
}

/* ---------------- 本机缓存清理 / 演示数据 ---------------- */

// 本机数据变了（管理员刚改完），让下次读取重新从云端拉
function clearAlbumsCache() {
  try {
    wx.removeStorageSync(KEY_ALBUMS)
  } catch (e) {
    // 忽略
  }
}

function clearPhotosCache() {
  try {
    wx.removeStorageSync(KEY_PHOTOS)
  } catch (e) {
    // 忽略
  }
}

// 恢复演示相册（只在本地模式生效：把本机数据重写回初始那 3 个相册）
function resetDemo() {
  if (MODE === 'cloud' && isCloudReady()) {
    return Promise.resolve({ ok: false, msg: '云端模式不提供「恢复演示相册」，请在相册页手动删除' })
  }
  markSeeded()
  writeAlbumsRaw(buildSeedAlbums())
  writePhotosRaw(buildSeedPhotos())
  return Promise.resolve({ ok: true })
}

/* ---------------- 管理员身份 ---------------- */

// 本机体验管理员：与「通知」共用同一把钥匙（长按「我的」页底部版本号开启）
function isLocalAdmin() {
  try {
    return !!notice.isLocalAdmin()
  } catch (e) {
    return false
  }
}

function setLocalAdmin(on) {
  try {
    notice.setLocalAdmin(!!on)
  } catch (e) {
    // 忽略
  }
}

// 身份判断：能连云端就以云端为准；云端不可用时退回「本机体验管理员」
// 返回 Promise<{ isAdmin, source, openid, initialized, tip }>
function adminStatus() {
  let task = null
  if (isCloudReady()) {
    try {
      task = menu.whoami()
    } catch (e) {
      task = null
    }
  }

  if (task && typeof task.then === 'function') {
    return task
      .then(function (res) {
        return {
          isAdmin: !!(res && res.isAdmin),
          source: 'cloud',
          openid: (res && res.openid) || '',
          initialized: !!(res && res.initialized),
          tip: ''
        }
      })
      .catch(function () {
        return localStatus('云函数暂时没连上')
      })
  }

  return Promise.resolve(localStatus('云开发未就绪'))
}

function localStatus(reason) {
  const on = isLocalAdmin()
  return {
    isAdmin: on,
    source: 'local',
    openid: '',
    initialized: false,
    tip: on ? '本机体验模式（' + reason + '）：传的照片只保存在这台手机上' : ''
  }
}

module.exports = {
  MODE: MODE,
  CLASSES: CLASSES,
  ALL_CLASS: ALL_CLASS,
  MAX_TITLE: MAX_TITLE,
  CLASS_MAX: CLASS_MAX,
  MAX_PHOTOS: MAX_PHOTOS,
  MAX_PICK: MAX_PICK,
  MAX_BATCH: MAX_BATCH,
  isCloudReady: isCloudReady,
  cloudError: cloudError,
  myClass: myClass,
  myClassSync: myClassSync,
  setMyClass: setMyClass,
  listAlbums: listAlbums,
  listAlbumsSync: listAlbumsSync,
  getAlbum: getAlbum,
  listPhotos: listPhotos,
  listPhotosSync: listPhotosSync,
  tempUrls: tempUrls,
  previewPhotos: previewPhotos,
  pickPhotos: pickPhotos,
  uploadPhotos: uploadPhotos,
  pickAndUpload: pickAndUpload,
  removePhotos: removePhotos,
  createAlbum: createAlbum,
  updateAlbum: updateAlbum,
  removeAlbum: removeAlbum,
  clearAlbumsCache: clearAlbumsCache,
  clearPhotosCache: clearPhotosCache,
  resetDemo: resetDemo,
  adminStatus: adminStatus,
  isLocalAdmin: isLocalAdmin,
  setLocalAdmin: setLocalAdmin
}
