// tools/smoke_account.js —— 演示账号 / 权限隔离（一票否决）/ 管理员花名册 自检
// 跑法：node tools/smoke_account.js
//
// 盯的是「权限只有一份判断」这件事：
//   ① 四个演示账号（李老师=超级管理员、王老师=管理员、陈老师=普通老师、乐乐妈妈=家长）；
//   ② 家长端一票否决 —— 云端白名单 / whoami 缓存 / 本机体验管理员 / 云端 init 四个来源全作废；
//   ③ 花名册只有超级管理员能改，超级管理员固定是、家长端固定不是。
const fs = require('fs')
const path = require('path')
const root = path.resolve(__dirname, '..')

const store = {}
const toasts = []
const navBacks = []
const modals = []
global.wx = {
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
    modals.push((o && o.title) || '')
    if (o && o.success) o.success({ confirm: true, cancel: false })
  },
  showActionSheet: function (o) {
    if (o && o.fail) o.fail({ errMsg: 'cancel' })
  },
  navigateTo: function () {},
  navigateBack: function () {
    navBacks.push(1)
  },
  pageScrollTo: function () {},
  setNavigationBarTitle: function () {},
  hideKeyboard: function () {}
}
global.getApp = function () {
  return { globalData: { statusBarHeight: 47 } }
}
global.getCurrentPages = function () {
  return [{}, {}]
}
let captured = null
global.Page = function (o) {
  captured = o
}

const role = require(path.join(root, 'utils/demo-role.js'))
const account = require(path.join(root, 'utils/account.js'))
const admins = require(path.join(root, 'utils/admins.js'))
const notice = require(path.join(root, 'utils/notice.js'))

const KEY_DEMO = role.KEY_CURRENT
const KEY_MEMBERS = role.KEY_MEMBERS
const KEY_LOCAL_ADMIN = 'notice_local_admin_v1'
const KEY_WHOAMI = 'menu_whoami_v1'

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

