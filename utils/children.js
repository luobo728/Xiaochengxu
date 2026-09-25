// utils/children.js —— 孩子档案（建档 / 改档 / 删档的唯一数据层）
//
// 为什么要有这个文件：课时是「按孩子」算的 —— 哪个孩子上了哪节课、扣了他几课时、
// 他还剩几课时，都应该记在这个孩子自己名下。名单要是写死在代码里，就做不到：
//   ① 给新生建档，② 每个孩子各有一本课时账，③ 点名时一眼看出是「谁」被扣了。
//
// 三份数据各管一段，谁也不越界：
//   孩子档案 children_v1 —— 姓名 / 性别 / 生日 / 班级 / 家长（就是这个文件）
//   课表 + 点名 schedule_* —— 谁该上哪节课、到底来没来（utils/schedule.js）
//   课时账本 billing_v1   —— 每个孩子还剩几课时（utils/billing.js，按 childId 分账）
//
// 这个文件谁都不 require（只读写两个 storage key），
// 免得和 utils/billing.js、utils/schedule.js 绕成循环依赖。
//
// 演示档案（乐乐 / 甜甜 / 木木）在第一次用到时自动种进去，一辈子只种一次：
// 用户把演示孩子删光了也不会自动补回来（KEY_SEEDED 记得这件事）。

const KEY_KIDS = 'children_v1' // 档案列表（数组，按建档顺序）
const KEY_SEEDED = 'children_seeded_v1' // 演示档案种过没有

const KID_MAX = 30 // 一个班最多 30 个孩子（和真实班级规模对齐）
const NAME_MAX = 8 // 姓名最长 8 个字
const NOTE_MAX = 40 // 备注最长 40 字
const CLASS_DEFAULT = '大一班' // 建档时默认班级（演练课表就是这个班）
const CLASSES = ['小班', '中班', '大班', '大一班', '学前班']
const SEXES = ['女', '男']

// 演示账号 ↔ 孩子：家长端「乐乐妈妈」对应档案里的哪个孩子
// （真登录账号没有这张表，页面按档案里的第一个孩子兜底）
const OWNER = { parent: 'lele' }

// 演示档案：和点名页 / 课时页的演示课表是同一批孩子（id 不能改，课时账按 id 记）
const DEMO_KIDS = [
  {
    id: 'lele',
    name: '乐乐',
    sex: '女',
    birthday: '2020-03-08',
    cls: CLASS_DEFAULT,
    parentName: '乐乐妈妈',
    parentPhone: '13800000001',
    note: '对芒果过敏（已报园所）'
  },
  {
    id: 'tian',
    name: '甜甜',
    sex: '女',
    birthday: '2020-07-21',
    cls: CLASS_DEFAULT,
    parentName: '甜甜爸爸',
    parentPhone: '13800000002',
    note: ''
  },
  {
    id: 'mumu',
    name: '木木',
    sex: '男',
    birthday: '2020-11-02',
    cls: CLASS_DEFAULT,
    parentName: '木木妈妈',
    parentPhone: '13800000003',
    note: '中午不肯睡午觉，老师多留意'
  }
]

/* ---------------- 小工具 ---------------- */

function pad(n) {
  return n < 10 ? '0' + n : '' + n
}

function trim(v) {
  return String(v === undefined || v === null ? '' : v).replace(/^\s+|\s+$/g, '')
}

function copy(o) {
  const out = {}
  for (const k in o) {
    if (Object.prototype.hasOwnProperty.call(o, k)) out[k] = o[k]
  }
  return out
}

// 建档时生成 id：k + 时间戳后 6 位 + 随机 3 位（本机演示够用，也不会和演示 id 撞）
function makeId() {
  const t = String(Date.now()).slice(-6)
  const r = Math.floor(Math.random() * 1000)
  return 'k' + t + pad(r % 100)
}

/* ---------------- 本地存储 ---------------- */

function readKids() {
  try {
    const raw = wx.getStorageSync(KEY_KIDS)
    if (raw && typeof raw.length === 'number') {
      const out = []
      for (let i = 0; i < raw.length; i++) {
        if (raw[i] && typeof raw[i] === 'object') out.push(copy(raw[i]))
      }
      return out
    }
  } catch (e) {
    // 读失败按「还没有档案」处理
  }
  return []
}

