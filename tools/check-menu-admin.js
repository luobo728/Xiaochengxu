// 临时自查脚本（不进入仓库）：校验 wxml 字段/事件、标签配平、wxss 花括号与硬性约束
const fs = require('fs')
const path = require('path')

const root = path.resolve(__dirname, '..')
let bad = 0
const ok = (msg) => console.log('  PASS  ' + msg)
const fail = (msg) => { bad++; console.log('  FAIL  ' + msg) }

// ---------- 在沙箱里加载页面 js，拿到真实的 data / methods ----------
function loadPage(rel) {
  const code = fs.readFileSync(path.join(root, rel), 'utf8')
  let captured = null
  const MEALS = [
    { key: 'breakfast', name: '早餐', time: '07:30' },
    { key: 'morning', name: '早点', time: '09:30' },
    { key: 'lunch', name: '午餐', time: '11:30' },
    { key: 'afternoon', name: '午点', time: '15:00' },
    { key: 'dinner', name: '晚餐', time: '16:30' }
  ]
  const stubs = {
    'utils/meal.js': { MEALS: MEALS, mealName: (k) => (MEALS.filter((m) => m.key === k)[0] || {}).name || '' },
    'utils/menu.js': {
      isCloudReady: () => true,
      cloudError: () => '',
      listByDates: () => Promise.resolve([]),
      whoami: () => Promise.resolve({ openid: 'openid-test', isAdmin: false }),
      addPhotos: () => Promise.resolve({ ok: true, added: 0 }),
      removePhoto: () => Promise.resolve({ ok: true }),
      previewUrls: () => Promise.resolve([])
    },
    // 演示账号身份底线：直接 require 真模块（它只读 storage，读不到就按「非家长」算）
    'utils/demo-role.js': require(path.join(root, 'utils/demo-role.js'))
  }
  const fakeRequire = (p) => {
    const hit = Object.keys(stubs).filter((k) => p.indexOf(k) > -1)[0]
    if (hit) return stubs[hit]
    // 其它 utils/*：直接 require 真模块（页面只在用到时才调用，加载期不碰 wx）
    const m = /utils\/([a-z-]+\.js)$/.exec(p)
    if (m) return require(path.join(root, 'utils', m[1]))
    throw new Error('unexpected require: ' + p)
  }
  const fn = new Function('Page', 'getApp', 'require', 'module', 'exports', 'wx', code)
  fn((o) => { captured = o }, () => ({ globalData: { statusBarHeight: 20 } }), fakeRequire, {}, {}, {})
  if (!captured) throw new Error(rel + ': Page() 未被调用')
  return captured
}

// ---------- wxml 解析 ----------
function stripComments(src) {
  return src.replace(/<!--[\s\S]*?-->/g, '')
}

