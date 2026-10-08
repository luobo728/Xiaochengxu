// 新页面静态自检：view 标签配对 / class 是否定义 / 事件方法是否存在
const fs = require('fs')
const path = require('path')
const ROOT = path.resolve(__dirname, '..')
const globalClasses = new Set(
  ('page hd hd-title hd-sub hd-stats stat stat-num stat-lbl body card card-head card-title card-more row row-ico ' +
    'row-main row-name row-sub row-val gray tag tag-blue tag-green tag-orange tag-gray progress progress-inner ' +
    'arrow btn-primary empty muted hairline').split(/\s+/)
)

const pages = ['pages/album/album', 'pages/album-admin/album-admin', 'pages/campus/campus', 'pages/mine/mine', 'pages/course-admin/course-admin', 'pages/attendance/attendance', 'pages/course/course']
let bad = 0

for (const base of pages) {
  const wxml = fs.readFileSync(path.join(ROOT, base + '.wxml'), 'utf8')
  const wxss = fs.readFileSync(path.join(ROOT, base + '.wxss'), 'utf8')
  const js = fs.readFileSync(path.join(ROOT, base + '.js'), 'utf8')

  const opens = (wxml.match(/<view\b/g) || []).length
  const closes = (wxml.match(/<\/view>/g) || []).length
  const self = (wxml.match(/<view\b[^>]*\/>/g) || []).length
  if (opens !== closes + self) {
    console.log('[FAIL] ' + base + ' view 不配对 open=' + opens + ' close=' + closes + ' self=' + self)
    bad++
  } else {
    console.log('[ok] ' + base + ' view 配对 ' + opens + ' 个')
  }

  const used = new Set()
  for (const m of wxml.matchAll(/class="([^"]*)"/g)) {
    const cleaned = m[1].replace(/\{\{[^}]*\}\}/g, (expr) =>
      (expr.match(/'([^']*)'/g) || []).map((s) => s.slice(1, -1)).join(' ')
    )
    cleaned.split(/\s+/).filter(Boolean).forEach((c) => used.add(c))
  }
  const defined = new Set([...wxss.matchAll(/\.([A-Za-z][\w-]*)/g)].map((m) => m[1]))
  const missing = [...used].filter((c) => !globalClasses.has(c) && !defined.has(c))
  if (missing.length) {
    console.log('[FAIL] ' + base + '.wxml 未定义 class: ' + missing.join(', '))
    bad++
  } else {
    console.log('[ok] ' + base + ' class 全部有定义（' + used.size + ' 个）')
  }

  const handlers = new Set([...wxml.matchAll(/bind(?:tap|change|input)="([A-Za-z_$][\w$]*)"/g)].map((m) => m[1]))
  const missingFn = [...handlers].filter((h) => !new RegExp('\\b' + h + '\\s*\\(').test(js))
  if (missingFn.length) {
    console.log('[FAIL] ' + base + ' 缺少事件方法: ' + missingFn.join(', '))
    bad++
  } else {
    console.log('[ok] ' + base + ' 事件方法齐全（' + handlers.size + ' 个）')
  }

  // 三个分支的身份判断必须是相邻的 wx:if / wx:elif / wx:else（中间夹注释会失效）
  if (base === 'pages/album-admin/album-admin') {
    const block = wxml.slice(wxml.indexOf('{{!checked}}'), wxml.indexOf('wx:else') + 40)
    if (/<!--/.test(block)) {
      console.log('[FAIL] 管理页身份判断三兄弟之间夹了注释')
      bad++
    } else {
      console.log('[ok] 管理页身份判断三兄弟相邻（无注释）')
    }
  }
}

console.log(bad ? 'CHECKS FAILED: ' + bad : '静态自检全部通过 ✅')
process.exit(bad ? 1 : 0)