// utils/demo-role.js —— 演示账号的「身份与权限底线」
//
// 为什么单独一个文件：判断「是不是管理员」的地方有好几处（utils/notice.js 的本机
// 管理员标记、utils/album.js 的相册身份、utils/account.js 的切换、三个管理页的校验），
// 如果把这行判断写在其中任何一个文件里，另外几个 require 过来就会绕成循环依赖。
// 这里只读两个 storage key（当前账号 + 管理员花名册），谁都可以 require，自己谁都不 require。
//
// 演示账号一共四个，权限从高到低：
//   teacher（老师端 · 李老师）—— 超级管理员：能管通知 / 食谱 / 相册，还能设置「谁是管理员」
//   admin  （老师端 · 王老师）—— 管理员：能管通知 / 食谱 / 相册，不能改管理员名单
//   staff  （老师端 · 陈老师）—— 普通老师：默认一个管理入口都没有，等超级管理员设置
//   parent （家长端 · 乐乐妈妈）—— 家长：永远不是管理员（硬规则，谁也改不了）
//
// 花名册（admin_members_v1）里存的就是「哪些演示账号现在是管理员」，
// 只有超级管理员能改（我的 → 管理员设置）。默认花名册就一个人：王老师。
//
// 谁能越过去？越不过去。身份其实有四个来源：
//   ① 云端白名单（云函数 menuAdmin 的 whoami）
//   ② whoami 的本地缓存 menu_whoami_v1（30 分钟）
//   ③ 本机体验管理员标记 notice_local_admin_v1（长按「我的」页版本号开启）
//   ④ 云端「首次一键成为管理员」init 流程
// 演示账号切到家长端时，① ~ ④ 全部作废，一律按「不是管理员」处理；
// 切到老师端的账号时，权限只看花名册（超级管理员固定是管理员），
// 免得在这台手机上假装有权限、真正保存时又被云端拒掉。
//
// 文案都放这里：三个管理页 + 管理员设置页 + 「我的」页用的是同一份，不会各说各的。
const KEY_CURRENT = 'demo_account_v1'

// 管理员花名册：存的是演示账号 id 数组，例如 ['admin']
const KEY_MEMBERS = 'admin_members_v1'

const PARENT = 'parent'
const TEACHER = 'teacher' // 超级管理员
const ADMIN = 'admin' // 管理员（可由超级管理员设置 / 取消）
const STAFF = 'staff' // 普通老师（默认不是管理员）

// 能被超级管理员设置成管理员的演示账号：家长端固定不是，超级管理员固定是
const MEMBERS = [ADMIN, STAFF]

// 默认花名册：王老师默认就是管理员，陈老师默认不是 —— 「取消」和「设置」两个方向都能试
const DEFAULT_MEMBERS = [ADMIN]

// 锁屏卡片上用长句（说清楚怎么解决）
const PARENT_TIP = '当前是演示账号的「家长端」，没有管理权限。要管理请到「我的 → 切换演示账号」切到老师端。'
const MEMBER_TIP = '当前这个演示账号还不是管理员，没有管理权限。请让超级管理员（老师端 · 李老师）到「我的 → 管理员设置」里把你设为管理员。'
const SUPER_TIP = '「管理员设置」只有超级管理员能进。演示账号里的超级管理员是「老师端 · 李老师」，请到「我的 → 切换演示账号」切过去。'

// 「相册管理」页上给普通老师的一句说明（页面顶部提示条用）
const ALBUM_STAFF_TIP = '你是老师：相册里可以上传照片；建相册、改名、删相册、删照片由管理员负责。'

// 「点名」页上的两句说明（页面顶部提示条用）
const ROLL_PARENT_TIP = '点名是老师做的事，家长端没有这个权限。要给孩子点名，请到「我的 → 切换演示账号」切到老师端。'
const ROLL_STAFF_TIP = '你是老师：点到课 / 请假 / 旷课，保存后自动扣课时（请假不扣、旷课照扣）。'

