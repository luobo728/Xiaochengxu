// utils/billing.js —— 计费模块数据层（课时余额 + 账户余额 + 收支账本）
//
// 两种模式：
//   'local'（当前）—— 数据存在手机本地，**不需要云函数**，装好就能演示；
//   'cloud'（待接入）—— 接云函数 billing（actions: summary / ledger / claim / checkin），
//                        券码由园所后台生成，一人一码、服务端校验。
//
// 设计要点：**计费规则只写在这一处**（RULES），页面不写死任何金额或时长；
//          将来换成联网，页面一行都不用改（接口签名保持不变）。
//
// 真实场景怎么用（新生扫码领课时）：
//   园所把券码（如 NEW-2026）做成二维码贴在门口/发朋友圈 →
//   家长在小程序里点「扫码领课时」扫这个码 → 课时直接进账（同一码限领一次）。
const MODE = 'local' // 'local' | 'cloud'

const STORE_KEY = 'billing_v1'
const LEDGER_MAX = 200

// ===== 计费规则（唯一来源）=====
const RULES = {
  checkinReward: 1.5, // 每天打卡返多少元余额
  claimHours: 2, // 默认券码送多少课时
  checkinAgainText: '今天已经打过卡啦，明天再来～',
  claimAgainText: '这个券码你已经领过了'
}

// 本地演示用的券码（联网后由园所后台生成，这里只是让功能马上能演示）
const DEMO_CODES = [
  { code: 'NEW-2026', hours: 2, note: '新生扫码礼' },
  { code: 'FRIEND-2026', hours: 1, note: '老带新推荐礼' }
]

/* ---------------- 小工具 ---------------- */

function pad(n) {
  return n < 10 ? '0' + n : '' + n
}

function dayStr(d) {
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate())
}

function todayStr() {
  return dayStr(new Date())
}

function yesterdayStr() {
  const d = new Date()
  d.setDate(d.getDate() - 1)
  return dayStr(d)
}

function nowText() {
  const d = new Date()
  return pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes())
}

function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100
}

/* ---------------- 本地存储 ---------------- */

function emptyState() {
  return {
    hours: 0,
    balance: 0,
    ledger: [],
    checkins: {},
    checkinDays: 0,
    lastCheckinDate: '',
    claims: {},
    claimCount: 0
  }
}

function readState() {
  try {
    const s = wx.getStorageSync(STORE_KEY)
    if (s && typeof s === 'object') {
      return Object.assign(emptyState(), s)
    }
  } catch (e) {
    // 读失败按全新账户处理
  }
  return emptyState()
}

function writeState(s) {
  try {
    wx.setStorageSync(STORE_KEY, s)
  } catch (e) {
    // 写失败不影响本次结果（下次打开会回到上一次的状态）
  }
}

function summarize(s) {
  return {
    hours: s.hours,
    balance: s.balance,
    checkinDays: s.checkinDays,
    todayChecked: !!s.checkins[todayStr()],
    claimCount: s.claimCount
  }
}

// 记一笔流水（新的在最前面，最多留 LEDGER_MAX 条）
function addLedger(s, item) {
  const isYuan = item.unit === 'yuan'
  s.ledger.unshift({
    id: 'l' + Date.now() + '_' + Math.floor(Math.random() * 1000),
    time: Date.now(),
    timeText: nowText(),
    type: item.type,
    typeName: item.typeName,
    amount: item.amount,
    unit: item.unit,
    unitName: isYuan ? '元' : '课时',
    note: item.note || '',
    afterText: isYuan ? '余额 ¥' + round2(s.balance).toFixed(2) : '课时 ' + s.hours
  })
  if (s.ledger.length > LEDGER_MAX) {
    s.ledger = s.ledger.slice(0, LEDGER_MAX)
  }
}

function findCode(code) {
  for (let i = 0; i < DEMO_CODES.length; i++) {
    if (DEMO_CODES[i].code === code) return DEMO_CODES[i]
  }
  return null
}

/* ---------------- 对外接口 ---------------- */

// 账户概况
function getSummary() {
  return Promise.resolve(summarize(readState()))
}

// 收支明细
function listLedger(limit) {
  const s = readState()
  const n = typeof limit === 'number' && limit > 0 ? limit : 50
  return Promise.resolve(s.ledger.slice(0, n))
}

// 扫码/输入券码 → 领课时
function claimByCode(code) {
  const raw = String(code || '').trim().toUpperCase()
  if (!raw) return Promise.resolve({ ok: false, msg: '请输入券码' })

  const s = readState()
  if (s.claims[raw]) {
    return Promise.resolve({ ok: false, msg: RULES.claimAgainText })
  }

  const found = findCode(raw)
  if (!found) {
    return Promise.resolve({ ok: false, msg: '券码无效，请检查是否输错' })
  }

  s.hours += found.hours
  s.claims[raw] = true
  s.claimCount += 1
  addLedger(s, {
    type: 'claim',
    typeName: '扫码领课时',
    amount: found.hours,
    unit: 'hour',
    note: found.note + '（' + raw + '）'
  })
  writeState(s)

  return Promise.resolve({
    ok: true,
    msg: '领取成功',
    hours: found.hours,
    summary: summarize(s)
  })
}

// 今日打卡 → 返余额
function checkin() {
  const s = readState()
  const today = todayStr()

  if (s.checkins[today]) {
    return Promise.resolve({ ok: false, msg: RULES.checkinAgainText })
  }

  // 连续天数：昨天打过就 +1，断了就从 1 重新算
  s.checkinDays = s.lastCheckinDate === yesterdayStr() ? (s.checkinDays || 0) + 1 : 1
  s.lastCheckinDate = today
  s.checkins[today] = true
  s.balance = round2(s.balance + RULES.checkinReward)

  addLedger(s, {
    type: 'checkin',
    typeName: '每日打卡返余额',
    amount: RULES.checkinReward,
    unit: 'yuan',
    note: '连续打卡 ' + s.checkinDays + ' 天'
  })
  writeState(s)

  return Promise.resolve({
    ok: true,
    msg: '打卡成功',
    reward: RULES.checkinReward,
    summary: summarize(s)
  })
}

// 计费规则（页面展示用）
function rules() {
  return {
    checkinReward: RULES.checkinReward,
    claimHours: RULES.claimHours,
    checkinAgainText: RULES.checkinAgainText,
    claimAgainText: RULES.claimAgainText
  }
}

// 演示用券码（联网后由园所后台生成，这里仅用于演示提示）
function demoCodes() {
  return DEMO_CODES.slice()
}

module.exports = {
  mode: MODE,
  getSummary: getSummary,
  listLedger: listLedger,
  claimByCode: claimByCode,
  checkin: checkin,
  rules: rules,
  demoCodes: demoCodes
}
