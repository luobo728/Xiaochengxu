// smoke_notice.js —— 「通知公告（含定向推送）」自检
// 跑法：node tools/smoke_notice.js
// 覆盖：数据层（增删改置顶 / 恢复演示 / 推送范围）+ 发布页 notice-admin + 首页 index + 详情页 notice + wxml 接线
const fs = require('fs')
const path = require('path')

const root = path.resolve(__dirname, '..')

/* ---------------- wx 模拟 ---------------- */
const store = {}
const toasts = []
const navBacks = []
const navTos = []
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
  // 弹窗一律点「确定」（删除 / 恢复演示都要走确认）
  showModal: function (o) {
    if (o && o.success) o.success({ confirm: true, cancel: false })
  },
  navigateTo: function (o) {
    navTos.push((o && o.url) || '')
  },
  navigateBack: function () {
    navBacks.push(1)
  },
  switchTab: function () {},
  reLaunch: function () {},
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

const notice = require(path.join(root, 'utils/notice.js'))
const children = require(path.join(root, 'utils/children.js'))
const role = require(path.join(root, 'utils/demo-role.js'))
const KEY_DEMO = 'demo_account_v1'
const KEY_LIST = 'notice_list_v1'
const KEY_KIDS = 'children_v1'
const KEY_SEEDED = 'children_seeded_v1'

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
// 切演示账号（'' = 没切，按真机那套走）
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
// 取一条通知（没有就回空对象）—— 源码被改坏时也要给出 ❌，而不是抛异常中断整轮自检
function rowOf(id) {
  return notice.getById(id) || {}
}
function titles(rows) {
  return (rows || []).map(function (r) {
    return r.title
  })
}
// 把列表还原成干净的 5 条演示通知（各段之间互不影响）
function resetDemo() {
  return notice.resetDemo()
}

