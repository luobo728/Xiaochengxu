// 云函数 albumAdmin —— 班级相册的唯一读写入口
// 规则：
//   家长端只读（listAlbums / listPhotos / tempUrls 任何人可调用）；
//   建相册、传照片、删照片必须经过本函数，且调用者 openid 在管理员白名单内。
// 管理员来源（满足其一即可，与 menuAdmin / noticeAdmin 完全相同）：
//   ① 云函数环境变量 ADMIN_OPENIDS（多个用英文逗号分隔）
//   ② 数据库集合 menu_admins，文档 ID = 管理员 openid
// 数据集合：
//   albums         相册：className / title / date / cover / count / createdAt / updatedAt
//   album_photos   照片：albumId / fileID / sort / createdAt / creator
//   album_members  家长自己的班级：文档 ID = openid，字段 className / updatedAt
// 照片本体存在云存储（客户端 wx.cloud.uploadFile 上传），本函数只登记 fileID，并负责删除文件。
const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()
const ALBUMS = 'albums'
const PHOTOS = 'album_photos'
const MEMBERS = 'album_members'
const ADMINS = 'menu_admins' // 与食谱、通知共用同一份管理员名单

const MAX_TITLE = 30 // 相册名最多多少字
const CLASS_MAX = 12 // 班级名最多多少字
const MAX_PHOTOS = 300 // 一个相册最多多少张照片
const MAX_BATCH = 30 // 一次最多登记 / 删除多少张
const LIST_LIMIT = 100 // 一次最多列出多少个相册
const PAGE_SIZE = 60 // 照片一次最多返回多少张
const DEL_BATCH = 50 // 云存储一次最多删多少个文件
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const DB_TIMEOUT = 1500 // 数据库查询的内部超时（毫秒），防止云函数被平台判超时

function ok(data) {
  return Object.assign({ ok: true }, data || {})
}

function fail(msg) {
  return { ok: false, msg: msg || '操作失败' }
}

function errText(e) {
  if (!e) return '未知错误'
  return e.errMsg || e.message || String(e)
}

function trimText(v) {
  return String(v === undefined || v === null ? '' : v).replace(/^\s+|\s+$/g, '')
}

// 今天：'YYYY-MM-DD'（按中国时区算，避免服务器在别的时区跑偏）
function todayText() {
  const d = new Date(Date.now() + 8 * 3600 * 1000)
  const m = d.getUTCMonth() + 1
  const day = d.getUTCDate()
  return d.getUTCFullYear() + '-' + (m < 10 ? '0' + m : '' + m) + '-' + (day < 10 ? '0' + day : '' + day)
}

// 给数据库查询加一个「内部超时」：数据库慢或不可达时，不让整个云函数卡到平台超时
function withTimeout(promise, ms, fallback) {
  return Promise.race([
    promise
      .then(function (value) {
        return value
      })
      .catch(function () {
        return fallback
      }),
    new Promise(function (resolve) {
      setTimeout(function () {
        resolve(fallback)
      }, ms)
    })
  ])
}

// 管理员判定
async function isAdmin(openid) {
  if (!openid) return false

  const raw = process.env.ADMIN_OPENIDS || ''
  const list = raw
    .split(',')
    .map(function (s) {
      return s.trim()
    })
    .filter(Boolean)
  if (list.indexOf(openid) > -1) return true

  const res = await withTimeout(db.collection(ADMINS).doc(openid).get(), DB_TIMEOUT, null)
  return !!(res && res.data)
}

// 是否已经有管理员（家长端提示用）
async function hasAdmin() {
  const res = await withTimeout(db.collection(ADMINS).count(), DB_TIMEOUT, null)
  return !!(res && res.total > 0)
}

// 集合不存在时先建出来，避免第一次使用就报错
async function ensure(name) {
  try {
    await db.createCollection(name)
  } catch (e) {
    // 已存在（或写入时会自动创建），忽略
  }
}

function chunks(list, size) {
  const out = []
  const arr = (list || []).slice()
  for (let i = 0; i < arr.length; i += size) {
    out.push(arr.slice(i, i + size))
  }
  return out
}

// 相册的统一形状（id 用文档 _id，客户端「改这一个」才对得上）
function shapeAlbum(doc) {
  const raw = doc || {}
  return {
    id: raw._id || raw.id || '',
    className: raw.className || '',
    title: raw.title || '',
    date: raw.date || '',
    cover: raw.cover || '',
    count: Number(raw.count) || 0,
    createdAt: Number(raw.createdAt) || 0,
    updatedAt: Number(raw.updatedAt) || Number(raw.createdAt) || 0
  }
}

