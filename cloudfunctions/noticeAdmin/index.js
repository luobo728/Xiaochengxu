// 云函数 noticeAdmin —— 通知公告的唯一写入入口
// 规则：家长端对数据库一律只读（其实连读都走本函数）；新增、修改、删除、恢复
//       都必须经过本函数，且调用者 openid 必须在管理员白名单内。
// 管理员来源（满足其一即可，与 menuAdmin 完全相同）：
//   ① 云函数环境变量 ADMIN_OPENIDS（多个用英文逗号分隔）
//   ② 数据库集合 menu_admins，文档 ID = 管理员 openid
// 数据集合：notices（文档字段：title / tag / time / body / top / createdAt / updatedAt）
const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()
const COLLECTION = 'notices'
const ADMINS = 'menu_admins' // 与食谱管理共用同一份管理员名单
const TAGS = ['通知', '活动', '保健', '提示', '食谱']
const MAX_TITLE = 40
const MAX_BODY = 1000
const DATE_RE = /^\d{2}-\d{2}$/
const DB_TIMEOUT = 1500 // 数据库查询的内部超时（毫秒），防止云函数被平台判超时

// 演示通知：管理员点「恢复演示通知」时写回这 4 条
const DEFAULT_NOTICES = [
  {
    id: 'n1',
    title: '周六亲子运动会报名截止 4月15日 18:00',
    tag: '活动',
    time: '04-14',
    top: false,
    body:
      '请还没报名的家长在 4月15日 18:00 前完成报名：从首页顶部活动卡进「活动中心」，找到「2026 春季亲子运动会」，点最下面的「我要报名」。\n' +
      '运动会当天请给孩子穿运动鞋、带水杯，8:40 之前到中心操场集合。'
  },
  {
    id: 'n2',
    title: '春季流感高发，请为宝贝准备一件外套',
    tag: '保健',
    time: '04-13',
    top: false,
    body:
      '最近天气忽冷忽热，园里已经加强通风与消毒。\n' +
      '请每天给孩子准备一件薄外套放在书包里，方便户外活动时增减；如果孩子有发热、咳嗽，请先在家休息并告诉班主任老师。'
  },
  {
    id: 'n3',
    title: '4月20日 家长开放日，欢迎家长准时参加',
    tag: '通知',
    time: '04-12',
    top: true,
    body:
      '4月20日（周一）上午 08:40-11:00 是本学期家长开放日。\n' +
      '每位孩子限一位家长参加，进园请出示接送卡并在门卫处登记，手机调成静音。活动结束后欢迎在班级群留言反馈。'
  },
  {
    id: 'n4',
    title: '本周五 16:00 结束接送，请提前安排',
    tag: '提示',
    time: '04-11',
    top: false,
    body:
      '本周五下午全园教研活动，16:00 开始离园，请家长提前安排时间。\n' +
      '如确需晚接，请在 15:00 前跟班主任说明，园里会安排值班老师看护。'
  }
]

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