async function main() {
  /* ================= A. 四个演示账号 ================= */
  const all = account.list()
  check('A1 演示账号一共四个', all.length === 4, all.map(function (a) {
    return a.id
  }))
  check('A2 四个账号的 id / 名字 / 端别都对', (function () {
    const want = { teacher: '李老师', admin: '王老师', staff: '陈老师', parent: '乐乐妈妈' }
    for (let i = 0; i < all.length; i++) {
      if (want[all[i].id] !== all[i].name) return false
      if (all[i].side !== '老师端' && all[i].side !== '家长端') return false
    }
    return true
  })(), all.map(function (a) {
    return a.side + '·' + a.name
  }))
  check('A3 家长端只有乐乐妈妈一个', all.filter(function (a) {
    return a.side === '家长端'
  }).length === 1)
  check('A4 老师端三个账号', all.filter(function (a) {
    return a.side === '老师端'
  }).length === 3)
  check('A5 没切演示账号时 current() 是空', account.current() === null, account.current())
  setDemo('teacher')
  check('A6 切到李老师：current() 给出这个账号（带身份名）', account.current() && account.current().id === 'teacher' && account.current().title === '超级管理员', account.current())
  check('A7 身份名和档位对得上（家长端的 title 是空的，身份看 role）', account.get('admin').title === '管理员' && account.get('staff').title === '普通老师' && account.get('parent').title === '' && account.get('parent').role === '家长')
  check('A8 identityText() 是「端别 · 名字（身份）」', account.identityText() === '老师端 · 李老师（超级管理员）', account.identityText())
  check('A9 切换不认识的账号会被拒', account.switchTo('火星老师').ok === false && account.switchTo('火星老师').msg.indexOf('没有这个演示账号') > -1)
  check('A10 切过去之后 storage 里记的是这个 id', account.switchTo('staff').ok === true && store[KEY_DEMO] === 'staff')
  account.clear()
  check('A11 clear() 之后回到「不是演示账号」', account.current() === null && store[KEY_DEMO] === undefined)
  check('A12 给出去的账号对象是拷贝（外面改不到里面）', (function () {
    const a = account.get('admin')
    a.name = '改坏了'
    return account.get('admin').name === '王老师'
  })())

  /* ================= B. 身份档位与权限 ================= */
  setDemo('teacher')
  check('B1 李老师 = 超级管理员档位', role.level() === 'super' && role.isSuper() === true && role.isTeacher() === true)
  setDemo('admin')
  check('B2 王老师 = 管理员档位', role.level() === 'admin' && role.isAdmin() === true && role.isSuper() === false)
  setDemo('staff')
  check('B3 陈老师 = 老师但不是管理员', role.level() === 'none' && role.isAdmin() === false && role.canManage() === false)
  setDemo('parent')
  check('B4 乐乐妈妈 = 家长档位', role.level() === 'parent' && role.isParent() === true && role.isDemo() === true)
  setDemo('')
  check('B5 没切演示账号时档位是空（照旧走云端那套）', role.level() === '' && role.isDemo() === false && role.isActive() === false)
  check('B6 能不能管内容（通知 / 食谱 / 相册）：只有超级管理员和管理员', (function () {
    setDemo('teacher')
    const t = role.canManage()
    setDemo('admin')
    const a = role.canManage()
    setDemo('staff')
    const s = role.canManage()
    setDemo('parent')
    const p = role.canManage()
    setDemo('')
    return t === true && a === true && s === false && p === false
  })())
  check('B7 相册：老师三人组都能上传照片，家长端不能', (function () {
    setDemo('teacher')
    const t = role.canUploadAlbum()
    setDemo('admin')
    const a = role.canUploadAlbum()
    setDemo('staff')
    const s = role.canUploadAlbum()
    setDemo('parent')
    const p = role.canUploadAlbum()
    setDemo('')
    return t && a && s && p === false
  })())
  check('B8 点名 / 课程内容：老师三人组都行，家长端一票否决', (function () {
    setDemo('staff')
    const s = role.canRoll() === true && role.canEditCourse() === true
    setDemo('parent')
    const p = role.canRoll() === false && role.canEditCourse() === false
    setDemo('')
    const n = role.canRoll() === null && role.canEditCourse() === null
    return s && p && n
  })())
  check('B9 改孩子档案：只有管理员和超级管理员', (function () {
    setDemo('teacher')
    const t = role.canEditChildren()
    setDemo('admin')
    const a = role.canEditChildren()
    setDemo('staff')
    const s = role.canEditChildren()
    setDemo('parent')
    const p = role.canEditChildren()
    setDemo('')
    return t === true && a === true && s === false && p === false && role.canEditChildren() === null
  })())

  /* ================= C. 家长端一票否决（四个来源全作废） ================= */
  // ① 云端白名单 + ② whoami 缓存 + ③ 本机体验管理员 + ④ 云端 init，全都摆上，家长端照样不是管理员
  store[KEY_WHOAMI] = { openid: 'openid_parent', isAdmin: true, initialized: true, at: Date.now() }
  store[KEY_LOCAL_ADMIN] = true
  setDemo('parent')
  check('C1 家长端：本机体验管理员标记作废（isLocalAdmin 返回 false）', notice.isLocalAdmin() === false, notice.isLocalAdmin())
  check('C2 家长端：canManage() 依然是 false（云端白名单 / 缓存都不看）', role.canManage() === false)
  const parentStatus = await notice.adminStatus()
  check('C3 家长端：adminStatus 直接给「不是管理员」+ 锁卡片文案', parentStatus.isAdmin === false && parentStatus.source === 'demo' && parentStatus.tip === role.PARENT_TIP, parentStatus)
  check('C4 家长端：lockTip() 给出家长那句话', role.lockTip() === role.PARENT_TIP)
  check('C5 家长端：点名 / 相册 / 课程 / 档案四道门槛全拦', role.rollTip() === role.ROLL_PARENT_TIP && role.albumTip() === role.PARENT_TIP && role.courseTip() === role.COURSE_PARENT_TIP && role.childTip() === role.CHILD_PARENT_TIP)
  check('C6 家长端：管理员设置页也进不去', role.settingsTip() === role.PARENT_TIP)
  // 切到老师端：本机标记同样不再当管理员（只看花名册）
  setDemo('staff')
  check('C7 老师端（陈老师）：本机标记不作数，按花名册算「不是管理员」', notice.isLocalAdmin() === false && role.canManage() === false)
  check('C8 陈老师被拦时的文案是「让超级管理员设置」', role.lockTip() === role.MEMBER_TIP)
  check('C9 陈老师进相册页 / 点名页不被拦（老师本来就能做）', role.albumTip() === '' && role.rollTip() === '')
  check('C10 不是超级管理员进「管理员设置」给的是超级管理员那句', role.settingsTip() === role.SUPER_TIP)
  // 清干净
  delete store[KEY_WHOAMI]
  delete store[KEY_LOCAL_ADMIN]

  /* ================= D. 文案只有一份 ================= */
  setDemo('teacher')
  check('D1 超级管理员长按版本号那句 = 权限已经全开', role.demoShort() === role.OWNER_SHORT, role.demoShort())
  setDemo('admin')
  check('D2 管理员那句 = 名单由超级管理员设置', role.demoShort() === role.ADMIN_SHORT)
  setDemo('staff')
  check('D3 普通老师那句 = 请超级管理员设置', role.demoShort() === role.MEMBER_SHORT)
  setDemo('')
  check('D4 家长端 / 没切账号时 lockTip 为空（页面照旧走云端那套）', role.lockTip() === '' && role.demoShort() === role.MEMBER_SHORT)

  /* ================= E. 花名册（谁能被设置成管理员） ================= */
  check('E1 默认花名册只有王老师', role.readMembers().join(',') === 'admin', role.readMembers())
  check('E2 能被设置成管理员的只有王老师和陈老师', role.MEMBERS.join(',') === 'admin,staff' && role.isMemberId('parent') === false && role.isMemberId('teacher') === false)
  check('E3 超级管理员永远是管理员（取消不了）', role.isMemberOn('teacher') === true)
  check('E4 家长端永远不是管理员（设置不了）', role.isMemberOn('parent') === false)
  check('E5 王老师默认是、陈老师默认不是', role.isMemberOn('admin') === true && role.isMemberOn('staff') === false)
  setDemo('staff')
  check('E6 普通老师改不动花名册（writeMembers 返回 false）', role.writeMembers(['admin', 'staff']) === false && role.readMembers().join(',') === 'admin')
  setDemo('admin')
  check('E7 管理员也改不动（只有超级管理员能改）', role.writeMembers(['staff']) === false && role.readMembers().join(',') === 'admin')
  setDemo('teacher')
  check('E8 超级管理员能改：把陈老师设成管理员', role.writeMembers(['admin', 'staff']) === true && role.readMembers().join(',') === 'admin,staff')
  check('E9 改完立刻生效（陈老师现在能管内容了）', (function () {
    setDemo('staff')
    const ok = role.canManage() === true && role.level() === 'admin'
    setDemo('teacher')
    return ok
  })())
  check('E10 取消王老师的管理员也生效', role.writeMembers(['staff']) === true && (function () {
    setDemo('admin')
    const off = role.canManage() === false && role.level() === 'none'
    setDemo('teacher')
    return off
  })())
  check('E11 花名册里写脏数据会被过滤（只认这两个 id，且不重复）', (function () {
    const ok = role.writeMembers(['admin', 'admin', 'parent', 'teacher', '火星老师'])
    const list = role.readMembers()
    const fixed = ok && list.join(',') === 'admin'
    role.writeMembers(role.DEFAULT_MEMBERS)
    return fixed
  })(), role.readMembers())
  check('E12 花名册存的是 id 数组（storage 口径）', (function () {
    role.writeMembers(['admin', 'staff'])
    const raw = store[KEY_MEMBERS]
    const ok = Array.isArray(raw) && raw.length === 2 && raw[0] === 'admin'
    role.writeMembers(role.DEFAULT_MEMBERS)
    return ok
  })())
  check('E13 花名册读出来是拷贝（外面改不到）', (function () {
    const a = role.readMembers()
    a.push('staff')
    return role.readMembers().length === 1
  })())

  /* ================= F. admins.js（管理员设置页的数据层） ================= */
  role.writeMembers(role.DEFAULT_MEMBERS)
  setDemo('teacher')
  const rows = admins.list()
  check('F1 名单顺序：李老师 → 王老师 → 陈老师 → 乐乐妈妈', rows.map(function (r) {
    return r.id
  }).join(',') === 'teacher,admin,staff,parent', rows.map(function (r) {
    return r.id
  }))
  check('F2 每行写清「能不能改 / 现在是不是管理员 / 身份名」', (function () {
    const m = {}
    for (let i = 0; i < rows.length; i++) m[rows[i].id] = rows[i]
    return m.teacher.editable === false && m.teacher.admin === true &&
      m.admin.editable === true && m.admin.admin === true &&
      m.staff.editable === true && m.staff.admin === false &&
      m.parent.editable === false && m.parent.admin === false
  })())
  check('F3 管理员人数 = 2（李老师 + 王老师）', admins.adminCount() === 2, admins.adminCount())
  check('F4 超级管理员不能把自己取消', admins.setAdmin('teacher', false).ok === false && admins.setAdmin('teacher', false).msg.indexOf('固定的') > -1)
  check('F5 家长端设置不了', admins.setAdmin('parent', true).ok === false && admins.setAdmin('parent', true).msg.indexOf('家长端固定') > -1)
  check('F6 把陈老师设为管理员成功', admins.setAdmin('staff', true).ok === true && admins.adminCount() === 3)
  check('F7 再取消王老师', admins.setAdmin('admin', false).ok === true && admins.adminCount() === 2)
  check('F8 恢复默认名单', admins.reset().ok === true && role.readMembers().join(',') === 'admin')
  setDemo('admin')
  check('F9 不是超级管理员时，改名单 / 恢复默认都被拦', admins.setAdmin('staff', true).ok === false && admins.reset().ok === false)
  check('F10 非超级管理员看到的名单还是完整的（只是改不了）', admins.list().length === 4 && admins.list()[0].id === 'teacher')

  /* ================= G. 页面：管理员设置 ================= */
  const memberPage = loadPage('pages/admin-members/admin-members.js')
  setDemo('teacher')
  const mctx = ctxOf(memberPage)
  mctx.checkAdmin.call(mctx)
  check('G1 超级管理员进得去，看到四行名单', mctx.data.canSet === true && mctx.data.demoLock === '' && mctx.data.rows.length === 4, mctx.data.rows.length)
  check('G2 页面上标出「现在有几个管理员」', mctx.data.count === 2 && mctx.data.summary.indexOf('管理员') > -1, mctx.data.summary)
  toasts.length = 0
  mctx.onToggle({ currentTarget: { dataset: { id: 'staff' } }, detail: { value: true } })
  check('G3 拨陈老师的开关 = 设成管理员', role.isMemberOn('staff') === true, role.readMembers())
  mctx.onReset()
  await tick(10)
  check('G4 点「恢复默认名单」回到王老师一个', role.readMembers().join(',') === 'admin' && toasts.join('|').indexOf('默认') > -1, toasts)
  setDemo('admin')
  const mctx2 = ctxOf(memberPage)
  mctx2.checkAdmin.call(mctx2)
  check('G5 王老师（管理员）进来只看到「只有超级管理员能设置管理员」', mctx2.data.canSet === false && mctx2.data.demoLock === role.SUPER_TIP, mctx2.data.demoLock)
  setDemo('parent')
  const mctx3 = ctxOf(memberPage)
  mctx3.checkAdmin.call(mctx3)
  check('G6 家长端进来是家长那句话', mctx3.data.canSet === false && mctx3.data.demoLock === role.PARENT_TIP)

  /* ================= H. 页面：「我的」页入口可见性 ================= */
  const minePage = loadPage('pages/mine/mine.js')
  function mineFlags(id) {
    setDemo(id)
    const c = ctxOf(minePage)
    c.refreshAdminEntry.call(c)
    return c.data
  }
  const dTeacher = mineFlags('teacher')
  check('H1 李老师：管理入口 + 管理员设置 + 点名 + 课程内容 全都有', dTeacher.isAdmin === true && dTeacher.isSuper === true && dTeacher.canAlbum === true && dTeacher.canRoll === true && dTeacher.canCourse === true)
  const dAdmin = mineFlags('admin')
  check('H2 王老师：管理入口有、管理员设置没有', dAdmin.isAdmin === true && dAdmin.isSuper === false && dAdmin.canRoll === true && dAdmin.canCourse === true)
  const dStaff = mineFlags('staff')
  check('H3 陈老师：管理入口没有，但点名 / 课程内容 / 相册上传都在', dStaff.isAdmin === false && dStaff.isSuper === false && dStaff.canAlbum === true && dStaff.canRoll === true && dStaff.canCourse === true)
  const dParent = mineFlags('parent')
  check('H4 乐乐妈妈：四个入口一个都不给', dParent.isAdmin === false && dParent.isSuper === false && dParent.canAlbum === false && dParent.canRoll === false && dParent.canCourse === false)

  /* ================= I. 页面：管理页在家长端一律进不去 ================= */
  const noticeAdmin = loadPage('pages/notice-admin/notice-admin.js')
  const albumAdmin = loadPage('pages/album-admin/album-admin.js')
  const menuAdmin = loadPage('pages/menu-admin/menu-admin.js')
  setDemo('parent')
  const naP = ctxOf(noticeAdmin)
  naP.checkAdmin.call(naP, '')
  check('I1 通知公告管理：家长端只给锁卡片', naP.data.isAdmin === false && naP.data.demoLock === role.PARENT_TIP, naP.data.demoLock)
  const aaP = ctxOf(albumAdmin)
  aaP.checkAdmin.call(aaP)
  check('I2 相册管理：家长端只给锁卡片', aaP.data.isAdmin === false && aaP.data.demoLock === role.PARENT_TIP, aaP.data.demoLock)
  const maP = ctxOf(menuAdmin)
  maP.checkAdmin.call(maP)
  check('I3 食谱管理：家长端只给锁卡片', maP.data.isAdmin === false && maP.data.demoLock === role.PARENT_TIP, maP.data.demoLock)

  setDemo('staff')
  const naS = ctxOf(noticeAdmin)
  naS.checkAdmin.call(naS, '')
  check('I4 通知公告管理：陈老师（还不是管理员）进不去', naS.data.isAdmin === false && naS.data.demoLock === role.MEMBER_TIP, naS.data.demoLock)
  const maS = ctxOf(menuAdmin)
  maS.checkAdmin.call(maS)
  check('I5 食谱管理：陈老师同样进不去', maS.data.isAdmin === false && maS.data.demoLock === role.MEMBER_TIP)

  setDemo('teacher') // 改名单只有超级管理员能做
  role.writeMembers(['admin', 'staff'])
  setDemo('staff')
  const naS2 = ctxOf(noticeAdmin)
  naS2.checkAdmin.call(naS2, '')
  await tick(20)
  check('I6 被设成管理员之后，陈老师立刻能进通知公告管理', naS2.data.isAdmin === true && naS2.data.demoLock === '', naS2.data.demoLock)
  setDemo('teacher')
  role.writeMembers(role.DEFAULT_MEMBERS)

  const naT = ctxOf(noticeAdmin)
  naT.checkAdmin.call(naT, '')
  await tick(20)
  check('I7 李老师（超级管理员）能进', naT.data.isAdmin === true && naT.data.demoLock === '')
  const aaT = ctxOf(albumAdmin)
  aaT.checkAdmin.call(aaT)
  await tick(20)
  check('I8 相册管理：管理员进去能建能删', aaT.data.isAdmin === true && aaT.data.canAdd === true)
  const aaStaff = await (async function () {
    setDemo('staff')
    const c = ctxOf(albumAdmin)
    c.checkAdmin.call(c)
    await tick(20)
    return c.data
  })()
  check('I9 相册管理：普通老师进去只能上传照片（不能建 / 删）', aaStaff.isAdmin === false && aaStaff.canAdd === true && aaStaff.demoLock === '', [aaStaff.isAdmin, aaStaff.canAdd])
  setDemo('')

  /* ================= J. 孩子档案页的门槛 ================= */
  const childrenPage = loadPage('pages/children/children.js')
  setDemo('parent')
  const chP = ctxOf(childrenPage)
  chP.checkIdentity.call(chP)
  check('J1 孩子档案：家长端能看自己孩子的（给一句说明，不是锁死）', chP.data.canEdit === false && chP.data.tip === role.CHILD_PARENT_TIP && chP.data.demoLock === role.CHILD_TIP, chP.data.tip)
  setDemo('staff')
  const chS = ctxOf(childrenPage)
  chS.checkIdentity.call(chS)
  check('J2 孩子档案：普通老师能看不能改', chS.data.canEdit === false && chS.data.roleTip === role.CHILD_STAFF_TIP, chS.data.roleTip)
  setDemo('admin')
  const chA = ctxOf(childrenPage)
  chA.checkIdentity.call(chA)
  check('J3 孩子档案：管理员能改', chA.data.canEdit === true && chA.data.demoLock === '', [chA.data.canEdit, chA.data.demoLock])
  setDemo('')

  console.log(bad ? '\n❌ 失败 ' + bad + ' 项' : '\n✅ 演示账号与权限自检全部通过')
  process.exit(bad ? 1 : 0)
}

main().catch(function (e) {
  console.log('❌ 抛异常：' + (e && e.stack ? e.stack : e))
  process.exit(1)
})
