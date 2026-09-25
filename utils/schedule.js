// utils/schedule.js —— 课时自动计算：课表 + 点名 + 结算 + 课时页统计
//
// 三份数据（本机都放 storage，云端以后对应三个集合）：
//   ① 课表  schedule_lessons_v1   一节课一条：日期 / 课程 / 老师 / 该来的孩子 / 每节几课时
//   ② 点名  schedule_marks_v1     一个孩子一节课一条：到课 / 请假 / 旷课 / 试听
//   ③ 流水  billing_v1.ledger     复用计费模块的账本（unit = 'hour'，见 utils/billing.js）
//
// 三条铁律：
//   ① 课时增减只走 utils/billing.js 的 applyHours()，本文件一个余额数字都不自己改；
//   ② 同一个孩子同一节课只扣一次：mark.settledHours 是主判据，
//      流水 ref（mark.id#次数）是第二道保险 —— 重复保存、断网重试、补算撞上点名都不会重扣；
//   ③ 纠正不改历史：旷课改成请假走「冲正」回补（refund +1），流水只增不删，账永远对得上。
//
// 「自动」是怎么发生的（本机没有后台定时器，所以用最诚实的方式）：
//   老师点名保存 → 立刻结算；进「点名」页 / 「课时」页 → settleDue() 把「时间已过、
//   还没点名」的课按到课补上并结算。将来云端换成定时触发器，调的是同一个函数，页面不用改。
const billing = require('./billing.js')
const children = require('./children.js')

const KEY_LESSONS = 'schedule_lessons_v1'
const KEY_MARKS = 'schedule_marks_v1'

// ===== 演示数据口径（要改演示范围只改这里）=====
const CLS = '大一班'
// 班里的孩子不写死在这里：唯一来源是「孩子档案」（utils/children.js）——
// 建了档就能点名，每个孩子一本独立的课时账（见 utils/billing.js 的 kids）

const DEMO = {
  weeks: 2, // 生成「昨天起 2 周」的课：天天有课，随时都能演示
  startOffset: -1, // 从昨天开始（昨天那节正好用来演示「自动补算」）
  giftHours: 20, // 第一次打开时送 20 课时，保证演示时余额是正的
  giftRef: 'demo_gift_v1', // 判重键：这份礼物一辈子只送一次
  giftNote: '演示数据：本学期入园赠送课时',
  settleDelayMin: 60 // 一节课开始 60 分钟后就算「上完了」，可以结算
}

// 点名可选状态（页面照这个列表摆按钮，文案也只写这一处）
const STATUS_LIST = [
  { key: 'present', label: '到课' },
  { key: 'leave', label: '请假' },
  { key: 'absent', label: '旷课' },
  { key: 'trial', label: '试听' }
]

// 课表：工作日两节、周末两节兴趣班（课程按日期轮换，看起来像真课表）
const WEEKDAY_SLOTS = ['09:20', '15:30']
const WEEKEND_SLOTS = ['10:00', '16:00']
const WEEKDAY_COURSES = [
  [
    { name: '主题课 · 春天的颜色', teacher: '王老师' },
    { name: '绘本阅读 · 小种子旅行记', teacher: '李老师' }
  ],
  [
    { name: '奥尔夫音乐 · 小手拍拍', teacher: '陈老师' },
    { name: '体能游戏 · 快乐跳跳跳', teacher: '张老师' }
  ]
]
const WEEKEND_COURSES = [
  { name: '美术延时班 · 手工风车', teacher: '陈老师' },
  { name: '舞蹈延时班 · 小星星', teacher: '李老师' }
]

// 课时页「本周课程」每行左侧方块换着颜色用（和原来的假数据一个色系）
const ROW_BGS = [
  'linear-gradient(135deg,#59A2FF,#2E6BFF)',
  'linear-gradient(135deg,#4FD1A5,#12A182)',
  'linear-gradient(135deg,#FFB45B,#F08A24)',
  'linear-gradient(135deg,#9B8CFF,#6A5BEF)'
]

const WEEK_TXT = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']

/* ---------------- 日期 / 时间小工具 ---------------- */

function pad(n) {
  return n < 10 ? '0' + n : '' + n
}

function parseDay(day) {
  const p = String(day || '').split('-')
  return new Date(Number(p[0]) || 1970, (Number(p[1]) || 1) - 1, Number(p[2]) || 1)
}

function dayStr(d) {
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate())
}

function today() {
  return dayStr(new Date())
}

// 日期加减天数：shift('2026-04-15', -1) → '2026-04-14'
function shift(day, n) {
  const d = parseDay(day)
  d.setDate(d.getDate() + n)
  return dayStr(d)
}

function weekday(day) {
  return parseDay(day).getDay() // 0 = 周日
}

