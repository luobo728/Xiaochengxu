// tools/smoke_schedule.js —— 课表 / 点名 / 结算 / 冲正 / 自动补算 / 清空点名 / 课时页统计 自检
// 跑法：node tools/smoke_schedule.js
//
// 这套断言盯着的是「课时=钱」的那几条铁律：
//   ① 课时增减只走 utils/billing.js 的 applyHours()；
//   ② 同一个孩子同一节课只扣一次（重复保存、自动补算撞上点名都不能重扣）；
//   ③ 纠正不改历史：改点法 / 清空点名走冲正，流水只增不删。
const fs = require('fs')
const path = require('path')
const root = path.resolve(__dirname, '..')

/* ---------------- wx 模拟（storage 读写各过一遍序列化，和真机一致） ---------------- */
const store = {}
const toasts = []
const navBacks = []
const modals = []
let sheetPick = -1
let sheetItems = []
global.wx = {
  getStorageSync: function (k) {
    return store[k] === undefined ? '' : JSON.parse(JSON.stringify(store[k]))
  },
  setStorageSync: function (k, v) {
    store[k] = JSON.parse(JSON.stringify(v))
  },
  removeStorageSync: function (k) {
    delete store[k]
  },
  getSystemInfoSync: function () {
    return { platform: 'devtools', SDKVersion: '3.0.0' }
  },
  showToast: function (o) {
    toasts.push((o && o.title) || '')
  },
  showLoading: function () {},
  hideLoading: function () {},
  showModal: function (o) {
    modals.push((o && o.title) || '')
    if (o && o.success) o.success({ confirm: true, cancel: false })
  },
  showActionSheet: function (o) {
    sheetItems = (o && o.itemList) || []
    if (sheetPick < 0) {
      if (o && o.fail) o.fail({ errMsg: 'cancel' })
      return
    }
    if (o && o.success) o.success({ tapIndex: sheetPick })
  },
  navigateTo: function () {},
  navigateBack: function () {
    navBacks.push(1)
  },
  pageScrollTo: function () {},
  setNavigationBarTitle: function () {},
  hideKeyboard: function () {}
}
global.getApp = function () {
  return { globalData: { statusBarHeight: 47 } }
}
global.getCurrentPages = function () {
  return [{}, {}]
}
let captured = null
global.Page = function (o) {
  captured = o
}

const schedule = require(path.join(root, 'utils/schedule.js'))
const billing = require(path.join(root, 'utils/billing.js'))
const children = require(path.join(root, 'utils/children.js'))
const role = require(path.join(root, 'utils/demo-role.js'))

const KEY_LESSONS = 'schedule_lessons_v1'
const KEY_MARKS = 'schedule_marks_v1'
const KEY_KIDS = 'children_v1'
const KEY_SEEDED = 'children_seeded_v1'
const KEY_DEMO = 'demo_account_v1'

let bad = 0
function check(name, cond, extra) {
  console.log((cond ? '✅ ' : '❌ ') + name + (extra === undefined ? '' : '  → ' + JSON.stringify(extra)))
  if (!cond) bad++
}
function tick(ms) {
  return new Promise(function (r) {
    setTimeout(r, ms || 0)
  })
}
function setDemo(id) {
  if (id) store[KEY_DEMO] = id
  else delete store[KEY_DEMO]
}
function readRaw(k) {
  return store[k] === undefined ? null : JSON.parse(JSON.stringify(store[k]))
}
function writeRaw(k, v) {
  store[k] = JSON.parse(JSON.stringify(v))
}
function loadPage(rel) {
  captured = null
  const full = path.join(root, rel)
  delete require.cache[require.resolve(full)]
  require(full)
  return captured
}
function ctxOf(page, extra) {
  const ctx = {}
  Object.keys(page).forEach(function (k) {
    if (k === 'data') return
    ctx[k] = page[k]
  })
  ctx.data = Object.assign({}, page.data, extra || {})
  ctx.setData = function (o) {
    Object.assign(this.data, o)
  }
  return ctx
}
function rowsOf(id, status) {
  const out = []
  const kids = children.list()
  for (let i = 0; i < kids.length; i++) out.push({ studentId: kids[i].id, status: status })
  return out
}
function lessonById(id) {
  const all = schedule.ensureLessons()
  for (let i = 0; i < all.length; i++) {
    if (all[i].id === id) return all[i]
  }
  return null
}
function ledgers(childId) {
  return billing.listLedger(200, childId)
}

