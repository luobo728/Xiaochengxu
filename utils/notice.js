// utils/notice.js —— 通知公告数据层（本地先跑通，云端接口预留）
//
// 全项目只有这个文件与「通知」数据打交道，页面只调用这里导出的函数。
//   读：listSync() 同步拿本机数据（页面立刻能画出来，不用等网络）
//       list()     拿最新数据（云端模式会走网络，返回 Promise）
//   写：save / remove / toggleTop / resetDemo —— 只有管理员会看到入口，页面已隐藏
//
// 两种模式（改一行 MODE 即可切换，页面代码完全不用动）：
//   'local' —— 通知存在本机（wx.setStorageSync）：现在就能用；换手机不通用
//   'cloud' —— 走云函数 noticeAdmin（集合 notices）：多人多机同步
//              云函数已写好：cloudfunctions/noticeAdmin，部署说明见 docs/notice-admin.md
const env = require('./env.js')
// 复用「谁是管理员」的唯一判断（云端 menuAdmin + 本机体验标记），避免项目里出现两套身份
const menu = require('./menu.js')
// 演示账号身份底线：家长端永远不是管理员（单独一个文件，避免循环依赖）
const role = require('./demo-role.js')
// 定向推送要知道「这个客户端是哪个班的」：班级只认「孩子档案」那一份（谁都不 require，不会绕圈）
const kids = require('./children.js')

const MODE = 'local'

const FUNCTION_NAME = env.NOTICE_FUNCTION || 'noticeAdmin'
const KEY_LIST = 'notice_list_v1'
const KEY_LOCAL_ADMIN = 'notice_local_admin_v1'

const MAX_TITLE = 40
const MAX_BODY = 1000
const TAGS = ['通知', '活动', '保健', '提示', '食谱']

// 定向推送：'全园' = 所有家长都看得到；选了班级，就只有那个班的客户端看得到
// 班级名单不在这个文件里再抄一份 —— 用的是「孩子档案」里那一份（同一个园，加班只改一处）
const ALL_CLASS = '全园'
const TARGETS = [ALL_CLASS].concat(kids.CLASSES)

// 演示通知：本机第一次使用时自动写入，管理员可编辑 / 删除 / 恢复
// n5 是「定向推送」的样例：只推给大一班（演示账号的家长端就是大一班的乐乐妈妈，所以她看得到）
const DEFAULT_NOTICES = [
  {
    id: 'n1',
    title: '周六亲子运动会报名截止 4月15日 18:00',
    tag: '活动',
    to: ALL_CLASS,
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
    to: ALL_CLASS,
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
    to: ALL_CLASS,
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
    to: ALL_CLASS,
    time: '04-11',
    top: false,
    body:
      '本周五下午全园教研活动，16:00 开始离园，请家长提前安排时间。\n' +
      '如确需晚接，请在 15:00 前跟班主任说明，园里会安排值班老师看护。'
  },
  {
    id: 'n5',
    title: '大一班周五户外写生：请给孩子带画本和彩色笔',
    tag: '通知',
    to: '大一班',
    time: '04-10',
    top: false,
    body:
      '周五上午大一班到园外小公园写生，9:00 出发，11:30 回园。\n' +
      '请给孩子带一本画本、一盒彩色笔，穿方便走路的鞋子。这条通知只推给「大一班」的家长，别班的家长端看不到。'
  }
]

/* ---------------- 小工具 ---------------- */

function pad2(n) {
  return n < 10 ? '0' + n : '' + n
}

// 今天：'MM-DD'（新增通知的默认日期）
function todayShort() {
  const d = new Date()
  return pad2(d.getMonth() + 1) + '-' + pad2(d.getDate())
}

function trimText(v) {
  return String(v === undefined || v === null ? '' : v).replace(/^\s+|\s+$/g, '')
}

// 把任意来源的「推送范围」收成一个合法值：不认识的一律当「全园」
// （宁可推给全园，也不要因为班级写错让这条通知在家长端凭空消失）
function pickTarget(v) {
  const t = trimText(v)
  return TARGETS.indexOf(t) > -1 ? t : ALL_CLASS
}