// 「孩子档案」页上的三句话（页面顶部提示条与锁卡片用同一份文案）
//   老师端：能看，改档案由管理员负责（和相册同一种分工）
//   家长端：只能看自己孩子的
const CHILD_STAFF_TIP = '你是老师：孩子档案都可以查看；新建档、改资料、删档由管理员负责。'
const CHILD_PARENT_TIP = '这里是你孩子的档案，只能查看。要改资料请找老师。'
const CHILD_TIP = '孩子档案只能查看。要新建档、改资料，请让管理员（老师端 · 王老师）来做。'

// toast 上用短句（一行能显示完）
const PARENT_SHORT = '家长端没有管理权限，先切到老师端'
const MEMBER_SHORT = '还不是管理员，请超级管理员设置'
const ADMIN_SHORT = '你是管理员，名单由超级管理员设置'
const OWNER_SHORT = '你是超级管理员，权限已经全开'
const SUPER_SHORT = '只有超级管理员能设置管理员'

function currentId() {
  try {
    return wx.getStorageSync(KEY_CURRENT) || ''
  } catch (e) {
    return ''
  }
}

// 读花名册（拿到的是拷贝，外面改不到里面的表）
function readMembers() {
  let raw = null
  try {
    raw = wx.getStorageSync(KEY_MEMBERS)
  } catch (e) {
    raw = null
  }
  if (!raw || typeof raw.length !== 'number') return DEFAULT_MEMBERS.slice()
  const out = []
  for (let i = 0; i < raw.length; i++) {
    if (isMemberId(raw[i]) && out.indexOf(raw[i]) === -1) out.push(raw[i])
  }
  return out
}

// 写花名册（只有超级管理员能改，返回 true 表示这次写入生效）
function writeMembers(ids) {
  if (!isSuper()) return false
  const out = []
  const list = (ids && typeof ids.length === 'number' ? ids : [])
  for (let i = 0; i < list.length; i++) {
    if (isMemberId(list[i]) && out.indexOf(list[i]) === -1) out.push(list[i])
  }
  try {
    wx.setStorageSync(KEY_MEMBERS, out)
  } catch (e) {
    return false
  }
  return true
}

// 这个 id 是不是「可以被设置成管理员」的演示账号
function isMemberId(id) {
  return MEMBERS.indexOf(id) > -1
}

// 某个演示账号现在是不是管理员（家长端永远不是；超级管理员永远是）
function isMemberOn(id) {
  if (id === TEACHER) return true
  if (id === PARENT) return false
  return readMembers().indexOf(id) > -1
}

// 当前身份档位：
//   '' 不是演示账号 | 'parent' 家长 | 'super' 超级管理员 | 'admin' 管理员 | 'none' 老师但不是管理员
function level() {
  const id = currentId()
  if (id === PARENT) return 'parent'
  if (id === TEACHER) return 'super'
  if (isMemberId(id)) return isMemberOn(id) ? 'admin' : 'none'
  return ''
}

// 现在切在演示账号上（四个里任意一个）
function isActive() {
  return level() !== ''
}

function isDemo() {
  return level() !== ''
}

function isParent() {
  return level() === 'parent'
}

// 老师端的超级管理员（老名字，判断的是同一个身份）
function isTeacher() {
  return level() === 'super'
}

function isSuper() {
  return level() === 'super'
}

function isAdmin() {
  return level() === 'admin'
}

// 当前账号能不能管内容（通知 / 食谱 / 相册）—— 超级管理员和管理员都行
function canManage() {
  const lv = level()
  return lv === 'super' || lv === 'admin'
}

// 当前账号能不能往相册里上传照片：
//   老师端的演示账号都能（超级管理员 / 管理员 / 普通老师）—— 普通老师就靠这一条拿到上传权限
//   家长端不能；不是演示账号的走原有那套（能不能管由 adminStatus() 决定）
function canUploadAlbum() {
  const lv = level()
  return lv === 'super' || lv === 'admin' || lv === 'none'
}

// 三个管理页的锁屏文案：'' 表示不拦（走云端 / 本机标记那套原有逻辑）
function lockTip() {
  const lv = level()
  if (lv === 'parent') return PARENT_TIP
  if (lv === 'none') return MEMBER_TIP
  return ''
}

