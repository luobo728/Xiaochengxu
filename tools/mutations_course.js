// mutations_course.js —— 变异测试：证明「课程内容编辑」的断言真能抓住坏代码
// 做法：把源码改成「坏的」→ 跑自检 → 必须失败（且失败项正是期望的那条）→ 还原 → md5 校验
// 范围：utils/schedule.js、utils/demo-role.js、pages/course-admin、点名页/课时页/我的页/app.json
// 跑法：node tools/mutations_course.js
const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const { execFileSync } = require('child_process')

const ROOT = path.resolve(__dirname, '..')
const TMP = path.join(__dirname, '.tmp') // 临时备份目录（.gitignore 里已排除）
const SMOKE = path.join(__dirname, 'smoke_course.js')
const BAK = path.join(TMP, 'bak_course')

// 开发者工具开着的话先提醒一句（它会跟着重编译，模拟器容易卡成乱版）
require(path.join(__dirname, 'devtools-check.js')).warn()

const md5 = function (f) {
  return crypto.createHash('md5').update(fs.readFileSync(f)).digest('hex')
}

const M = [
  /* ---------- 数据层：校验（写坏数据一律拦下来） ---------- */
  {
    n: '1 数据层：课程名空着也照存',
    f: 'utils/schedule.js',
    from: "  if (!name) return { ok: false, msg: '课程名不能空着' }",
    to: "  if (false) return { ok: false, msg: '课程名不能空着' }",
    want: 'B1 课程名空着不让存'
  },
  {
    n: '2 数据层：课程名超长不拦（页面会撑坏）',
    f: 'utils/schedule.js',
    from: "  if (name.length > MAX_NAME) return { ok: false, msg: '课程名最多 ' + MAX_NAME + ' 字' }",
    to: "  if (false) return { ok: false, msg: '课程名最多 ' + MAX_NAME + ' 字' }",
    want: 'B2 课程名超长不让存'
  },
  {
    n: '3 数据层：老师名字超长不拦',
    f: 'utils/schedule.js',
    from: "  if (teacher.length > MAX_TEACHER) return { ok: false, msg: '老师名字最多 ' + MAX_TEACHER + ' 字' }",
    to: "  if (false) return { ok: false, msg: '老师名字最多 ' + MAX_TEACHER + ' 字' }",
    want: 'B3 老师名字超长不让存'
  },
  {
    n: '4 数据层：内容简介超长不拦',
    f: 'utils/schedule.js',
    from: "  if (desc.length > MAX_DESC) return { ok: false, msg: '内容简介最多 ' + MAX_DESC + ' 字' }",
    to: "  if (false) return { ok: false, msg: '内容简介最多 ' + MAX_DESC + ' 字' }",
    want: 'B4 内容简介超长不让存'
  },
  {
    n: '5 数据层：课时数范围不校验（能填 0 或 99）',
    f: 'utils/schedule.js',
    from: '  if (!(hours >= HOURS_MIN && hours <= HOURS_MAX) || Math.round(hours) !== hours) {',
    to: '  if (false) {',
    want: 'B5 课时数只能是 1~9 的整数'
  },
  {
    n: '6 数据层：改课找不到这节课也说存成功了',
    f: 'utils/schedule.js',
    from: "  const lesson = findLesson(list, String(id || ''))\n  if (!lesson) return { ok: false, msg: '这节课已经不在了，返回列表刷新一下' }",
    to: "  const lesson = findLesson(list, String(id || ''))\n  if (!lesson) return { ok: true, msg: '' }",
    want: 'B7 找不到这节课时有明确提示'
  },

  /* ---------- 数据层：改动要落盘、只动这一节 ---------- */
  {
    n: '7 数据层：改完不写盘（刷新就没了）',
    f: 'utils/schedule.js',
    from: '  writeLessons(list)\n  return { ok: true, item: lessonRow(lesson, marks, Date.now()) }',
    to: '  return { ok: true, item: lessonRow(lesson, marks, Date.now()) }',
    want: 'C2 重新读一遍还是改后的内容（真的落盘了）'
  },
  {
    n: '8 数据层：没点名的课改课时数不生效',
    f: 'utils/schedule.js',
    from: '  if (!locked) lesson.hours = f.hours',
    to: '  if (false) lesson.hours = f.hours',
    want: 'C4 没点名的课能改课时数'
  },
  {
    n: '9 数据层：内容简介不落盘',
    f: 'utils/schedule.js',
    from: '  lesson.desc = f.desc',
    to: "  lesson.desc = ''",
    want: 'C2 重新读一遍还是改后的内容（真的落盘了）'
  },
  {
    n: '10 数据层：列表排成倒序（家长看到的是从晚到早）',
    f: 'utils/schedule.js',
    from: '  out.sort(function (a, b) {\n    return startTs(a.date, a.time) - startTs(b.date, b.time)\n  })',
    to: '  out.sort(function (a, b) {\n    return startTs(b.date, b.time) - startTs(a.date, a.time)\n  })',
    want: 'A3 列表按时间从早到晚排好'
  },

  /* ---------- 课时=钱：点过名的课不让改课时数 ---------- */
  {
    n: '11 数据层：已点名的课也照改课时数（账和页面会对不上）',
    f: 'utils/schedule.js',
    from: '  if (locked && f.hours !== lesson.hours) {',
    to: '  if (false) {',
    want: 'D3 已点名的课改课时数被拦住，并说清怎么办'
  },
  {
    n: '12 数据层：课时数永远不锁（点过名的也能改）',
    f: 'utils/schedule.js',
    from: 'function hoursLocked(lesson, marks) {\n  return lessonRolled(lesson, marks)\n}',
    to: 'function hoursLocked(lesson, marks) {\n  return false\n}',
    want: 'D2 点过名的课在列表里标成「课时数锁住」'
  },

  /* ---------- 展示：内容简介要出现在点名页 / 课时页 ---------- */
  {
    n: '13 数据层：点名页拿到的课不带简介',
    f: 'utils/schedule.js',
    from: "    name: lesson.name,\n    desc: lesson.desc || '',\n    time: lesson.time,",
    to: '    name: lesson.name,\n    time: lesson.time,',
    want: 'H1 点名页拿到的课带着内容简介'
  },
  {
    n: '14 数据层：课时页「本周课时」不带简介',
    f: 'utils/schedule.js',
    from: "    name: lesson.name,\n    desc: lesson.desc || '',\n    sub: WEEK_TXT[weekday(lesson.date)] + ' ' + lesson.time + ' · ' + lesson.teacher,",
    to: "    name: lesson.name,\n    sub: WEEK_TXT[weekday(lesson.date)] + ' ' + lesson.time + ' · ' + lesson.teacher,",
    want: 'H2 课时页「本周课时」每行也带着内容简介（家长能看到）'
  },
  {
    n: '15 数据层：课时选项清单没了（页面摆不出胶囊）',
    f: 'utils/schedule.js',
    from: 'const HOURS_CHOICES = [1, 2, 3, 4, 5, 6] // 每节几课时（页面上摆成胶囊，点一下选中）',
    to: 'const HOURS_CHOICES = [] // 每节几课时（页面上摆成胶囊，点一下选中）',
    want: 'G7 点课时胶囊就选中它'
  },

  /* ---------- 权限：老师能改、家长端一票否决 ---------- */
  {
    n: '16 权限：家长端不再一票否决（也能进管理页）',
    f: 'utils/demo-role.js',
    from: "function courseTip() {\n  if (level() === 'parent') return COURSE_PARENT_TIP",
    to: 'function courseTip() {\n  if (false) return COURSE_PARENT_TIP',
    want: 'G17 家长端一票否决：进不去，只给锁卡片'
  },
  {
    n: '17 权限：canEditCourse 对谁都说能改',
    f: 'utils/demo-role.js',
    from: "function canEditCourse() {\n  const lv = level()\n  if (lv === '') return null\n  return lv !== 'parent'",
    to: 'function canEditCourse() {\n  return true',
    want: 'G20 权限判断只有一份：canEditCourse 和家长端一票否决同口径'
  },

  /* ---------- 页面：course-admin ---------- */
  {
    n: '18 页面：点课时胶囊写错字段（界面选不中）',
    f: 'pages/course-admin/course-admin.js',
    from: '    if (hours) this.applyForm({ hours: hours })',
    to: "    if (hours) this.applyForm({ desc: 'x' })",
    want: 'G7 点课时胶囊就选中它'
  },
  {
    n: '19 页面：锁住的课也能点胶囊（界面不拦）',
    f: 'pages/course-admin/course-admin.js',
    from: '    if (this.data.hoursLocked) {',
    to: '    if (false) {',
    want: 'G13 锁住的课点胶囊改不动，只弹一句说明'
  },
  {
    n: '20 页面：字数提示不跟着输入变（applyForm 不算剩余字数）',
    f: 'pages/course-admin/course-admin.js',
    from: '      nameLeft: Math.max(0, schedule.MAX_NAME - name.length),',
    to: '      nameLeft: 0,',
    want: 'G8 输入框改动同步到表单（字数提示跟着走）'
  },
  {
    n: '21 页面：点一行不把内容填进编辑区',
    f: 'pages/course-admin/course-admin.js',
    from: '    if (id) this.fillForm(id)',
    to: '    if (false) this.fillForm(id)',
    want: 'G5 点一行 → 表单填上这一节的内容'
  },
  {
    n: '22 页面：列表不按天分组（日期小标题全没了）',
    f: 'pages/course-admin/course-admin.js',
    from: '      const head = r.date !== lastDay',
    to: '      const head = false',
    want: 'G4 列表按天分组（每天第一条打 dayHead，天数对得上）'
  },

  /* ---------- 页面结构 / 入口 ---------- */
  {
    n: '23 点名页：简介那一行不画了',
    f: 'pages/attendance/attendance.wxml',
    from: '        <view class="ls-desc" wx:if="{{ls.desc}}">{{ls.desc}}</view>\n',
    to: '',
    want: 'H3 点名页 / 课时页都画出了简介那一行'
  },
  {
    n: '24 课时页：简介那一行不画了',
    f: 'pages/course/course.wxml',
    from: '          <view class="row-desc" wx:if="{{item.desc}}">{{item.desc}}</view>\n',
    to: '',
    want: 'H3 点名页 / 课时页都画出了简介那一行'
  },
  {
    n: '25 我的页：课程内容管理入口绑错了事件',
    f: 'pages/mine/mine.wxml',
    from: 'bindtap="onCourseAdminTap"',
    to: 'bindtap="onRollTap"',
    want: 'H4 「我的」页有课程内容管理入口（老师可见）'
  },
  {
    n: '26 我的页：入口跳错页面',
    f: 'pages/mine/mine.js',
    from: "      url: '/pages/course-admin/course-admin',",
    to: "      url: '/pages/attendance/attendance',",
    want: 'H5 入口跳的是新页面，且这个页面已在 app.json 里注册'
  },
  {
    n: '27 app.json：忘了注册新页面',
    f: 'app.json',
    from: '    "pages/children-edit/children-edit",\n    "pages/course-admin/course-admin"',
    to: '    "pages/children-edit/children-edit"',
    want: 'H5 入口跳的是新页面，且这个页面已在 app.json 里注册'
  },

  /* ---------- 加课 / 删课 ---------- */
  {
    n: '28 加课：过去的课也照加（一进页面就被自动补算，所有人课时被扣）',
    f: 'utils/schedule.js',
    from: '  if (start <= Date.now()) {',
    to: '  if (false) {',
    want: 'I2 加课：过去的课加不了（会被自动补算扣课时）'
  },
  {
    n: '29 加课：同一天同一时间能重复排（课表撞车）',
    f: 'utils/schedule.js',
    from: '    if (list[i].date === date && list[i].time === time) {',
    to: '    if (false) {',
    want: 'I3 加课：这一天这个点已经有课了 → 拒绝'
  },
  {
    n: '30 加课：课程名空着也照加',
    f: 'utils/schedule.js',
    from: "  if (!name) return { ok: false, msg: '课程名不能空着' }",
    to: "  if (false) return { ok: false, msg: '课程名不能空着' }",
    want: 'I1 加课：日期 / 时间 / 课程名 / 课时数都要校验'
  },
  {
    n: '31 加课：加完不写盘（刷新就没了）',
    f: 'utils/schedule.js',
    from: '  writeLessons(list)\n  unmarkRemoved(id)',
    to: '  unmarkRemoved(id)',
    want: 'I4 加课：能加在演示课表之外的日子，列表里立刻有它'
  },
  /* 说明：原来这里有一条「新加的课不带孩子名单」的变异，实测抓不住 —— 因为
   * ensureLessons() 里的 syncRoster() 会把「今天以后、还没点名」的课的名单刷成最新名册，
   * 所以 addLesson 里那份 studentIds 只是防御性写法，行为上等价。等价变异不留。 */
  {
    n: '33 删课：点过名的课也照删（账已经记了）',
    f: 'utils/schedule.js',
    from: '  if (lessonRolled(lesson, marks)) {',
    to: '  if (false) {',
    want: 'I8 删课：点过名的课删不了，提示先清空点名'
  },
  {
    n: '34 删课：删了记录但不记「已删名单」（下次进页面又生成回来）',
    f: 'utils/schedule.js',
    from: '  markRemoved(lid)',
    to: "  markRemoved('')",
    want: 'I10 删课：删掉的课不会又被自动生成回来（★课表是自动生成的，得记住「删过」）'
  },
  {
    n: '35 删课：自动生成课表时不看「已删名单」（删掉的课又冒出来）',
    f: 'utils/schedule.js',
    from: '  const gone = removedSet()\n  for (const k in gone) has[k] = true\n',
    to: '',
    want: 'I10 删课：删掉的课不会又被自动生成回来（★课表是自动生成的，得记住「删过」）'
  },
  {
    n: '36 删课：删的时候把别的课也一起删了',
    f: 'utils/schedule.js',
    from: '    if (list[i].id !== lid) next.push(list[i])',
    to: '    if (true) next.push(list[i])',
    want: 'I9 删课：清空这一天的点名之后就能删了'
  },
  {
    n: '37 页面：点「＋ 添加课程」不进添加态',
    f: 'pages/course-admin/course-admin.js',
    from: "      adding: true,\n      editing: false,\n      editId: '',\n      editTitle: '',\n      name: '',\n      teacher: '',\n      desc: '',\n      hours: 1,\n      date: schedule.today(),",
    to: "      adding: false,\n      editing: false,\n      editId: '',\n      editTitle: '',\n      name: '',\n      teacher: '',\n      desc: '',\n      hours: 1,\n      date: schedule.today(),",
    want: 'I15 页面：点「＋ 添加课程」进添加态（字段清空、日期默认今天）'
  },
  {
    n: '38 页面：添加完不刷新列表（课表里看不到新课）',
    f: 'pages/course-admin/course-admin.js',
    from: '    const item = res.item || {}\n    this.refreshList()',
    to: '    const item = res.item || {}',
    want: 'I17 页面：添加成功 → 提示写明日期时间、列表刷新、自动进「修改这一节」'
  },
  {
    n: '39 页面：删除时拿错 id（删不动）',
    f: 'pages/course-admin/course-admin.js',
    from: "    this.askDelete(id, row ? row.dayText + ' ' + row.time : '')",
    to: "    this.askDelete('', '')",
    want: 'I20 页面：点过名的课点删除 → 弹「先清空点名」，列表里还在'
  },
  {
    n: '40 页面：删除假装成功（其实没删）',
    f: 'pages/course-admin/course-admin.js',
    from: '        const res = schedule.removeLesson(id, this.byName())',
    to: '        const res = { ok: true }',
    want: 'I19 页面：删除先弹确认框，确认后从列表里消失'
  }
]

