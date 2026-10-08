// smoke_course.js —— 「课程内容编辑（课程内容管理）」自检
// 跑法：node tools/smoke_course.js
// 覆盖：数据层（课表 / 改内容 / 校验 / 已点名不让改课时数）+ 页面 course-admin + 展示与入口
const fs = require('fs')
const path = require('path')

const root = path.resolve(__dirname, '..')

/* ---------------- wx 模拟 ---------------- */
const store = {}
const toasts = []
const navBacks = []
let scrolls = 0
global.wx = {
  // 和真机一样：读写都过一遍序列化 —— 不共享对象引用，才能测出「忘记写盘」
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
    if (o && o.success) o.success({ confirm: true, cancel: false })
  },
  navigateTo: function () {},
  navigateBack: function () {
    navBacks.push(1)
  },
  pageScrollTo: function () {
    scrolls++
  },
  setNavigationBarTitle: function () {},
  hideKeyboard: function () {}
}
global.getApp = function () {
  return { globalData: { statusBarHeight: 47 } }
}
// 有上一页：nav.back() 会走 wx.navigateBack（返回按钮自检用）
global.getCurrentPages = function () {
  return [{}, {}]
}

const schedule = require(path.join(root, 'utils/schedule.js'))
const billing = require(path.join(root, 'utils/billing.js'))
const children = require(path.join(root, 'utils/children.js'))
const role = require(path.join(root, 'utils/demo-role.js'))
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

/* ---------------- 页面装载（和小程序一样：先 Page 注册，再取对象） ---------------- */
let captured = null
global.Page = function (o) {
  captured = o
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

function findRow(rows, id) {
  for (let i = 0; i < rows.length; i++) {
    if (rows[i].id === id) return rows[i]
  }
  return null
}
// 课表里挑一节课：future = 今天之后的（不会被自动补算），locked = 已点过名的
function pickLesson(rows, future, locked) {
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i]
    if (r.hoursLocked !== !!locked) continue
    if (future && r.date <= schedule.today()) continue
    if (!future && r.date !== schedule.today()) continue
    return r
  }
  return null
}

