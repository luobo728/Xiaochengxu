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

const KEY_LESSONS = 'schedule_lessons_v1'
const KEY_MARKS = 'schedule_marks_v1'

// ===== 演示数据口径（要改演示范围只改这里）=====
const CLS = '大一班'
const STUDENTS = [
  { id: 'lele', name: '乐乐' },
  { id: 'tian', name: '甜甜' },
  { id: 'mumu', name: '木木' }
]

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

function studentIds() {
  const ids = []
  for (let i = 0; i < STUDENTS.length; i++) ids.push(STUDENTS[i].id)
  return ids
}

function studentName(id) {
  for (let i = 0; i < STUDENTS.length; i++) {
    if (STUDENTS[i].id === id) return STUDENTS[i].name
  }
  return String(id || '')
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
function ensureLessons() {
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
  }
  writeLessons(list)
}

// 第一次进入课时功能：生成课表 + 送一次演示课时（ref 判重，只送一次）
function bootstrap() {
  ensureLessons()
  return billing.applyHours({
    amount: DEMO.giftHours,
    type: 'gift',
    typeName: '演示赠送课时',
    note: DEMO.giftNote,
    ref: DEMO.giftRef,
    title: '入园赠送课时',
    sub: DEMO.giftNote,
    okText: '已送演示课时'
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
  const note = charging
    ? lesson.name + ' · ' + who + '（' + when + '）' + (mark.status === 'absent' ? ' 旷课照扣' : '')
    : studentName(mark.studentId) + ' 这节不用扣（' +
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
      sub: charging ? who + ' · ' + when : studentName(mark.studentId) + ' 这节不用扣'
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

/* ---------------- 兜底：进页面自动补算 ---------------- */

// 时间已过、还没点名（status = planned）的课：按「到课」补上并结算
// 老师点过的课不受影响（status 已经是 settled）
function settleDue() {
  const list = ensureLessons()
  const marks = readMarks()
  const now = Date.now()
  const due = []
  for (let i = 0; i < list.length; i++) {
    if (list[i].status === 'planned' && endTs(list[i]) <= now) due.push(list[i])
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
function kidRow(status, lessonHours, state) {
  const st = state || {}
  const target = targetHoursOf(status, lessonHours)
  const label = statusLabel(status)
  const hourText = target > 0 ? '扣 ' + target + ' 课时' : '不扣课时'
  const saved = !!st.saved
  const applied = round2(st.applied)
  return {
    status: status,
    statusText: label,
    hourText: hourText,
    done: saved,
    applied: applied,
    stateLine: saved
      ? '已结算 · ' + (applied > 0 ? '扣 ' + applied + ' 课时' : '不扣课时')
      : label + ' · ' + hourText,
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
    const row = kidRow(mark.status, lesson.hours, { saved: mark.saved, applied: mark.settledHours })
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
  return {
    date: d,
    title: dayTitle(d),
    isToday: d === today(),
    lessons: out
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
function recordRows(items) {
  const out = []
  const min = Date.now() - 30 * 86400000
  for (let i = 0; i < items.length; i++) {
    const it = items[i]
    if (it.unit !== 'hour') continue
    if (it.time && it.time < min) continue
    const amount = round2(it.amount)
    const d = new Date(it.time || Date.now())
    out.push({
      id: it.id,
      date: pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + ' ' + WEEK_TXT[d.getDay()],
      name: it.title || it.typeName,
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
function buildStats() {
  const stat = billing.hoursStat()
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

  return billing.listLedger(60).then(function (items) {
    return {
      totalHours: stat.total,
      doneHours: stat.spent,
      leftHours: stat.left,
      weekDone: weekDone,
      weekTotal: weekTotal,
      weekPercent: weekTotal ? Math.round((weekDone / weekTotal) * 100) : 0,
      weekCourses: rows,
      records: recordRows(items || [])
    }
  })
}

// 课时页数据（进页面先送演示课时 + 自动补算一次，这就是「自动」的部分）
function courseStats() {
  return bootstrap()
    .then(function () {
      return settleDue()
    })
    .then(
      function () {
        return buildStats()
      },
      function () {
        return buildStats()
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
  return '演示模式：课表从昨天起 2 周自动生成，天天有课；进页面会把「时间已过、还没点名」的课按到课自动补算。课时按设备记账（切换演示账号看的是同一本账）。规则：' +
    ruleText()
}

// 剩余课时不足时的一句提醒（'' 表示不用提醒）
function lowTip() {
  const r = billing.attendRules()
  const st = billing.hoursStat()
  if (st.left > r.lowWarn) return ''
  return '剩余课时只剩 ' + st.left + ' 课时（≤ ' + r.lowWarn + ' 课时），记得提醒家长续费'
}

module.exports = {
  CLS: CLS,
  STUDENTS: STUDENTS,
  DEMO: DEMO,
  STATUS_LIST: STATUS_LIST,
  today: today,
  shift: shift,
  weekday: weekday,
  isWeekend: isWeekend,
  dayTitle: dayTitle,
  ensureLessons: ensureLessons,
  bootstrap: bootstrap,
  listDay: listDay,
  listToday: listToday,
  saveMarks: saveMarks,
  settleDue: settleDue,
  courseStats: courseStats,
  statusLabel: statusLabel,
  pillsOf: pillsOf,
  kidRow: kidRow,
  ruleText: ruleText,
  modeTip: modeTip,
  lowTip: lowTip
}