function writeKids(list) {
  try {
    wx.setStorageSync(KEY_KIDS, list)
  } catch (e) {
    // 写失败不影响本次结果（下次打开回到上一次的档案）
  }
  return list
}

function seeded() {
  try {
    return !!wx.getStorageSync(KEY_SEEDED)
  } catch (e) {
    return false
  }
}

function markSeeded() {
  try {
    wx.setStorageSync(KEY_SEEDED, true)
  } catch (e) {
    // 记不住就下次再种一遍（最多多三个演示孩子，不会丢用户自己建的孩子）
  }
}

// 演示档案只种一次：已有的 id 一条都不动（用户改过的名字 / 删掉的档案都保留）
function ensureSeed() {
  const list = readKids()
  if (seeded()) return list
  const has = {}
  for (let i = 0; i < list.length; i++) has[list[i].id] = true
  for (let j = 0; j < DEMO_KIDS.length; j++) {
    if (has[DEMO_KIDS[j].id]) continue
    list.push(copy(DEMO_KIDS[j]))
  }
  writeKids(list)
  markSeeded()
  return list
}

/* ---------------- 读 ---------------- */

// 全部档案（顺序就是建档顺序，点名名单也照这个顺序）
function list() {
  return ensureSeed()
}

// 不种演示数据的读法（自检脚本用：想看「一个孩子都没有」的样子）
function read() {
  return readKids()
}

function count() {
  return list().length
}

function ids() {
  const all = list()
  const out = []
  for (let i = 0; i < all.length; i++) out.push(all[i].id)
  return out
}

function get(id) {
  const all = list()
  for (let i = 0; i < all.length; i++) {
    if (all[i].id === id) return all[i]
  }
  return null
}

function byName(name) {
  const want = trim(name)
  if (!want) return null
  const all = list()
  for (let i = 0; i < all.length; i++) {
    if (all[i].name === want) return all[i]
  }
  return null
}

// 名字（找不到就回 id，页面上至少有个能看的东西）
function nameOf(id) {
  const k = get(id)
  return k ? k.name : String(id || '')
}

// 某个演示账号对应哪个孩子（家长端 = 自己孩子；其他账号 = 档案里第一个）
function defaultChildId(accountId) {
  const want = OWNER[accountId]
  if (want && get(want)) return want
  const all = list()
  return all.length ? all[0].id : ''
}

// 下拉 / 动作面板用的最小列表
function pickerList() {
  const all = list()
  const out = []
  for (let i = 0; i < all.length; i++) {
    out.push({ id: all[i].id, name: all[i].name })
  }
  return out
}

/* ---------------- 展示字段（WXML 里不做运算） ---------------- */

// 头像就用名字第一个字（本项目不放图片资源）
function avatarOf(child) {
  const name = trim(child && child.name)
  return name ? name.charAt(0) : '档'
}

// 年龄：'5 岁 8 个月'（生日没填 / 填错就回 ''）
function ageText(birthday) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trim(birthday))
  if (!m) return ''
  const y = Number(m[1])
  const mo = Number(m[2])
  const d = Number(m[3])
  const now = new Date()
  let years = now.getFullYear() - y
  let months = now.getMonth() + 1 - mo
  if (now.getDate() < d) months--
  if (months < 0) {
    years--
    months += 12
  }
  if (years < 0) return ''
  return years + ' 岁' + (months ? ' ' + months + ' 个月' : '')
}

function sexText(child) {
  const s = trim(child && child.sex)
  return SEXES.indexOf(s) > -1 ? s : '女'
}

// 手机号打码：138****0001（演示数据也不该把号码整个亮出来）
function phoneText(phone) {
  const p = trim(phone)
  if (p.length !== 11) return p
  return p.slice(0, 3) + '****' + p.slice(7)
}

// 档案卡片第二行：'大一班 · 家长 乐乐妈妈'
function subOf(child) {
  const k = child || {}
  const parts = []
  if (trim(k.cls)) parts.push(trim(k.cls))
  if (trim(k.parentName)) parts.push('家长 ' + trim(k.parentName))
  const age = ageText(k.birthday)
  if (age) parts.push(age)
  return parts.join(' · ')
}

/* ---------------- 校验 / 写 ---------------- */

function emptyForm() {
  return {
    id: '',
    name: '',
    sex: '女',
    birthday: '',
    cls: CLASS_DEFAULT,
    parentName: '',
    parentPhone: '',
    note: ''
  }
}

