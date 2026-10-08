// tools/mutations_clear.js —— 变异测试：证明「课时自动计算 / 清空点名」的断言真能抓住坏代码
// 做法：把源码改成「坏的」→ 跑自检 → 必须失败（且失败项正是期望的那条）→ 还原 → md5 校验
// 范围：utils/schedule.js、pages/attendance/attendance.js + wxml
// 跑法：node tools/mutations_clear.js
const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const { execFileSync } = require('child_process')

const ROOT = path.resolve(__dirname, '..')
const TMP = path.join(__dirname, '.tmp')
const SMOKE = path.join(__dirname, 'smoke_schedule.js')
const BAK = path.join(TMP, 'bak_clear')

const md5 = function (f) {
  return crypto.createHash('md5').update(fs.readFileSync(f)).digest('hex')
}

const M = [
  /* ---------- 课时=钱：规则与判重 ---------- */
  {
    n: '1 数据层：请假也照扣课时（规则表读反了）',
    f: 'utils/schedule.js',
    from: "  if (status === 'leave') return r.leaveFree ? 0 : unit",
    to: "  if (status === 'leave') return r.leaveFree ? unit : 0",
    want: 'B8 请假不扣 / 旷课照扣 / 试听不扣'
  },
  {
    n: '2 数据层：旷课不扣课时（该扣的不扣）',
    f: 'utils/schedule.js',
    from: "  if (status === 'absent') return r.absentCharge ? unit : 0",
    to: "  if (status === 'absent') return 0",
    want: 'B8 请假不扣 / 旷课照扣 / 试听不扣'
  },
  {
    n: '3 数据层：试听照扣课时',
    f: 'utils/schedule.js',
    from: "  if (status === 'trial') return r.trialFree ? 0 : unit",
    to: "  if (status === 'trial') return unit",
    want: 'B8 请假不扣 / 旷课照扣 / 试听不扣'
  },
  {
    n: '4 数据层：不减去「已经结算过的课时」（同一节课重复扣）',
    f: 'utils/schedule.js',
    from: '  const delta = round2(target - done)',
    to: '  const delta = round2(target)',
    want: 'C1 同一节课重复保存：不重复扣（提示已经记过了）'
  },
  {
    n: '5 数据层：扣课时传成了正数（越上越多课时）',
    f: 'utils/schedule.js',
    from: '      amount: -delta, // 账本口径：正数进、负数扣；扣课时要传负值',
    to: '      amount: delta, // 账本口径：正数进、负数扣；扣课时要传负值',
    want: 'C5 回补后余额加回来了'
  },
  {
    n: '6 数据层：流水不带判重键（重试 / 补算会重复记账）',
    f: 'utils/schedule.js',
    from: "      ref: mark.id + '#' + seq, // 同一个孩子同一节课的同一笔只记一次",
    to: "      ref: '', // 同一个孩子同一节课的同一笔只记一次",
    want: 'C8 同一个孩子的几条流水 ref 各不相同（礼物 + 扣 + 退 + 再扣）'
  },
  {
    n: '7 数据层：流水不写是哪个孩子（一本账里分不清）',
    f: 'utils/schedule.js',
    from: '      childId: mark.studentId, // 账记到孩子头上：几个孩子的课时各算各的',
    to: "      childId: '', // 账记到孩子头上：几个孩子的课时各算各的",
    want: 'B6 流水写明是哪个孩子（childId / childName / 课程名）'
  },

  /* ---------- 课表生成 ---------- */
  {
    n: '8 数据层：每天只生成一节课（课表少一半）',
    f: 'utils/schedule.js',
    from: "const WEEKDAY_SLOTS = ['09:20', '15:30']",
    to: "const WEEKDAY_SLOTS = ['09:20']",
    want: 'A2 每天两节（工作日 09:20 / 15:30，周末 10:00 / 16:00）'
  },
  {
    n: '9 数据层：课表不从昨天开始（没有能自动补算的课）',
    f: 'utils/schedule.js',
    from: '  startOffset: -1, // 从昨天开始（昨天那节正好用来演示「自动补算」）',
    to: '  startOffset: 0, // 从昨天开始（昨天那节正好用来演示「自动补算」）',
    want: 'A6 昨天 / 今天 / 明天都有课（演示随时能点）'
  },

  /* ---------- 自动补算 ---------- */
  {
    n: '10 数据层：自动补算把「手动清空过」的课又扣一遍',
    f: 'utils/schedule.js',
    from: "    if (list[i].status === 'planned' && !list[i].cleared && endTs(list[i]) <= now) due.push(list[i])",
    to: "    if (list[i].status === 'planned' && endTs(list[i]) <= now) due.push(list[i])",
    want: 'E9 清空过的课不会被自动补算又扣一遍'
  },
  {
    n: '11 数据层：自动补算把还没到的课也补了',
    f: 'utils/schedule.js',
    from: "    if (list[i].status === 'planned' && !list[i].cleared && endTs(list[i]) <= now) due.push(list[i])",
    to: "    if (list[i].status === 'planned' && !list[i].cleared) due.push(list[i])",
    want: 'D6 还没到的课不动（明天还是待上课）'
  },

  /* ---------- 清空点名 ---------- */
  {
    n: '12 数据层：清空的退回写成倒扣（越清越少）',
    f: 'utils/schedule.js',
    from: '        amount: job.back, // 账本口径：正数进、负数扣 —— 退回传正数',
    to: '        amount: -job.back, // 账本口径：正数进、负数扣 —— 退回传正数',
    want: 'E3 每个孩子的余额都回到清空之前 + 各自退回的'
  },
  {
    n: '13 数据层：结算序号不往前走（退回那笔和下次点名撞号，退回记不进去）',
    f: 'utils/schedule.js',
    from: '      mark.settledHours = target\n      mark.settleCount = seq + 1\n      mark.hours = target',
    to: '      mark.settledHours = target\n      mark.settleCount = seq\n      mark.hours = target',
    want: 'C5 回补后余额加回来了'
  },
  {
    n: '14 数据层：清空时把点名记录删了（不是清零）',
    f: 'utils/schedule.js',
    from: "      mark.timeText = ''\n    }\n    writeMarks(marks)",
    to: "      mark.timeText = ''\n    }\n    writeMarks({})",
    want: 'E6 点名记录是「清零」不是删除（今天的记录还在，saved 归零）'
  },
  {
    n: '15 数据层：清空后课不回「待上课」（页面上还显示已结算）',
    f: 'utils/schedule.js',
    from: "      lesson.status = 'planned'\n      lesson.cleared = true",
    to: "      lesson.status = 'settled'\n      lesson.cleared = true",
    want: 'E4 页面上回到「没点过名」：rolled = 0，状态回「待上课 / 待点名」'
  },
  {
    n: '16 数据层：清空后不打 cleared 标记（下次进页面又被补算扣回去）',
    f: 'utils/schedule.js',
    from: '      lesson.cleared = true',
    to: '      lesson.cleared = false',
    want: 'E8 清空过的课带 cleared 标记，并给出说明'
  },
  {
    n: '17 数据层：点名记录不清零（页面还显示已结算）',
    f: 'utils/schedule.js',
    from: '      mark.saved = false',
    to: '      mark.saved = true',
    want: 'E5 每行也回到没结算的样子（0/3，不扣课时）'
  },
  {
    n: '18 数据层：没点过名也说清空成功',
    f: 'utils/schedule.js',
    from: '  if (!touched.length) {',
    to: '  if (false) {',
    want: 'E13 没点过名的日子清空时明确说「不用清」'
  },
  {
    n: '19 数据层：清空说明不写退回多少课时',
    f: 'utils/schedule.js',
    from: "    msg += refunded > 0 ? '，退回 ' + refunded + ' 课时' : '（这节课本来就不扣课时）'",
    to: "    msg += refunded > 0 ? '' : '（这节课本来就不扣课时）'",
    want: 'E1 清空这一天：清掉 2 节课、6 条点名记录'
  },

  /* ---------- 课时页统计 ---------- */
  {
    n: '20 数据层：本周课节数算成两倍（进度条百分比不对）',
    f: 'utils/schedule.js',
    from: '      weekTotal++',
    to: '      weekTotal += 2',
    want: 'F3 本周进度：完成数 ≤ 总数，百分比按这个算'
  },

  /* ---------- 点名页 ---------- */
  {
    n: '21 页面：家长端守卫拿掉（家长也能点名 / 清空）',
    f: 'pages/attendance/attendance.js',
    from: '  onClear() {\n    if (!this.data.canRoll) return',
    to: '  onClear() {\n    if (false) return',
    want: 'H2 家长端就算直接调点名 / 清空也什么都不做'
  },
  {
    n: '22 页面：有没保存的改动也照清（可能把没保存的改动一起清了）',
    f: 'pages/attendance/attendance.js',
    from: '    if (this.data.dirty) {',
    to: '    if (false && this.data.dirty) {',
    want: 'H11 有未保存的改动时，清空先被拦住'
  },
  {
    n: '23 页面：不是今天也写「清空今日点名」',
    f: 'pages/attendance/attendance.js',
    from: "      clearLabel: data.isToday ? '清空今日点名' : '清空这一天点名',",
    to: "      clearLabel: '清空今日点名',",
    want: 'H12 换到前一天：文案变「清空这一天点名」'
  },
  {
    n: '24 页面：没点名也显示「清空」按钮',
    f: 'pages/attendance/attendance.js',
    from: '      showClear: data.rolled > 0,',
    to: '      showClear: true,',
    want: 'H6 这一天刚清空过 → 不显示「清空」按钮'
  },
  {
    n: '25 wxml：「清空」按钮不受 showClear 控制',
    f: 'pages/attendance/attendance.wxml',
    from: 'wx:if="{{showClear}}"',
    to: 'wx:if="{{true}}"',
    want: 'J1 「清空」按钮受 showClear 控制，并绑在 onClear 上'
  },
  {
    n: '26 wxml：状态胶囊绑错事件',
    f: 'pages/attendance/attendance.wxml',
    from: 'bindtap="onPill"',
    to: 'bindtap="onSave"',
    want: 'J3 状态胶囊绑在 onPill 上，并把 li / ki / key 传下去'
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
