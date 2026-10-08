// mutations_notice.js —— 变异测试：证明「通知公告 + 定向推送」的断言真能抓住坏代码
// 做法：把源码改成「坏的」（一行）→ 跑对应的冒烟测试 → 必须失败（且报出期望的那一条）→ 还原 → md5 校验
// 范围只允许：utils/notice.js、pages/notice-admin/*、pages/notice/*、pages/index/index.js、
//             cloudfunctions/noticeAdmin/index.js
//             （utils/schedule.js、utils/children.js、utils/billing.js、点名页、孩子档案页有别的自检在跑，
//              这里一律不碰，免得互相打架）
// 跑法：node tools/mutations_notice.js
const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const { execFileSync } = require('child_process')

const ROOT = path.resolve(__dirname, '..')
const TMP = path.join(__dirname, '.tmp') // 临时备份目录（.gitignore 里已排除）
const BAK = path.join(TMP, 'bak_notice')

// 允许被改坏的文件（前缀匹配）
const ALLOWED = [
  'utils/notice.js',
  'pages/notice-admin/',
  'pages/notice/',
  'pages/index/index.js',
  'cloudfunctions/noticeAdmin/index.js'
]

const md5 = function (f) {
  return crypto.createHash('md5').update(fs.readFileSync(f)).digest('hex')
}

const SMOKE_LOCAL = 'smoke_notice.js'
const SMOKE_FN = 'smoke_cloudfn.js'