// 把任意来源的数据整理成统一的一条通知
function normalize(raw) {
  if (!raw || typeof raw !== 'object') return null
  const title = trimText(raw.title)
  if (!title) return null
  const id = trimText(raw.id || raw._id) || 'n' + Date.now()
  return {
    id: id,
    title: title,
    tag: trimText(raw.tag) || '通知',
    to: pickTarget(raw.to),
    time: trimText(raw.time) || todayShort(),
    body: trimText(raw.body),
    top: !!raw.top,
    createdAt: Number(raw.createdAt) || Date.now(),
    updatedAt: Number(raw.updatedAt) || Number(raw.createdAt) || Date.now()
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

/* ---------------- 本机存储 ---------------- */

function readListRaw() {
  try {
    const value = wx.getStorageSync(KEY_LIST)
    if (Array.isArray(value)) {
      return value.map(normalize).filter(Boolean)
    }
  } catch (e) {
    // 读失败按「没有数据」处理
  }
  return []
}

function writeListRaw(rows) {
  try {
    wx.setStorageSync(KEY_LIST, rows || [])
  } catch (e) {
    // 写失败不影响本页显示，下次读取会重新写入种子数据
  }
}

function buildSeed() {
  const now = Date.now()
  return DEFAULT_NOTICES.map(function (item, i) {
    return normalize(
      Object.assign({}, item, {
        createdAt: now - i * 3600000,
        updatedAt: now - i * 3600000
      })
    )
  }).filter(Boolean)
}

/* ---------------- 云开发状态 ---------------- */

function isCloudReady() {
  try {
    return !!menu.isCloudReady()
  } catch (e) {
    return false
  }
}

function callOnce(action, data) {
  return new Promise(function (resolve, reject) {
    if (!isCloudReady()) {
      reject(new Error(menu.cloudError() || '云开发未就绪'))
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

/* ---------------- 读 ---------------- */

// 同步读：本机有数据就用本机数据；本机为空且是本地模式时写入演示数据后再返回
function listSync() {
  const rows = readListRaw()
  if (rows.length) return sortRows(rows)
  if (MODE === 'local') {
    const seed = buildSeed()
    writeListRaw(seed)
    return sortRows(seed)
  }
  return []
}

// 拿最新数据：本地模式 = 本机数据；云端模式 = 问云函数（并把结果存到本机当缓存）
function list() {
  if (MODE !== 'cloud' || !isCloudReady()) {
    return Promise.resolve(listSync())
  }
  return call('list').then(function (res) {
    const rows = ((res && res.rows) || []).map(normalize).filter(Boolean)
    writeListRaw(rows)
    return sortRows(rows)
  })
}

function getById(id) {
  const key = trimText(id)
  if (!key) return null
  const rows = listSync()
  for (let i = 0; i < rows.length; i++) {
    if (rows[i].id === key) return rows[i]
  }
  return null
}

/* ---------------- 定向推送（推送范围） ---------------- */

// 这个客户端「属于哪个班」—— 定向推送就按它投递：
//   演示账号的家长端 —— 自己孩子（乐乐）档案里的班级（档案被删就当没有班级）
//   老师端 / 管理员 / 没切演示账号的真机 —— '' 表示不筛，通知全都看得到
function viewClass() {
  if (!role.isParent()) return ''
  const kid = kids.get(kids.OWNER.parent)
  return trimText(kid && kid.cls)
}

// 这条通知这个客户端看得到吗：
//   全园 —— 都看得到
//   定向到某个班 —— 只有这个班的客户端看得到（没有班级的客户端不筛，免得老师自己看不到）
function canSee(row) {
  const to = pickTarget(row && row.to)
  if (to === ALL_CLASS) return true
  const cls = viewClass()
  if (!cls) return true
  return cls === to
}

// 按「这个客户端的班级」筛一遍（家长端首页 / 通知详情用这个）
function filterVisible(rows) {
  const all = rows || []
  const out = []
  for (let i = 0; i < all.length; i++) {
    if (canSee(all[i])) out.push(all[i])
  }
  return out
}

// 同步版：本机数据立刻画出来（家长端首页不等网络）
function listVisibleSync() {
  return filterVisible(listSync())
}

// 最新版：拉一次最新数据再筛
function listVisible() {
  return list().then(function (rows) {
    return filterVisible(rows)
  })
}

// 这条通知推给谁（'全园' / '小班' / '中班' / '大班' / '大一班' / '学前班'）
function targetOf(row) {
  return pickTarget(row && row.to)
}

// 「推送范围」在页面上怎么写（管理页列表和通知详情共用这一份文案）
function rangeText(row) {
  const to = targetOf(row)
  return to === ALL_CLASS ? '全园' : '仅 ' + to
}

// 范围标签的配色：全园用灰的，定向用蓝的（配色 class 在 app.wxss）
function rangeTone(row) {
  return targetOf(row) === ALL_CLASS ? 'tag-gray' : 'tag-blue'
}

// 表单用：某个范围在胶囊列表里的下标（找不到就是 0 = 全园）
function targetIndex(v) {
  const i = TARGETS.indexOf(pickTarget(v))
  return i > -1 ? i : 0
}

/* ---------------- 写（仅管理员） ---------------- */

// 保存：带 id 表示改这一条，不带 id 表示新增。返回 Promise<{ ok, msg, item }>
function save(input) {
  const draft = input || {}
  const title = trimText(draft.title)
  if (!title) {
    return Promise.resolve({ ok: false, msg: '请先填写标题' })
  }
  if (title.length > MAX_TITLE) {
    return Promise.resolve({ ok: false, msg: '标题最多 ' + MAX_TITLE + ' 个字' })
  }
  const body = trimText(draft.body)
  if (body.length > MAX_BODY) {
    return Promise.resolve({ ok: false, msg: '正文最多 ' + MAX_BODY + ' 个字' })
  }

  const now = Date.now()
  const id = trimText(draft.id)
  // 推送范围：这次没传就沿用原来那条（改通知时不会把范围悄悄改回「全园」）
  const cur = id ? getById(id) : null
  const to = draft.to === undefined || draft.to === '' ? targetOf(cur) : pickTarget(draft.to)

  if (MODE === 'cloud' && isCloudReady()) {
    return call('save', {
      id: id,
      title: title,
      tag: trimText(draft.tag) || '通知',
      to: to,
      body: body,
      top: !!draft.top
    }).then(function (res) {
      if (res && res.ok) clearListCache()
      return res && res.ok ? { ok: true, item: res.item || null } : { ok: false, msg: (res && res.msg) || '保存失败' }
    })
  }

  const rows = listSync()
  let item = null
  let found = false
  const next = rows.map(function (row) {
    if (id && row.id === id) {
      found = true
      item = Object.assign({}, row, {
        title: title,
        tag: trimText(draft.tag) || row.tag || '通知',
        to: to,
        body: body,
        top: !!draft.top,
        updatedAt: now
      })
      return item
    }
    return row
  })

  if (!found) {
    item = normalize({
      id: 'n' + now,
      title: title,
      tag: trimText(draft.tag) || '通知',
      to: to,
      time: todayShort(),
      body: body,
      top: !!draft.top,
      createdAt: now,
      updatedAt: now
    })
    next.push(item)
  }

  writeListRaw(next)
  return Promise.resolve({ ok: true, item: item })
}

function remove(id) {
  const key = trimText(id)
  if (!key) return Promise.resolve({ ok: false, msg: '缺少 id' })

  if (MODE === 'cloud' && isCloudReady()) {
    return call('remove', { id: key }).then(function (res) {
      if (res && res.ok) clearListCache()
      return res && res.ok ? { ok: true } : { ok: false, msg: (res && res.msg) || '删除失败' }
    })
  }

  const rows = listSync()
  const next = rows.filter(function (row) {
    return row.id !== key
  })
  if (next.length === rows.length) return Promise.resolve({ ok: false, msg: '这条通知已经不在了' })
  writeListRaw(next)
  return Promise.resolve({ ok: true })
}

// 置顶 / 取消置顶
function toggleTop(id) {
  const row = getById(id)
  if (!row) return Promise.resolve({ ok: false, msg: '这条通知已经不在了' })

  if (MODE === 'cloud' && isCloudReady()) {
    return call('save', {
      id: row.id,
      title: row.title,
      tag: row.tag,
      body: row.body,
      to: pickTarget(row.to),
      top: !row.top
    }).then(function (res) {
      if (res && res.ok) clearListCache()
      return res && res.ok ? { ok: true, top: !row.top } : { ok: false, msg: (res && res.msg) || '操作失败' }
    })
  }

  const now = Date.now()
  const next = listSync().map(function (item) {
    if (item.id !== row.id) return item
    return Object.assign({}, item, { top: !item.top, updatedAt: now })
  })
  writeListRaw(next)
  return Promise.resolve({ ok: true, top: !row.top })
}

// 恢复演示数据（只在本地模式生效：把本机通知重写回初始那几条）
function resetDemo() {
  if (MODE === 'cloud' && isCloudReady()) {
    return call('reset').then(function (res) {
      if (res && res.ok) clearListCache()
      return res && res.ok ? { ok: true } : { ok: false, msg: (res && res.msg) || '恢复失败' }
    })
  }
  writeListRaw(buildSeed())
  return Promise.resolve({ ok: true })
}

// 本机数据变了（管理员刚改完），让下次读取重新从云端拉
function clearListCache() {
  try {
    wx.removeStorageSync(KEY_LIST)
  } catch (e) {
    // 忽略
  }
}

/* ---------------- 管理员身份 ---------------- */

// 「现在这个人是不是管理员」只有一份判断（utils/demo-role.js）：
//   演示账号 —— 只看花名册：超级管理员固定是、管理员看有没有被设置、家长和普通老师一律不是
//               （长按开过的标记、云端白名单、whoami 缓存全都不参与）
//   没切演示账号 —— 还是原来那套：本机体验管理员标记（长按「我的」页版本号开启）
function isLocalAdmin() {
  if (role.isDemo()) return role.canManage()
  try {
    return !!wx.getStorageSync(KEY_LOCAL_ADMIN)
  } catch (e) {
    return false
  }
}

// 返回值：true 表示这次写入生效；false 表示被演示账号挡下了（这条路只给没切账号的真机用）
function setLocalAdmin(on) {
  if (on && role.isDemo() && !role.isSuper()) return false
  try {
    if (on) {
      wx.setStorageSync(KEY_LOCAL_ADMIN, 1)
    } else {
      wx.removeStorageSync(KEY_LOCAL_ADMIN)
    }
  } catch (e) {
    // 忽略
  }
  return true
}

// 身份判断：能连云端就以云端为准；云端不可用时退回「本机体验管理员」
// 演示账号例外：不看云端、不看缓存、不看本机标记，权限只看花名册
//   —— 家长端、还没被设为管理员的老师端，都在这里直接收口成「不是管理员」
// 返回 Promise<{ isAdmin, source, openid, initialized, tip }>
function adminStatus() {
  const lock = role.lockTip()
  if (lock) return Promise.resolve(demoStatus(lock))

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

// 演示账号被拦住时统一这么回，tip 就是锁屏卡片上那句话
// initialized 给 true：免得页面再走「还没有设置管理员 → 一键成为管理员」那一套
function demoStatus(tip) {
  return {
    isAdmin: false,
    source: 'demo',
    openid: '',
    initialized: true,
    tip: tip || role.PARENT_TIP
  }
}

function localStatus(reason) {
  const on = isLocalAdmin()
  let tip = ''
  if (on) {
    tip = '本机体验模式（' + reason + '）：改的通知只保存在这台手机上'
  } else {
    tip = role.lockTip()
  }
  return {
    isAdmin: on,
    source: 'local',
    openid: '',
    initialized: false,
    tip: tip
  }
}

module.exports = {
  MODE: MODE,
  TAGS: TAGS,
  MAX_TITLE: MAX_TITLE,
  MAX_BODY: MAX_BODY,
  ALL_CLASS: ALL_CLASS,
  TARGETS: TARGETS,
  isCloudReady: isCloudReady,
  list: list,
  listSync: listSync,
  getById: getById,
  save: save,
  remove: remove,
  toggleTop: toggleTop,
  resetDemo: resetDemo,
  clearListCache: clearListCache,
  adminStatus: adminStatus,
  isLocalAdmin: isLocalAdmin,
  setLocalAdmin: setLocalAdmin,
  // 定向推送（推送范围）：谁属于哪个班、这条通知他看不看得到、页面上怎么写
  pickTarget: pickTarget,
  targetOf: targetOf,
  viewClass: viewClass,
  canSee: canSee,
  filterVisible: filterVisible,
  listVisible: listVisible,
  listVisibleSync: listVisibleSync,
  rangeText: rangeText,
  rangeTone: rangeTone,
  targetIndex: targetIndex
}