function isWeekend(day) {
  const w = weekday(day)
  return w === 0 || w === 6
}

// 本周一（周一算一周的第一天）
function weekStartOf(day) {
  return shift(day, -((weekday(day) + 6) % 7))
}

// 显示用日期：'04-15 周三'
function dayTitle(day) {
  const d = parseDay(day)
  return pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + ' ' + WEEK_TXT[d.getDay()]
}

function timeText(ts) {
  const d = new Date(ts)
  return pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes())
}

function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100
}

// 某天某时刻的时间戳（用来判断这节课过没过）
function startTs(day, time) {
  const d = parseDay(day)
  const p = String(time || '').split(':')
  d.setHours(Number(p[0]) || 0, Number(p[1]) || 0, 0, 0)
  return d.getTime()
}

// 这节课「上完了」的时间点：开始 + 60 分钟结算缓冲
function endTs(lesson) {
  return (lesson.start || startTs(lesson.date, lesson.time)) + DEMO.settleDelayMin * 60000
}

// 顺序执行一串异步动作（写流水必须按顺序来，明细顺序才稳定）
function chain(list, fn) {
  let p = Promise.resolve()
  for (let i = 0; i < list.length; i++) {
    p = p.then(step(list[i], fn))
  }
  return p
}

function step(item, fn) {
  return function () {
    return fn(item)
  }
}

/* ---------------- 本地存储 ---------------- */

function readLessons() {
  try {
    const raw = wx.getStorageSync(KEY_LESSONS)
    if (raw && typeof raw.length === 'number') return raw
  } catch (e) {
    // 读失败按「还没有课表」处理
  }
  return []
}

function writeLessons(list) {
  try {
    wx.setStorageSync(KEY_LESSONS, list)
  } catch (e) {
    // 写失败不影响本次结果（下次打开回到上一次的状态）
  }
}

function readMarks() {
  try {
    const raw = wx.getStorageSync(KEY_MARKS)
    if (raw && typeof raw === 'object' && typeof raw.length !== 'number') return raw
  } catch (e) {
    // 同上
  }
  return {}
}

function writeMarks(map) {
  try {
    wx.setStorageSync(KEY_MARKS, map)
  } catch (e) {
    // 同上
  }
}

/* ---------------- 课表 ---------------- */

// 班里的孩子来自「孩子档案」（utils/children.js）—— 唯一来源，不在这里再写一份名单
// 建了档就能点名；档案里没有的孩子不会出现在点名表里（每个孩子一本独立的课时账）
function roster() {
  return children.list()
}

function studentIds() {
  const kids = roster()
  const out = []
  for (let i = 0; i < kids.length; i++) out.push(kids[i].id)
  return out
}

function studentName(id) {
  return children.nameOf(id)
}

// 名册同步：今天（含）以后的「待上课」课，孩子名单刷成档案里的最新名单 ——
// 刚建好档的孩子马上能点名；已点名 / 已结算的和过去的课一律不动（纠正不改历史）
function syncRoster() {
  const list = readLessons()
  const ids = studentIds()
  const key = ids.join(',')
  const t = today()
  let changed = false
  for (let i = 0; i < list.length; i++) {
    const l = list[i]
    if (l.status !== 'planned' || l.date < t) continue
    const cur = l.studentIds && l.studentIds.length ? l.studentIds.join(',') : ''
    if (cur === key) continue
    l.studentIds = ids.slice()
    changed = true
  }
  if (changed) writeLessons(list)
  return ids
}

// 生成某一天的课（没有的字段不要瞎猜，全在这里定）
function lessonsOfDay(day) {
  const we = isWeekend(day)
  const slots = we ? WEEKEND_SLOTS : WEEKDAY_SLOTS
  const courses = we ? WEEKEND_COURSES : WEEKDAY_COURSES[parseDay(day).getDate() % 2]
  const per = billing.attendRules().perLesson
  const out = []
  for (let i = 0; i < slots.length; i++) {
    const course = courses[i]
    if (!course) continue
    out.push({
      id: 'L' + String(day).replace(/-/g, '') + (i === 0 ? 'A' : 'B'),
      date: day,
      time: slots[i],
      start: startTs(day, slots[i]),
      name: course.name,
      teacher: course.teacher,
      cls: CLS,
      studentIds: studentIds(),
      hours: per,
      status: 'planned' // planned 待结算 / settled 已结算 / canceled 已取消（不结算）
    })
  }
  return out
}

