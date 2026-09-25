// utils/account.js —— 纯本机演示账号（不连云、不注册，只存在这台手机上）
//
// 为什么有它：家长端和老师端（管理员）的界面差别不小，做演示、验收、给人看
// 效果时，需要一个几秒就能来回切的办法。这里只在手机本地放两个账号：
//   家长端「乐乐妈妈」—— 孩子档案、课时余额、班级相册（只能看）
//   老师端「李老师」  —— 在家长能看的基础上，多出通知公告管理、食谱管理、相册管理
//
// 切换时只做两件本机的事：
//   ① 写登录态（utils/auth.js，本机模式，token 用 demo- 前缀，一眼看出不是真微信身份）
//   ② 开关「本机管理员」标记（notice_local_admin_v1，和长按版本号是同一个开关，
//      所以通知公告、食谱、相册三个管理页会一起跟着变）
// 想回到「未登录」：在「我的 → 切换演示账号」里选退出登录。
const auth = require('./auth.js')
const notice = require('./notice.js')

const KEY_CURRENT = 'demo_account_v1'

// 顺序就是切换面板里的顺序
const ACCOUNTS = [
  {
    id: 'parent',
    side: '家长端',
    name: '乐乐妈妈',
    phone: '13800000001',
    role: '家长',
    admin: false,
    desc: '看孩子档案、课时余额、班级相册（只能看）'
  },
  {
    id: 'teacher',
    side: '老师端',
    name: '李老师',
    phone: '13900000002',
    role: '管理员',
    admin: true,
    desc: '多出通知公告管理、食谱管理、相册管理'
  }
]

function copy(acc) {
  return {
    id: acc.id,
    side: acc.side,
    name: acc.name,
    phone: acc.phone,
    role: acc.role,
    admin: !!acc.admin,
    desc: acc.desc
  }
}

// 账号表（拷贝一份，外面改不动里面的表）
function list() {
  const out = []
  for (let i = 0; i < ACCOUNTS.length; i++) out.push(copy(ACCOUNTS[i]))
  return out
}

function get(id) {
  for (let i = 0; i < ACCOUNTS.length; i++) {
    if (ACCOUNTS[i].id === id) return copy(ACCOUNTS[i])
  }
  return null
}

function currentId() {
  try {
    return wx.getStorageSync(KEY_CURRENT) || ''
  } catch (e) {
    return ''
  }
}

// 当前账号，没切过就是 null
function current() {
  return get(currentId())
}

function writeId(id) {
  try {
    if (id) wx.setStorageSync(KEY_CURRENT, id)
    else wx.removeStorageSync(KEY_CURRENT)
  } catch (e) {
    // 写失败不影响这次切换，页面上重新进一次会按旧账号显示
  }
}

// 切成某个演示账号：登录态 + 本机管理员标记一起改
function switchTo(id) {
  const acc = get(id)
  if (!acc) return { ok: false, msg: '没有这个演示账号' }
  writeId(acc.id)
  notice.setLocalAdmin(acc.admin)
  auth.setSession({
    name: acc.name,
    phone: acc.phone,
    role: acc.role,
    token: 'demo-' + acc.id,
    wx: false
  })
  return { ok: true, account: acc }
}

// 清掉演示账号标记（退出登录时用；登录态本身由 utils/auth.js 清）
function clear() {
  writeId('')
}

// 头部一句话；还没选过账号时返回 ''，由页面自己兜底
function identityText() {
  const acc = current()
  if (!acc) return ''
  return acc.side + ' · ' + acc.name + (acc.admin ? '（管理员）' : '')
}

// 底部那行用：还没选过账号时按家长端显示
function sideName() {
  const acc = current()
  return acc ? acc.side : '家长端'
}

module.exports = {
  list: list,
  get: get,
  current: current,
  currentId: currentId,
  switchTo: switchTo,
  clear: clear,
  identityText: identityText,
  sideName: sideName
}
