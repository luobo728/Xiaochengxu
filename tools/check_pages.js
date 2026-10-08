const fs = require('fs')
const path = require('path')

const root = path.resolve(__dirname, '..')
const pairs = [
  'pages/index/index',
  'pages/notice/notice',
  'pages/notice-admin/notice-admin',
  'pages/mine/mine',
  'pages/attendance/attendance',
  'pages/children/children',
  'pages/children-edit/children-edit',
  'pages/course/course',
  'pages/billing/billing',
  'pages/course-admin/course-admin'
]

let bad = 0
pairs.forEach(function (base) {
  const wxml = fs.readFileSync(path.join(root, base + '.wxml'), 'utf8')
  const js = fs.readFileSync(path.join(root, base + '.js'), 'utf8')
  const handlers = new Set()
  const re = /\b(?:bind|catch)\w*\s*=\s*"([A-Za-z_$][\w$]*)"/g
  let m
  while ((m = re.exec(wxml))) handlers.add(m[1])

  const missing = []
  handlers.forEach(function (h) {
    const rx = new RegExp('(^|[\\s,{])' + h + '\\s*\\(')
    if (!rx.test(js)) missing.push(h)
  })
  console.log(base + ' -> 事件 ' + handlers.size + ' 个，' + (missing.length ? '❌ 缺失: ' + missing.join(', ') : '✅ 全部存在'))
  if (missing.length) bad++

  // 顺带核对 wxml 里用到的 {{顶层字段}} 是否在 js 里出现过
  const fields = new Set()
  const fre = /\{\{([^}]*)\}\}/g
  while ((m = fre.exec(wxml))) {
    const expr = m[1]
    const ire = /[A-Za-z_$][\w$]*/g
    let im
    while ((im = ire.exec(expr))) fields.add(im[0])
  }
  const kws = ['true', 'false', 'null', 'undefined', 'item', 'index', 'wx', 'length', 'slice', 'indexOf', 'if', 'else']
  const unknown = []
  fields.forEach(function (f) {
    if (kws.indexOf(f) > -1) return
    if (new RegExp('(^|[^\\w$.])' + f + '(?![\\w$])').test(js)) return
    unknown.push(f)
  })
  if (unknown.length) console.log('   ⚠️ js 中未直接出现（可能是方法内解构或全局）：' + unknown.join(', '))
})

process.exit(bad ? 1 : 0)