const M = [
  /* ---------- 数据层：推送范围（认不出的、没写的都得兜住） ---------- */
  {
    n: '1 数据层：范围乱写也当合法的（那条通知只推给「火星班」= 谁都不显示）',
    f: 'utils/notice.js',
    smoke: SMOKE_LOCAL,
    from: '  return TARGETS.indexOf(t) > -1 ? t : ALL_CLASS',
    to: '  return t',
    want: 'A24 pickTarget：认不出的值一律当「全园」'
  },
  {
    n: '2 数据层：老数据（没有 to 字段）不兜底，读出来是 undefined',
    f: 'utils/notice.js',
    smoke: SMOKE_LOCAL,
    from: '    to: pickTarget(raw.to),',
    to: '    to: raw.to,',
    want: 'A23 老数据没有 to 字段 → 读出来按「全园」'
  },
  {
    n: '3 数据层：家长端不再按自己孩子的班级筛（谁都能看全部）',
    f: 'utils/notice.js',
    smoke: SMOKE_LOCAL,
    from: "  if (!role.isParent()) return ''",
    to: "  if (true) return ''",
    want: 'B2 viewClass 取的是自己孩子档案里的班级（大一班）'
  },
  {
    n: '4 数据层：canSee 把全园通知当成定向（全园通知在家长端凭空消失）',
    f: 'utils/notice.js',
    smoke: SMOKE_LOCAL,
    from: '  if (to === ALL_CLASS) return true',
    to: '  if (false) return true',
    want: 'B3 全园通知：家长看得到'
  },
  {
    n: '5 数据层：canSee 的班级比对写反了（只看到别班的）',
    f: 'utils/notice.js',
    smoke: SMOKE_LOCAL,
    from: '  return cls === to',
    to: '  return cls !== to',
    want: 'B5 定向给别班的通知：家长看不到'
  },
  {
    n: '6 数据层：filterVisible 根本不筛（首页把别班通知也画出来）',
    f: 'utils/notice.js',
    smoke: SMOKE_LOCAL,
    from: '    if (canSee(all[i])) out.push(all[i])',
    to: '    if (true) out.push(all[i])',
    want: 'B9 filterVisible：只留自己看得到的那几条'
  },
  {
    n: '7 数据层：范围文案不分全园 / 定向（全园也写成「仅 全园」）',
    f: 'utils/notice.js',
    smoke: SMOKE_LOCAL,
    from: "  return to === ALL_CLASS ? '全园' : '仅 ' + to",
    to: "  return '仅 ' + to",
    want: 'A30 rangeText：全园就写「全园」'
  },
  {
    n: '8 数据层：范围配色不分灰 / 蓝（全园也挂蓝标签）',
    f: 'utils/notice.js',
    smoke: SMOKE_LOCAL,
    from: "  return targetOf(row) === ALL_CLASS ? 'tag-gray' : 'tag-blue'",
    to: "  return 'tag-blue'",
    want: 'C8 全园那条的标签是灰的'
  },
  {
    n: '9 数据层：胶囊下标不认「范围」那套（前后空格 / 认不出的班选不中「全园」）',
    f: 'utils/notice.js',
    smoke: SMOKE_LOCAL,
    from: '  const i = TARGETS.indexOf(pickTarget(v))',
    to: '  const i = TARGETS.indexOf(v)',
    want: 'A28 targetIndex：合法班级能对上下标（大一班 = 4，前后带空格也算）'
  },

  /* ---------- 数据层：写（改通知别把范围改回全园、改动要落盘） ---------- */
  {
    n: '10 数据层：改通知不带范围就改回「全园」（悄悄改掉推送范围）',
    f: 'utils/notice.js',
    smoke: SMOKE_LOCAL,
    from: "  const to = draft.to === undefined || draft.to === '' ? targetOf(cur) : pickTarget(draft.to)",
    to: '  const to = pickTarget(draft.to)',
    want: 'A11 改通知不带范围 → 沿用原来的「大一班」（不会悄悄变全园）'
  },
  {
    n: '11 数据层：保存完不写盘（刷新就没了）',
    f: 'utils/notice.js',
    smoke: SMOKE_LOCAL,
    from: '  writeListRaw(next)\n  return Promise.resolve({ ok: true, item: item })',
    to: '  return Promise.resolve({ ok: true, item: item })',
    want: 'A8 新增真的落盘了（重新读一遍能找到）'
  },
  {
    n: '12 数据层：置顶不写盘（点了置顶没反应）',
    f: 'utils/notice.js',
    smoke: SMOKE_LOCAL,
    from: '  writeListRaw(next)\n  return Promise.resolve({ ok: true, top: !row.top })',
    to: '  return Promise.resolve({ ok: true, top: !row.top })',
    want: 'A19 置顶：这条立刻排到最前面'
  },
  {
    n: '13 数据层：删除不真删（家长端还看得到）',
    f: 'utils/notice.js',
    smoke: SMOKE_LOCAL,
    from: '  const next = rows.filter(function (row) {\n    return row.id !== key\n  })',
    to: '  const next = rows.filter(function (row) {\n    return true\n  })',
    want: 'A17 删除一条：返回 ok，列表里真的没了'
  },
  {
    n: '14 数据层：恢复演示通知只写回 4 条（少了一条）',
    f: 'utils/notice.js',
    smoke: SMOKE_LOCAL,
    from: '  return DEFAULT_NOTICES.map(function (item, i) {',
    to: '  return DEFAULT_NOTICES.slice(0, 4).map(function (item, i) {',
    want: 'A21 恢复演示通知：又是 5 条'
  },
  {
    n: '15 数据层：演示数据里那条定向通知改成全园（定向演示没了）',
    f: 'utils/notice.js',
    smoke: SMOKE_LOCAL,
    from: "    to: '大一班',",
    to: '    to: ALL_CLASS,',
    want: 'A22 恢复后第 5 条仍然定向「大一班」'
  },
  {
    n: '16 数据层：排序不看置顶（置顶的排不到最前）',
    f: 'utils/notice.js',
    smoke: SMOKE_LOCAL,
    from: '    if (!!a.top !== !!b.top) return a.top ? -1 : 1',
    to: '    if (false) return a.top ? -1 : 1',
    want: 'A5 置顶的那条排在列表最前面'
  },

  /* ---------- 发布页 notice-admin ---------- */
  {
    n: '17 页面：点范围胶囊写错字段（选不中）',
    f: 'pages/notice-admin/notice-admin.js',
    smoke: SMOKE_LOCAL,
    from: '    this.setData({ targetIndex: index })',
    to: '    this.setData({ tagIndex: index })',
    want: 'C4 点范围胶囊就选中它（大班）'
  },
  {
    n: '18 页面：点已有通知时范围不跟着变（一律回到全园）',
    f: 'pages/notice-admin/notice-admin.js',
    smoke: SMOKE_LOCAL,
    from: '      targetIndex: notice.targetIndex(row.to),',
    to: '      targetIndex: 0,',
    want: 'C5 点已有通知 → 表单填上它，范围也跟着变成「大一班」'
  },
  {
    n: '19 页面：点「写一条新通知」不把范围复位（留着上一条的班）',
    f: 'pages/notice-admin/notice-admin.js',
    smoke: SMOKE_LOCAL,
    from: "title: '', tagIndex: 0, targetIndex: 0, body: '', top: false })",
    to: "title: '', tagIndex: 0, targetIndex: this.data.targetIndex, body: '', top: false })",
    want: 'C6 点「写一条新通知」→ 表单清空，范围回到「全园」'
  },
  {
    n: '20 页面：保存时不把选中的范围传下去（选了大班也发全园）',
    f: 'pages/notice-admin/notice-admin.js',
    smoke: SMOKE_LOCAL,
    from: '      to: to,',
    to: '      to: undefined,',
    want: 'C10 发布落盘的就是「大班」（页面选的胶囊真的传下去了）'
  },
  {
    n: '21 页面：发布成功提示不写范围（家长端看不出推给谁）',
    f: 'pages/notice-admin/notice-admin.js',
    smoke: SMOKE_LOCAL,
    from: "  return to === notice.ALL_CLASS ? '已发布：全园家长可见' : '已发布：仅' + to + '家长可见'",
    to: "  return '已发布：全园家长可见'",
    want: 'C9 选「大班」发布 → 提示写明范围'
  },
  {
    n: '22 页面：列表每条都挂「全园」灰标签（定向范围看不出来）',
    f: 'pages/notice-admin/notice-admin.js',
    smoke: SMOKE_LOCAL,
    from: '        rangeText: notice.rangeText(row),\n        rangeTone: notice.rangeTone(row),',
    to: "        rangeText: '全园',\n        rangeTone: 'tag-gray',",
    want: 'C7 列表每条都带范围标签（n5 = 仅 大一班 / 蓝）'
  },

  /* ---------- 详情页 notice ---------- */
  {
    n: '23 详情页：不挡别班通知（从分享链接点进来能看到）',
    f: 'pages/notice/notice.js',
    smoke: SMOKE_LOCAL,
    from: '    if (!notice.canSee(row)) {',
    to: '    if (false) {',
    want: 'E1 别班通知：详情页挡住，提示写明推给谁'
  },
  {
    n: '24 详情页：全园通知也挂范围标签（每条都多个灰标签）',
    f: 'pages/notice/notice.js',
    smoke: SMOKE_LOCAL,
    from: "    return notice.targetOf(row) === notice.ALL_CLASS ? '' : notice.rangeText(row)",
    to: '    return notice.rangeText(row)',
    want: 'E5 全园通知不挂范围标签（rangeText 为空）'
  },
  {
    n: '25 详情页：找不到这条也当找到了（空标题的白页）',
    f: 'pages/notice/notice.js',
    smoke: SMOKE_LOCAL,
    from: '    const row = notice.getById(this.data.id)',
    to: '    const row = notice.getById(this.data.id) || { id: this.data.id }',
    want: 'E7 被删的通知：提示「这条通知已被删除」'
  },
  {
    n: '26 详情页：空态文案写死（看不到时不说推给哪个班）',
    f: 'pages/notice/notice.js',
    smoke: SMOKE_LOCAL,
    from: "      emptyText: text || '这条通知已被删除'",
    to: "      emptyText: '这条通知已被删除'",
    want: 'E1 别班通知：详情页挡住，提示写明推给谁'
  },

  /* ---------- 首页 index：第一屏和刷新都得是筛过的那份 ---------- */
  {
    n: '27 首页：第一屏用没筛过的 listSync（别班通知也画出来）',
    f: 'pages/index/index.js',
    smoke: SMOKE_LOCAL,
    from: '    this.applyNotices(notice.listVisibleSync())',
    to: '    this.applyNotices(notice.listSync())',
    want: 'D1 首次画（listVisibleSync）出来的就是筛过的那份：别班通知不在'
  },
  {
    n: '28 首页：刷新用没筛过的 list（切回首页又冒出别班通知）',
    f: 'pages/index/index.js',
    smoke: SMOKE_LOCAL,
    from: '    notice.listVisible().then((rows) => {',
    to: '    notice.list().then((rows) => {',
    want: 'D4 刷新（listVisible）之后还是筛过的'
  },

  /* ---------- 页面结构（wxml） ---------- */
  {
    n: '29 发布页 wxml：范围胶囊绑错事件（点了没反应）',
    f: 'pages/notice-admin/notice-admin.wxml',
    smoke: SMOKE_LOCAL,
    from: '              bindtap="onTargetTap">{{item}}</view>',
    to: '              bindtap="onTagTap">{{item}}</view>',
    want: 'F1 推送范围胶囊绑在 onTargetTap 上'
  },
  {
    n: '30 发布页 wxml：列表不画范围标签（看不到推给谁）',
    f: 'pages/notice-admin/notice-admin.wxml',
    smoke: SMOKE_LOCAL,
    from: '                <text class="tag {{item.rangeTone}}">{{item.rangeText}}</text>\n',
    to: '',
    want: 'F3 管理页列表画出范围文案和配色'
  },
  {
    n: '31 详情页 wxml：范围标签那一行不画了',
    f: 'pages/notice/notice.wxml',
    smoke: SMOKE_LOCAL,
    from: '        <text class="tag {{rangeTone}}" wx:if="{{rangeText}}">{{rangeText}}</text>\n',
    to: '',
    want: 'F4 详情页范围标签按 rangeText 显示（全园时不挂）'
  },

  /* ---------- 云函数 noticeAdmin ---------- */
  {
    n: '32 云函数：新增不传范围时不给默认值（存了个别的班）',
    f: 'cloudfunctions/noticeAdmin/index.js',
    smoke: SMOKE_FN,
    from: '    // 新增的默认推给全园\n    const to = pickTarget(event.to)',
    to: "    // 新增的默认推给全园\n    const to = trimText(event.to) ? pickTarget(event.to) : '大班'",
    want: 'C5 新增：不带 to 默认推给「全园」'
  },
  {
    n: '33 云函数：改通知不带范围就改回全园（把定向范围冲掉）',
    f: 'cloudfunctions/noticeAdmin/index.js',
    smoke: SMOKE_FN,
    from: '      const to = trimText(event.to) ? pickTarget(event.to) : pickTarget(doc.to)',
    to: '      const to = pickTarget(event.to)',
    want: 'C12 改通知：不带 to 沿用原来的范围（还是大一班，不会悄悄变全园）'
  },
  {
    n: '34 云函数：shape 不给 to 兜底（老数据读出来是 undefined）',
    f: 'cloudfunctions/noticeAdmin/index.js',
    smoke: SMOKE_FN,
    from: '    to: pickTarget(raw.to),',
    to: '    to: raw.to,',
    want: 'B7 老数据（文档里没有 to 字段）读出来按「全园」'
  },
  {
    n: '35 云函数：list 不排序（置顶的排不到最前）',
    f: 'cloudfunctions/noticeAdmin/index.js',
    smoke: SMOKE_FN,
    from: '      return ok({ rows: sortRows((res && res.data) || []).map(shape) })',
    to: '      return ok({ rows: ((res && res.data) || []).map(shape) })',
    want: 'B6 list 排好序：置顶的排最前'
  },
  {
    n: '36 云函数：白名单不 trim（ADMIN_OPENIDS 里带空格的 openid 认不出来）',
    f: 'cloudfunctions/noticeAdmin/index.js',
    smoke: SMOKE_FN,
    from: '    .map(function (s) {\n      return s.trim()\n    })',
    to: '    .map(function (s) {\n      return s\n    })',
    want: 'A3 白名单里带空格的 openid 也认（ADMIN_OPENIDS 逗号 + 空格）'
  },
  {
    n: '37 云函数：不看环境变量白名单（谁都不是管理员）',
    f: 'cloudfunctions/noticeAdmin/index.js',
    smoke: SMOKE_FN,
    from: '  if (list.indexOf(openid) > -1) return true',
    to: '  if (false) return true',
    want: 'A2 环境变量白名单里的 openid 是管理员'
  },
  {
    n: '38 云函数：管理权限那道门形同虚设（家长也能写）',
    f: 'cloudfunctions/noticeAdmin/index.js',
    smoke: SMOKE_FN,
    from: "    return fail('没有管理权限')",
    to: '    return ok({ rows: [] })',
    want: 'C1 不是管理员不能存（没有管理权限）'
  },
  {
    n: '39 云函数：标题空着也照存',
    f: 'cloudfunctions/noticeAdmin/index.js',
    smoke: SMOKE_FN,
    from: "    if (!title) return fail('请先填写标题')",
    to: "    if (false) return fail('请先填写标题')",
    want: 'C2 标题空着不让存'
  },
  {
    n: '40 云函数：分类乱写就照存（页面标签会没颜色）',
    f: 'cloudfunctions/noticeAdmin/index.js',
    smoke: SMOKE_FN,
    from: "    const tag = TAGS.indexOf(trimText(event.tag)) > -1 ? trimText(event.tag) : '通知'",
    to: "    const tag = trimText(event.tag) || '通知'",
    want: 'C10 分类乱写按「通知」存'
  },
  {
    n: '41 云函数：删一条不带 id 也照删',
    f: 'cloudfunctions/noticeAdmin/index.js',
    smoke: SMOKE_FN,
    from: "    if (!id) return fail('缺少 id')",
    to: "    if (false) return fail('缺少 id')",
    want: 'D3 删一条不带 id：给明确提示'
  },
  {
    n: '42 云函数：reset 只写回 4 条演示通知',
    f: 'cloudfunctions/noticeAdmin/index.js',
    smoke: SMOKE_FN,
    from: '        DEFAULT_NOTICES.map(function (item, i) {',
    to: '        DEFAULT_NOTICES.slice(0, 4).map(function (item, i) {',
    want: 'E2 reset 写回 5 条演示通知'
  },
  {
    n: '43 云函数：reset 把那条定向通知也写成全园',
    f: 'cloudfunctions/noticeAdmin/index.js',
    smoke: SMOKE_FN,
    from: "    to: '大一班',",
    to: '    to: ALL_CLASS,',
    want: 'E4 reset 后有一条定向推给「大一班」（演示里那条写生通知）'
  },
  {
    n: '44 云函数：未知 action 静默成功（客户端以为做完了）',
    f: 'cloudfunctions/noticeAdmin/index.js',
    smoke: SMOKE_FN,
    from: "  return fail('未知操作：' + action)",
    to: '  return ok({})',
    want: 'F1 未知 action：给明确提示（不静默成功）'
  }
]