function main() {
  const files = {}
  M.forEach(function (m) {
    files[m.f] = true
  })
  fs.mkdirSync(BAK, { recursive: true })
  Object.keys(files).forEach(function (f) {
    fs.copyFileSync(path.join(ROOT, f), path.join(BAK, f.replace(/\//g, '_')))
  })
  const base = {}
  Object.keys(files).forEach(function (f) {
    base[f] = md5(path.join(ROOT, f))
  })
  console.log('备份 + md5 完成：' + Object.keys(files).length + ' 个文件 → ' + BAK)

  let caught = 0
  const bad = []
  M.forEach(function (m) {
    const file = path.join(ROOT, m.f)
    const bak = path.join(BAK, m.f.replace(/\//g, '_'))
    fs.copyFileSync(bak, file)
    const src = fs.readFileSync(file, 'utf8')
    const hits = src.split(m.from).length - 1
    if (hits !== 1 || base[m.f] !== md5(file)) {
      bad.push(m.n + '  →  变异锚点异常（出现 ' + hits + ' 次 / md5 不一致），跳过')
      console.log('❌ ' + bad[bad.length - 1])
      return
    }
    fs.writeFileSync(file, src.replace(m.from, m.to))

    let out = ''
    let failed = false
    try {
      out = execFileSync('node', [SMOKE], { cwd: ROOT, encoding: 'utf8' })
    } catch (e) {
      failed = true
      out = String((e && e.stdout) || '') + String((e && e.stderr) || '')
    }

    fs.copyFileSync(bak, file)
    if (md5(file) !== base[m.f]) {
      bad.push(m.n + '  →  ⚠️ 还原后 md5 不一致！立刻停下')
      console.log(bad[bad.length - 1])
      process.exit(1)
    }

    const hitWrong = out.indexOf(m.want) > -1
    if (failed && hitWrong) {
      caught++
      console.log('✅ 抓到：' + m.n + '（自检报出 ' + m.want + '）')
    } else {
      bad.push(m.n + '  →  ' + (failed ? '失败了但没报出 ' + m.want : '居然没失败（测试漏了）'))
      console.log('❌ ' + bad[bad.length - 1])
      console.log('   ' + out.split('\n').slice(-6).join('\n   '))
    }
  })

  let dirty = 0
  Object.keys(files).forEach(function (f) {
    if (md5(path.join(ROOT, f)) !== base[f]) dirty++
  })
  console.log('')
  console.log('变异 ' + M.length + ' 组：抓到 ' + caught + ' 组 / 源码还原后不一致 ' + dirty + ' 个文件')
  if (bad.length || dirty) {
    console.log('❌ 有问题的：')
    bad.forEach(function (b) {
      console.log('   - ' + b)
    })
    process.exitCode = 1
    return
  }
  console.log('✅ 全部变异都被自检抓住，源码已还原（md5 逐文件校验一致）')
}

main()