// 「相册管理」页的门槛：'' 表示不拦
//   老师端任何账号都能进（普通老师进去只能上传照片，页面按 canUploadAlbum() 摆按钮）
//   家长端进不去 —— 家长看照片走「班级相册」，用不着管理页
//   不是演示账号 → ''，照旧走云端白名单 / 本机体验管理员
function albumTip() {
  if (level() === 'parent') return PARENT_TIP
  return ''
}

// 「点名」页的门槛：'' 表示能进
//   老师端任何演示账号都能点名（点名本来就是老师做的事，普通老师也能做）
//   家长端进不去 —— 点名是老师的事，家长端只负责看课时
//   不是演示账号 → ''，照旧走云端白名单 / 本机体验管理员（notice.adminStatus）
function rollTip() {
  if (level() === 'parent') return ROLL_PARENT_TIP
  return ''
}

// 「孩子档案」页的门槛：'' 表示不拦（家长端给一句说明：只能看自己孩子的档案）
function childTip() {
  if (level() === 'parent') return CHILD_PARENT_TIP
  return ''
}

// 能不能点名（和 rollTip() 同一份口径，只是这里只管「能不能」）：
//   老师端演示账号（超级管理员 / 管理员 / 普通老师）→ true
//   家长端 → false（一票否决：点名是老师做的事）
//   不是演示账号 → null，交给页面照旧走云端白名单 / 本机体验管理员
function canRoll() {
  const lv = level()
  if (lv === '') return null
  return lv !== 'parent'
}

// 能不能新建 / 修改 / 删除孩子档案：
//   老师端的超级管理员和管理员能改（和管通知、管相册同一档）
//   普通老师、家长只能看
//   不是演示账号 → null：交给页面照旧走云端白名单 / 本机体验管理员
function canEditChildren() {
  const lv = level()
  if (lv === '') return null
  return lv === 'super' || lv === 'admin'
}

// 管理员设置页的锁屏文案：'' 表示能进（只有超级管理员能进）
function settingsTip() {
  const lv = level()
  if (lv === 'super') return ''
  if (lv === 'parent') return PARENT_TIP
  return SUPER_TIP
}

// 演示账号长按版本号时给的一句人话（家长端是静默的，不会走到这里）
function demoShort() {
  const lv = level()
  if (lv === 'super') return OWNER_SHORT
  if (lv === 'admin') return ADMIN_SHORT
  return MEMBER_SHORT
}

module.exports = {
  KEY_CURRENT: KEY_CURRENT,
  KEY_MEMBERS: KEY_MEMBERS,
  PARENT: PARENT,
  TEACHER: TEACHER,
  ADMIN: ADMIN,
  STAFF: STAFF,
  MEMBERS: MEMBERS,
  DEFAULT_MEMBERS: DEFAULT_MEMBERS,
  PARENT_TIP: PARENT_TIP,
  MEMBER_TIP: MEMBER_TIP,
  ALBUM_STAFF_TIP: ALBUM_STAFF_TIP,
  ROLL_PARENT_TIP: ROLL_PARENT_TIP,
  ROLL_STAFF_TIP: ROLL_STAFF_TIP,
  CHILD_STAFF_TIP: CHILD_STAFF_TIP,
  CHILD_PARENT_TIP: CHILD_PARENT_TIP,
  CHILD_TIP: CHILD_TIP,
  SUPER_TIP: SUPER_TIP,
  PARENT_SHORT: PARENT_SHORT,
  MEMBER_SHORT: MEMBER_SHORT,
  ADMIN_SHORT: ADMIN_SHORT,
  OWNER_SHORT: OWNER_SHORT,
  SUPER_SHORT: SUPER_SHORT,
  currentId: currentId,
  readMembers: readMembers,
  writeMembers: writeMembers,
  isMemberId: isMemberId,
  isMemberOn: isMemberOn,
  level: level,
  isActive: isActive,
  isDemo: isDemo,
  isParent: isParent,
  isTeacher: isTeacher,
  isSuper: isSuper,
  isAdmin: isAdmin,
  canManage: canManage,
  canUploadAlbum: canUploadAlbum,
  lockTip: lockTip,
  albumTip: albumTip,
  rollTip: rollTip,
  canRoll: canRoll,
  childTip: childTip,
  canEditChildren: canEditChildren,
  settingsTip: settingsTip,
  demoShort: demoShort
}