// 照片的统一形状（src 给 <image> 直接用，cloud:// 由小程序原生支持）
function shapePhoto(doc) {
  const raw = doc || {}
  return {
    id: raw._id || raw.id || '',
    albumId: raw.albumId || '',
    fileID: raw.fileID || '',
    src: raw.fileID || '',
    createdAt: Number(raw.createdAt) || 0
  }
}

// 相册排序：日期新的在前，其次刚更新的在前
function sortAlbums(rows) {
  const list = (rows || []).slice()
  list.sort(function (a, b) {
    const da = String(a.date || '')
    const db2 = String(b.date || '')
    if (da !== db2) return db2.localeCompare(da)
    return (b.updatedAt || 0) - (a.updatedAt || 0)
  })
  return list
}

// 重新数一遍某个相册里有几张照片
async function countPhotos(albumId) {
  const res = await withTimeout(db.collection(PHOTOS).where({ albumId: albumId }).count(), DB_TIMEOUT, null)
  return res && typeof res.total === 'number' ? res.total : 0
}

// 取某个相册里排在最前面的一张（用来当封面）
async function firstPhoto(albumId) {
  try {
    const res = await db.collection(PHOTOS).where({ albumId: albumId }).orderBy('sort', 'asc').limit(1).get()
    const row = ((res && res.data) || [])[0]
    return row ? row.fileID || '' : ''
  } catch (e) {
    return ''
  }
}

// 一批一批删云存储文件（文件已不在时忽略）
async function deleteFiles(fileIDs) {
  const ids = (fileIDs || []).filter(Boolean)
  for (const group of chunks(ids, DEL_BATCH)) {
    try {
      await cloud.deleteFile({ fileList: group })
    } catch (e) {
      // 忽略：数据库记录已经删掉，文件残留不影响使用
    }
  }
}