// 演示课表：保证「昨天起 2 周」每天都有课；已经存在的课一条都不动（点名结果不会被覆盖）
// 每次进来先按档案同步一次名单：今天起的待上课会用最新名册（刚建档的孩子立刻能点名）
function ensureLessons() {
  syncRoster()
  const list = readLessons()
  const has = {}
  for (let i = 0; i < list.length; i++) has[list[i].id] = true
  const start = shift(today(), DEMO.startOffset)
  let added = 0
  for (let i = 0; i < DEMO.weeks * 7; i++) {
    const dayList = lessonsOfDay(shift(start, i))
    for (let j = 0; j < dayList.length; j++) {
      if (has[dayList[j].id]) continue
      has[dayList[j].id] = true
      list.push(dayList[j])
      added++
    }
  }
  if (added) {
    list.sort(function (a, b) {
      return a.start - b.start
    })
    writeLessons(list)
  }
  return list
}

function findLesson(list, id) {
  for (let i = 0; i < list.length; i++) {
    if (list[i].id === id) return list[i]
  }
  return null
}

function lessonOf(id) {
  return findLesson(ensureLessons(), id)
}

// 把课的状态写回 storage（lesson 是从 storage 读出来的对象，改内存不会自己存）
function saveLesson(lesson) {
  const list = readLessons()
  const cur = findLesson(list, lesson.id)
  if (!cur) {
    list.push(lesson)
  } else {
    cur.status = lesson.status
    // 手动「清空点名」的标记也要落盘：不然下次进页面自动补算又把它扣一遍
    if (lesson.cleared) {
      cur.cleared = true
      cur.clearedAt = lesson.clearedAt
      cur.clearedBy = lesson.clearedBy
    }
  }
  writeLessons(list)
}

// 第一次进入课时功能：生成课表 + 给每个孩子各送一次演示课时（ref 判重，只送一次）
// 升级前设备上那笔「没有归属」的老课时先划给第一个孩子（只搬账不记流水，合计数不变）
function bootstrap() {
  ensureLessons()
  const kids = roster()
  if (!kids.length) {
    // 一个档案都没有：一份课时都不送。课时的主人是「孩子」，还没有孩子就先不记账。
    // （以前这里给「设备账」送 20 课时；等老师建好第一个档、再进这一页时，那 20 会被
    //   划给第一个孩子、又按「每个孩子各送一份」再送一次 —— 同一份礼物变成 40，
    //   和别的孩子对不上。现在不送：课时页显示 0 + 一句「去建档」，建好档后人人各得 20。）
    return Promise.resolve({ ok: true, dup: false, msg: '' })
  }
  return billing.transferLegacy(kids[0].id, kids[0].name).then(function () {
    return chain(kids, function (kid) {
      return billing.applyHours({
        amount: DEMO.giftHours,
        type: 'gift',
        typeName: '演示赠送课时',
        note: kid.name + ' · ' + DEMO.giftNote,
        childId: kid.id,
        childName: kid.name,
        ref: DEMO.giftRef + ':' + kid.id, // 每个孩子各判各的重，礼物一辈子只送一次
        title: '入园赠送课时',
        sub: kid.name + ' · ' + DEMO.giftNote,
        okText: '已送演示课时'
      })
    })
  })
}

/* ---------------- 点名 ---------------- */

function markId(lessonId, studentId) {
  return lessonId + ':' + studentId
}

// 新建一条点名记录：默认「到课」，还没结算
function newMark(lesson, sid, status, byName) {
  return {
    id: markId(lesson.id, sid),
    lessonId: lesson.id,
    studentId: sid,
    studentName: studentName(sid),
    status: status || 'present',
    hours: 0, // 上次结算的目标课时（展示用）
    settledHours: 0, // 已经真正记进流水的课时 —— 判重的主判据
    settleCount: 0, // 结算过几次（流水 ref = mark.id#次数）
    saved: false, // 老师（或自动补算）标过没有：标过才显示「已结算」
    by: byName || '',
    at: 0,
    timeText: ''
  }
}

// 某个状态该扣多少课时：规则只在 billing.ATTEND 一处，这里只做映射
function targetHoursOf(status, per) {
  const r = billing.attendRules()
  const unit = Number(per) || r.perLesson
  if (status === 'leave') return r.leaveFree ? 0 : unit
  if (status === 'absent') return r.absentCharge ? unit : 0
  if (status === 'trial') return r.trialFree ? 0 : unit
  return unit // 到课
}

function targetHours(status, lesson) {
  return targetHoursOf(status, (lesson && lesson.hours) || billing.attendRules().perLesson)
}