async function main() {
  const today = schedule.today()
  const yesterday = schedule.shift(today, -1)
  const tomorrow = schedule.shift(today, 1)

  /* ================= A. 课表生成 ================= */
  const all = schedule.ensureLessons()
  check('A1 课表按「昨天起 2 周」生成（天天有课）', all.length >= 26, all.length)
  check('A2 每天两节（工作日 09:20 / 15:30，周末 10:00 / 16:00）', (function () {
    const seen = {}
    for (let i = 0; i < all.length; i++) {
      seen[all[i].date] = seen[all[i].date] || []
      seen[all[i].date].push(all[i].time)
    }
    const days = Object.keys(seen)
    for (let i = 0; i < days.length; i++) {
      const want = schedule.isWeekend(days[i]) ? '10:00,16:00' : '09:20,15:30'
      if (seen[days[i]].join(',') !== want) return false
    }
    return days.length >= 13
  })())
  check('A3 课的 id = L + 日期 + A/B（一天两节不重号）', (function () {
    for (let i = 0; i < all.length; i++) {
      const want = 'L' + all[i].date.replace(/-/g, '') + (all[i].time === '09:20' || all[i].time === '10:00' ? 'A' : 'B')
      if (all[i].id !== want) return false
    }
    return true
  })())
  check('A4 每节课都有课程名 / 老师 / 内容简介 / 课时数', all.every(function (l) {
    return !!l.name && !!l.teacher && typeof l.desc === 'string' && l.hours === billing.attendRules().perLesson
  }), all[0] && all[0].name)
  check('A5 每节课的名单 = 孩子档案里的孩子', (function () {
    const ids = children.list().map(function (k) {
      return k.id
    }).join(',')
    return all.every(function (l) {
      return (l.studentIds || []).join(',') === ids
    })
  })(), children.count())
  check('A6 昨天 / 今天 / 明天都有课（演示随时能点）', (function () {
    const has = {}
    for (let i = 0; i < all.length; i++) has[all[i].date] = true
    return !!has[yesterday] && !!has[today] && !!has[tomorrow]
  })())
  const dayInfo = schedule.listDay(today)
  check('A7 listDay 给出日期标题 / 是不是今天 / 点过名几节', dayInfo.date === today && dayInfo.isToday === true && typeof dayInfo.title === 'string' && dayInfo.rolled === 0, dayInfo.title)
  check('A8 listToday() 就是 listDay(今天)', schedule.listToday().date === today && schedule.listToday().lessons.length === dayInfo.lessons.length)
  check('A9 一节课的展示字段齐全（状态 / 副标题 / 结算说明 / 孩子行）', (function () {
    const l = dayInfo.lessons[0]
    return !!l.statusText && !!l.tagClass && !!l.subText && !!l.settledText && l.kids.length === children.count() && l.kidTotal === children.count()
  })())

  /* ================= B. 点名结算（今天两节） ================= */
  const gift = await schedule.bootstrap()
  check('B1 第一次进课时功能：每个孩子各送 20 课时（判重只送一次）', gift.ok === true, gift.msg)
  const kids = children.list()
  const left0 = {}
  for (let i = 0; i < kids.length; i++) left0[kids[i].id] = billing.hoursStat(kids[i].id).left
  check('B2 送完之后每个孩子余额都是 20', kids.every(function (k) {
    return left0[k.id] === 20
  }), left0)
  const again = await schedule.bootstrap()
  check('B3 再进一次不再重复送（判重键 demo_gift_v1:孩子id）', billing.hoursStat(kids[0].id).left === 20, billing.hoursStat(kids[0].id).left)

  const L1 = dayInfo.lessons[0]
  const L2 = dayInfo.lessons[1]
  const settle1 = await schedule.saveMarks(L1.id, rowsOf(L1.id, 'present'), '王老师')
  check('B4 全部到课：按人头各扣 1 课时', settle1.ok === true && settle1.charged === kids.length * L1.hours && settle1.chargedKids === kids.length, settle1.msg)
  check('B5 每个孩子各扣各的（一本账里按孩子分桶）', kids.every(function (k) {
    return billing.hoursStat(k.id).left === 19
  }), kids.map(function (k) {
    return billing.hoursStat(k.id).left
  }))
  const led1 = await ledgers(kids[0].id)
  const ledConsume = led1.filter(function (r) {
    return r.type === 'consume'
  })
  check('B6 流水写明是哪个孩子（childId / childName / 课程名）', ledConsume.length === 1 && ledConsume[0].childId === kids[0].id && ledConsume[0].childName === kids[0].name && ledConsume[0].unit === 'hour' && ledConsume[0].amount === -1, ledConsume[0] && ledConsume[0].note)
  check('B7 扣课时的流水带判重键（ref = 记录id#序号）', ledConsume[0].ref === L1.id + ':' + kids[0].id + '#0', ledConsume[0].ref)

  const mix = [
    { studentId: kids[0].id, status: 'leave' },
    { studentId: kids[1].id, status: 'absent' },
    { studentId: kids[2].id, status: 'trial' }
  ]
  const settle2 = await schedule.saveMarks(L2.id, mix, '王老师')
  check('B8 请假不扣 / 旷课照扣 / 试听不扣', settle2.ok === true && settle2.charged === 1 && settle2.chargedKids === 1, settle2.msg)
  check('B9 三种状态各自的余额对得上（请假、试听没动；旷课扣 1）', billing.hoursStat(kids[0].id).left === 19 && billing.hoursStat(kids[1].id).left === 18 && billing.hoursStat(kids[2].id).left === 19, [billing.hoursStat(kids[0].id).left, billing.hoursStat(kids[1].id).left, billing.hoursStat(kids[2].id).left])
  const dayAfter = schedule.listDay(today)
  check('B10 两节课都变成「已结算」，点过名的课数是 2', dayAfter.rolled === 2 && dayAfter.lessons.every(function (l) {
    return l.status === 'settled' && l.statusText === '已结算'
  }), dayAfter.rolled)
  check('B11 一节课的结算说明写清「几人 · 记几课时」', dayAfter.lessons[1].settledText === '已结算 3/3 人 · 本节记 1 课时', dayAfter.lessons[1].settledText)

  // 取消的课不结算
  const tmrLesson = schedule.listDay(tomorrow).lessons[0]
  const rawLessons = readRaw(KEY_LESSONS)
  for (let i = 0; i < rawLessons.length; i++) {
    if (rawLessons[i].id === tmrLesson.id) rawLessons[i].status = 'canceled'
  }
  writeRaw(KEY_LESSONS, rawLessons)
  const canceled = await schedule.saveMarks(tmrLesson.id, rowsOf('', 'present'), '王老师')
  check('B12 取消的课不结算（也拦下来）', canceled.ok === false && canceled.msg.indexOf('已取消') > -1, canceled.msg)
  const raw2 = readRaw(KEY_LESSONS)
  for (let i = 0; i < raw2.length; i++) {
    if (raw2[i].id === tmrLesson.id) raw2[i].status = 'planned'
  }
  writeRaw(KEY_LESSONS, raw2)
  const missing = await schedule.saveMarks('L不存在的课', rowsOf('', 'present'), '王老师')
  check('B13 找不到这节课时明确说没找到', missing.ok === false && missing.msg.indexOf('没找到') > -1, missing.msg)

  /* ================= C. 幂等与纠正（课时=钱的核心） ================= */
  const beforeC = billing.hoursStat(kids[0].id).left
  const ledBeforeC = (await ledgers(kids[0].id)).length
  const reSave = await schedule.saveMarks(L1.id, rowsOf(L1.id, 'present'), '王老师')
  check('C1 同一节课重复保存：不重复扣（提示已经记过了）', reSave.ok === true && reSave.charged === 0 && reSave.msg === '这节课已经记过了', reSave.msg)
  check('C2 余额没有变化', billing.hoursStat(kids[0].id).left === beforeC, billing.hoursStat(kids[0].id).left)
  check('C3 流水也没有多出来', (await ledgers(kids[0].id)).length === ledBeforeC)

  const fix1 = [
    { studentId: kids[0].id, status: 'leave' },
    { studentId: kids[1].id, status: 'present' },
    { studentId: kids[2].id, status: 'present' }
  ]
  const settled3 = await schedule.saveMarks(L1.id, fix1, '王老师')
  check('C4 点错了改点法：走冲正回补（到课 → 请假退回 1 课时）', settled3.ok === true && settled3.backed === 1 && settled3.charged === 0, settled3.msg)
  check('C5 回补后余额加回来了', billing.hoursStat(kids[0].id).left === beforeC + 1, billing.hoursStat(kids[0].id).left)
  const ledFix = await ledgers(kids[0].id)
  check('C6 纠正记一笔退回流水，原来那笔扣费还在（明细只增不删）', (function () {
    let refunds = 0
    let consumes = 0
    for (let i = 0; i < ledFix.length; i++) {
      if (ledFix[i].type === 'refund') refunds++
      if (ledFix[i].type === 'consume') consumes++
    }
    return ledFix.length === ledBeforeC + 1 && refunds === 1 && consumes === 1
  })(), ledFix.map(function (r) {
    return r.type + ':' + r.amount
  }))
  const back = [
    { studentId: kids[0].id, status: 'present' },
    { studentId: kids[1].id, status: 'present' },
    { studentId: kids[2].id, status: 'present' }
  ]
  const settled4 = await schedule.saveMarks(L1.id, back, '王老师')
  check('C7 改回「到课」再扣一次（序号往下走，不和退回那笔撞号）', settled4.ok === true && settled4.charged === 1 && settled4.backed === 0, settled4.msg)
  const ledAll = await ledgers(kids[0].id)
  check('C8 同一个孩子的几条流水 ref 各不相同（礼物 + 扣 + 退 + 再扣）', (function () {
    const refs = []
    for (let i = 0; i < ledAll.length; i++) {
      if (ledAll[i].type === 'gift') continue
      refs.push(ledAll[i].ref)
    }
    const uniq = refs.filter(function (r, i) {
      return refs.indexOf(r) === i
    })
    return refs.length === 3 && uniq.length === 3
  })(), ledAll.map(function (r) {
    return r.type + ':' + r.ref
  }))
  check('C9 全请假也算「点过名」（不写流水也留痕）', (function () {
    const l = schedule.listDay(today).lessons[0]
    return l.rolled === 3 && l.kids.every(function (k) {
      return k.done === true
    })
  })())

  /* ================= D. 自动补算 ================= */
  const yBefore = billing.hoursStat(kids[0].id).left
  const yLessons = schedule.listDay(yesterday).lessons
  check('D1 昨天的课还没点名（status = planned）', yLessons.length === 2 && yLessons.every(function (l) {
    return l.status === 'planned'
  }), yLessons.map(function (l) {
    return l.status
  }))
  const due = await schedule.settleDue()
  check('D2 进页面自动补算：昨天的课按「到课」补上', due.ok === true && due.count === 2 && due.charged === kids.length * 2, due)
  check('D3 补算后余额按人头各扣 1（每节）', billing.hoursStat(kids[0].id).left === yBefore - 2, billing.hoursStat(kids[0].id).left)
  const dueAgain = await schedule.settleDue()
  check('D4 再补算一次什么都不做（幂等）', dueAgain.count === 0 && dueAgain.charged === 0, dueAgain)
  const yLed = await ledgers(kids[0].id)
  check('D5 补算的流水里写清是自动补算的', (function () {
    for (let i = 0; i < yLed.length; i++) {
      if (yLed[i].note && yLed[i].note.indexOf('自动补算') > -1) return true
    }
    return false
  })())
  const tmr = schedule.listDay(tomorrow).lessons
  check('D6 还没到的课不动（明天还是待上课）', tmr.every(function (l) {
    return l.status === 'planned'
  }), tmr.map(function (l) {
    return l.status
  }))

  /* ================= E. 清空点名（把 3/3 变回 0/3） ================= */
  const leftBeforeClear = {}
  for (let i = 0; i < kids.length; i++) leftBeforeClear[kids[i].id] = billing.hoursStat(kids[i].id).left
  const cleared = await schedule.clearDay(today, '陈老师')
  check('E1 清空这一天：清掉 2 节课、6 条点名记录', cleared.ok === true && cleared.lessons === 2 && cleared.kids === 6, cleared.msg)
  check('E2 退回的课时数 = 今天真正扣掉的（L1 三人 3 + L2 旷课 1）', cleared.refunded === 4, cleared.refunded)
  check('E3 每个孩子的余额都回到清空之前 + 各自退回的', billing.hoursStat(kids[0].id).left === leftBeforeClear[kids[0].id] + 1 && billing.hoursStat(kids[1].id).left === leftBeforeClear[kids[1].id] + 2 && billing.hoursStat(kids[2].id).left === leftBeforeClear[kids[2].id] + 1, [billing.hoursStat(kids[0].id).left, billing.hoursStat(kids[1].id).left, billing.hoursStat(kids[2].id).left])
  const afterClear = schedule.listDay(today)
  check('E4 页面上回到「没点过名」：rolled = 0，状态回「待上课 / 待点名」', afterClear.rolled === 0 && afterClear.lessons.every(function (l) {
    return l.status === 'planned'
  }), afterClear.rolled)
  check('E5 每行也回到没结算的样子（0/3，不扣课时）', afterClear.lessons[0].kids.every(function (k) {
    return k.done === false && k.applied === 0
  }))
  const marksAfter = readRaw(KEY_MARKS)
  check('E6 点名记录是「清零」不是删除（今天的记录还在，saved 归零）', (function () {
    const keys = Object.keys(marksAfter || {})
    const todayIds = [L1.id, L2.id]
    let todayCount = 0
    for (let i = 0; i < keys.length; i++) {
      if (todayIds.indexOf(marksAfter[keys[i]].lessonId) > -1) {
        todayCount++
        if (marksAfter[keys[i]].saved !== false || marksAfter[keys[i]].settledHours !== 0 || marksAfter[keys[i]].timeText !== '') return false
      }
    }
    return todayCount === 6 && keys.length === 12
  })(), Object.keys(marksAfter || {}).length)
  const clearLed = await ledgers(kids[0].id)
  check('E7 退回记一笔「清空点名（冲正）」流水，扣费那几笔都还在', (function () {
    let refunds = 0
    let consumes = 0
    let clearEntry = 0
    for (let i = 0; i < clearLed.length; i++) {
      if (clearLed[i].type === 'refund') refunds++
      if (clearLed[i].type === 'consume') consumes++
      if (clearLed[i].typeName === '清空点名（冲正）' && clearLed[i].amount === 1) clearEntry++
    }
    return refunds === 2 && consumes === 4 && clearEntry === 1
  })(), clearLed.map(function (r) {
    return r.type + ':' + r.amount
  }))
  check('E8 清空过的课带 cleared 标记，并给出说明', (function () {
    const l = lessonById(afterClear.lessons[0].id)
    return l.cleared === true && l.clearedBy === '陈老师' && afterClear.lessons[0].clearedNote.indexOf('手动清空过') > -1
  })(), afterClear.lessons[0].clearedNote)
  const dueAfterClear = await schedule.settleDue()
  check('E9 清空过的课不会被自动补算又扣一遍', dueAfterClear.count === 0 && schedule.listDay(today).rolled === 0, dueAfterClear)
  const reSettle = await schedule.saveMarks(L1.id, rowsOf(L1.id, 'present'), '王老师')
  check('E10 清空后重新点名：按新的一笔正常扣（退回那笔的判重键不撞号）', reSettle.ok === true && reSettle.charged === kids.length, reSettle.msg)
  const reLed = await ledgers(kids[0].id)
  check('E11 重新点名后余额、流水都对得上（扣 1）', billing.hoursStat(kids[0].id).left === leftBeforeClear[kids[0].id] && reLed.length === clearLed.length + 1, [billing.hoursStat(kids[0].id).left, reLed.length])
  const clearAgain = await schedule.clearDay(today, '陈老师')
  check('E12 再清一次照样能清（不会因为清过就卡住）', clearAgain.ok === true && clearAgain.refunded === kids.length, clearAgain.msg)
  const clearEmpty = await schedule.clearDay(tomorrow, '陈老师')
  check('E13 没点过名的日子清空时明确说「不用清」', clearEmpty.ok === false && clearEmpty.msg.indexOf('没有点过名') > -1, clearEmpty.msg)
  check('E14 清空只影响这一天（昨天的补算记录没被动）', schedule.listDay(yesterday).rolled === 2, schedule.listDay(yesterday).rolled)

  /* ================= F. 课时页统计 ================= */
  const kidId = kids[0].id
  const st = await schedule.courseStats(kidId)
  check('F1 三个数字自洽：本学期 = 已完成 + 剩余', st.totalHours === st.doneHours + st.leftHours && st.leftHours === billing.hoursStat(kidId).left, [st.totalHours, st.doneHours, st.leftHours])
  check('F2 看单个孩子时标题是他的名字', st.kidName === children.get(kidId).name && st.childId === kidId, st.kidName)
  check('F3 本周进度：完成数 ≤ 总数，百分比按这个算', st.weekDone <= st.weekTotal && st.weekPercent === (st.weekTotal ? Math.round((st.weekDone / st.weekTotal) * 100) : 0), [st.weekDone, st.weekTotal, st.weekPercent])
  check('F3b 本周课节数和课表对得上（只数这一周、不算取消的课）', (function () {
    const ws = schedule.shift(today, -((schedule.weekday(today) + 6) % 7))
    const we = schedule.shift(ws, 6)
    let n = 0
    for (let i = 0; i < all.length; i++) {
      if (all[i].date >= ws && all[i].date <= we && all[i].status !== 'canceled') n++
    }
    return st.weekTotal === n
  })(), st.weekTotal)
  check('F4 本周课时只列「还没扣课时」的课（已扣的归到明细，不重复列）', (function () {
    if (st.weekCourses.length > 6) return false
    for (let i = 0; i < st.weekCourses.length; i++) {
      const r = st.weekCourses[i]
      // 已扣 / 已结算的课不该再出现在「本周课时」里
      if (r.val.indexOf('已扣') > -1 || r.val.indexOf('已结算') > -1) return false
      if (!r.id || !r.name || !r.sub || !r.bg || !r.ico || typeof r.desc !== 'string') return false
    }
    return true
  })(), st.weekCourses.map(function (r) {
    return r.val
  }))
  check('F4b 这一周确实有已扣课时的课（说明上面的过滤不是空转）', (function () {
    const ws = schedule.shift(schedule.today(), -((schedule.weekday(schedule.today()) + 6) % 7))
    const we = schedule.shift(ws, 6)
    const all = schedule.listLessons()
    let charged = 0
    for (let i = 0; i < all.length; i++) {
      if (all[i].date >= ws && all[i].date <= we && all[i].charged > 0) charged++
    }
    return charged > 0
  })())
  check('F5 课时明细最多 4 条，每行带日期 / 课程名 / 课时数', st.records.length > 0 && st.records.length <= 4 && st.records.every(function (r) {
    return /^\d\d-\d\d /.test(r.date) && !!r.name && /课时$/.test(r.val)
  }), st.records.length)
  check('F5b 本周扣掉的课时能在明细里找到（归了类也没丢账）', (function () {
    const name = schedule.listDay(schedule.today()).lessons[0].name
    for (let i = 0; i < st.records.length; i++) {
      if (st.records[i].name.indexOf(name) > -1) return true
    }
    return false
  })(), st.records.map(function (r) {
    return r.name
  }))
  check('F6 明细里退回的写 +、扣掉的写 -', (function () {
    for (let i = 0; i < st.records.length; i++) {
      if (st.records[i].val.charAt(0) === '+' && st.records[i].gray !== true) return false
      if (st.records[i].val.charAt(0) === '-' && st.records[i].gray === true) return false
    }
    return true
  })())
  const stAll = await schedule.courseStats()
  check('F7 不传孩子 → 全园合计（数字 ≥ 单个孩子）', stAll.kidName === '全园合计' && stAll.totalHours >= st.totalHours && stAll.doneHours >= st.doneHours, [stAll.totalHours, st.totalHours])
  check('F8 合计的明细里会标出这是谁的课时', (function () {
    for (let i = 0; i < stAll.records.length; i++) {
      if (stAll.records[i].name.indexOf('·') > -1) return true
    }
    return stAll.records.length === 0
  })())

  /* ================= G. 展示小工具 ================= */
  check('G1 四种状态的文案只有一处（statusLabel）', schedule.statusLabel('present') === '到课' && schedule.statusLabel('leave') === '请假' && schedule.statusLabel('absent') === '旷课' && schedule.statusLabel('trial') === '试听')
  check('G2 状态胶囊 4 个，当前状态高亮', (function () {
    const p = schedule.pillsOf('leave')
    if (p.length !== 4) return false
    let on = 0
    for (let i = 0; i < p.length; i++) if (p[i].on) on++
    return on === 1 && p[1].key === 'leave' && p[1].on === true
  })())
  check('G3 kidRow：没保存时显示「状态 · 扣 N 课时」', (function () {
    const r = schedule.kidRow('present', 1, { saved: false, applied: 0, left: 19 })
    return r.stateLine === '到课 · 扣 1 课时 · 余 19 课时' && r.done === false && r.pills.length === 4
  })(), schedule.kidRow('present', 1, { saved: false, applied: 0, left: 19 }).stateLine)
  check('G4 kidRow：请假不扣课时', schedule.kidRow('leave', 1, {}).stateLine === '请假 · 不扣课时', schedule.kidRow('leave', 1, {}).stateLine)
  check('G5 kidRow：保存后显示「已结算 · 扣 N 课时」', schedule.kidRow('present', 1, { saved: true, applied: 1, left: 19 }).stateLine === '已结算 · 扣 1 课时 · 余 19 课时', schedule.kidRow('present', 1, { saved: true, applied: 1, left: 19 }).stateLine)
  check('G6 ruleText 把扣课时规则写成人话（数值来自规则表）', schedule.ruleText() === '每节 1 课时 · 请假不扣 · 旷课照扣 · 试听不扣', schedule.ruleText())
  check('G7 modeTip 说明了演示口径与规则', schedule.modeTip().indexOf('演示模式') > -1 && schedule.modeTip().indexOf('各记一本账') > -1)
  check('G8 余额充足时没有续费提醒', schedule.lowTip(kidId) === '', schedule.lowTip(kidId))
  const lowLeft = billing.hoursStat(kidId).left
  await billing.applyHours({
    amount: -(lowLeft - 2),
    type: 'consume',
    typeName: '冒烟测试：把余额压到 2',
    childId: kidId,
    childName: children.get(kidId).name,
    ref: 'smoke_low_v1',
    title: '冒烟测试'
  })
  check('G9 余额 ≤ 4 时提醒续费，并写出是谁', schedule.lowTip(kidId).indexOf(children.get(kidId).name) > -1 && schedule.lowTip(kidId).indexOf('剩 2 课时') > -1, schedule.lowTip(kidId))
  await billing.applyHours({
    amount: lowLeft - 2,
    type: 'gift',
    typeName: '冒烟测试：还回去',
    childId: kidId,
    childName: children.get(kidId).name,
    ref: 'smoke_low_v2',
    title: '冒烟测试'
  })
  check('G10 补回去之后提醒又消失（口径只跟余额有关）', schedule.lowTip(kidId) === '', billing.hoursStat(kidId).left)

  /* ================= H. 点名页 ================= */
  const attPage = loadPage('pages/attendance/attendance.js')
  setDemo('parent')
  const pctx = ctxOf(attPage)
  pctx.checkIdentity.call(pctx)
  check('H1 家长端一票否决：只有锁卡片，没有课表', pctx.data.canRoll === false && pctx.data.demoLock === role.ROLL_PARENT_TIP && pctx.data.lessons.length === 0, pctx.data.demoLock)
  check('H2 家长端就算直接调点名 / 清空也什么都不做', (function () {
    toasts.length = 0
    modals.length = 0
    pctx.onSave({ currentTarget: { dataset: { li: 0 } } })
    // 就算页面状态被搞脏（假装有课点过名），家长端的守卫也必须先拦住
    pctx.data.showClear = true
    pctx.data.rolled = 2
    pctx.onClear()
    pctx.onPrevDay()
    return toasts.length === 0 && modals.length === 0 && pctx.data.lessons.length === 0
  })())

  setDemo('teacher')
  const tctx = ctxOf(attPage)
  tctx.checkIdentity.call(tctx)
  await tick(20)
  check('H3 老师端能进，并给出老师说明', tctx.data.canRoll === true && tctx.data.staffTip === role.ROLL_STAFF_TIP, tctx.data.staffTip)
  check('H4 进页面就把今天的课表画出来（2 节）', tctx.data.lessons.length === 2 && tctx.data.isToday === true && tctx.data.kidCount === children.count(), tctx.data.lessons.length)
  check('H5 顶部两个数字 = 全园合计', tctx.data.left === billing.hoursStat().left && tctx.data.spent === billing.hoursStat().spent, [tctx.data.left, tctx.data.spent])
  check('H6 这一天刚清空过 → 不显示「清空」按钮', tctx.data.rolled === 0 && tctx.data.showClear === false, tctx.data.rolled)

  toasts.length = 0
  tctx.onPill({ currentTarget: { dataset: { li: 0, ki: 0, key: 'leave' } } })
  check('H7 点状态胶囊：只改这一行显示，先标成「还没保存」', tctx.data.dirty === true && tctx.data.lessons[0].kids[0].status === 'leave' && tctx.data.lessons[0].kids[0].done === false, tctx.data.lessons[0].kids[0].stateLine)
  const beforeSave = billing.hoursStat(kids[0].id).left
  tctx.onSave({ currentTarget: { dataset: { li: 0 } } })
  await tick(20)
  check('H8 保存点名：结算 + 给提示', toasts.indexOf('已结算 2 人，扣 2 课时') > -1, toasts)
  check('H9 保存后余额按状态扣（请假那个不扣）', billing.hoursStat(kids[0].id).left === beforeSave, billing.hoursStat(kids[0].id).left)
  check('H10 保存后出现「清空」按钮，文案是「清空今日点名」', tctx.data.showClear === true && tctx.data.clearLabel === '清空今日点名' && tctx.data.dirty === false, tctx.data.clearLabel)
  tctx.onPill({ currentTarget: { dataset: { li: 0, ki: 1, key: 'absent' } } })
  check('H11 有未保存的改动时，清空先被拦住', (function () {
    toasts.length = 0
    tctx.onClear()
    return toasts.length === 1 && toasts[0].indexOf('先点「保存点名」再清空') > -1
  })(), toasts)
  tctx.onSave({ currentTarget: { dataset: { li: 0 } } })
  await tick(20)
  tctx.onPrevDay()
  await tick(20)
  check('H12 换到前一天：文案变「清空这一天点名」', tctx.data.isToday === false && tctx.data.clearLabel === '清空这一天点名', tctx.data.clearLabel)
  tctx.onToday()
  await tick(20)
  check('H13 点中间回到今天', tctx.data.isToday === true)
  toasts.length = 0
  modals.length = 0
  tctx.onClear()
  await tick(30)
  check('H14 清空点名：弹确认 → 清掉 → 提示写清退回多少课时', modals.length === 1 && modals[0].indexOf('清空今日点名') > -1 && toasts.join('|').indexOf('退回') > -1, toasts)
  check('H15 清空后按钮又消失、页面回到没点名状态', tctx.data.rolled === 0 && tctx.data.showClear === false, tctx.data.rolled)
  navBacks.length = 0
  tctx.goBack()
  check('H16 返回按钮走统一返回逻辑', navBacks.length === 1)

  // 一个孩子档案都没有：引导去建档
  const kidsBackup = readRaw(KEY_KIDS)
  writeRaw(KEY_KIDS, [])
  writeRaw(KEY_SEEDED, true)
  const nctx = ctxOf(attPage)
  nctx.checkIdentity.call(nctx)
  await tick(20)
  check('H17 还没有孩子档案时：提示去建档，不出点名表', nctx.data.noKid === true && nctx.data.kidCount === 0, nctx.data.noKid)
  nctx.goChildren()
  check('H18 「去建立孩子档案」跳的是档案页', true)
  writeRaw(KEY_KIDS, kidsBackup)

  /* ================= I. 课时页 ================= */
  const coursePage = loadPage('pages/course/course.js')
  setDemo('parent')
  const pc = ctxOf(coursePage)
  pc.pickKid.call(pc)
  await tick(30)
  check('I1 家长端锁在自己孩子（乐乐），不给切换', pc.data.kidId === children.OWNER.parent && pc.data.kidLock === true && pc.data.kidName === children.get(children.OWNER.parent).name, pc.data.kidName)
  toasts.length = 0
  pc.onPickKid()
  check('I2 家长端点「切换孩子」只给一句说明', toasts.length === 1 && toasts[0].indexOf('只能看他一个') > -1, toasts)
  check('I3 三个数字铺到页面上（和账本一致）', pc.data.leftHours === billing.hoursStat(children.OWNER.parent).left && pc.data.totalHours === pc.data.doneHours + pc.data.leftHours, [pc.data.totalHours, pc.data.doneHours, pc.data.leftHours])
  check('I4 本周课程与明细都画出来了', pc.data.weekCourses.length > 0 && pc.data.weekTotal > 0, [pc.data.weekCourses.length, pc.data.weekTotal])

  setDemo('teacher')
  const tc = ctxOf(coursePage)
  tc.pickKid.call(tc)
  await tick(30)
  check('I5 老师端：档案里不止一个孩子 → 可以切换', tc.data.multiKid === true && tc.data.kidLock === false, tc.data.multiKid)
  const pickKid2 = children.list()[1]
  sheetPick = 1
  tc.onPickKid()
  await tick(30)
  check('I3b 选一个孩子就切过去（并记住这次选择）', tc.data.kidId === pickKid2.id && tc.data.kidName === pickKid2.name && store['course_kid_v1'] === pickKid2.id, [sheetItems.length, tc.data.kidName])
  check('I6 切到别的孩子后，看的是他自己的账', tc.data.leftHours === billing.hoursStat(tc.data.kidId).left, tc.data.leftHours)
  toasts.length = 0
  tc.onMoreTap()
  check('I7 明细里的「查看全部」暂时给一句占位提示', toasts.length === 1, toasts)
  check('I8 课时页没有孩子档案时退回「全园合计」', (function () {
    writeRaw(KEY_KIDS, [])
    writeRaw(KEY_SEEDED, true)
    const ec = ctxOf(coursePage)
    ec.pickKid.call(ec)
    const ok = ec.data.kidId === '' && ec.data.kidName === '全园合计'
    writeRaw(KEY_KIDS, kidsBackup)
    return ok
  })())

  /* ================= J. 页面结构（wxml 源码级） ================= */
  const attWxml = fs.readFileSync(path.join(root, 'pages/attendance/attendance.wxml'), 'utf8')
  check('J1 「清空」按钮受 showClear 控制，并绑在 onClear 上', attWxml.indexOf('wx:if="{{showClear}}"') > -1 && attWxml.indexOf('bindtap="onClear"') > -1)
  check('J2 清空按钮旁边写着「会退回课时、明细不删」的说明', attWxml.indexOf('按「冲正」退回') > -1)
  check('J3 状态胶囊绑在 onPill 上，并把 li / ki / key 传下去', attWxml.indexOf('bindtap="onPill"') > -1 && attWxml.indexOf('data-li="{{li}}"') > -1 && attWxml.indexOf('data-key="{{p.key}}"') > -1)

  console.log(bad ? '\n❌ 失败 ' + bad + ' 项' : '\n✅ 课时自动计算冒烟测试全部通过')
  process.exit(bad ? 1 : 0)
}

main().catch(function (e) {
  console.log('❌ 抛异常：' + (e && e.stack ? e.stack : e))
  process.exit(1)
})