// 今天：'MM-DD'（云函数按中国时区算，避免服务器在别的时区跑偏）
function todayShort() {
  const d = new Date(Date.now() + 8 * 3600 * 1000)
  const m = d.getUTCMonth() + 1
  const day = d.getUTCDate()
  return (m < 10 ? '0' + m : '' + m) + '-' + (day < 10 ? '0' + day : '' + day)
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

// 是否已经有管理员（首次初始化时用来防止重复认领）
async function hasAdmin() {
  const res = await withTimeout(db.collection(ADMINS).count(), DB_TIMEOUT, null)
  return !!(res && res.total > 0)
}

// 统一整理成客户端要的形状（id 用文档 _id，保证「改这一条」能对上）
function shape(doc) {
  const raw = doc || {}
  return {
    id: raw._id || raw.id || '',
    title: raw.title || '',
    tag: raw.tag || '通知',
    time: raw.time || todayShort(),
    body: raw.body || '',
    top: !!raw.top,
    createdAt: Number(raw.createdAt) || 0,
    updatedAt: Number(raw.updatedAt) || Number(raw.createdAt) || 0
  }
}

// 排序：置顶在前；其次新发布的在前（同一天按 updatedAt 排）
function sortRows(rows) {
  const list = (rows || []).slice()
  list.sort(function (a, b) {
    if (!!a.top !== !!b.top) return a.top ? -1 : 1
    if ((b.updatedAt || 0) !== (a.updatedAt || 0)) return (b.updatedAt || 0) - (a.updatedAt || 0)
    return String(b.time || '').localeCompare(String(a.time || ''))
  })
  return list
}

exports.main = async (event) => {
  const wxContext = cloud.getWXContext()
  const openid = wxContext.OPENID || ''
  const action = (event && event.action) || ''

  // 我是谁（任何用户都可调用，用于决定是否展示管理入口）
  if (action === 'whoami') {
    const both = await Promise.all([isAdmin(openid), hasAdmin()])
    return ok({
      openid: openid,
      isAdmin: both[0],
      initialized: both[1]
    })
  }

  // 读取通知列表（所有用户可调用：家长端只需要「看」，所以放在管理员校验之前）
  if (action === 'list') {
    try {
      const res = await db.collection(COLLECTION).limit(100).get()
      return ok({ rows: sortRows((res && res.data) || []).map(shape) })
    } catch (e) {
      // 集合还不存在时按「还没有通知」处理，不报错
      return ok({ rows: [] })
    }
  }

  // 以下操作必须是管理员
  if (!(await isAdmin(openid))) {
    return fail('没有管理权限')
  }

  // 说明：这个函数不提供「自助成为管理员」——管理员认领只在 menuAdmin 里做一次，
  //       避免两个云函数各开一个提权口子（安全考虑）。本函数只认已有白名单。

  // 新增 / 修改（带 id 就是改这一条）
  if (action === 'save') {
    const title = trimText(event.title)
    if (!title) return fail('请先填写标题')
    if (title.length > MAX_TITLE) return fail('标题最多 ' + MAX_TITLE + ' 个字')
    const body = trimText(event.body)
    if (body.length > MAX_BODY) return fail('正文最多 ' + MAX_BODY + ' 个字')

    const tag = TAGS.indexOf(trimText(event.tag)) > -1 ? trimText(event.tag) : '通知'
    const top = !!event.top
    const now = Date.now()
    const id = trimText(event.id)

    try {
      await db.createCollection(COLLECTION)
    } catch (e) {
      // 已存在，忽略
    }

    // 改
    if (id) {
      let doc = null
      try {
        const res = await db.collection(COLLECTION).doc(id).get()
        doc = (res && res.data) || null
      } catch (e) {
        doc = null
      }
      if (!doc) return fail('这条通知已经不在了')

      const time = DATE_RE.test(doc.time || '') ? doc.time : todayShort()
      try {
        await db
          .collection(COLLECTION)
          .doc(id)
          .update({
            data: {
              title: title,
              tag: tag,
              body: body,
              top: top,
              time: time,
              updatedAt: now,
              updater: openid
            }
          })
      } catch (e) {
        return fail('保存失败：' + errText(e))
      }
      return ok({ item: shape(Object.assign({}, doc, { title: title, tag: tag, body: body, top: top, time: time, updatedAt: now })) })
    }

    // 新增
    const data = {
      title: title,
      tag: tag,
      time: todayShort(),
      body: body,
      top: top,
      createdAt: now,
      updatedAt: now,
      creator: openid
    }
    let newId = ''
    try {
      const res = await db.collection(COLLECTION).add({ data: data })
      newId = (res && res._id) || ''
    } catch (e) {
      return fail('保存失败：' + errText(e))
    }
    if (!newId) return fail('保存失败：没有拿到新记录的 id')
    return ok({ item: shape(Object.assign({ _id: newId }, data)) })
  }

  // 删除一条
  if (action === 'remove') {
    const id = trimText(event.id)
    if (!id) return fail('缺少 id')
    try {
      await db.collection(COLLECTION).doc(id).remove()
    } catch (e) {
      return fail('删除失败：' + errText(e))
    }
    return ok({ removed: 1 })
  }

  // 恢复演示通知：清空后写回那 4 条（给园长试手感的，谨慎使用）
  if (action === 'reset') {
    try {
      await db.createCollection(COLLECTION)
    } catch (e) {
      // 已存在，忽略
    }

    let olds = []
    try {
      const res = await db.collection(COLLECTION).limit(100).get()
      olds = (res && res.data) || []
    } catch (e) {
      olds = []
    }
    try {
      await Promise.all(
        olds.map(function (d) {
          return db.collection(COLLECTION).doc(d._id).remove()
        })
      )
    } catch (e) {
      return fail('清理旧通知失败：' + errText(e))
    }

    const now = Date.now()
    try {
      await Promise.all(
        DEFAULT_NOTICES.map(function (item, i) {
          return db
            .collection(COLLECTION)
            .add({
              data: {
                title: item.title,
                tag: item.tag,
                time: item.time,
                body: item.body,
                top: item.top,
                createdAt: now - (DEFAULT_NOTICES.length - i) * 1000,
                updatedAt: now - (DEFAULT_NOTICES.length - i) * 1000,
                creator: openid
              }
            })
        })
      )
    } catch (e) {
      return fail('写入演示通知失败：' + errText(e))
    }
    return ok({ reset: DEFAULT_NOTICES.length })
  }

  return fail('未知操作：' + action)
}