// 结算一个孩子的一节课：目标课时 − 已结算课时 = 差额
//   差额 > 0 → 扣课时（consume）；差额 < 0 → 冲正回补（refund）；差额 = 0 → 什么都不做
//   这就是「重复点保存不重扣」和「点错了能纠正」的同一段代码
function settleOne(lesson, mark, byName) {
  const target = targetHours(mark.status, lesson)
  const done = round2(mark.settledHours)
  const delta = round2(target - done)

  const who = byName || mark.by || lesson.teacher
  const charging = delta > 0

  if (!delta) {
    // 没课时变化也要留下「已点名」的痕迹：请假 / 试听的孩子照样算点过名，
    // 行内才显示「已结算 · 不扣课时」，结算人数也才数得对（不写流水、不加结算序号）
    mark.settledHours = target
    mark.hours = target
    mark.saved = true
    mark.by = who
    mark.at = Date.now()
    mark.timeText = timeText(mark.at)
    return Promise.resolve({ charged: 0, backed: 0, dup: false, mark: mark })
  }

  const seq = Number(mark.settleCount) || 0
  const when = dayTitle(lesson.date) + ' ' + lesson.time
  const kid = mark.studentName || studentName(mark.studentId)
  // 流水说明里必须写清是哪个孩子：一本账里几个孩子的记录挨在一起，
  // 只写「课程名」会看成「同一个人被扣了三次」（这就是老版点一次名像扣三节课的原因）
  const note = charging
    ? kid + ' · ' + lesson.name + ' · ' + who + '（' + when + '）' + (mark.status === 'absent' ? ' 旷课照扣' : '')
    : kid + ' 这节不用扣（' +
      (mark.status === 'leave' ? '请假' : mark.status === 'trial' ? '试听' : '不算课时') +
      '），回补 ' + Math.abs(delta) + ' 课时'

  return billing
    .applyHours({
      amount: -delta, // 账本口径：正数进、负数扣；扣课时要传负值
      type: charging ? 'consume' : 'refund',
      typeName: charging ? '上课扣课时' : '课时回补（纠正）',
      note: note,
      ref: mark.id + '#' + seq, // 同一个孩子同一节课的同一笔只记一次
      title: charging ? lesson.name : '课时回补（纠正）',
      sub: charging ? who + ' · ' + when : kid + ' 这节不用扣',
      childId: mark.studentId, // 账记到孩子头上：几个孩子的课时各算各的
      childName: kid
    })
    .then(function (res) {
      // 走到这里说明这笔账已经在流水里了（res.dup = 上次写成功过但记录没存下来）
      // 两种情况的处理一样：把记录推进到「已结算」状态
      mark.settledHours = target
      mark.settleCount = seq + 1
      mark.hours = target
      mark.saved = true
      mark.by = who
      mark.at = Date.now()
      mark.timeText = timeText(mark.at)
      return {
        charged: charging ? delta : 0,
        backed: charging ? 0 : Math.abs(delta),
        dup: !!res.dup,
        mark: mark
      }
    })
}

// 结算一节课的所有孩子（顺序执行，流水顺序才稳定）
function settleLesson(lesson, marks, byName) {
  const list = []
  for (let i = 0; i < lesson.studentIds.length; i++) {
    const id = markId(lesson.id, lesson.studentIds[i])
    if (!marks[id]) marks[id] = newMark(lesson, lesson.studentIds[i], 'present', byName)
    marks[id].saved = true
    list.push(marks[id])
  }
  let charged = 0
  let chargedKids = 0
  let backed = 0
  let backedKids = 0
  return chain(list, function (mark) {
    return settleOne(lesson, mark, byName).then(function (r) {
      if (r.charged) {
        charged = round2(charged + r.charged)
        chargedKids++
      }
      if (r.backed) {
        backed = round2(backed + r.backed)
        backedKids++
      }
      return r
    })
  }).then(function () {
    const changed = chargedKids + backedKids
    if (changed) lesson.status = 'settled'
    return {
      charged: charged,
      backed: backed,
      chargedKids: chargedKids,
      backedKids: backedKids,
      changed: changed
    }
  })
}

// 老师点名保存：list = [{ studentId, status }]（页面只传状态，扣多少由规则算）
function saveMarks(lessonId, list, byName) {
  const lesson = lessonOf(lessonId)
  if (!lesson) return Promise.resolve({ ok: false, msg: '没找到这节课' })
  if (lesson.status === 'canceled') return Promise.resolve({ ok: false, msg: '这节课已取消，不结算课时' })

  const marks = readMarks()
  const rows = list || []
  const jobs = []
  for (let i = 0; i < rows.length; i++) {
    const sid = rows[i].studentId
    if (!sid) continue
    const id = markId(lesson.id, sid)
    if (!marks[id]) marks[id] = newMark(lesson, sid, rows[i].status, byName)
    if (rows[i].status) marks[id].status = rows[i].status
    jobs.push(marks[id])
  }
  if (!jobs.length) return Promise.resolve({ ok: false, msg: '没有可保存的点名' })

  let charged = 0
  let chargedKids = 0
  let backed = 0
  let backedKids = 0
  return chain(jobs, function (mark) {
    return settleOne(lesson, mark, byName).then(function (r) {
      if (r.charged) {
        charged = round2(charged + r.charged)
        chargedKids++
      }
      if (r.backed) {
        backed = round2(backed + r.backed)
        backedKids++
      }
      return r
    })
  }).then(function () {
    writeMarks(marks)
    // 老师点过名就算「已点名」：哪怕全请假、一个课时都不扣，标签也该是已结算
    lesson.status = 'settled'
    saveLesson(lesson)

    let msg = '这节课已经记过了'
    if (chargedKids && backedKids) {
      msg = '已结算 ' + chargedKids + ' 人扣 ' + charged + ' 课时，回补 ' + backed + ' 课时'
    } else if (chargedKids) {
      msg = '已结算 ' + chargedKids + ' 人，扣 ' + charged + ' 课时'
    } else if (backedKids) {
      msg = '已回补 ' + backed + ' 课时'
    }
    return {
      ok: true,
      msg: msg,
      charged: charged,
      backed: backed,
      chargedKids: chargedKids,
      backedKids: backedKids
    }
  })
}