function checkTags(src, rel) {
  const s = stripComments(src)
  const stack = []
  const re = /<(\/?)([a-zA-Z][\w-]*)((?:"[^"]*"|'[^']*'|[^>"'])*?)(\/?)>/g
  let m
  let count = 0
  let lastEnd = 0
  while ((m = re.exec(s))) {
    count++
    lastEnd = re.lastIndex
    const closing = m[1] === '/'
    const tag = m[2]
    const selfClose = m[4] === '/'
    if (closing) {
      const top = stack.pop()
      if (top !== tag) {
        fail(rel + ': 标签不配平 —— 期望 </' + (top || '(空)') + '>，实际 </' + tag + '>')
        return
      }
    } else if (!selfClose) {
      stack.push(tag)
    }
  }
  if (stack.length) {
    fail(rel + ': 以下标签未闭合 ' + JSON.stringify(stack))
    return
  }
  if (count === 0) fail(rel + ': 未解析到任何标签')
  else ok(rel + ': ' + count + ' 个标签全部配平（含 picker/image/block）')
  if (lastEnd > s.length) fail(rel + ': 解析越界')
}

const GLOBALS = ['true', 'false', 'null', 'undefined', 'NaN']

function checkBindings(src, rel, page) {
  const s = stripComments(src)
  // {{}} 引用的根字段
  const fields = new Set()
  const exprRe = /\{\{([\s\S]*?)\}\}/g
  let m
  while ((m = exprRe.exec(s))) {
    const expr = m[1].replace(/'(?:[^'\\]|\\.)*'/g, "''").replace(/"(?:[^"\\]|\\.)*"/g, '""')
    const noProps = expr.replace(/\.\s*[A-Za-z_$][\w$]*/g, '')          // 去掉 .xxx 属性访问
    const ids = noProps.match(/[A-Za-z_$][\w$]*/g) || []
    ids.forEach((id) => fields.add(id))
  }
  const dataKeys = Object.keys(page.data || {})
  const locals = ['item', 'index']                                        // wx:for 默认别名
  const missing = [...fields].filter(
    (f) => dataKeys.indexOf(f) < 0 && locals.indexOf(f) < 0 && GLOBALS.indexOf(f) < 0
  )
  if (missing.length) fail(rel + ': {{}} 引用了 data 中不存在的字段 ' + JSON.stringify(missing))
  else ok(rel + ': ' + fields.size + ' 个 {{}} 根字段全部存在于 data（' + dataKeys.length + ' 个字段）')

  // bind*/catch* 事件方法
  const handlers = new Set()
  const bindRe = /\b(?:bind|catch|capture-bind|capture-catch)[:a-zA-Z]*\s*=\s*"([^"{}]+)"/g
  while ((m = bindRe.exec(s))) handlers.add(m[1].trim())
  const methods = Object.keys(page).filter((k) => typeof page[k] === 'function')
  const missH = [...handlers].filter((h) => methods.indexOf(h) < 0)
  if (missH.length) fail(rel + ': 事件方法在 js 中不存在 ' + JSON.stringify(missH))
  else ok(rel + ': ' + handlers.size + ' 个事件方法全部存在（' + [...handlers].join(', ') + '）')
}

