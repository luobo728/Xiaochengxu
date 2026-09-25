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

const MODE = 'local'

const FUNCTION_NAME = env.NOTICE_FUNCTION || 'noticeAdmin'
const KEY_LIST = 'notice_list_v1'
const KEY_LOCAL_ADMIN = 'notice_local_admin_v1'

const MAX_TITLE = 40
const MAX_BODY = 1000
const TAGS = ['通知', '活动', '保健', '提示', '食谱']

// 演示通知：本机第一次使用时自动写入，管理员可编辑 / 删除 / 恢复
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

  if (MODE === 'cloud' && isCloudReady()) {
    return call('save', {
      id: id,
      title: title,
      tag: trimText(draft.tag) || '通知',
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

// 本机体验管理员：云端还没连上时，让园长能先把通知改起来（只影响本机）
// 例外：演示账号的「家长端」一票否决 —— 之前长按开过的、云端白名单里有这台机器
// openid 的，全都不算数（见 utils/demo-role.js）。要管理先切到老师端。
function isLocalAdmin() {
  if (role.isParent()) return false
  try {
    return !!wx.getStorageSync(KEY_LOCAL_ADMIN)
  } catch (e) {
    return false
  }
}

// 返回值：true 表示这次写入生效；false 表示被演示账号的家长端挡下了（调用方要给提示）
function setLocalAdmin(on) {
  if (on && role.isParent()) return false
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
// 演示账号的家长端例外：不看云端、不看缓存、不看本机标记，一律「不是管理员」
// 返回 Promise<{ isAdmin, source, openid, initialized, tip }>
function adminStatus() {
  if (role.isParent()) return Promise.resolve(parentStatus())

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

// 演示账号的家长端：统一按「不是管理员」回，并带一句照着做的提示
// initialized 给 true：免得页面再走「还没有设置管理员 → 一键成为管理员」那一套
function parentStatus() {
  return {
    isAdmin: false,
    source: 'demo',
    openid: '',
    initialized: true,
    tip: role.PARENT_TIP
  }
}

function localStatus(reason) {
  const on = isLocalAdmin()
  let tip = ''
  if (on) {
    tip = '本机体验模式（' + reason + '）：改的通知只保存在这台手机上'
  } else if (role.isParent()) {
    tip = role.PARENT_TIP
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
  setLocalAdmin: setLocalAdmin
}