/* ---------------- 清空点名：把「3/3」变回「0/3」（＝没点过名） ---------------- */

// 老师按「清空今日点名」时做的事：这一天点过名的孩子全部撤销 —— 页面上那节「3/3」就回到「0/3」。
//   ① 已经扣掉的课时按规矩冲正退回（记一笔退货流水，明细只增不删，账永远对得上）；
//   ② 点名记录清零 —— 是清零不是删除：结算序号先往前挪一格，重新点名时流水 ref 不会撞上老账；
//   ③ 课回到 planned 并打 cleared 标记 —— 免得下次进页面「自动补算」又把它扣一遍。
// 清完想重新点名：照常点「保存点名」，按新的一笔记，不重不漏。
function clearDay(day, byName) {
  const d = day || today()
  const list = ensureLessons()
  const dayLessons = {}
  for (let i = 0; i < list.length; i++) {
    if (list[i].date === d) dayLessons[list[i].id] = list[i]
  }

  const marks = readMarks()
  const keys = Object.keys(marks)
  const jobs = [] // 这一天点过名、而且真扣了课时的记录（要写退回流水）
  const lessonIds = [] // 这一天点过名的课（要打 cleared 标记）
  const touched = [] // 撤销了哪几条记录（写流水说明 + 后面清零用）
  for (let i = 0; i < keys.length; i++) {
    const mark = marks[keys[i]]
    const lesson = dayLessons[mark.lessonId]
    if (!lesson || !mark.saved) continue
    if (lesson.status === 'canceled') continue // 取消的课本来就不结算
    if (lessonIds.indexOf(mark.lessonId) === -1) lessonIds.push(mark.lessonId)
    touched.push(mark)
    const back = round2(mark.settledHours)
    if (back) jobs.push({ mark: mark, back: back })
  }

  const when = dayTitle(d)
  if (!touched.length) {
    return Promise.resolve({
      ok: false,
      day: d,
      lessons: 0,
      kids: 0,
      refunded: 0,
      msg: '这一天没有点过名，不用清'
    })
  }

  let refunded = 0
  return chain(jobs, function (job) {
    const mark = job.mark
    const kid = mark.studentName || studentName(mark.studentId)
    const seq = Number(mark.settleCount) || 0 // 点名用掉的号：退回这笔接着往下排
    mark.settleCount = seq + 1 // 序号先走一格，下次点名（ref = id#序号）绝不和退回这笔重号
    return billing
      .applyHours({
        amount: job.back, // 账本口径：正数进、负数扣 —— 退回传正数
        type: 'refund',
        typeName: '清空点名（冲正）',
        note: kid + ' · 清空 ' + when + ' 的点名，退回 ' + job.back + ' 课时（' + (byName || '老师') + ' 手动清空）',
        ref: mark.id + '#clear' + seq,
        title: '清空点名（冲正）',
        sub: kid + ' · ' + when + ' 的点名被清空',
        childId: mark.studentId,
        childName: kid
      })
      .then(function (res) {
        if (!res.dup) refunded = round2(refunded + job.back)
        return res
      })
  }).then(function () {
    // 点名记录清零：回到「没点过名」的样子（记录留着，序号往后排，重新点名才不会撞账）
    for (let i = 0; i < touched.length; i++) {
      const mark = touched[i]
      mark.status = 'present'
      mark.hours = 0
      mark.settledHours = 0
      mark.saved = false
      mark.by = ''
      mark.at = 0
      mark.timeText = ''
    }
    writeMarks(marks)

    // 课也回到「没点过」：cleared 标记让自动补算不再碰它
    const at = Date.now()
    for (let i = 0; i < lessonIds.length; i++) {
      const lesson = dayLessons[lessonIds[i]]
      lesson.status = 'planned'
      lesson.cleared = true
      lesson.clearedAt = at
      lesson.clearedBy = byName || ''
      saveLesson(lesson)
    }

    let msg = '已清空 ' + lessonIds.length + ' 节课的点名：' + touched.length + ' 个孩子回到「没点过名」'
    msg += refunded > 0 ? '，退回 ' + refunded + ' 课时' : '（这节课本来就不扣课时）'
    return {
      ok: true,
      day: d,
      lessons: lessonIds.length,
      kids: touched.length,
      refunded: refunded,
      msg: msg
    }
  })
}

