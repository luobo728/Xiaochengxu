// 云函数 menuAdmin —— 食谱图片的唯一写入入口
// 规则：客户端对数据库/存储一律只读；新增、删除都必须经过本函数，
//       且调用者 openid 必须在管理员白名单内。
// 管理员来源（满足其一即可）：
//   ① 云函数环境变量 ADMIN_OPENIDS（多个用英文逗号分隔）
//   ② 数据库集合 menu_admins，文档 ID = 管理员 openid
const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()
const _ = db.command
const COLLECTION = 'menu_photos'
const ADMINS = 'menu_admins'
const MEAL_KEYS = ['breakfast', 'morning', 'lunch', 'afternoon', 'dinner']
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

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

  try {
    const res = await db.collection(ADMINS).doc(openid).get()
    return !!(res && res.data)
  } catch (e) {
    return false
  }
}

// 是否已经有管理员（首次初始化时用来防止重复认领）
async function hasAdmin() {
  try {
    const res = await db.collection(ADMINS).count()
    return !!(res && res.total > 0)
  } catch (e) {
    return false
  }
}

exports.main = async (event) => {
  const wxContext = cloud.getWXContext()
  const openid = wxContext.OPENID || ''
  const action = (event && event.action) || ''

  // 我是谁（任何用户都可调用，用于决定是否展示管理入口）
  if (action === 'whoami') {
    return ok({
      openid: openid,
      isAdmin: await isAdmin(openid),
      initialized: await hasAdmin()
    })
  }

  // 读取图片记录（所有用户可调用：客户端只需要「看」，所以放在管理员校验之前）
  if (action === 'list') {
    const rawDates = Array.isArray(event.dates) ? event.dates : []
    const dates = rawDates
      .filter(function (d) {
        return DATE_RE.test(d || '')
      })
      .slice(0, 14)
    if (!dates.length) return ok({ rows: [] })
    try {
      const res = await db
        .collection(COLLECTION)
        .where({ date: _.in(dates) })
        .orderBy('sort', 'asc')
        .limit(100)
        .get()
      return ok({ rows: (res && res.data) || [] })
    } catch (e) {
      // 集合还不存在时按「还没有图片」处理，不报错
      return ok({ rows: [] })
    }
  }

  // 首次初始化：还没有管理员时，第一个调用者成为管理员
  // （这样不用去控制台手工建集合、配权限、抄 openid）
  if (action === 'init') {
    if (!openid) return fail('拿不到 openid，请在真机小程序里操作')
    try {
      await db.createCollection(COLLECTION)
    } catch (e) {
      // 集合已存在（或会在写入时自动创建），忽略
    }
    try {
      await db.createCollection(ADMINS)
    } catch (e) {
      // 集合已存在（或会在写入时自动创建），忽略
    }
    if (await hasAdmin()) return fail('已经设置过管理员了')
    try {
      await db.collection(ADMINS).doc(openid).set({
        data: {
          createTime: db.serverDate(),
          note: 'first-admin'
        }
      })
    } catch (e) {
      return fail('设置失败：' + errText(e))
    }
    return ok({ openid: openid, isAdmin: true })
  }

  // 以下操作必须是管理员
  if (!(await isAdmin(openid))) {
    return fail('没有管理权限')
  }

  // 新增图片记录
  if (action === 'add') {
    const raw = event.items
    if (!Array.isArray(raw) || !raw.length) {
      return fail('没有可写入的有效记录')
    }
    // 单次最多 60 条，避免异常大的 payload 造成无谓的配额消耗
    if (raw.length > 60) {
      return fail('一次最多写入 60 条')
    }
    const items = raw.filter(function (it) {
      return (
        it &&
        DATE_RE.test(it.date || '') &&
        MEAL_KEYS.indexOf(it.meal) > -1 &&
        typeof it.fileID === 'string' &&
        it.fileID.indexOf('cloud://') === 0
      )
    })
    if (!items.length) {
      return fail('没有可写入的有效记录')
    }
    try {
      const tasks = items.map(function (it) {
        return db.collection(COLLECTION).add({
          data: {
            date: it.date,
            meal: it.meal,
            fileID: it.fileID,
            sort: Number.isFinite(it.sort) ? it.sort : Date.now(),
            createTime: db.serverDate(),
            creator: openid
          }
        })
      })
      const res = await Promise.all(tasks)
      return ok({ added: res.length })
    } catch (e) {
      return fail('写入失败：' + errText(e))
    }
  }

  // 删除图片记录（同时删除云存储文件）
  if (action === 'remove') {
    const id = event.id
    if (!id) return fail('缺少 id')

    let fileID = ''
    try {
      const doc = await db.collection(COLLECTION).doc(id).get()
      fileID = (doc && doc.data && doc.data.fileID) || ''
    } catch (e) {
      return fail('记录不存在或已被删除')
    }

    try {
      await db.collection(COLLECTION).doc(id).remove()
    } catch (e) {
      return fail('删除记录失败：' + errText(e))
    }

    if (fileID) {
      try {
        await cloud.deleteFile({ fileList: [fileID] })
      } catch (e) {
        // 文件已不存在时忽略
      }
    }
    return ok({ removed: 1 })
  }

  return fail('未知操作：' + action)
}