async function main() {
  /* ================= A. 数据层：演示数据 + 增删改置顶 ================= */
  const all = notice.listSync()
  check('A1 第一次读自动写入 5 条演示通知', all.length === 5, all.length)
  check('A2 演示通知的编号就是 n1~n5', all
    .map(function (r) {
      return r.id
    })
    .sort()
    .join(',') === 'n1,n2,n3,n4,n5')
  check('A3 第 5 条（n5）定向推给「大一班」', (function () {
    const r = findRow(all, 'n5')
    return !!r && r.to === '大一班' && notice.rangeText(r) === '仅 大一班'
  })(), findRow(all, 'n5') && findRow(all, 'n5').to)
  check('A4 另外 4 条都是「全园」', ['n1', 'n2', 'n3', 'n4'].every(function (id) {
    return (findRow(all, id) || {}).to === '全园'
  }))
  check('A5 置顶的那条排在列表最前面', all[0].id === 'n3' && all[0].top === true, all[0].id)
  check('A6 每条都带范围文案和配色（页面直接用）', all.every(function (r) {
    return notice.rangeText(r).length > 0 && notice.rangeTone(r).indexOf('tag-') === 0
  }), notice.rangeText(all[0]) + '/' + notice.rangeTone(all[0]))

  await tick(5)
  const added = await notice.save({ title: '冒烟测试 · 新通知', tag: '提示', to: '大班', body: '正文一\n正文二' })
  check('A7 新增一条：返回 ok，并带上推送范围', added.ok === true && added.item.to === '大班', added.item && added.item.to)
  const addedRow = findRow(notice.listSync(), added.item.id)
  check('A8 新增真的落盘了（重新读一遍能找到）', !!addedRow && addedRow.title === '冒烟测试 · 新通知' && addedRow.body === '正文一\n正文二' && /^\d{2}-\d{2}$/.test(addedRow.time), addedRow && addedRow.time)

  await tick(5)
  const noTo = await notice.save({ title: '冒烟测试 · 不传范围' })
  check('A9 新增时不传范围 → 默认「全园」', noTo.ok === true && noTo.item.to === '全园', noTo.item && noTo.item.to)

  const renamed = await notice.save({ id: 'n1', title: '冒烟测试 · 改过的标题', to: '全园', body: '改过的正文' })
  check('A10 修改一条：标题 / 正文都改得动', renamed.ok === true && notice.getById('n1').title === '冒烟测试 · 改过的标题' && notice.getById('n1').body === '改过的正文', notice.getById('n1').title)

  await notice.save({ id: 'n5', title: '冒烟测试 · 改 n5 但没带范围', body: '只改正文' })
  check('A11 改通知不带范围 → 沿用原来的「大一班」（不会悄悄变全园）', rowOf('n5').to === '大一班', rowOf('n5').to)
  await notice.save({ id: 'n5', title: '冒烟测试 · 改 n5 的范围', to: '中班', body: '改成中班' })
  check('A12 改通知带了范围 → 就按新范围存', rowOf('n5').to === '中班', rowOf('n5').to)
  await notice.save({ id: 'n5', title: '大一班周五户外写生：请给孩子带画本和彩色笔', to: '大一班', body: '恢复成演示数据里的那条' })

  await tick(5)
  const weird = await notice.save({ title: '冒烟测试 · 乱写范围', to: '火星班' })
  check('A13 范围乱写 → 一律按「全园」存（不让通知凭空消失）', weird.ok === true && weird.item.to === '全园', weird.item && weird.item.to)

  const noTitle = await notice.save({ title: '   ' })
  check('A14 标题空着不让存', noTitle.ok === false && noTitle.msg.indexOf('请先填写标题') > -1, noTitle.msg)
  const longTitle = await notice.save({ title: '标'.repeat(notice.MAX_TITLE + 1) })
  check('A15 标题超长不让存', longTitle.ok === false && longTitle.msg.indexOf('标题最多') > -1, longTitle.msg)
  const longBody = await notice.save({ title: '冒烟测试 · 正文超长', body: '字'.repeat(notice.MAX_BODY + 1) })
  check('A16 正文超长不让存', longBody.ok === false && longBody.msg.indexOf('正文最多') > -1, longBody.msg)

  const removed = await notice.remove(added.item.id)
  check('A17 删除一条：返回 ok，列表里真的没了', removed.ok === true && findRow(notice.listSync(), added.item.id) === null)
  const removed2 = await notice.remove('n-这条不存在')
  check('A18 删一条不存在的：给明确提示', removed2.ok === false && removed2.msg.indexOf('这条通知已经不在了') > -1, removed2.msg)

  await notice.toggleTop('n1')
  check('A19 置顶：这条立刻排到最前面', rowOf('n1').top === true && notice.listSync()[0].id === 'n1', notice.listSync()[0].id)
  await notice.toggleTop('n1')
  check('A20 再点一次取消置顶', rowOf('n1').top === false && notice.listSync()[0].id !== 'n1', notice.listSync()[0].id)

  await resetDemo()
  check('A21 恢复演示通知：又是 5 条', notice.listSync().length === 5, notice.listSync().length)
  check('A22 恢复后第 5 条仍然定向「大一班」', (findRow(notice.listSync(), 'n5') || {}).to === '大一班', (findRow(notice.listSync(), 'n5') || {}).to)

  store[KEY_LIST] = [{ id: 'old1', title: '老数据：没有范围字段', tag: '通知', time: '04-01', body: '升级前存下的通知', top: false }]
  const oldRow = notice.listSync()[0]
  check('A23 老数据没有 to 字段 → 读出来按「全园」', oldRow.to === '全园' && notice.targetOf(oldRow) === '全园' && notice.rangeText(oldRow) === '全园', oldRow.to)
  await resetDemo()

  check('A24 pickTarget：认不出的值一律当「全园」', notice.pickTarget('火星班') === '全园' && notice.pickTarget('') === '全园' && notice.pickTarget(undefined) === '全园' && notice.pickTarget('  ') === '全园')
  check('A25 pickTarget：合法班级原样返回（前后空格也算）', notice.pickTarget('学前班') === '学前班' && notice.pickTarget(' 中班 ') === '中班', notice.pickTarget(' 中班 '))
  check('A26 TARGETS = [全园] + 孩子档案里的班级（不各写一份）', notice.TARGETS[0] === '全园' && notice.TARGETS.join(',') === ['全园'].concat(children.CLASSES).join(','), notice.TARGETS.join(','))
  check('A27 targetOf：没有 to 的按全园，有的按原样', notice.targetOf({}) === '全园' && notice.targetOf({ to: '学前班' }) === '学前班')
  check('A28 targetIndex：合法班级能对上下标（大一班 = 4，前后带空格也算）', notice.targetIndex('大一班') === 4 && notice.targetIndex(' 中班 ') === 2 && notice.TARGETS[4] === '大一班', notice.targetIndex('大一班'))
  check('A29 targetIndex：认不出的回 0（胶囊里选中「全园」）', notice.targetIndex('火星班') === 0 && notice.targetIndex('') === 0 && notice.targetIndex(undefined) === 0)
  check('A30 rangeText：全园就写「全园」', notice.rangeText({ to: '全园' }) === '全园' && notice.rangeText({}) === '全园')
  check('A31 rangeText：定向写「仅 大一班」', notice.rangeText({ to: '大一班' }) === '仅 大一班', notice.rangeText({ to: '大一班' }))
  check('A32 rangeTone：全园用灰的、定向用蓝的', notice.rangeTone({ to: '全园' }) === 'tag-gray' && notice.rangeTone({ to: '大班' }) === 'tag-blue')

  /* ================= B. 定向推送：谁看得到哪条 ================= */
  setDemo('parent')
  check('B1 切到演示家长端（乐乐妈妈）', role.isParent() === true)
  check('B2 viewClass 取的是自己孩子档案里的班级（大一班）', notice.viewClass() === '大一班', notice.viewClass())
  check('B3 全园通知：家长看得到', notice.canSee({ to: '全园' }) === true)
  check('B4 定向给自己班的通知：家长看得到', notice.canSee({ to: '大一班' }) === true)
  check('B5 定向给别班的通知：家长看不到', notice.canSee({ to: '大班' }) === false)

  setDemo('teacher')
  check('B6 老师端不筛（班级为空）：什么通知都看得到', notice.viewClass() === '' && notice.canSee({ to: '大班' }) === true, notice.viewClass())
  setDemo('')
  check('B7 没切演示账号的真机也不筛', notice.viewClass() === '' && notice.canSee({ to: '中班' }) === true)

  setDemo('parent')
  const kidsBak = store[KEY_KIDS]
  store[KEY_KIDS] = []
  check('B8 孩子档案被删 → 当没有班级，照样不筛（老师自己不会看不到）', notice.viewClass() === '' && notice.canSee({ to: '中班' }) === true, notice.viewClass())
  if (kidsBak === undefined) delete store[KEY_KIDS]
  else store[KEY_KIDS] = kidsBak
  if (store[KEY_SEEDED] === undefined) children.list()

  const mixRows = [
    { id: 'm1', title: '给全园的', to: '全园' },
    { id: 'm2', title: '给大班的', to: '大班' },
    { id: 'm3', title: '给大一班的', to: '大一班' },
    { id: 'm4', title: '给学前班的', to: '学前班' }
  ]
  const visible = notice.filterVisible(mixRows)
  check('B9 filterVisible：只留自己看得到的那几条', visible.length === 2 && visible[0].id === 'm1' && visible[1].id === 'm3', titles(visible))
  const syncVisible = notice.listVisibleSync()
  check('B10 listVisibleSync = filterVisible(listSync())（首页第一屏用它）', syncVisible.length === notice.filterVisible(notice.listSync()).length && syncVisible.length === 5, syncVisible.length)
  const asyncVisible = await notice.listVisible()
  check('B11 listVisible（异步版）也筛过，和同步版一致', asyncVisible.length === syncVisible.length, asyncVisible.length)

  /* ================= C. 发布页 notice-admin ================= */
  setDemo('teacher')
  await resetDemo()
  const adminPage = loadPage('pages/notice-admin/notice-admin.js')
  check('C1 页面推送范围清单来自数据层（不各写一份）', adminPage.data.targets.join(',') === notice.TARGETS.join(',') && adminPage.data.targets.length === 6)
  check('C2 默认选中的是「全园」', adminPage.data.targetIndex === 0 && adminPage.data.targets[0] === '全园', adminPage.data.targetIndex)

  const ctx = ctxOf(adminPage)
  ctx.checkAdmin.call(ctx)
  await tick(20)
  check('C3 老师端（超级管理员）能进，进页面就把 5 条演示通知列出来', ctx.data.isAdmin === true && ctx.data.rows.length === 5, ctx.data.rows.length)

  ctx.onTargetTap({ currentTarget: { dataset: { index: 3 } } })
  check('C4 点范围胶囊就选中它（大班）', ctx.data.targetIndex === 3 && ctx.data.targets[3] === '大班', ctx.data.targets[ctx.data.targetIndex])

  ctx.onRowTap({ currentTarget: { dataset: { id: 'n5' } } })
  check('C5 点已有通知 → 表单填上它，范围也跟着变成「大一班」', ctx.data.editId === 'n5' && ctx.data.targetIndex === 4 && ctx.data.title === (findRow(notice.listSync(), 'n5') || {}).title, ctx.data.targets[ctx.data.targetIndex])

  ctx.onNewTap()
  check('C6 点「写一条新通知」→ 表单清空，范围回到「全园」', ctx.data.editId === '' && ctx.data.targetIndex === 0 && ctx.data.title === '', ctx.data.targetIndex)

  const n5Row = findRow(ctx.data.rows, 'n5') || {}
  const n1Row = findRow(ctx.data.rows, 'n1') || {}
  check('C7 列表每条都带范围标签（n5 = 仅 大一班 / 蓝）', n5Row.rangeText === '仅 大一班' && n5Row.rangeTone === 'tag-blue', n5Row.rangeText + '/' + n5Row.rangeTone)
  check('C8 全园那条的标签是灰的', n1Row.rangeText === '全园' && n1Row.rangeTone === 'tag-gray', n1Row.rangeText + '/' + n1Row.rangeTone)

  ctx.onTargetTap({ currentTarget: { dataset: { index: 3 } } })
  ctx.onTitleInput({ detail: { value: '冒烟测试 · 页面发布给大班' } })
  ctx.onBodyInput({ detail: { value: '只有大班家长看得到' } })
  toasts.length = 0
  ctx.onSave()
  await tick(20)
  check('C9 选「大班」发布 → 提示写明范围', toasts.indexOf('已发布：仅大班家长可见') > -1, toasts)
  const pubRow = notice.listSync().filter(function (r) {
    return r.title === '冒烟测试 · 页面发布给大班'
  })[0]
  check('C10 发布落盘的就是「大班」（页面选的胶囊真的传下去了）', !!pubRow && pubRow.to === '大班', pubRow && pubRow.to)

  ctx.onNewTap()
  ctx.onTitleInput({ detail: { value: '冒烟测试 · 页面发布给全园' } })
  toasts.length = 0
  ctx.onSave()
  await tick(20)
  check('C11 选「全园」发布 → 提示全园家长可见', toasts.indexOf('已发布：全园家长可见') > -1, toasts)

  ctx.onRowTap({ currentTarget: { dataset: { id: 'n5' } } })
  ctx.onTitleInput({ detail: { value: '冒烟测试 · 从页面改的 n5' } })
  toasts.length = 0
  ctx.onSave()
  await tick(20)
  check('C12 编辑已有通知保存 → 提示「已保存修改」', toasts.indexOf('已保存修改') > -1, toasts)
  check('C13 编辑保存后范围没变（还是大一班）', rowOf('n5').to === '大一班' && rowOf('n5').title === '冒烟测试 · 从页面改的 n5', rowOf('n5').to)

  ctx.onNewTap()
  ctx.onTitleInput({ detail: { value: '   ' } })
  toasts.length = 0
  ctx.onSave()
  await tick(20)
  check('C14 标题空着保存 → 页面拦住并提示', toasts.indexOf('请先写标题') > -1, toasts)

  ctx.onNewTap()
  ctx.onTitleInput({ detail: { value: '冒烟测试 · 页面置顶的一条' } })
  ctx.onTopChange({ detail: { value: true } })
  const topOnForm = ctx.data.top === true
  toasts.length = 0
  ctx.onSave()
  await tick(20)
  const topRow = notice.listSync().filter(function (r) {
    return r.title === '冒烟测试 · 页面置顶的一条'
  })[0]
  check('C15 置顶开关同步进表单，保存后落盘', topOnForm && !!topRow && topRow.top === true, topRow && topRow.top)

  // 上面那条没存进去（源码被改坏时）就用一个不存在的 id：删除照样会给出 ❌，不会抛异常
  const topId = (topRow && topRow.id) || 'n-没有这条'
  toasts.length = 0
  ctx.onDelTap({ currentTarget: { dataset: { id: topId } } })
  await tick(20)
  check('C16 删除：确认后提示「已删除」，列表里也没了', toasts.indexOf('已删除') > -1 && notice.getById(topId) === null, toasts)

  toasts.length = 0
  ctx.onReset()
  await tick(20)
  check('C17 恢复演示通知：提示 + 又回到 5 条', toasts.indexOf('已恢复演示通知') > -1 && notice.listSync().length === 5, toasts)

  setDemo('parent')
  const pctx = ctxOf(adminPage)
  pctx.checkAdmin.call(pctx)
  await tick(10)
  check('C18 家长端进不去：只给锁卡片，列表一条都不画', pctx.data.isAdmin === false && pctx.data.demoLock === role.PARENT_TIP && pctx.data.rows.length === 0, pctx.data.demoLock)

  setDemo('staff')
  const sctx = ctxOf(adminPage)
  sctx.checkAdmin.call(sctx)
  await tick(10)
  check('C19 普通老师（陈老师）也不是管理员：给「请超级管理员设置」那句', sctx.data.isAdmin === false && sctx.data.demoLock === role.MEMBER_TIP, sctx.data.demoLock)

  setDemo('')
  const nctx = ctxOf(adminPage)
  navBacks.length = 0
  nctx.goBack()
  check('C20 返回按钮走的是统一返回逻辑（有上一页就返回）', navBacks.length === 1)

  /* ================= D. 首页 index：画的是筛过的那份 ================= */
  await resetDemo()
  setDemo('parent')
  await tick(5)
  const bigOnly = await notice.save({ title: '冒烟测试 · 只推给大班', tag: '通知', to: '大班', body: '别班看不到' })
  const indexPage = loadPage('pages/index/index.js')
  const ictx = ctxOf(indexPage)
  ictx.onLoad()
  check('D1 首次画（listVisibleSync）出来的就是筛过的那份：别班通知不在', ictx.data.notices.length > 0 && titles(ictx.data.notices).indexOf('冒烟测试 · 只推给大班') === -1, titles(ictx.data.notices))
  check('D2 首页列表最多 3 条', ictx.data.notices.length <= 3, ictx.data.notices.length)
  check('D3 跑马灯文案也只含筛过的（别班通知的标题不在里面）', ictx.data.marqueeText.length > 0 && ictx.data.marqueeText.indexOf('只推给大班') === -1)
  await tick(20)
  check('D4 刷新（listVisible）之后还是筛过的', titles(ictx.data.notices).indexOf('冒烟测试 · 只推给大班') === -1 && ictx.data.notices.length > 0, titles(ictx.data.notices))

  setDemo('teacher')
  const tctx = ctxOf(indexPage)
  tctx.onLoad()
  await tick(20)
  check('D5 老师端首页看得到全部（含那条只推给大班的）', titles(tctx.data.notices).indexOf('冒烟测试 · 只推给大班') > -1, titles(tctx.data.notices))

  /* ================= E. 详情页 notice：看不见 / 看得到 ================= */
  setDemo('parent')
  const noticePage = loadPage('pages/notice/notice.js')
  const dctx = ctxOf(noticePage)
  dctx.onLoad({ id: bigOnly.item.id })
  await tick(20)
  check('E1 别班通知：详情页挡住，提示写明推给谁', dctx.data.found === false && dctx.data.emptyText === '这条通知只推送给「大班」的家长', dctx.data.emptyText)
  check('E2 挡住时不画正文段落', dctx.data.paragraphs.length === 0)

  const ectx = ctxOf(noticePage)
  ectx.onLoad({ id: 'n5' })
  await tick(20)
  check('E3 定向给自己的通知看得到，并挂上范围标签', ectx.data.found === true && ectx.data.rangeText === '仅 大一班' && ectx.data.rangeTone === 'tag-blue', ectx.data.rangeText)
  check('E4 标题 / 时间 / 置顶都来自数据层', ectx.data.title === (findRow(notice.listSync(), 'n5') || {}).title && ectx.data.time === (findRow(notice.listSync(), 'n5') || {}).time && ectx.data.top === false, ectx.data.time)

  const gctx = ctxOf(noticePage)
  gctx.onLoad({ id: 'n1' })
  await tick(20)
  check('E5 全园通知不挂范围标签（rangeText 为空）', gctx.data.found === true && gctx.data.rangeText === '', gctx.data.rangeText)

  await tick(5)
  const para = await notice.save({ title: '冒烟测试 · 分段的正文', to: '大一班', body: '第一段\n\n第二段\n  ' })
  const pctx2 = ctxOf(noticePage)
  pctx2.onLoad({ id: para.item.id })
  await tick(20)
  check('E6 正文按换行拆成段落，空行不显示', pctx2.data.paragraphs.join('|') === '第一段|第二段', pctx2.data.paragraphs)

  const mctx = ctxOf(noticePage)
  mctx.onLoad({ id: 'n-这条已经被删了' })
  await tick(20)
  check('E7 被删的通知：提示「这条通知已被删除」', mctx.data.found === false && mctx.data.emptyText === '这条通知已被删除', mctx.data.emptyText)

  check('E8 家长端详情页不出现「编辑这条通知」', dctx.data.isAdmin === false, dctx.data.isAdmin)

  setDemo('teacher')
  const actx = ctxOf(noticePage)
  actx.onLoad({ id: 'n1' })
  await tick(20)
  check('E9 管理员在详情页多一个编辑入口', actx.data.isAdmin === true)
  navTos.length = 0
  actx.toEdit()
  check('E10 点编辑跳到管理页并带上这条的 id', navTos.length === 1 && navTos[0] === '/pages/notice-admin/notice-admin?id=n1', navTos)

  /* ================= F. wxml 接线（源码级） ================= */
  const adminWxml = fs.readFileSync(path.join(root, 'pages/notice-admin/notice-admin.wxml'), 'utf8')
  const detailWxml = fs.readFileSync(path.join(root, 'pages/notice/notice.wxml'), 'utf8')
  const indexWxml = fs.readFileSync(path.join(root, 'pages/index/index.wxml'), 'utf8')
  check('F1 推送范围胶囊绑在 onTargetTap 上', adminWxml.indexOf('bindtap="onTargetTap"') > -1)
  check('F2 胶囊画的是 targets，选中态看 targetIndex', adminWxml.indexOf('wx:for="{{targets}}"') > -1 && adminWxml.indexOf("targetIndex === index ? 'on' : ''") > -1)
  check('F3 管理页列表画出范围文案和配色', adminWxml.indexOf('{{item.rangeText}}') > -1 && adminWxml.indexOf('{{item.rangeTone}}') > -1)
  check('F4 详情页范围标签按 rangeText 显示（全园时不挂）', detailWxml.indexOf('wx:if="{{rangeText}}"') > -1 && detailWxml.indexOf('{{rangeText}}') > -1)
  check('F5 首页那条通知点了跳详情页（带上 id）', indexWxml.indexOf('bindtap="onNoticeTap"') > -1 && indexWxml.indexOf('data-id="{{item.id}}"') > -1)

  console.log(bad ? '\n❌ 失败 ' + bad + ' 项' : '\n✅ 通知公告（含定向推送）冒烟测试全部通过')
  process.exit(bad ? 1 : 0)
}

main().catch(function (e) {
  console.log('❌ 抛异常：' + (e && e.stack ? e.stack : e))
  process.exit(1)
})