/* ---------------- 兜底：进页面自动补算 ---------------- */

// 时间已过、还没点名（status = planned）的课：按「到课」补上并结算
// 老师点过的课不受影响（status 已经是 settled）
function settleDue() {
  const list = ensureLessons()
  const marks = readMarks()
  const now = Date.now()
  const due = []
  for (let i = 0; i < list.length; i++) {
    // 手动清空过的课（cleared）不再自动补算：清完就是「没点名」，别一进页面又被扣回去
    if (list[i].status === 'planned' && !list[i].cleared && endTs(list[i]) <= now) due.push(list[i])
  }
  if (!due.length) return Promise.resolve({ ok: true, count: 0, charged: 0 })

  let count = 0
  let charged = 0
  return chain(due, function (lesson) {
    return settleLesson(lesson, marks, '自动补算').then(function (r) {
      if (r.changed) {
        count++
        charged = round2(charged + r.charged)
        saveLesson(lesson)
      }
      return r
    })
  }).then(function () {
    writeMarks(marks)
    return { ok: true, count: count, charged: charged }
  })
}

/* ---------------- 展示层（WXML 里不做运算，字段都在这里算好） ---------------- */

function statusLabel(key) {
  for (let i = 0; i < STATUS_LIST.length; i++) {
    if (STATUS_LIST[i].key === key) return STATUS_LIST[i].label
  }
  return '到课'
}

function pillsOf(status) {
  const out = []
  for (let i = 0; i < STATUS_LIST.length; i++) {
    out.push({
      key: STATUS_LIST[i].key,
      label: STATUS_LIST[i].label,
      on: STATUS_LIST[i].key === status
    })
  }
  return out
}

// 一个孩子 + 一个状态 → 页面要的显示字段（点名页按钮点了之后也调它，规则仍然只写在数据层）
// state.left 传了就在行内写出「余 N 课时」—— 每个孩子各算各的余额
function kidRow(status, lessonHours, state) {
  const st = state || {}
  const target = targetHoursOf(status, lessonHours)
  const label = statusLabel(status)
  const hourText = target > 0 ? '扣 ' + target + ' 课时' : '不扣课时'
  const saved = !!st.saved
  const applied = round2(st.applied)
  const hasLeft = st.left !== undefined && st.left !== null
  const left = hasLeft ? round2(st.left) : null
  const leftText = hasLeft ? '余 ' + left + ' 课时' : ''
  const stateLine = saved
    ? '已结算 · ' + (applied > 0 ? '扣 ' + applied + ' 课时' : '不扣课时') + (leftText ? ' · ' + leftText : '')
    : label + ' · ' + hourText + (leftText ? ' · ' + leftText : '')
  return {
    status: status,
    statusText: label,
    hourText: hourText,
    done: saved,
    applied: applied,
    left: left,
    leftText: leftText,
    stateLine: stateLine,
    pills: pillsOf(status)
  }
}

// 这节课点名了没有 / 记进去多少课时
function settledCount(lesson, marks) {
  let n = 0
  for (let i = 0; i < lesson.studentIds.length; i++) {
    const m = marks[markId(lesson.id, lesson.studentIds[i])]
    if (m && m.saved) n++
  }
  return n
}

function chargedHours(lesson, marks) {
  let n = 0
  for (let i = 0; i < lesson.studentIds.length; i++) {
    const m = marks[markId(lesson.id, lesson.studentIds[i])]
    if (m) n = round2(n + round2(m.settledHours))
  }
  return n
}