function checkWxss(rel) {
  const src = fs.readFileSync(path.join(root, rel), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
  const open = (src.match(/\{/g) || []).length
  const close = (src.match(/\}/g) || []).length
  if (open !== close) fail(rel + ': 花括号不配平 { ' + open + ' } ' + close)
  else ok(rel + ': 花括号配平（' + open + ' 组）')
  const px = src.match(/[\d.]+px/g)
  if (px) fail(rel + ': 出现非 rpx 尺寸 ' + JSON.stringify(px))
  else ok(rel + ': 尺寸全部使用 rpx')
}

// ---------- 硬性约束 ----------
function checkConstraints(rel) {
  const js = fs.readFileSync(path.join(root, rel), 'utf8')
  if (/wx\.getSystemInfoSync/.test(js)) fail(rel + ': 使用了 wx.getSystemInfoSync')
  else ok(rel + ': 未使用 wx.getSystemInfoSync')
  const db = js.match(/wx\.cloud\.(database|callFunction|deleteFile|getTempFileURL)/g)
  if (db) fail(rel + ': 出现禁止的云 API ' + JSON.stringify(db))
  else ok(rel + ': 未直接调用 database/callFunction/deleteFile/getTempFileURL')
  const uploads = js.match(/wx\.cloud\.uploadFile/g) || []
  ok(rel + ': wx.cloud.uploadFile 出现 ' + uploads.length + ' 次（仅上传流程）')
}

function checkImageSrc(rel) {
  const wxml = stripComments(fs.readFileSync(path.join(root, rel), 'utf8'))
  const imgs = wxml.match(/<image\b[^>]*>/g) || []
  const badSrc = imgs.filter((t) => !/src="\{\{[^}]+\}\}"/.test(t))
  if (badSrc.length) fail(rel + ': <image> 的 src 不是数据绑定 ' + JSON.stringify(badSrc))
  else ok(rel + ': ' + imgs.length + ' 个 <image> 的 src 均为绑定值（无本地/网络图片）')
}

// ---------- 执行 ----------
console.log('== menu-admin ==')
const page = loadPage('pages/menu-admin/menu-admin.js')
const dataKeys = Object.keys(page.data)
const methods = Object.keys(page).filter((k) => typeof page[k] === 'function')
console.log('  data 字段: ' + dataKeys.join(', '))
console.log('  方法: ' + methods.join(', '))

const REQUIRED_DATA = ['statusBarHeight', 'today', 'date', 'meal', 'meals', 'cloudReady', 'cloudError',
  'checked', 'isAdmin', 'openid', 'list', 'current', 'uploading', 'done', 'total']
const REQUIRED_METHODS = ['onLoad', 'onShow', 'onDateChange', 'onMealTap', 'onChoose', 'onDelete', 'loadList', 'goBack']
const missD = REQUIRED_DATA.filter((k) => dataKeys.indexOf(k) < 0)
const missM = REQUIRED_METHODS.filter((k) => methods.indexOf(k) < 0)
if (missD.length) fail('菜单端缺少规定 data 字段 ' + JSON.stringify(missD)); else ok('规定 data 字段齐备')
if (missM.length) fail('菜单端缺少规定方法 ' + JSON.stringify(missM)); else ok('规定方法齐备')

checkTags(fs.readFileSync(path.join(root, 'pages/menu-admin/menu-admin.wxml'), 'utf8'), 'menu-admin.wxml')
checkBindings(fs.readFileSync(path.join(root, 'pages/menu-admin/menu-admin.wxml'), 'utf8'), 'menu-admin.wxml', page)
checkWxss('pages/menu-admin/menu-admin.wxss')
checkConstraints('pages/menu-admin/menu-admin.js')
checkImageSrc('pages/menu-admin/menu-admin.wxml')

// 非管理员分支不得出现上传/删除 UI
const wxml = fs.readFileSync(path.join(root, 'pages/menu-admin/menu-admin.wxml'), 'utf8')
const idxElse = wxml.indexOf('<block wx:else>')
const head = idxElse > -1 ? wxml.slice(0, idxElse) : ''
if (/onChoose|onDelete|picker |<picker/.test(head)) fail('非管理员分支内出现上传/删除 UI 或 picker')
else ok('非管理员 / 未就绪 / 校验中分支内没有 picker、onChoose、onDelete')

console.log('== mine ==')
const mine = loadPage('pages/mine/mine.js')
const mineMethods = Object.keys(mine).filter((k) => typeof mine[k] === 'function')
if (mine.data.isAdmin === false) ok('mine.data.isAdmin = false 已添加')
else fail('mine.data.isAdmin 缺失')
if (mineMethods.indexOf('onAdminTap') > -1) ok('mine.onAdminTap 存在')
else fail('mine.onAdminTap 缺失')
if (mine.data.noticeOn === true && mine.data.version === 'v1.0.0' && mine.data.tools === undefined) ok('mine 原有 data 字段未被破坏（「常用功能」那排假入口已按需求删掉）')
else fail('mine 原有 data 字段被破坏')
checkTags(fs.readFileSync(path.join(root, 'pages/mine/mine.wxml'), 'utf8'), 'mine.wxml')
checkBindings(fs.readFileSync(path.join(root, 'pages/mine/mine.wxml'), 'utf8'), 'mine.wxml', mine)
if (fs.readFileSync(path.join(root, 'pages/mine/mine.wxml'), 'utf8').indexOf('常用功能') === -1) ok('mine.wxml 里「常用功能」整块已删掉（只留班级相册）')
else fail('mine.wxml 里还留着「常用功能」')

console.log('')
console.log(bad === 0 ? 'ALL CHECKS PASSED' : bad + ' CHECK(S) FAILED')
process.exit(bad === 0 ? 0 : 1)