exports.main = async (event) => {
  const wxContext = cloud.getWXContext()
  const openid = wxContext.OPENID || ''
  const action = (event && event.action) || ''

  /* ---------------- 任何人都能用的：身份、班级、看相册 ---------------- */

  if (action === 'whoami') {
    const both = await Promise.all([isAdmin(openid), hasAdmin()])
    return ok({
      openid: openid,
      isAdmin: both[0],
      initialized: both[1]
    })
  }

  // 家长自己的班级（第一次进相册页时选一次，云端记住，换手机也在）
  if (action === 'myClass') {
    if (!openid) return ok({ className: '' })
    const res = await withTimeout(db.collection(MEMBERS).doc(openid).get(), DB_TIMEOUT, null)
    return ok({ className: (res && res.data && res.data.className) || '' })
  }

  if (action === 'setMyClass') {
    if (!openid) return fail('拿不到 openid，请在真机小程序里操作')
    const className = trimText(event.className)
    if (!className) return fail('请先选择班级')
    if (className.length > CLASS_MAX) return fail('班级名最多 ' + CLASS_MAX + ' 个字')
    await ensure(MEMBERS)
    try {
      await db
        .collection(MEMBERS)
        .doc(openid)
        .set({ data: { className: className, updatedAt: Date.now() } })
    } catch (e) {
      return fail('保存失败：' + errText(e))
    }
    return ok({ className: className })
  }

  // 相册列表：家长端只传自己的班级；不传就是全部（园里的总览）
  if (action === 'listAlbums') {
    const className = trimText(event.className)
    try {
      let query = db.collection(ALBUMS)
      if (className) query = query.where({ className: className })
      const res = await query.limit(LIST_LIMIT).get()
      return ok({ albums: sortAlbums(((res && res.data) || []).map(shapeAlbum)) })
    } catch (e) {
      // 集合还不存在时按「还没有相册」处理，不报错
      return ok({ albums: [] })
    }
  }

  // 某个相册里的照片（分页：一次最多 60 张）
  if (action === 'listPhotos') {
    const albumId = trimText(event.albumId)
    if (!albumId) return fail('缺少相册 id')
    const skip = Math.max(0, Number(event.skip) || 0)

    let album = null
    try {
      const res = await db.collection(ALBUMS).doc(albumId).get()
      album = (res && res.data && shapeAlbum(res.data)) || null
    } catch (e) {
      album = null
    }
    if (!album) return fail('这个相册已经不在了')

    try {
      const res = await db
        .collection(PHOTOS)
        .where({ albumId: albumId })
        .orderBy('sort', 'asc')
        .skip(skip)
        .limit(PAGE_SIZE)
        .get()
      const photos = ((res && res.data) || []).map(shapePhoto)
      return ok({
        album: album,
        photos: photos,
        skip: skip,
        hasMore: photos.length >= PAGE_SIZE,
        total: album.count
      })
    } catch (e) {
      return ok({ album: album, photos: [], skip: skip, hasMore: false, total: album.count })
    }
  }

  // 把 fileID 换成 https 临时链接（保存到手机、分享时才需要；<image> 直接用 fileID 就行）
  if (action === 'tempUrls') {
    const raw = Array.isArray(event.fileIDs) ? event.fileIDs : []
    const ids = raw
      .filter(function (id) {
        return typeof id === 'string' && id.indexOf('cloud://') === 0
      })
      .slice(0, 50)
    if (!ids.length) return ok({ urls: [] })
    try {
      const res = await cloud.getTempFileURL({ fileList: ids })
      const list = ((res && res.fileList) || []).map(function (item) {
        return { fileID: item.fileID || '', url: item.tempFileURL || '' }
      })
      return ok({ urls: list })
    } catch (e) {
      return fail('取临时链接失败：' + errText(e))
    }
  }

  /* ---------------- 以下操作必须是管理员 ---------------- */

  if (!(await isAdmin(openid))) {
    return fail('没有管理权限')
  }

  // 说明：本函数同样不提供「自助成为管理员」——管理员认领只在 menuAdmin 里做一次，
  //       避免多个云函数各开一个提权口子（安全考虑）。本函数只认已有白名单。

  // 新建相册
  if (action === 'createAlbum') {
    const className = trimText(event.className)
    const title = trimText(event.title)
    const date = trimText(event.date)

    if (!className) return fail('请先选择班级')
    if (className.length > CLASS_MAX) return fail('班级名最多 ' + CLASS_MAX + ' 个字')
    if (!title) return fail('请先填写相册名')
    if (title.length > MAX_TITLE) return fail('相册名最多 ' + MAX_TITLE + ' 个字')
    if (date && !DATE_RE.test(date)) return fail('日期格式要像 2026-04-20')

    await ensure(ALBUMS)
    const now = Date.now()
    const data = {
      className: className,
      title: title,
      date: date || todayText(),
      cover: '',
      count: 0,
      createdAt: now,
      updatedAt: now,
      creator: openid
    }
    let newId = ''
    try {
      const res = await db.collection(ALBUMS).add({ data: data })
      newId = (res && res._id) || ''
    } catch (e) {
      return fail('新建失败：' + errText(e))
    }
    if (!newId) return fail('新建失败：没有拿到相册 id')
    return ok({ album: shapeAlbum(Object.assign({ _id: newId }, data)) })
  }

  // 改相册信息（相册名 / 班级 / 日期 / 封面）
  if (action === 'updateAlbum') {
    const albumId = trimText(event.albumId)
    if (!albumId) return fail('缺少相册 id')

    let doc = null
    try {
      const res = await db.collection(ALBUMS).doc(albumId).get()
      doc = (res && res.data) || null
    } catch (e) {
      doc = null
    }
    if (!doc) return fail('这个相册已经不在了')

    const patch = { updatedAt: Date.now(), updater: openid }
    if (event.title !== undefined) {
      const title = trimText(event.title)
      if (!title) return fail('相册名不能为空')
      if (title.length > MAX_TITLE) return fail('相册名最多 ' + MAX_TITLE + ' 个字')
      patch.title = title
    }
    if (event.className !== undefined) {
      const className = trimText(event.className)
      if (!className) return fail('班级不能为空')
      if (className.length > CLASS_MAX) return fail('班级名最多 ' + CLASS_MAX + ' 个字')
      patch.className = className
    }
    if (event.date !== undefined) {
      const date = trimText(event.date)
      if (date && !DATE_RE.test(date)) return fail('日期格式要像 2026-04-20')
      patch.date = date
    }
    if (event.cover !== undefined) {
      const cover = trimText(event.cover)
      patch.cover = cover.indexOf('cloud://') === 0 ? cover : ''
    }

    try {
      await db.collection(ALBUMS).doc(albumId).update({ data: patch })
    } catch (e) {
      return fail('保存失败：' + errText(e))
    }
    return ok({ album: shapeAlbum(Object.assign({}, doc, patch)) })
  }

  // 删除相册：连同里面的照片记录和云存储文件一起删掉
  if (action === 'removeAlbum') {
    const albumId = trimText(event.albumId)
    if (!albumId) return fail('缺少相册 id')

    let photos = []
    try {
      const res = await db.collection(PHOTOS).where({ albumId: albumId }).limit(LIST_LIMIT).get()
      photos = (res && res.data) || []
    } catch (e) {
      photos = []
    }

    try {
      await Promise.all(
        photos.map(function (p) {
          return db
            .collection(PHOTOS)
            .doc(p._id)
            .remove()
            .catch(function () {
              // 单条删失败不影响整体
            })
        })
      )
    } catch (e) {
      return fail('删除照片记录失败：' + errText(e))
    }

    await deleteFiles(
      photos.map(function (p) {
        return p.fileID
      })
    )

    try {
      await db.collection(ALBUMS).doc(albumId).remove()
    } catch (e) {
      return fail('删除相册失败：' + errText(e))
    }
    return ok({ removed: 1, photos: photos.length })
  }

  // 登记照片：客户端先把图传到云存储，再把 fileID 交上来记账
  if (action === 'addPhotos') {
    const albumId = trimText(event.albumId)
    if (!albumId) return fail('缺少相册 id')

    const raw = Array.isArray(event.fileIDs) ? event.fileIDs : []
    const fileIDs = raw.filter(function (id) {
      return typeof id === 'string' && id.indexOf('cloud://') === 0
    })
    if (!fileIDs.length) return fail('没有可登记的照片')
    if (fileIDs.length > MAX_BATCH) return fail('一次最多上传 ' + MAX_BATCH + ' 张')

    let doc = null
    try {
      const res = await db.collection(ALBUMS).doc(albumId).get()
      doc = (res && res.data) || null
    } catch (e) {
      doc = null
    }
    if (!doc) return fail('这个相册已经不在了')

    await ensure(PHOTOS)
    const before = await countPhotos(albumId)
    const after = before + fileIDs.length
    if (after > MAX_PHOTOS) {
      return fail('这个相册最多放 ' + MAX_PHOTOS + ' 张，先删掉一些再传')
    }

    const now = Date.now()
    try {
      await Promise.all(
        fileIDs.map(function (fileID, i) {
          return db.collection(PHOTOS).add({
            data: {
              albumId: albumId,
              fileID: fileID,
              sort: now + i,
              createdAt: now + i,
              creator: openid
            }
          })
        })
      )
    } catch (e) {
      return fail('登记照片失败：' + errText(e))
    }

    const albumPatch = { count: after, updatedAt: now }
    if (!doc.cover) albumPatch.cover = fileIDs[0]
    try {
      await db.collection(ALBUMS).doc(albumId).update({ data: albumPatch })
    } catch (e) {
      // 照片已经写进去了，这里失败只影响封面和数量显示，不当作整体失败
    }

    return ok({ added: fileIDs.length, album: shapeAlbum(Object.assign({}, doc, albumPatch)) })
  }

  // 删照片：记录和云存储文件一起删；删掉封面就自动换成剩下的第一张
  if (action === 'removePhotos') {
    const raw = Array.isArray(event.ids) ? event.ids : []
    const ids = raw
      .filter(function (id) {
        return typeof id === 'string' && !!id
      })
      .slice(0, MAX_BATCH)
    if (!ids.length) return fail('没有可删除的照片')

    const docs = []
    for (const id of ids) {
      try {
        const res = await db.collection(PHOTOS).doc(id).get()
        if (res && res.data) docs.push(Object.assign({ _id: id }, res.data))
      } catch (e) {
        // 已经不在了，跳过
      }
    }
    if (!docs.length) return fail('这些照片已经不在了')

    try {
      await Promise.all(
        docs.map(function (doc) {
          return db.collection(PHOTOS).doc(doc._id).remove()
        })
      )
    } catch (e) {
      return fail('删除失败：' + errText(e))
    }

    await deleteFiles(
      docs.map(function (doc) {
        return doc.fileID
      })
    )

    // 每个受影响的相册：重数一遍数量，封面没了就换一张
    const albumIds = []
    docs.forEach(function (doc) {
      if (doc.albumId && albumIds.indexOf(doc.albumId) < 0) albumIds.push(doc.albumId)
    })
    for (const albumId of albumIds) {
      const count = await countPhotos(albumId)
      const patch = { count: count, updatedAt: Date.now() }
      try {
        const res = await db.collection(ALBUMS).doc(albumId).get()
        const album = (res && res.data) || null
        // 封面这张正好被删掉了（或本来就没封面）→ 换成剩下的第一张
        const coverGone = !!(album && (!album.cover || (await hasFile(docs, album.cover))))
        if (coverGone) patch.cover = await firstPhoto(albumId)
        if (album) await db.collection(ALBUMS).doc(albumId).update({ data: patch })
      } catch (e) {
        // 相册已被删掉时忽略
      }
    }

    return ok({ removed: docs.length })
  }

  return fail('未知操作：' + action)
}

// 刚删掉的这批照片里，是否包含这张封面
async function hasFile(docs, fileID) {
  return (docs || []).some(function (doc) {
    return doc.fileID === fileID
  })
}