// 一节课的展示字段
function decorateLesson(lesson, marks, now) {
  const kids = []
  let settled = 0
  let charged = 0
  for (let i = 0; i < lesson.studentIds.length; i++) {
    const mark = marks[markId(lesson.id, lesson.studentIds[i])] || newMark(lesson, lesson.studentIds[i], 'present')
    // 每个孩子各看各的余额：这一行扣完还剩多少（页面不自己算）
    const row = kidRow(mark.status, lesson.hours, {
      saved: mark.saved,
      applied: mark.settledHours,
      left: billing.hoursStat(mark.studentId).left
    })
    row.id = mark.id
    row.studentId = mark.studentId
    row.studentName = mark.studentName
    kids.push(row)
    if (mark.saved) settled++
    charged = round2(charged + round2(mark.settledHours))
  }

  let statusText = '待上课'
  let tagClass = 'tag-blue'
  if (lesson.status === 'canceled') {
    statusText = '已取消'
    tagClass = 'tag-gray'
  } else if (lesson.status === 'settled') {
    statusText = '已结算'
    tagClass = 'tag-green'
  } else if (lesson.start <= now) {
    statusText = '待点名'
    tagClass = 'tag-orange'
  }

  return {
    id: lesson.id,
    date: lesson.date,
    name: lesson.name,
    time: lesson.time,
    teacher: lesson.teacher,
    hours: lesson.hours,
    start: lesson.start,
    status: lesson.status,
    statusText: statusText,
    tagClass: tagClass,
    subText: lesson.teacher + ' · ' + lesson.time + ' · 每节 ' + lesson.hours + ' 课时',
    settledText: '已结算 ' + settled + '/' + kids.length + ' 人 · 本节记 ' + charged + ' 课时',
    // 页面要的两个数字：点过几名（「3/3」里的前一个数）、记了几课时
    rolled: settled,
    charged: charged,
    kidTotal: kids.length,
    // 手动清空过的课：说明白它不再自动补算，免得以为漏算了
    clearedNote: lesson.cleared ? '这一天被手动清空过：不再自动补算，想点名照常点「保存点名」' : '',
    kids: kids
  }
}

// 某一天的点名数据（点名页直接用）
function listDay(day) {
  const d = day || today()
  const list = ensureLessons()
  const marks = readMarks()
  const now = Date.now()
  const out = []
  for (let i = 0; i < list.length; i++) {
    if (list[i].date === d) out.push(decorateLesson(list[i], marks, now))
  }
  let rolled = 0
  for (let i = 0; i < out.length; i++) {
    if (out[i].rolled > 0) rolled++
  }
  return {
    date: d,
    title: dayTitle(d),
    isToday: d === today(),
    lessons: out,
    rolled: rolled // 这一天点过名的课有几节（大于 0 页面才显示「清空」按钮）
  }
}

function listToday() {
  return listDay(today())
}

/* ---------------- 课时页统计 ---------------- */

function courseRow(lesson, marks, idx, now) {
  const total = lesson.studentIds.length
  const settled = settledCount(lesson, marks)
  const charged = chargedHours(lesson, marks)
  let val = '待上课'
  if (lesson.status === 'canceled') {
    val = '已取消'
  } else if (total && settled >= total) {
    val = charged > 0 ? '已扣 ' + charged + ' 课时' : '已结算 · 不扣课时'
  } else if (settled > 0) {
    val = '已结算 ' + settled + '/' + total + ' 人'
  } else if (lesson.cleared) {
    val = '已清空 · 待点名'
  } else if (lesson.start <= now) {
    val = '待点名'
  }
  return {
    id: lesson.id,
    ico: String(lesson.name).charAt(0),
    name: lesson.name,
    sub: WEEK_TXT[weekday(lesson.date)] + ' ' + lesson.time + ' · ' + lesson.teacher,
    val: val,
    bg: ROW_BGS[idx % ROW_BGS.length]
  }
}

// 近 30 天课时明细（只取 unit = 'hour' 的流水，最多 10 条）
// 看单个孩子时不用再写名字（每行都是他的）；看合计时每行标出这是谁的课时
function recordRows(items, childId) {
  const out = []
  const min = Date.now() - 30 * 86400000
  const showKid = !String(childId || '')
  for (let i = 0; i < items.length; i++) {
    const it = items[i]
    if (it.unit !== 'hour') continue
    if (it.time && it.time < min) continue
    const amount = round2(it.amount)
    const d = new Date(it.time || Date.now())
    const kid = it.childName || (it.childId ? studentName(it.childId) : '')
    const base = it.title || it.typeName
    out.push({
      id: it.id,
      date: pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + ' ' + WEEK_TXT[d.getDay()],
      name: showKid && kid ? kid + ' · ' + base : base,
      teacher: it.sub || it.note || it.typeName,
      val: (amount > 0 ? '+' : '') + amount + ' 课时',
      gray: amount > 0
    })
    if (out.length >= 10) break
  }
  return out
}