// 表单校验：返回 '' 表示通过，否则是那句要显示给老师的话
function checkForm(form, editingId) {
  const f = form || {}
  const name = trim(f.name)
  if (!name) return '请填写孩子姓名'
  if (name.length > NAME_MAX) return '姓名最多 ' + NAME_MAX + ' 个字'

  const cls = trim(f.cls) || CLASS_DEFAULT
  if (CLASSES.indexOf(cls) === -1) return '班级要选：' + CLASSES.join(' / ')

  const sex = trim(f.sex)
  if (sex && SEXES.indexOf(sex) === -1) return '性别只能选：' + SEXES.join(' / ')

  const birthday = trim(f.birthday)
  if (birthday) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(birthday)
    if (!m) return '生日要填成 2020-03-08 这样'
    const t = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).getTime()
    if (!t || t > Date.now()) return '生日不能是还没到的日期'
  }

  const phone = trim(f.parentPhone)
  if (phone && !/^1\d{10}$/.test(phone)) return '家长手机号要填 11 位数字'

  if (trim(f.note).length > NOTE_MAX) return '备注最多 ' + NOTE_MAX + ' 个字'

  // 同一个班里重名要拦住：不然点名时两个「乐乐」根本分不清谁是谁
  const all = list()
  for (let i = 0; i < all.length; i++) {
    if (all[i].id === editingId) continue
    if (all[i].name === name && trim(all[i].cls) === cls) {
      return '「' + cls + '」已经有个叫「' + name + '」的孩子了，重名会点错人'
    }
  }
  return ''
}

// 建档 / 改档：存的是校验后的干净数据；返回 { ok, msg, child, created }
function save(form) {
  const f = form || {}
  const editId = trim(f.id)
  if (!editId && list().length >= KID_MAX) {
    return { ok: false, msg: '一个班最多 ' + KID_MAX + ' 个孩子，建不了更多了' }
  }
  const bad = checkForm(f, editId)
  if (bad) return { ok: false, msg: bad }

  const clean = {
    id: editId || makeId(),
    name: trim(f.name),
    sex: trim(f.sex) || '女',
    birthday: trim(f.birthday),
    cls: trim(f.cls) || CLASS_DEFAULT,
    parentName: trim(f.parentName),
    parentPhone: trim(f.parentPhone),
    note: trim(f.note),
    updatedAt: Date.now()
  }

  const all = list()
  let found = false
  for (let i = 0; i < all.length; i++) {
    if (all[i].id !== clean.id) continue
    clean.createdAt = all[i].createdAt || Date.now()
    all[i] = clean
    found = true
    break
  }
  if (!found) {
    clean.createdAt = clean.updatedAt
    all.push(clean)
  }
  writeKids(all)
  return {
    ok: true,
    created: !found,
    child: clean,
    msg: found ? '档案已更新' : '档案已建立'
  }
}

// 删档案：只删档案本身。课时账本一条都不动 ——
// 交的钱和上过的课是财务记录，不能因为删了档案就消失（账还留在账单明细里）
function remove(id) {
  const all = list()
  const out = []
  let hit = null
  for (let i = 0; i < all.length; i++) {
    if (all[i].id === id) {
      hit = all[i]
      continue
    }
    out.push(all[i])
  }
  if (!hit) return { ok: false, msg: '没找到这个孩子的档案' }
  writeKids(out)
  return { ok: true, child: hit, msg: '档案已删除（课时记录仍留在账单里）' }
}

module.exports = {
  KEY_KIDS: KEY_KIDS,
  KEY_SEEDED: KEY_SEEDED,
  KID_MAX: KID_MAX,
  NAME_MAX: NAME_MAX,
  NOTE_MAX: NOTE_MAX,
  CLASSES: CLASSES,
  CLASS_DEFAULT: CLASS_DEFAULT,
  SEXES: SEXES,
  OWNER: OWNER,
  DEMO_KIDS: DEMO_KIDS,
  list: list,
  read: read,
  count: count,
  ids: ids,
  get: get,
  byName: byName,
  nameOf: nameOf,
  defaultChildId: defaultChildId,
  pickerList: pickerList,
  avatarOf: avatarOf,
  ageText: ageText,
  sexText: sexText,
  phoneText: phoneText,
  subOf: subOf,
  emptyForm: emptyForm,
  checkForm: checkForm,
  save: save,
  remove: remove,
  ensureSeed: ensureSeed
}
