// utils/admins.js —— 管理员花名册（纯本机演示数据）
//
// 干什么用：超级管理员在「我的 → 管理员设置」里把某个演示账号设成管理员 / 取消管理员。
// 名单存在本机（utils/demo-role.js 的 KEY_MEMBERS = admin_members_v1），
// 名字、手机号这些展示信息从 utils/account.js 取，判断「谁是管理员」也只有
// utils/demo-role.js 一份 —— 这个文件只负责「列表 + 改名单」，不自己算权限。
//
// 规则（也写在管理员设置页的说明卡片上）：
//   超级管理员（李老师）—— 固定是，取消不了
//   管理员 / 普通老师     —— 超级管理员说了算，随时可以设成管理员或取消
//   家长（乐乐妈妈）      —— 固定不是，设置不了（演示账号的家长端一票否决）
const role = require('./demo-role.js')
const account = require('./account.js')

// 一行花名册：能不能改、现在是不是管理员、身份名
function rowOf(id) {
  const acc = account.get(id)
  if (!acc) return null
  const editable = role.isMemberId(id)
  const admin = role.isMemberOn(id)
  let roleName = '普通老师'
  if (id === role.TEACHER) roleName = '超级管理员'
  else if (id === role.PARENT) roleName = '家长'
  else if (admin) roleName = '管理员'
  return {
    id: id,
    name: acc.name,
    phone: acc.phone,
    side: acc.side,
    roleName: roleName,
    // 头像方块里显示的字（纯 CSS 方块配一个字，项目里不用图片）
    badge: id === role.TEACHER ? '超' : id === role.PARENT ? '家' : admin ? '管' : '师',
    admin: admin,
    editable: editable,
    // 固定身份的行右边不显示开关，显示这句话
    fixedText: id === role.TEACHER ? '固定 · 取消不了' : '固定 · 不是管理员',
    // 头像方块的配色（CSS 渐变，项目里不用图片）
    tone: id === role.TEACHER ? 'linear-gradient(135deg,#34C759,#12A150)'
      : id === role.PARENT ? 'linear-gradient(135deg,#7C6BFF,#4B37E0)'
      : admin ? 'linear-gradient(135deg,#4C8BFF,#2E6BFF)' : 'linear-gradient(135deg,#B9C2D0,#8C97A8)'
  }
}

// 花名册列表：超级管理员排第一，然后是能被设置的老师账号，最后是家长端
function list() {
  const out = []
  const order = []
  order.push(role.TEACHER)
  for (let i = 0; i < role.MEMBERS.length; i++) order.push(role.MEMBERS[i])
  order.push(role.PARENT)
  for (let i = 0; i < order.length; i++) {
    const row = rowOf(order[i])
    if (row) out.push(row)
  }
  return out
}

// 现在有几个管理员（含超级管理员）
function adminCount() {
  const rows = list()
  let n = 0
  for (let i = 0; i < rows.length; i++) {
    if (rows[i].admin) n++
  }
  return n
}

// 设置 / 取消某个账号的管理员身份。
// 返回值：{ ok: true, admin } 或 { ok: false, msg }（msg 直接给用户看）
function setAdmin(id, on) {
  // 只有超级管理员能改名单（写花名册那层还会再拦一次）
  if (!role.isSuper()) return { ok: false, msg: role.SUPER_SHORT }
  if (id === role.TEACHER) return { ok: false, msg: '超级管理员是固定的，取消不了' }
  if (id === role.PARENT) return { ok: false, msg: '家长端固定不是管理员，设置不了' }
  if (!role.isMemberId(id)) return { ok: false, msg: '这个账号不在花名册里' }

  const next = []
  const cur = role.readMembers()
  for (let i = 0; i < cur.length; i++) {
    if (cur[i] !== id) next.push(cur[i])
  }
  if (on) next.push(id)
  if (!role.writeMembers(next)) return { ok: false, msg: '名单没保存上，请再试一次' }
  return { ok: true, admin: !!on, members: next }
}

// 恢复成默认名单（超级管理员 + 王老师），测试时想回到干净状态就用它
function reset() {
  if (!role.isSuper()) return { ok: false, msg: role.SUPER_SHORT }
  if (!role.writeMembers(role.DEFAULT_MEMBERS)) return { ok: false, msg: '名单没保存上，请再试一次' }
  return { ok: true, members: role.readMembers() }
}

module.exports = {
  list: list,
  rowOf: rowOf,
  adminCount: adminCount,
  setAdmin: setAdmin,
  reset: reset
}
