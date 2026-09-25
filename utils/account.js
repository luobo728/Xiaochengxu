// utils/account.js —— 纯本机演示账号（不连云、不注册，只存在这台手机上）
//
// 为什么有它：家长端和老师端的界面差别不小，做演示、验收、给人看效果时，
// 需要一个几秒就能来回切的办法。这里只在手机本地放四个账号（顺序就是切换面板里的顺序）：
//   家长端「乐乐妈妈」—— 孩子档案、课时余额、班级相册（只能看）
//   老师端「李老师」  —— 超级管理员：通知公告 / 食谱 / 相册管理，还能设置谁是管理员
//   老师端「王老师」  —— 管理员：一样能管通知 / 食谱 / 相册，但改不了管理员名单
//   老师端「陈老师」  —— 普通老师：默认没有管理入口，等超级管理员在「管理员设置」里开
//
// 谁的权限由谁定：只有「谁是管理员」那一份判断在 utils/demo-role.js（花名册
// admin_members_v1，超级管理员在「我的 → 管理员设置」里改）；这个文件只负责
// 切换账号时把三件事一次做完：
//   ① 写登录态（utils/auth.js，本机模式，token 用 demo- 前缀，一眼看出不是真微信身份）
//   ② 开关「本机管理员」标记（notice_local_admin_v1）—— 演示账号其实不看这个标记了
//      （权限以花名册为准），留着是为了「退出登录」后回到没切账号时行为不变
//   ③ 写当前账号 key（demo_account_v1）
// 想回到「未登录」：在「我的 → 切换演示账号」里选退出登录。
const auth = require('./auth.js')
const notice = require('./notice.js')
// 演示账号的身份底线（谁是不是管理员）：key 与判断都在这个文件里
const role = require('./demo-role.js')

const KEY_CURRENT = role.KEY_CURRENT

const ACCOUNTS = [
  {
    id: role.PARENT,
    side: '家长端',
    name: '乐乐妈妈',
    phone: '13800000001',
    role: '家长',
    admin: false,
    desc: '看孩子档案、课时余额、班级相册（只能看）'
  },
  {
    id: role.TEACHER,
    side: '老师端',
    name: '李老师',
    phone: '13900000002',
    role: '超级管理员',
    admin: true,
    super: true,
    desc: '超级管理员：管通知、食谱、相册，还能设置谁是管理员'
  },
  {
    id: role.ADMIN,
    side: '老师端',
    name: '王老师',
    phone: '13900000003',
    role: '管理员',
    admin: true,
    desc: '管理员：通知、食谱、相册都能管，但改不了管理员名单'
  },
  {
    id: role.STAFF,
    side: '老师端',
    name: '陈老师',
    phone: '13900000004',
    role: '老师',
    admin: false,
    desc: '普通老师：还没有管理权限，等超级管理员在「管理员设置」里开'
  }
]

// 身份名：会跟着花名册变（王老师被取消后就是「普通老师」）
function roleNameOf(acc) {
  if (!acc) return ''
  if (acc.id === role.TEACHER) return '超级管理员'
  if (acc.id === role.PARENT) return '家长'
  return role.isMemberOn(acc.id) ? '管理员' : '普通老师'
}

function copy(acc) {
  const name = roleNameOf(acc)
  return {
    id: acc.id,
    side: acc.side,
    name: acc.name,
    phone: acc.phone,
    role: name,
    admin: role.isMemberOn(acc.id),
    super: !!acc.super,
    // 头部文案里的身份后缀：家长端不加（「家长端 · 乐乐妈妈」），老师端账号加
    title: acc.id === role.PARENT ? '' : name,
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

// 切成某个演示账号：当前账号 + 登录态 + 本机管理员标记一起改
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
  return acc.side + ' · ' + acc.name + (acc.title ? '（' + acc.title + '）' : '')
}

// 切换面板里那一行：老师端账号带上身份名，当前账号带个标记
function labelOf(acc, curId) {
  if (!acc) return ''
  let text = acc.side + ' · ' + acc.name
  if (acc.title) text += '（' + acc.title + '）'
  if (acc.id === curId) text += ' · 当前'
  return text
}

// 底部那行用：还没选过账号时按家长端显示
function sideName() {
  const acc = current()
  return acc ? acc.side : '家长端'
}

module.exports = {
  list: list,
  get: get,
  roleNameOf: roleNameOf,
  current: current,
  currentId: currentId,
  switchTo: switchTo,
  clear: clear,
  identityText: identityText,
  labelOf: labelOf,
  sideName: sideName
}