// 课时页要的全部数据：三个数字 + 本周课程 + 近 30 天明细
// 口径：剩余 = 课时余额；已完成 = 已扣合计；本学期 = 已完成 + 剩余
// 传 childId：三个数字和明细都是这个孩子自己的；不传 = 全园合计（历史未分账 + 所有孩子）
function buildStats(childId) {
  const cid = String(childId || '')
  const stat = billing.hoursStat(cid)
  const list = ensureLessons()
  const marks = readMarks()
  const t = today()
  const weekStart = weekStartOf(t)
  const weekEnd = shift(weekStart, 6)
  const now = Date.now()

  const rows = []
  let weekTotal = 0
  let weekDone = 0
  for (let i = 0; i < list.length; i++) {
    const lesson = list[i]
    if (lesson.date < weekStart || lesson.date > weekEnd) continue
    if (lesson.status !== 'canceled') {
      weekTotal++
      if (lesson.studentIds.length && settledCount(lesson, marks) >= lesson.studentIds.length) weekDone++
    }
    rows.push(courseRow(lesson, marks, rows.length, now))
  }
  // 一周 14 节课，列表只挑「离今天最近的 6 节」给家长看（不然卡片太长）
  if (rows.length > 6) {
    rows.sort(function (a, b) {
      return Math.abs(startTs(a.date, a.time) - now) - Math.abs(startTs(b.date, b.time) - now)
    })
    rows.length = 6
    rows.sort(function (a, b) {
      return startTs(a.date, a.time) - startTs(b.date, b.time)
    })
  }

  return billing.listLedger(60, cid).then(function (items) {
    return {
      childId: cid,
      kidName: cid ? studentName(cid) : '全园合计',
      totalHours: stat.total,
      doneHours: stat.spent,
      leftHours: stat.left,
      weekDone: weekDone,
      weekTotal: weekTotal,
      weekPercent: weekTotal ? Math.round((weekDone / weekTotal) * 100) : 0,
      weekCourses: rows,
      records: recordRows(items || [], cid)
    }
  })
}

// 课时页数据（进页面先送演示课时 + 自动补算一次，这就是「自动」的部分）
// 传 childId = 只看这个孩子的课时；不传 = 全园合计
function courseStats(childId) {
  const cid = String(childId || '')
  return bootstrap()
    .then(function () {
      return settleDue()
    })
    .then(
      function () {
        return buildStats(cid)
      },
      function () {
        return buildStats(cid)
      }
    )
}

/* ---------------- 给页面用的一句话说明 ---------------- */

// 扣课时规则的人话（数值都来自 billing.ATTEND，页面不写死）
function ruleText() {
  const r = billing.attendRules()
  const parts = ['每节 ' + r.perLesson + ' 课时']
  parts.push(r.leaveFree ? '请假不扣' : '请假照扣')
  parts.push(r.absentCharge ? '旷课照扣' : '旷课不扣')
  parts.push(r.trialFree ? '试听不扣' : '试听照扣')
  return parts.join(' · ')
}

// 点名页顶部那句演示说明
function modeTip() {
  return '演示模式：课表从昨天起 2 周自动生成，天天有课；进页面会把「时间已过、还没点名」的课按到课自动补算。' +
    '课时按孩子各记一本账（档案里建好孩子，点名一次算一次，几个孩子互不影响）。规则：' +
    ruleText()
}

// 剩余课时不足时的一句话提醒（'' 表示不用提醒）
// 每个孩子各看各的账：点名前老师就知道「谁快没课时了」，不用一个一个点开档案
function lowTip(childId) {
  const r = billing.attendRules()
  const cid = String(childId || '')

  if (cid) {
    const one = billing.hoursStat(cid)
    if (one.left > r.lowWarn) return ''
    return studentName(cid) + ' 剩余课时只剩 ' + one.left + ' 课时（≤ ' + r.lowWarn + ' 课时），记得提醒家长续费'
  }

  const kids = roster()
  const low = []
  for (let i = 0; i < kids.length; i++) {
    const st = billing.hoursStat(kids[i].id)
    if (st.left <= r.lowWarn) low.push(kids[i].name + '（剩 ' + st.left + ' 课时）')
  }
  if (low.length) return low.join('、') + ' 剩余课时不足（≤ ' + r.lowWarn + ' 课时），记得提醒家长续费'

  // 一个孩子都没有（老数据）：退回设备账口径
  const all = billing.hoursStat()
  if (kids.length || all.left > r.lowWarn) return ''
  return '剩余课时只剩 ' + all.left + ' 课时（≤ ' + r.lowWarn + ' 课时），记得提醒家长续费'
}

module.exports = {
  CLS: CLS,
  DEMO: DEMO,
  STATUS_LIST: STATUS_LIST,
  today: today,
  shift: shift,
  weekday: weekday,
  isWeekend: isWeekend,
  dayTitle: dayTitle,
  ensureLessons: ensureLessons,
  syncRoster: syncRoster,
  roster: roster,
  studentIds: studentIds,
  studentName: studentName,
  bootstrap: bootstrap,
  listDay: listDay,
  listToday: listToday,
  saveMarks: saveMarks,
  settleDue: settleDue,
  clearDay: clearDay,
  courseStats: courseStats,
  statusLabel: statusLabel,
  pillsOf: pillsOf,
  kidRow: kidRow,
  ruleText: ruleText,
  modeTip: modeTip,
  lowTip: lowTip
}