async function main() {
  /* ================= A. 课表与课程内容默认值 ================= */
  const all = schedule.listLessons()
  check('A1 课表出得来（演示课表：昨天起 2 周）', all.length > 10, all.length)
  check('A2 演示课表每节都自带「内容简介」', all.every(function (r) {
    return typeof r.desc === 'string' && r.desc.length > 0
  }), all[0] && all[0].desc)
  check('A3 列表按时间从早到晚排好', (function () {
    for (let i = 1; i < all.length; i++) {
      if (all[i - 1].date + all[i - 1].time > all[i].date + all[i].time) return false
    }
    return true
  })())
  check('A4 每行都带日期标题、状态、课时数', all.every(function (r) {
    return r.dayText.length > 5 && r.statusText.length > 0 && r.hours > 0 && r.id
  }), all[0] && all[0].dayText)

  /* ================= B. 校验：写坏数据一律拦下来 ================= */
  const someId = all[0].id
  const baseName = all[0].name
  let res = schedule.updateLesson(someId, { name: '   ', teacher: '王老师', desc: '', hours: 1 })
  check('B1 课程名空着不让存', res.ok === false && res.msg.indexOf('课程名不能空着') > -1, res.msg)
  res = schedule.updateLesson(someId, { name: '课程名'.repeat(13), teacher: '', desc: '', hours: 1 })
  check('B2 课程名超长不让存', res.ok === false && res.msg.indexOf('课程名最多') > -1, res.msg)
  res = schedule.updateLesson(someId, { name: baseName, teacher: '王'.repeat(schedule.MAX_TEACHER + 1), desc: '', hours: 1 })
  check('B3 老师名字超长不让存', res.ok === false && res.msg.indexOf('老师名字最多') > -1, res.msg)
  res = schedule.updateLesson(someId, { name: baseName, teacher: '王老师', desc: '简'.repeat(schedule.MAX_DESC + 1), hours: 1 })
  check('B4 内容简介超长不让存', res.ok === false && res.msg.indexOf('内容简介最多') > -1, res.msg)
  res = schedule.updateLesson(someId, { name: baseName, teacher: '王老师', desc: '', hours: 0 })
  check('B5 课时数只能是 1~9 的整数', res.ok === false && res.msg.indexOf('整数') > -1, res.msg)
  res = schedule.updateLesson(someId, { name: baseName, teacher: '王老师', desc: '', hours: 1.5 })
  check('B6 课时数不接受小数', res.ok === false && res.msg.indexOf('整数') > -1, res.msg)
  res = schedule.updateLesson('L不存在的课', { name: '随便', teacher: '', desc: '', hours: 1 })
  check('B7 找不到这节课时有明确提示', res.ok === false && res.msg.indexOf('已经不在了') > -1, res.msg)

  /* ================= C. 改内容：只动这一节 ================= */
  const target = pickLesson(all, true, false) // 今天之后、还没点名的一节
  const twin = (function () {
    for (let i = 0; i < all.length; i++) {
      if (all[i].id !== target.id && all[i].name === target.name) return all[i]
    }
    return null
  })()
  res = schedule.updateLesson(target.id, { name: '冒烟测试 · 改过的课程名', teacher: '测试老师', desc: '这节课用来验证课程内容能改', hours: target.hours }, '测试老师')
  check('C1 改课程名 / 老师 / 内容简介能存下来', res.ok === true && res.item.name === '冒烟测试 · 改过的课程名', res.item && res.item.name)
  const afterEdit = findRow(schedule.listLessons(), target.id)
  check('C2 重新读一遍还是改后的内容（真的落盘了）', afterEdit.name === '冒烟测试 · 改过的课程名' && afterEdit.teacher === '测试老师' && afterEdit.desc === '这节课用来验证课程内容能改', afterEdit.desc)
  check('C3 别的课一节都没动', !twin || findRow(schedule.listLessons(), twin.id).name === twin.name, twin && findRow(schedule.listLessons(), twin.id).name)
  res = schedule.updateLesson(target.id, { name: '冒烟测试 · 改过的课程名', teacher: '测试老师', desc: '这节课用来验证课程内容能改', hours: 2 }, '测试老师')
  check('C4 没点名的课能改课时数', res.ok === true && res.item.hours === 2, res.item && res.item.hours)
  const raw = store['schedule_lessons_v1']
  const rawRow = findRow(raw, target.id)
  check('C5 改动写进了课表存储（updatedAt / updatedBy 也落盘）', rawRow.hours === 2 && rawRow.updatedBy === '测试老师' && rawRow.updatedAt > 0)

  /* ================= D. 课时=钱：点过名的课不让改课时数 ================= */
  await schedule.bootstrap() // 送演示课时（每个孩子一份，判重只送一次）
  const kids = children.list()
  check('D0 演示孩子档案已就绪（点名要按人头各扣各的）', kids.length >= 1, kids.length)

  const todayRow = schedule.listDay(schedule.today()).lessons[0]
  const rows = []
  for (let i = 0; i < todayRow.kids.length; i++) rows.push({ studentId: todayRow.kids[i].studentId, status: 'present' })
  const settle = await schedule.saveMarks(todayRow.id, rows, '测试老师')
  check('D1 点名保存成功（今天这节结算掉）', settle.ok === true && settle.chargedKids === rows.length, settle.msg)

  const lockedRow = findRow(schedule.listLessons(), todayRow.id)
  check('D2 点过名的课在列表里标成「课时数锁住」', lockedRow.hoursLocked === true, lockedRow.hoursLocked)
  res = schedule.updateLesson(todayRow.id, { name: lockedRow.name, teacher: lockedRow.teacher, desc: lockedRow.desc, hours: 3 }, '测试老师')
  check('D3 已点名的课改课时数被拦住，并说清怎么办', res.ok === false && res.msg.indexOf('清空今日点名') > -1, res.msg)
  res = schedule.updateLesson(todayRow.id, { name: '冒烟测试 · 改名的已点名课', teacher: '测试老师', desc: '已点名的课名字还能改', hours: lockedRow.hours }, '测试老师')
  check('D4 已点名的课：课程名 / 老师 / 简介照样能改（只是课时数不能动）', res.ok === true && res.item.name === '冒烟测试 · 改名的已点名课' && res.item.hours === lockedRow.hours, res.item && res.item.name)
  const chargedRow = findRow(schedule.listLessons(), todayRow.id)
  check('D5 账没被搅乱：这节记的还是按旧课时数算的', chargedRow.charged === todayRow.kids.length * lockedRow.hours, chargedRow.charged)

  /* ================= E. 改课时数后，结算按新数字扣 ================= */
  const eKid = kids[0]
  const beforeSpent = billing.hoursStat(eKid.id).spent
  const eRow = pickLesson(schedule.listLessons(), true, false)
  schedule.updateLesson(eRow.id, { name: '冒烟测试 · 两课时', teacher: '测试老师', desc: '改成每节 2 课时再点名', hours: 2 }, '测试老师')
  const eLesson = schedule.listDay(eRow.date).lessons.filter(function (l) {
    return l.id === eRow.id
  })[0]
  const eRows = []
  for (let i = 0; i < eLesson.kids.length; i++) eRows.push({ studentId: eLesson.kids[i].studentId, status: 'present' })
  const eSettle = await schedule.saveMarks(eRow.id, eRows, '测试老师')
  check('E1 改成每节 2 课时后点名，扣的就是 2 × 人数', eSettle.ok === true && eSettle.charged === eLesson.kids.length * 2, eSettle.charged)
  check('E2 孩子账上确实多扣了 2 课时（课时=钱，走账本）', billing.hoursStat(eKid.id).spent === beforeSpent + 2, billing.hoursStat(eKid.id).spent)

  /* ================= F. 清空点名后又能改课时数 ================= */
  const cleared = await schedule.clearDay(schedule.today(), '测试老师')
  check('F1 清空今日点名成功', cleared.ok === true, cleared.msg)
  const unlockedRow = findRow(schedule.listLessons(), todayRow.id)
  check('F2 清空后这节课的课时数解锁', unlockedRow.hoursLocked === false, unlockedRow.hoursLocked)
  res = schedule.updateLesson(todayRow.id, { name: unlockedRow.name, teacher: unlockedRow.teacher, desc: unlockedRow.desc, hours: 3 }, '测试老师')
  check('F3 解锁后能改课时数了', res.ok === true && res.item.hours === 3, res.item && res.item.hours)

  /* ================= G. 页面：course-admin ================= */
  const adminPage = loadPage('pages/course-admin/course-admin.js')
  check('G1 页面数据里的课时选项和上限都来自数据层（不各写一份）',
    adminPage.data.hoursChoices.join(',') === schedule.HOURS_CHOICES.join(',') &&
    adminPage.data.maxName === schedule.MAX_NAME &&
    adminPage.data.maxTeacher === schedule.MAX_TEACHER &&
    adminPage.data.maxDesc === schedule.MAX_DESC)

  setDemo('teacher')
  const tctx = ctxOf(adminPage)
  tctx.checkIdentity.call(tctx)
  check('G2 老师端（超级管理员）能进，且给出老师说明', tctx.data.canEdit === true && tctx.data.demoLock === '' && tctx.data.staffTip === role.COURSE_STAFF_TIP, tctx.data.staffTip)
  check('G3 进页面就把课表列出来', tctx.data.rows.length > 10 && tctx.data.total === tctx.data.rows.length, tctx.data.total)
  check('G4 列表按天分组（每天第一条打 dayHead，天数对得上）', (function () {
    const list = tctx.data.rows
    let days = 0
    let last = ''
    for (let i = 0; i < list.length; i++) {
      const head = list[i].dayHead
      if (list[i].dayText === last && head) return false
      if (list[i].dayText !== last && !head) return false
      if (head) days++
      last = list[i].dayText
    }
    return days === tctx.data.dayCount && days > 5
  })(), tctx.data.dayCount)

  const gPick = pickLesson(schedule.listLessons(), true, false)
  const gRow = findRow(tctx.data.rows, gPick.id)
  tctx.onRowTap({ currentTarget: { dataset: { id: gPick.id } } })
  check('G5 点一行 → 表单填上这一节的内容', tctx.data.editing === true && tctx.data.editId === gPick.id && tctx.data.name === gRow.name, tctx.data.name)
  tctx.onHoursTap({ currentTarget: { dataset: { index: 3 } } })
  check('G7 点课时胶囊就选中它', tctx.data.hours === schedule.HOURS_CHOICES[3], tctx.data.hours)

  toasts.length = 0
  tctx.onNameInput({ detail: { value: '冒烟测试 · 从页面改的名字' } })
  tctx.onTeacherInput({ detail: { value: '页面老师' } })
  tctx.onDescInput({ detail: { value: '从页面改的内容简介' } })
  check('G8 输入框改动同步到表单（字数提示跟着走）', tctx.data.nameLeft === schedule.MAX_NAME - '冒烟测试 · 从页面改的名字'.length, tctx.data.nameLeft)
  tctx.onSave()
  await tick(10)
  check('G9 保存成功给提示', toasts.indexOf('已保存修改') > -1, toasts)
  const savedRow = findRow(schedule.listLessons(), gPick.id)
  check('G10 页面改完真的落盘了（老师 / 简介 / 课时都对）', savedRow.name === '冒烟测试 · 从页面改的名字' && savedRow.teacher === '页面老师' && savedRow.desc === '从页面改的内容简介' && savedRow.hours === schedule.HOURS_CHOICES[3], savedRow.name)

  toasts.length = 0
  tctx.onNameInput({ detail: { value: '   ' } })
  tctx.onSave()
  check('G11 课程名空着保存 → 页面拦住并提示', toasts.indexOf('课程名不能空着') > -1, toasts)

  // 已点名的课（今天刚点过名的那节在 F 段被清空过，这里重新点一次名造出「锁住」的课）
  const lockRow2 = schedule.listDay(schedule.today()).lessons[0]
  const lockRows = []
  for (let i = 0; i < lockRow2.kids.length; i++) lockRows.push({ studentId: lockRow2.kids[i].studentId, status: 'present' })
  await schedule.saveMarks(lockRow2.id, lockRows, '测试老师')
  tctx.refreshList()
  tctx.onRowTap({ currentTarget: { dataset: { id: lockRow2.id } } })
  check('G12 已点名的课：表单里标明课时数锁住了', tctx.data.hoursLocked === true && tctx.data.hoursLockTip.indexOf('清空今日点名') > -1, tctx.data.hoursLockTip)
  const lockedHours = tctx.data.hours
  toasts.length = 0
  tctx.onHoursTap({ currentTarget: { dataset: { index: 4 } } })
  check('G13 锁住的课点胶囊改不动，只弹一句说明', tctx.data.hours === lockedHours && toasts.length === 1 && toasts[0].indexOf('课时数改不了') > -1, toasts)
  toasts.length = 0
  tctx.onHoursTap({ currentTarget: { dataset: { index: 4 } } })
  tctx.data.hours = schedule.HOURS_CHOICES[4] // 绕过界面直接改：数据层必须自己再拦一道
  tctx.onSave()
  await tick(10)
  const stillOld = findRow(schedule.listLessons(), lockRow2.id)
  check('G14 就算绕过界面硬存：数据层也拦住，课时数没变', stillOld.hours === lockedHours, stillOld.hours)
  tctx.onCancelEdit()
  check('G15 点「不改了」→ 编辑区回到引导状态', tctx.data.editing === false && tctx.data.editId === '', tctx.data.editId)

  setDemo('staff')
  const sctx = ctxOf(adminPage)
  sctx.checkIdentity.call(sctx)
  check('G16 普通老师（陈老师）也能改课程内容', sctx.data.canEdit === true && sctx.data.rows.length > 0, sctx.data.canEdit)

  setDemo('parent')
  const pctx = ctxOf(adminPage)
  pctx.checkIdentity.call(pctx)
  check('G17 家长端一票否决：进不去，只给锁卡片', pctx.data.canEdit === false && pctx.data.demoLock === role.COURSE_PARENT_TIP && pctx.data.rows.length === 0, pctx.data.demoLock)

  setDemo('')
  const nctx = ctxOf(adminPage)
  check('G18 家长端页面里没有任何编辑入口（按钮都不渲染）', (function () {
    const wxml = fs.readFileSync(path.join(root, 'pages/course-admin/course-admin.wxml'), 'utf8')
    const block = wxml.slice(wxml.indexOf('{{!checked}}'), wxml.indexOf('wx:else') + 40)
    return block.indexOf('onSave') === -1 && block.indexOf('onRowTap') === -1 && wxml.indexOf('wx:elif="{{!canEdit}}"') > -1
  })())
  check('G19 返回按钮走的是统一返回逻辑（有上一页就返回）', (function () {
    navBacks.length = 0
    nctx.goBack()
    return navBacks.length === 1
  })())
  check('G20 权限判断只有一份：canEditCourse 和家长端一票否决同口径', (function () {
    const none = role.canEditCourse() === null // 不是演示账号 → 交给页面走云端那套
    setDemo('teacher')
    const t = role.canEditCourse() === true
    setDemo('staff')
    const s = role.canEditCourse() === true
    setDemo('parent')
    const p = role.canEditCourse() === false
    setDemo('')
    return none && t && s && p
  })())

  /* ================= H. 展示与入口 ================= */
  const dayRow = pickLesson(schedule.listLessons(), true, false)
  const dayLesson = schedule.listDay(dayRow.date).lessons.filter(function (l) {
    return l.id === dayRow.id
  })[0]
  check('H1 点名页拿到的课带着内容简介', dayLesson.desc === dayRow.desc && dayLesson.desc.length > 0, dayLesson.desc)

  const stats = await schedule.courseStats(kids[0].id)
  check('H2 课时页「本周课时」每行也带着内容简介（家长能看到）', stats.weekCourses.length > 0 && stats.weekCourses.every(function (r) {
    return typeof r.desc === 'string'
  }), stats.weekCourses[0] && stats.weekCourses[0].desc)

  const attWxml = fs.readFileSync(path.join(root, 'pages/attendance/attendance.wxml'), 'utf8')
  const courseWxml = fs.readFileSync(path.join(root, 'pages/course/course.wxml'), 'utf8')
  check('H3 点名页 / 课时页都画出了简介那一行', attWxml.indexOf('class="ls-desc"') > -1 && courseWxml.indexOf('class="row-desc"') > -1)

  const mineWxml = fs.readFileSync(path.join(root, 'pages/mine/mine.wxml'), 'utf8')
  const mineJs = fs.readFileSync(path.join(root, 'pages/mine/mine.js'), 'utf8')
  check('H4 「我的」页有课程内容管理入口（老师可见）', mineWxml.indexOf('{{canCourse}}') > -1 && mineWxml.indexOf('bindtap="onCourseAdminTap"') > -1)
  check('H5 入口跳的是新页面，且这个页面已在 app.json 里注册', mineJs.indexOf('/pages/course-admin/course-admin') > -1 && require(path.join(root, 'app.json')).pages.indexOf('pages/course-admin/course-admin') > -1)

  console.log(bad ? '\n❌ 失败 ' + bad + ' 项' : '\n✅ 课程内容编辑冒烟测试全部通过')
  process.exit(bad ? 1 : 0)
}

main().catch(function (e) {
  console.log('❌ 抛异常：' + (e && e.stack ? e.stack : e))
  process.exit(1)
})
