// utils/demo-role.js —— 演示账号的「身份底线」：家长端永远不是管理员
//
// 为什么单独一个文件：判断「是不是管理员」的地方有好几处（utils/notice.js 的本机
// 管理员标记、utils/account.js 的切换、utils/album.js 的相册身份），如果把这行判断
// 写在其中任何一个文件里，另外两个 require 过来就会绕成循环依赖。这里只读一个
// storage key，谁都可以 require，自己谁都不 require。
//
// 谁能越过去？越不过去。身份其实有四个来源：
//   ① 云端白名单（云函数 menuAdmin 的 whoami）
//   ② whoami 的本地缓存 menu_whoami_v1（30 分钟）
//   ③ 本机体验管理员标记 notice_local_admin_v1（长按「我的」页版本号开启）
//   ④ 云端「首次一键成为管理员」init 流程
// 演示账号切到家长端时，① ~ ④ 全部作废，一律按「不是管理员」处理；
// 切到老师端时按原有的本机管理员逻辑走（本机模式=管理员，云端模式仍以云端为准，
// 免得在这台手机上假装有权限、真正保存时又被云端拒掉）。
//
// 家长端被拦住时的提示语放这里，三个管理页的锁屏文案都用同一句，不会各说各的。
const KEY_CURRENT = 'demo_account_v1'
const PARENT = 'parent'
const TEACHER = 'teacher'

// 锁屏卡片上用长句（说清楚怎么解决）；toast 上用短句（一行能显示完）
const PARENT_TIP = '当前是演示账号的「家长端」，没有管理权限。要管理请到「我的 → 切换演示账号」切到老师端。'
const PARENT_SHORT = '家长端没有管理权限，先切到老师端'

function currentId() {
  try {
    return wx.getStorageSync(KEY_CURRENT) || ''
  } catch (e) {
    return ''
  }
}

// 是不是切在演示账号上（家长端或老师端）
function isActive() {
  const id = currentId()
  return id === PARENT || id === TEACHER
}

function isParent() {
  return currentId() === PARENT
}

function isTeacher() {
  return currentId() === TEACHER
}

module.exports = {
  KEY_CURRENT: KEY_CURRENT,
  PARENT: PARENT,
  TEACHER: TEACHER,
  PARENT_TIP: PARENT_TIP,
  PARENT_SHORT: PARENT_SHORT,
  currentId: currentId,
  isActive: isActive,
  isParent: isParent,
  isTeacher: isTeacher
}