function allowed(f) {
  for (let i = 0; i < ALLOWED.length; i++) {
    if (f === ALLOWED[i] || f.indexOf(ALLOWED[i]) === 0) return true
  }
  return false
}

function main() {
  // 先卡一道：只许改通知相关的这几个文件（别的自检在同时重建，碰了会互相打架）
  const outside = M.filter(function (m) {
    return !allowed(m.f)
  })
  if (outside.length) {
    console.log('❌ 有变异指向了不允许改的文件（会踩到别的自检）：')
    outside.forEach(function (m) {
      console.log('   - ' + m.n + '  →  ' + m.f)
    })
    process.exit(1)
  }

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
    const smoke = path.join(__dirname, m.smoke)
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
      out = execFileSync('node', [smoke], { cwd: ROOT, encoding: 'utf8' })
    } catch (e) {
      failed = true
      out = String((e && e.stdout) || '') + String((e && e.stderr) || '')
    }

    fs.copyFileSync(bak, file)
    if (md5(file) !== base[m.f]) {
      console.log('⚠️ ' + m.n + '  →  还原后 md5 不一致！立刻停下')
      process.exit(1)
    }

    const hitWrong = out.indexOf(m.want) > -1
    if (failed && hitWrong) {
      caught++
      console.log('✅ 抓到：' + m.n + '（' + m.smoke + ' 报出 ' + m.want + '）')
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
