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

// ===== 上课扣课时规则（自动计算课时的唯一来源，页面不写死数字）=====
// 已确认口径：每节 1 课时；请假不扣、旷课照扣；试听不扣 —— 要改口径只改这里
const ATTEND = {
  perLesson: 1, // 正常到课：扣几课时
  leaveFree: true, // 请假：不扣
  absentCharge: true, // 旷课：照扣
  trialFree: true, // 试听：不扣
  unitMinutes: 45, // 将来按分钟排课：45 分钟记 1 课时（本机按次，用不到）
  lowWarn: 4, // 剩余课时 ≤ 4 时提醒家长续费
  allowNegative: true // 课时不够时照扣成负数（课确实上了）；关掉就变成「没课时不让上课」
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
    spent: 0,
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
    // 已完成课时合计（课时页用；领到的课时不算「已完成」）
    spent: s.spent || 0,
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
    // 判重键：同一节课绝不用重复扣，就靠它（见 applyHours）
    ref: item.ref || '',
    // 展示用：课时页「课时明细」显示课程名 + 老师（账单页用不到，忽略也不影响）
    title: item.title || '',
    sub: item.sub || '',
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

/* ---------------- 课时变动（唯一入口） ---------------- */

// 这个 ref 记过账没有（同一节课的同一笔只记一次）
function hasRef(s, ref) {
  if (!ref) return false
  for (let i = 0; i < s.ledger.length; i++) {
    if (s.ledger[i].ref === ref) return true
  }
  return false
}

// 课时增减的唯一入口 —— 页面和别的模块都不许自己改 `hours`，只能走这里
//   amount 正数进、负数扣
//   type：'consume' 上课扣课时 / 'refund' 课时回补（纠正）/ 'claim' 领课时 / 'gift' 赠送
//   ref 是判重键（例：L20260415A:lele#0）：同一 ref 再来一次直接跳过 ——
//   重复点保存、断网重试、自动补算撞上老师点名，都不会重复扣课时
function applyHours(item) {
  const it = item || {}
  const amount = round2(it.amount)
  const ref = String(it.ref || '')

  if (!amount) return Promise.resolve({ ok: false, dup: false, msg: '没有课时变化' })

  const s = readState()
  if (ref && hasRef(s, ref)) {
    return Promise.resolve({ ok: false, dup: true, msg: it.dupText || '这笔已经记过了', summary: summarize(s) })
  }

  s.hours = round2(s.hours + amount)
  // 「已完成课时」的口径（课时页用）：扣课时算上过的课，冲正回补要减回去（领 / 赠不动它）
  if (it.type === 'consume') s.spent = round2((s.spent || 0) + Math.abs(amount))
  if (it.type === 'refund') s.spent = Math.max(0, round2((s.spent || 0) - Math.abs(amount)))

  addLedger(s, {
    type: it.type || 'adjust',
    typeName: it.typeName || '课时调整',
    amount: amount,
    unit: 'hour',
    note: it.note || '',
    ref: ref,
    title: it.title || '',
    sub: it.sub || ''
  })
  writeState(s)

  return Promise.resolve({
    ok: true,
    dup: false,
    msg: it.okText || '已记账',
    amount: amount,
    summary: summarize(s)
  })
}

// 课时口径（课时页的三个数字）：剩余 = 余额；已完成 = 已扣合计；本学期 = 已完成 + 剩余
function hoursStat() {
  const s = readState()
  const left = round2(s.hours)
  const spent = round2(s.spent || 0)
  return {
    left: left,
    spent: spent,
    total: round2(spent + left)
  }
}

// 扫码/输入券码 → 领课时（课时进账走唯一入口 applyHours，同一券码另有 ref 判重）
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

  return applyHours({
    amount: found.hours,
    type: 'claim',
    typeName: '扫码领课时',
    note: found.note + '（' + raw + '）',
    ref: 'claim:' + raw,
    title: '扫码领课时',
    sub: found.note + '（' + raw + '）',
    dupText: RULES.claimAgainText
  }).then(function (res) {
    if (res.dup) return { ok: false, msg: RULES.claimAgainText }
    // 券码标记写在进账之后：万一这步没写成，最多「同一券码能再领一次」，不会丢课时
    const s2 = readState()
    s2.claims[raw] = true
    s2.claimCount = (s2.claimCount || 0) + 1
    writeState(s2)
    return {
      ok: true,
      msg: '领取成功',
      hours: found.hours,
      summary: summarize(s2)
    }
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

// 上课扣课时规则（点名页 / 课时页展示用；要改口径只改 ATTEND）
function attendRules() {
  return {
    perLesson: ATTEND.perLesson,
    leaveFree: ATTEND.leaveFree,
    absentCharge: ATTEND.absentCharge,
    trialFree: ATTEND.trialFree,
    unitMinutes: ATTEND.unitMinutes,
    lowWarn: ATTEND.lowWarn,
    allowNegative: ATTEND.allowNegative
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
  applyHours: applyHours,
  hoursStat: hoursStat,
  rules: rules,
  attendRules: attendRules,
  demoCodes: demoCodes
}
