// smoke_children.js —— 「孩子档案 + 课时按孩子独立分账」自检
// 跑法：node tools/smoke_children.js
// 覆盖：数据层（建档校验 / 演示档案只种一次 / 删档不动账本）
//       + 每个孩子一本账（点名一次按人头各扣各的 / 同一节课不重扣 / 改点法走冲正）
//       + 演示赠送（demo_gift_v1:<孩子id>，没档案就不送）
//       + 权限真值表（utils/demo-role.js）+ 页面接线（pages/children、pages/children-edit）
const fs = require('fs')
const path = require('path')

const root = path.resolve(__dirname, '..')

/* ---------------- wx 模拟 ---------------- */
const store = {}
const toasts = []
const navs = [] // wx.navigateTo 的目标
const navBacks = [] // wx.navigateBack 的次数
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
  showModal: function (o) {
    if (o && o.success) o.success({ confirm: true, cancel: false })
  },
  navigateTo: function (o) {
    navs.push((o && o.url) || '')
  },
  navigateBack: function () {
    navBacks.push(1)
  },
  switchTab: function () {},
  reLaunch: function () {},
  pageScrollTo: function () {},
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

const children = require(path.join(root, 'utils/children.js'))
const billing = require(path.join(root, 'utils/billing.js'))
const schedule = require(path.join(root, 'utils/schedule.js'))
const role = require(path.join(root, 'utils/demo-role.js'))
const KEY_DEMO = role.KEY_CURRENT
const KEY_LOCAL_ADMIN = 'notice_local_admin_v1'

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
function pad2(n) {
  return n < 10 ? '0' + n : '' + n
}
function todayStr() {
  const d = new Date()
  return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate())
}

// 整块 storage 快照：造「极端状态」（30 人满员 / 一个档案都没有）用完立刻还原
function snap() {
  const out = {}
  Object.keys(store).forEach(function (k) {
    out[k] = JSON.parse(JSON.stringify(store[k]))
  })
  return out
}
function restore(s) {
  Object.keys(store).forEach(function (k) {
    delete store[k]
  })
  Object.keys(s).forEach(function (k) {
    store[k] = JSON.parse(JSON.stringify(s[k]))
  })
}
function ledger() {
  const s = store['billing_v1']
  return s && s.ledger ? s.ledger.slice() : []
}
function findRow(rows, id) {
  for (let i = 0; i < rows.length; i++) {
    if (rows[i].id === id) return rows[i]
  }
  return null
}
// 铺一个「已经满员」的班：直接写 30 条档案（不靠自动 id，免得撞车）
function fullClass() {
  const out = []
  for (let i = 0; i < children.KID_MAX; i++) {
    out.push({ id: 'k' + i, name: '测试' + i, cls: '小班', sex: '女', birthday: '', parentName: '', parentPhone: '', note: '' })
  }
  return out
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

// 点名页那种「一节课的一行一行状态」：只传状态，扣多少由数据层算
function rowsOf(lesson, status) {
  const out = []
  for (let i = 0; i < lesson.kids.length; i++) {
    const sid = lesson.kids[i].studentId
    out.push({ studentId: sid, status: typeof status === 'function' ? status(sid) : status })
  }
  return out
}

async function main() {
  /* ================= A. 演示档案：种一次，一辈子只种一次 ================= */
  check('A1 read() 只读不种：空设备上读出来是空名单，也不写盘', children.read().length === 0 && store[children.KEY_KIDS] === undefined)

  const seeded = children.list()
  check('A2 第一次读档案自动种上三个演示孩子', seeded.length === 3 && children.count() === 3, children.ids())
  check('A3 演示孩子都在大一班（和演练课表同一个班）', seeded.every(function (k) {
    return k.cls === children.CLASS_DEFAULT && k.cls === '大一班'
  }), seeded[0] && seeded[0].cls)
  check('A4 演示孩子的 id 固定是 lele / tian / mumu（课时账按 id 记）', children.ids().join(',') === 'lele,tian,mumu', children.ids())
  check('A5 演示档案字段齐全（性别 / 生日 / 家长称呼 / 11 位手机号）', seeded.every(function (k) {
    return (k.sex === '女' || k.sex === '男') && /^\d{4}-\d{2}-\d{2}$/.test(k.birthday) && !!k.parentName && /^1\d{10}$/.test(k.parentPhone)
  }), seeded[0] && seeded[0].parentPhone)
  check('A6 家长端绑定的是乐乐（OWNER.parent = lele）', children.OWNER.parent === 'lele' && children.nameOf(children.OWNER.parent) === '乐乐', children.OWNER)
  check('A7 档案存在 children_v1 里（KEY_KIDS 没写错）', children.KEY_KIDS === 'children_v1' && store['children_v1'].length === 3)
  check('A8 种过就把 children_seeded_v1 记上', children.KEY_SEEDED === 'children_seeded_v1' && store['children_seeded_v1'] === true, store['children_seeded_v1'])

  const snapshotA = snap()
  children.remove('lele')
  check('A9 演示档案只种一次：把乐乐删了再读也不会补回来', children.list().length === 2 && children.get('lele') === null, children.list().length)
  restore(snapshotA)

  check('A10 byName / nameOf / defaultChildId 都读同一份档案（查不到不崩）',
    children.byName(' 乐乐 ').id === 'lele' &&
    children.byName('没这人') === null &&
    children.nameOf('lele') === '乐乐' &&
    children.nameOf('k没这人') === 'k没这人' &&
    children.defaultChildId('parent') === 'lele' &&
    children.defaultChildId('teacher') === 'lele',
    children.defaultChildId('parent'))
  check('A11 pickerList 只给 id + name（切换孩子用）', children.pickerList().length === 3 && children.pickerList()[0].id === 'lele' && children.pickerList()[0].name === '乐乐', children.pickerList())
  check('A12 展示字段：头像取姓名首字、副标题带班级和家长、手机号打码',
    children.avatarOf(children.get('lele')) === '乐' &&
    children.subOf(children.get('lele')).indexOf('大一班 · 家长 乐乐妈妈') === 0 &&
    children.phoneText('13800000001') === '138****0001',
    children.subOf(children.get('lele')))

  /* ================= B. 建档校验：写坏数据一律拦下来 ================= */
  const snapshotB = snap()
  function form(over) {
    return Object.assign({
      name: '小满',
      sex: '男',
      birthday: '2021-05-06',
      cls: '中班',
      parentName: '小满妈妈',
      parentPhone: '13900000009',
      note: ''
    }, over || {})
  }

  let msg = children.checkForm(form({ name: '' }))
  check('B1 姓名为空要拦下来', msg === '请填写孩子姓名', msg)
  msg = children.checkForm(form({ name: '   ' }))
  check('B2 姓名只有空格也算空', msg === '请填写孩子姓名', msg)
  msg = children.checkForm(form({ name: '一'.repeat(children.NAME_MAX + 1) }))
  check('B3 姓名超过 8 个字要拦下来', msg === '姓名最多 ' + children.NAME_MAX + ' 个字', msg)
  msg = children.checkForm(form({ name: '一二三四五六七八' }))
  check('B4 姓名正好 8 个字能通过', msg === '', msg)
  msg = children.checkForm(form({ cls: '大大班' }))
  check('B5 班级必须在名单里', msg === '班级要选：' + children.CLASSES.join(' / '), msg)
  msg = children.checkForm(form({ cls: '' }))
  check('B6 班级留空时按默认大一班', msg === '', msg)
  msg = children.checkForm(form({ sex: '未知' }))
  check('B7 性别只能是 女 / 男', msg === '性别只能选：' + children.SEXES.join(' / '), msg)
  msg = children.checkForm(form({ birthday: '2020/03/08' }))
  check('B8 生日格式不对要拦下来', msg === '生日要填成 2020-03-08 这样', msg)
  msg = children.checkForm(form({ birthday: '2099-01-01' }))
  check('B9 生日不能是还没到的日期', msg === '生日不能是还没到的日期', msg)
  msg = children.checkForm(form({ birthday: todayStr() }))
  check('B10 生日是今天可以（不算未来）', msg === '', msg)
  msg = children.checkForm(form({ parentPhone: '1380000000' }))
  check('B11 家长手机号必须是 1 开头的 11 位数字', msg === '家长手机号要填 11 位数字', msg)
  msg = children.checkForm(form({ parentPhone: '23800000001' }))
  check('B12 手机号不以 1 开头的也拦下来', msg === '家长手机号要填 11 位数字', msg)
  msg = children.checkForm(form({ parentPhone: '' }))
  check('B13 手机号留空可以（选填）', msg === '', msg)
  msg = children.checkForm(form({ note: '备'.repeat(children.NOTE_MAX + 1) }))
  check('B14 备注超过 40 个字要拦下来', msg === '备注最多 ' + children.NOTE_MAX + ' 个字', msg)
  msg = children.checkForm(form({ name: '乐乐', cls: '大一班' }))
  check('B15 同一个班重名要拦住（重名会点错人）', msg.indexOf('重名会点错人') > -1 && msg.indexOf('大一班') > -1, msg)
  msg = children.checkForm(form({ name: '乐乐', cls: '小班' }))
  check('B16 跨班重名不拦（别的班可以有同名）', msg === '', msg)
  msg = children.checkForm(form({ name: '乐乐', cls: '大一班' }), 'lele')
  check('B17 改自己的档不算重名（editingId 跳过自己）', msg === '', msg)

  // 一个班 30 人上限：造一个已经满员的班，用完还原
  store[children.KEY_KIDS] = fullClass()
  store[children.KEY_SEEDED] = true
  const overflow = children.save({ name: '多出来的', cls: '小班' })
  check('B18 一个班最多 30 个孩子（第 31 个拦下来）',
    children.read().length === children.KID_MAX && overflow.ok === false && overflow.msg.indexOf('一个班最多 30 个孩子') > -1, overflow.msg)
  const keep = children.read()[0]
  const again = children.save({ id: keep.id, name: keep.name, cls: '小班' })
  check('B19 满 30 人时改老档照样能存（上限只管新建）', again.ok === true && children.read().length === children.KID_MAX, again.msg)
  restore(snapshotB)

  const created = children.save(form({ note: '  对花粉过敏  ' }))
  const savedKid = created.child ? children.get(created.child.id) : null
  check('B20 建档真的落盘了（msg「档案已建立」/ created = true）',
    created.ok === true && created.created === true && created.msg === '档案已建立' && !!savedKid && savedKid.name === '小满', created.msg)
  check('B21 存下来的是洗干净的数据（前后空格去掉）', !!savedKid && savedKid.note === '对花粉过敏' && created.child.cls === '中班', savedKid && savedKid.note)
  const newId = created.child.id
  const updated = children.save({ id: newId, name: '小满', sex: '男', birthday: '2021-05-06', cls: '中班', parentName: '小满妈妈', parentPhone: '13900000009', note: '改成对花生过敏' })
  check('B22 改档：id 不变、createdAt 保留（msg「档案已更新」）',
    updated.ok === true && updated.created === false && updated.msg === '档案已更新' && updated.child.id === newId && updated.child.createdAt === created.child.createdAt, updated.msg)
  check('B23 改档后名单里还是 4 个孩子（没有多出一条）', children.read().length === 4, children.read().length)
  check('B24 新孩子的课时账是空的（还没上过课）', billing.hoursStat(newId).left === 0 && billing.hoursStat(newId).spent === 0, billing.hoursStat(newId))

  await billing.applyHours({ amount: 3, type: 'gift', typeName: '测试补课时', childId: newId, childName: '小满' })
  const ledBefore = ledger().length
  const removed = children.remove(newId)
  check('B25 删档真的落盘了（名单里没有了）', removed.ok === true && children.get(newId) === null && children.read().length === 3, removed.msg)
  check('B26 删档不动账本（课时流水和余额格都留着）',
    ledger().length === ledBefore && billing.hoursStat(newId).left === 3 && (await billing.listLedger(10, newId)).length === 1, billing.hoursStat(newId).left)
  check('B27 删档的提示写明账还留着', removed.msg.indexOf('课时记录仍留在账单里') > -1, removed.msg)
  const gone = children.remove('k没这人')
  check('B28 没找到这个孩子的档案时有明确提示', gone.ok === false && gone.msg === '没找到这个孩子的档案', gone.msg)
  const empty = children.emptyForm()
  check('B29 emptyForm 默认值（性别女 / 班级大一班 / 其余空）', empty.sex === '女' && empty.cls === children.CLASS_DEFAULT && empty.name === '' && empty.id === '', empty)
  restore(snapshotB)

  /* ================= C. 演示赠送：每个孩子各 20 课时，一人一份 ================= */
  await schedule.bootstrap()
  const kids = children.list()
  check('C1 进课时功能就给每个孩子各送 20 课时',
    kids.length === 3 && kids.every(function (k) {
      return billing.hoursStat(k.id).left === 20
    }), kids.map(function (k) {
      return billing.hoursStat(k.id).left
    }))
  check('C2 每个孩子各占一格账（kids 里三条，各 20）', (function () {
    const b = store['billing_v1']
    return !!b && !!b.kids && Object.keys(b.kids).length === 3 && b.kids.lele.hours === 20 && b.kids.tian.hours === 20 && b.kids.mumu.hours === 20
  })(), store['billing_v1'] && store['billing_v1'].kids)
  check('C3 送的课时流水写着是哪个孩子的（childName 落盘）',
    ledger().length === 3 && ledger().every(function (r) {
      return !!r.childId && !!r.childName
    }), ledger().map(function (r) {
      return r.childName
    }))
  check('C4 判重键是 demo_gift_v1:<孩子id>（一个孩子一份）', ledger().map(function (r) {
    return r.ref
  }).sort().join(',') === 'demo_gift_v1:lele,demo_gift_v1:mumu,demo_gift_v1:tian', ledger().map(function (r) {
    return r.ref
  }))
  const ledAfterGift = ledger().length
  await schedule.bootstrap()
  check('C5 再跑一次 bootstrap 不会重复送（还是 20 / 流水没多）', billing.hoursStat('lele').left === 20 && ledger().length === ledAfterGift, ledger().length)

  const snapshotC = snap()
  store[children.KEY_KIDS] = []
  store[children.KEY_SEEDED] = true
  delete store['billing_v1']
  await schedule.bootstrap()
  check('C6 一个档案都没有时不送课时（设备账也是 0，不再变成 40）',
    billing.hoursStat().left === 0 && billing.hoursStat().spent === 0 && ledger().length === 0, billing.hoursStat())
  restore(snapshotC)

  const snapshotC7 = snap()
  const kid7 = children.save({ name: '小满', cls: '中班', sex: '男' })
  await schedule.bootstrap()
  const kid7Row = ledger().filter(function (r) {
    return r.childId === kid7.child.id
  })[0]
  check('C7 新建档的孩子下次进点名页也自动各送 20（一人一份）',
    billing.hoursStat(kid7.child.id).left === 20 && !!kid7Row && kid7Row.ref === 'demo_gift_v1:' + kid7.child.id, billing.hoursStat(kid7.child.id).left)
  restore(snapshotC7)

  const snapshotC8 = snap()
  store['billing_v1'] = { hours: 5, spent: 2, balance: 0, kids: {}, ledger: [], checkins: {}, checkinDays: 0, lastCheckinDate: '', claims: {}, claimCount: 0 }
  await schedule.bootstrap()
  check('C8 升级前设备账上的老课时划给第一个孩子（只搬账不记流水）',
    billing.hoursStat().left === 65 && billing.hoursStat().spent === 2 && billing.hoursStat('lele').left === 25 && billing.hoursStat('lele').spent === 2 && ledger().length === 3,
    billing.hoursStat('lele'))
  restore(snapshotC8)

  /* ================= D. 按孩子独立分账：点名一次按人头各扣各的 ================= */
  const day = schedule.today()
  const lesson = schedule.listDay(day).lessons[0]
  check('D1 点名名单就是孩子档案（不是写死的）',
    lesson.kids.length === 3 && lesson.kids.map(function (r) {
      return r.studentId
    }).join(',') === children.ids().join(','), lesson.kids.length)

  const before = {}
  for (let i = 0; i < kids.length; i++) before[kids[i].id] = billing.hoursStat(kids[i].id)
  const totalBefore = billing.hoursStat()
  const rows = rowsOf(lesson, 'present')
  const settled = await schedule.saveMarks(lesson.id, rows, '测试老师')
  check('D2 点名保存：3 个孩子各扣 1 课时', settled.ok === true && settled.chargedKids === 3 && settled.charged === 3, settled.msg)
  check('D3 每个孩子只动自己那一格（各少 1 课时）', kids.every(function (k) {
    return billing.hoursStat(k.id).left === before[k.id].left - 1 && billing.hoursStat(k.id).spent === before[k.id].spent + 1
  }), kids.map(function (k) {
    return billing.hoursStat(k.id).left
  }))
  check('D4 一条流水对应一个孩子（流水里带 childId / childName）', (function () {
    const hit = ledger().filter(function (r) {
      return r.ref.indexOf(lesson.id) === 0
    })
    if (hit.length !== 3) return false
    return hit.map(function (r) {
      return r.childId
    }).sort().join(',') === 'lele,mumu,tian' && hit.every(function (r) {
      return !!r.childName
    })
  })(), ledger().map(function (r) {
    return r.childId
  }))
  check('D5 流水说明里写着是哪个孩子 + 哪节课', (function () {
    const r = ledger().filter(function (x) {
      return x.childId === 'lele' && x.type === 'consume'
    })[0]
    return !!r && r.note.indexOf('乐乐') === 0 && r.note.indexOf(lesson.name) > -1
  })(), (function () {
    const r = ledger().filter(function (x) {
      return x.childId === 'lele' && x.type === 'consume'
    })[0]
    return r && r.note
  })())
  check('D6 三个孩子三条流水，不是「一个人被扣了三次」', (function () {
    const hit = ledger().filter(function (r) {
      return r.type === 'consume' && r.ref.indexOf(lesson.id) === 0
    })
    return hit.length === 3 && hit.map(function (r) {
      return r.childName
    }).sort().join(',') === '乐乐,木木,甜甜'
  })())
  check('D7 判重键是「课 + 孩子」（ref = 课id:孩子id#0）', ledger().some(function (r) {
    return r.ref === lesson.id + ':lele#0'
  }), ledger().map(function (r) {
    return r.ref
  }))
  const onlyLele = await billing.listLedger(50, 'lele')
  check('D8 按孩子查流水只倒出他自己的', onlyLele.length > 0 && onlyLele.every(function (r) {
    return r.childId === 'lele'
  }), onlyLele.length)
  check('D9 全园合计只少了 3 课时（不是一个人少 9）', billing.hoursStat().left === totalBefore.left - 3, billing.hoursStat().left)
  const dayAfter = schedule.listDay(day)
  check('D10 点完名这节课标成已结算', dayAfter.lessons[0].status === 'settled' && dayAfter.rolled === 1, dayAfter.lessons[0].status)
  check('D11 每个孩子行里显示的是他自己的余额', dayAfter.lessons[0].kids.every(function (r) {
    return r.left === billing.hoursStat(r.studentId).left
  }), dayAfter.lessons[0].kids.map(function (r) {
    return r.left
  }))

  /* ================= E. 同一节课不重复扣 / 改点法走冲正 ================= */
  const ledAfterD = ledger().length
  const againSave = await schedule.saveMarks(lesson.id, rows, '测试老师')
  check('E1 同一节课再保存一次：不再扣课时', againSave.ok === true && againSave.chargedKids === 0 && againSave.backedKids === 0, againSave.msg)
  check('E2 重复保存没有新流水（流水条数不变）', ledger().length === ledAfterD, ledger().length)

  const leleBefore = billing.hoursStat('lele')
  const tianBefore = billing.hoursStat('tian')
  const back = await schedule.saveMarks(lesson.id, rowsOf(lesson, function (id) {
    return id === 'lele' ? 'leave' : 'present'
  }), '测试老师')
  check('E3 改点法走冲正：乐乐改成请假 → 回补 1 课时', back.ok === true && back.backedKids === 1 && back.backed === 1, back.msg)
  check('E4 回补只动乐乐（甜甜 / 木木一点没动）',
    billing.hoursStat('lele').left === leleBefore.left + 1 && billing.hoursStat('tian').left === tianBefore.left, billing.hoursStat('lele').left)
  check('E5 回补流水写着孩子名和「回补」', (function () {
    const r = ledger().filter(function (x) {
      return x.type === 'refund' && x.childId === 'lele'
    })[0]
    return !!r && r.note.indexOf('乐乐') === 0 && r.note.indexOf('回补') > -1 && r.typeName === '课时回补（纠正）'
  })())
  const back2 = await schedule.saveMarks(lesson.id, rowsOf(lesson, 'present'), '测试老师')
  check('E6 再改回「到课」→ 又扣 1 课时（走新的一笔，判重键不撞老账）', (function () {
    const hit = ledger().filter(function (r) {
      return r.type === 'consume' && r.childId === 'lele' && r.ref.indexOf(lesson.id + ':lele#') === 0
    })
    return back2.ok === true && back2.chargedKids === 1 && hit.length === 2 && hit[0].ref !== hit[1].ref
  })(), back2.msg)
  const trial = await schedule.saveMarks(lesson.id, rowsOf(lesson, function (id) {
    return id === 'mumu' ? 'trial' : 'present'
  }), '测试老师')
  check('E7 试听不扣：木木改成试听 → 回补 1 课时', trial.ok === true && trial.backedKids === 1 && billing.hoursStat('mumu').left === before.mumu.left, billing.hoursStat('mumu').left)
  const absent = await schedule.saveMarks(lesson.id, rowsOf(lesson, function (id) {
    return id === 'mumu' ? 'absent' : 'present'
  }), '测试老师')
  check('E8 旷课照扣：木木再改成旷课 → 又扣 1 课时', absent.ok === true && absent.chargedKids === 1 && billing.hoursStat('mumu').left === before.mumu.left - 1, absent.msg)
  check('E9 旷课的流水上写明「旷课照扣」', ledger().some(function (r) {
    return r.childId === 'mumu' && r.note.indexOf('旷课照扣') > -1
  }))

  const lesson2 = schedule.listDay(day).lessons[1]
  const leftBefore2 = kids.map(function (k) {
    return billing.hoursStat(k.id).left
  })
  const leaveAll = await schedule.saveMarks(lesson2.id, rowsOf(lesson2, 'leave'), '测试老师')
  check('E10 全班请假也能保存（一个课时不扣，但算点过名）',
    leaveAll.ok === true && leaveAll.chargedKids === 0 && leaveAll.charged === 0 && schedule.listDay(day).lessons[1].status === 'settled', leaveAll.msg)
  check('E11 请假不扣：每个孩子的余额一课时都没变', kids.every(function (k, i) {
    return billing.hoursStat(k.id).left === leftBefore2[i]
  }), kids.map(function (k) {
    return billing.hoursStat(k.id).left
  }))

  /* ================= F. 权限：老师能看，只有管理员能改（判断只有一份） ================= */
  setDemo('teacher')
  check('F1 超级管理员（李老师）能建档 / 改档 / 删档', role.canEditChildren() === true && role.childTip() === '')
  setDemo('admin')
  check('F2 管理员（王老师）能建档 / 改档 / 删档', role.canEditChildren() === true)
  setDemo('staff')
  check('F3 普通老师（陈老师）只能看（改档由管理员负责）', role.canEditChildren() === false && role.childTip() === '')
  check('F4 普通老师被拦时给的是「找管理员」那句说明', role.CHILD_TIP.indexOf('孩子档案只能查看') > -1 && role.CHILD_TIP.indexOf('管理员') > -1, role.CHILD_TIP)
  setDemo('parent')
  check('F5 家长端不能改档案', role.canEditChildren() === false)
  check('F6 家长端有专属说明（只能看自己孩子）', role.childTip() === role.CHILD_PARENT_TIP && role.CHILD_PARENT_TIP.indexOf('只能查看') > -1, role.childTip())
  check('F7 家长端点名被一票否决（和档案页同一份口径）', role.canRoll() === false && role.rollTip() === role.ROLL_PARENT_TIP)
  check('F8 老师端三档都看得到全班（childTip 不锁人）', (function () {
    const ids = ['teacher', 'admin', 'staff']
    const out = []
    for (let i = 0; i < ids.length; i++) {
      setDemo(ids[i])
      out.push(role.childTip() === '')
    }
    return out.join(',') === 'true,true,true'
  })())
  setDemo('')
  check('F9 不是演示账号 → canEditChildren 返回 null（交给云端白名单）', role.canEditChildren() === null && role.childTip() === '' && role.canRoll() === null, role.canEditChildren())

  /* ================= G. 页面接线：pages/children ================= */
  const page = loadPage('pages/children/children.js')
  check('G1 进页面先校验身份（校验中先显示一句话，别闪一下）', page.data.checked === false && page.data.canEdit === false)

  setDemo('admin')
  const adminCtx = ctxOf(page)
  adminCtx.onLoad()
  await tick(20)
  check('G2 管理员进页面：能改档、顶部给老师那句说明',
    adminCtx.data.canEdit === true && adminCtx.data.demoLock === '' && adminCtx.data.roleTip === role.CHILD_STAFF_TIP && adminCtx.data.checked === true, adminCtx.data.roleTip)
  check('G3 进页面就把档案列出来（3 行）', adminCtx.data.rows.length === 3 && adminCtx.data.count === 3, adminCtx.data.count)
  check('G4 每行都有头像字 / 姓名 / 副标题 / 余额文案', adminCtx.data.rows.every(function (r) {
    return !!r.id && !!r.avatar && !!r.name && r.sub.indexOf('大一班') === 0 && /^余 \d/.test(r.leftText) && /^已扣 \d/.test(r.spentText)
  }), adminCtx.data.rows[0] && adminCtx.data.rows[0].leftText)
  check('G5 卡片头的三个数字来自数据层（剩余 / 已扣 / 人数）',
    adminCtx.data.sumLeft === billing.hoursStat().left && adminCtx.data.sumSpent === billing.hoursStat().spent && adminCtx.data.count === children.count(), adminCtx.data.sumLeft)
  navs.length = 0
  adminCtx.onTapRow({ currentTarget: { dataset: { id: 'lele' } } })
  check('G6 管理员点一行 → 进编辑页并带上这个孩子的 id', navs.length === 1 && navs[0] === '/pages/children-edit/children-edit?id=lele', navs)
  navs.length = 0
  adminCtx.onAdd()
  check('G7 有权限时「建立孩子档案」进建档页（不带 id）', navs.length === 1 && navs[0] === '/pages/children-edit/children-edit', navs)
  navs.length = 0
  adminCtx.onRoll()
  check('G8 老师端点「去点名」→ 进点名页', navs.length === 1 && navs[0] === '/pages/attendance/attendance', navs)
  navBacks.length = 0
  adminCtx.goBack()
  check('G9 返回按钮走统一返回逻辑（有上一页就返回）', navBacks.length === 1, navBacks)

  setDemo('staff')
  const staffCtx = ctxOf(page)
  staffCtx.checkIdentity()
  await tick(20)
  check('G10 普通老师：能看全班，但改不了（给「找管理员」那句说明）',
    staffCtx.data.canEdit === false && staffCtx.data.demoLock === role.CHILD_TIP && staffCtx.data.roleTip === role.CHILD_STAFF_TIP && staffCtx.data.rows.length === 3, staffCtx.data.demoLock)
  toasts.length = 0
  navs.length = 0
  staffCtx.onTapRow({ currentTarget: { dataset: { id: 'tian' } } })
  check('G11 没有改档权限时点一行：只弹一句说明，不进编辑页', toasts.length === 1 && toasts[0] === role.CHILD_TIP && navs.length === 0, toasts)
  toasts.length = 0
  navs.length = 0
  staffCtx.onAdd()
  check('G12 普通老师点「建立孩子档案」被拦（连建档页都进不去）', toasts.length === 1 && toasts[0] === role.CHILD_TIP && navs.length === 0, toasts)

  setDemo('parent')
  const parentCtx = ctxOf(page)
  parentCtx.checkIdentity()
  await tick(20)
  check('G13 家长端只看得到自己孩子那一份（乐乐）',
    parentCtx.data.rows.length === 1 && parentCtx.data.rows[0].id === children.OWNER.parent && parentCtx.data.count === 1, parentCtx.data.rows.length)
  check('G14 家长端顶部那句说明画出来了', parentCtx.data.tip === role.CHILD_PARENT_TIP && parentCtx.data.roleTip === '', parentCtx.data.tip)
  toasts.length = 0
  navs.length = 0
  parentCtx.onTapRow({ currentTarget: { dataset: { id: 'tian' } } })
  check('G15 家长端点行弹的是家长端那句说明（不是通用的那句）', toasts.length === 1 && toasts[0] === role.CHILD_PARENT_TIP && navs.length === 0, toasts)
  toasts.length = 0
  navs.length = 0
  parentCtx.onRoll()
  check('G16 家长端点「去点名」被一票否决', toasts.length === 1 && toasts[0] === role.ROLL_PARENT_TIP && navs.length === 0, toasts)
  toasts.length = 0
  parentCtx.onAdd()
  check('G17 家长端点「建立孩子档案」也被拦（页面上没入口，函数里再拦一道）', toasts.length === 1 && toasts[0] === role.CHILD_TIP && navs.length === 0, toasts)

  const snapshotG = snap()
  store[children.KEY_KIDS] = fullClass()
  store[children.KEY_SEEDED] = true
  setDemo('admin')
  const fullCtx = ctxOf(page)
  fullCtx.checkIdentity()
  await tick(20)
  toasts.length = 0
  navs.length = 0
  fullCtx.onAdd()
  check('G18 满 30 人时「建立孩子档案」被拦住', toasts.length === 1 && toasts[0] === '一个班最多 ' + children.KID_MAX + ' 个孩子' && navs.length === 0, toasts)
  restore(snapshotG)

  const snapshotG2 = snap()
  const small = children.save({ name: '小满', cls: '中班', sex: '男' })
  setDemo('admin')
  const newKidCtx = ctxOf(page)
  newKidCtx.checkIdentity()
  await tick(20)
  const smallRow = findRow(newKidCtx.data.rows, small.child.id)
  check('G19 新孩子的行：余 0 课时 + 标成偏低颜色', !!smallRow && smallRow.leftText === '余 0 课时' && smallRow.leftClass === 'low' && smallRow.avatar === '小', smallRow && smallRow.leftText)
  check('G20 行里的班级 / 已扣文案都由数据层算好（WXML 不做运算）', !!smallRow && smallRow.spentText === '已扣 0 课时' && smallRow.cls === '中班' && smallRow.tone.length > 0, smallRow && smallRow.spentText)
  restore(snapshotG2)

  setDemo('')
  delete store[KEY_LOCAL_ADMIN]
  const cloudCtx = ctxOf(page)
  cloudCtx.checkIdentity()
  await tick(20)
  check('G21 不是演示账号：照旧走云端白名单，本机没权限时只能看', cloudCtx.data.canEdit === false && cloudCtx.data.demoLock === '', cloudCtx.data.demoLock)
  store[KEY_LOCAL_ADMIN] = 1
  const localCtx = ctxOf(page)
  localCtx.checkIdentity()
  await tick(20)
  check('G22 本机体验管理员标记打开后，非演示账号能改档', localCtx.data.canEdit === true && localCtx.data.demoLock === '', localCtx.data.canEdit)
  delete store[KEY_LOCAL_ADMIN]

  const childWxml = fs.readFileSync(path.join(root, 'pages/children/children.wxml'), 'utf8')
  check('G23 名单里每一行都绑了 onTapRow（点一行看详情）', childWxml.indexOf('bindtap="onTapRow"') > -1 && childWxml.indexOf('data-id="{{item.id}}"') > -1)
  check('G24 没有改档权限时不渲染「建立孩子档案」，改渲染锁提示', childWxml.indexOf('wx:if="{{canEdit}}" bindtap="onAdd"') > -1 && childWxml.indexOf('wx:else>{{demoLock}}') > -1)
  check('G25 家长端卡片头写「只看自己孩子」（和全班名单区分开）', childWxml.indexOf("{{mine ? '只看自己孩子' : '全班名单'}}") > -1)
  check('G26 家长端提示条和老师端提示条是两条不同的线', childWxml.indexOf('wx:if="{{tip}}"') > -1 && childWxml.indexOf('wx:if="{{roleTip}}"') > -1)
  check('G27 校验中 / 校验完两个分支必须相邻（中间不夹注释）', childWxml.indexOf('wx:if="{{!checked}}"') > -1 && childWxml.indexOf('<block wx:else>') > childWxml.indexOf('wx:if="{{!checked}}"'))

  // 「加课时入口做的明显点」：名单顶部提示条 + 每行橙色大按钮
  const snapshotAdd = snap() // 这段只是验证「加课时入口」，补的课时用完立刻还原，别污染后面的流水断言
  setDemo('admin')
  const addListCtx = ctxOf(page)
  addListCtx.checkIdentity()
  await tick(20)
  check('G28 演示账号 + 管理员：demo 标记为真（页面据此画加课时入口）',
    addListCtx.data.demo === true && addListCtx.data.canEdit === true, addListCtx.data.demo)
  const tianLeftG = billing.hoursStat('tian').left
  const leleLeftG = billing.hoursStat('lele').left
  toasts.length = 0
  addListCtx.onAdd3({ currentTarget: { dataset: { id: 'tian', name: '甜甜' } } })
  await tick(20)
  check('G29 名单里点「＋3 课时」：只补这一行那个孩子，别的孩子一分不动',
    toasts.length === 1 && toasts[0] === '已给 甜甜 补 3 课时' &&
    billing.hoursStat('tian').left === tianLeftG + 3 && billing.hoursStat('lele').left === leleLeftG, toasts)
  const tianRowG = findRow(addListCtx.data.rows, 'tian')
  check('G30 补完名单立刻刷新（这一行余额跟着变）',
    !!tianRowG && tianRowG.leftText === '余 ' + (tianLeftG + 3) + ' 课时', tianRowG && tianRowG.leftText)
  toasts.length = 0
  addListCtx.onAdd3({ currentTarget: { dataset: { id: 'tian', name: '甜甜' } } })
  await tick(20)
  check('G31 名单里补课时也故意不写 ref：可以重复点（再点一次又 +3）',
    billing.hoursStat('tian').left === tianLeftG + 6, billing.hoursStat('tian').left)
  check('G32 名单里补的课时也写在这个孩子名下（流水带 childId）', (function () {
    const hit = ledger().filter(function (r) {
      return r.childId === 'tian' && r.typeName === '补课时（测试）'
    })
    return hit.length === 2 && hit[0].childName === '甜甜'
  })())

  setDemo('staff')
  const staffListCtx = ctxOf(page)
  staffListCtx.checkIdentity()
  await tick(20)
  check('G33 普通老师：是演示账号，但没有改档权限 → 不画加课时入口',
    staffListCtx.data.demo === true && staffListCtx.data.canEdit === false, staffListCtx.data.demo)
  const tianLeftG2 = billing.hoursStat('tian').left
  toasts.length = 0
  staffListCtx.onAdd3({ currentTarget: { dataset: { id: 'tian', name: '甜甜' } } })
  await tick(20)
  check('G34 普通老师绕过界面调 onAdd3 也被拦，课时一分没动',
    toasts.length === 1 && toasts[0] === role.CHILD_TIP && billing.hoursStat('tian').left === tianLeftG2, toasts)

  setDemo('parent')
  const parentListCtx = ctxOf(page)
  parentListCtx.checkIdentity()
  await tick(20)
  check('G35 家长端：是演示账号，但权限一票否决 → 不画加课时入口',
    parentListCtx.data.demo === true && parentListCtx.data.canEdit === false, parentListCtx.data.demo)
  const leleLeftG2 = billing.hoursStat('lele').left
  toasts.length = 0
  parentListCtx.onAdd3({ currentTarget: { dataset: { id: 'lele', name: '乐乐' } } })
  await tick(20)
  check('G36 家长端绕过界面调 onAdd3 也被拦，乐乐课时没动',
    toasts.length === 1 && toasts[0] === role.CHILD_TIP && billing.hoursStat('lele').left === leleLeftG2, toasts)
  restore(snapshotAdd)

  check('G37 名单每行的加课时按钮：catchtap（不误触整行）+ 只在「有权限 + 演示账号」时画',
    childWxml.indexOf('class="k-add" wx:if="{{canEdit && demo}}"') > -1 && childWxml.indexOf('catchtap="onAdd3"') > -1)
  check('G38 名单上面有加课时提示条，且排在名单卡片前面（一进来就看得到）',
    childWxml.indexOf('class="add-banner" wx:if="{{canEdit && demo}}"') > -1 &&
    childWxml.indexOf('add-banner') < childWxml.indexOf('class="card"'))
  const childWxss = fs.readFileSync(path.join(root, 'pages/children/children.wxss'), 'utf8')
  check('G39 提示条和每行按钮都是橙色（.add-banner / .k-add 都有定义，别是没样式的裸文字）',
    childWxss.indexOf('.add-banner {') > -1 && childWxss.indexOf('.k-add {') > -1 &&
    childWxss.indexOf('linear-gradient(135deg, #FFB020, #F08A00)') > -1)

  /* ================= H. 页面接线：pages/children-edit ================= */
  const editPage = loadPage('pages/children-edit/children-edit.js')
  setDemo('admin')
  const newCtx = ctxOf(editPage)
  newCtx.onLoad({})
  await tick(20)
  check('H1 新建档：标题 / 空表单 / 默认班级大一班 / 今天日期',
    newCtx.data.title === '建立孩子档案' && newCtx.data.editId === '' && newCtx.data.name === '' &&
    newCtx.data.cls === children.CLASS_DEFAULT && newCtx.data.clsIndex === children.CLASSES.indexOf(children.CLASS_DEFAULT) &&
    newCtx.data.today === todayStr() && newCtx.data.canEdit === true, newCtx.data.cls)
  check('H2 新建档：性别默认女，两个胶囊的选中态跟着走',
    newCtx.data.sex === '女' && newCtx.data.sexList.length === 2 && newCtx.data.sexList[0].on === true && newCtx.data.sexList[1].on === false)
  check('H3 新建档时表单里没有课时卡（还没有这个孩子的账）', newCtx.data.leftText === '')

  const leleNow = children.get('lele')
  const leleLeft = billing.hoursStat('lele').left
  const editCtx = ctxOf(editPage)
  editCtx.onLoad({ id: 'lele' })
  await tick(20)
  check('H4 打开老档：表单填上这个孩子的资料',
    editCtx.data.title === '编辑孩子档案' && editCtx.data.editId === 'lele' && editCtx.data.name === leleNow.name &&
    editCtx.data.birthday === leleNow.birthday && editCtx.data.parentPhone === leleNow.parentPhone && editCtx.data.note === leleNow.note &&
    editCtx.data.clsIndex === children.CLASSES.indexOf(leleNow.cls), editCtx.data.name)
  check('H5 老档顶部显示这个孩子自己的账（只算他自己的）',
    editCtx.data.leftText.indexOf('只算他自己的') > -1 && editCtx.data.leftText.indexOf('剩 ' + leleLeft + ' 课时') > -1, editCtx.data.leftText)
  editCtx.onInput({ currentTarget: { dataset: { key: 'name' } }, detail: { value: '乐乐乐' } })
  check('H6 输入框改动按 data-key 同步到表单', editCtx.data.name === '乐乐乐')
  editCtx.onInput({ currentTarget: { dataset: {} }, detail: { value: 'x' } })
  check('H7 没有 data-key 的输入不改任何字段（不会串字段）', editCtx.data.name === '乐乐乐' && editCtx.data.note === leleNow.note)
  editCtx.onPickSex({ currentTarget: { dataset: { key: '男' } } })
  check('H8 选性别：选中态跟着走', editCtx.data.sex === '男' && editCtx.data.sexList[1].on === true && editCtx.data.sexList[0].on === false)
  editCtx.onBirth({ detail: { value: '2020-01-02' } })
  check('H9 选生日写进表单', editCtx.data.birthday === '2020-01-02')
  editCtx.onCls({ detail: { value: children.CLASSES.indexOf('小班') } })
  check('H10 选班级：写班级名 + 记住下标', editCtx.data.cls === '小班' && editCtx.data.clsIndex === children.CLASSES.indexOf('小班'))
  editCtx.onCls({ detail: { value: 99 } })
  check('H11 班级下标越界时回默认班级（不会变成 undefined）',
    editCtx.data.cls === children.CLASS_DEFAULT && editCtx.data.clsIndex === children.CLASSES.indexOf(children.CLASS_DEFAULT), editCtx.data.cls)

  const newCtx2 = ctxOf(editPage)
  newCtx2.onLoad({})
  await tick(20)
  navBacks.length = 0
  toasts.length = 0
  newCtx2.onSave()
  check('H12 姓名空着保存 → 页面弹数据层那句提示，也不返回', toasts.length === 1 && toasts[0] === '请填写孩子姓名' && navBacks.length === 0, toasts)
  toasts.length = 0
  newCtx2.onInput({ currentTarget: { dataset: { key: 'name' } }, detail: { value: '小满' } })
  newCtx2.onCls({ detail: { value: children.CLASSES.indexOf('中班') } })
  newCtx2.onSave()
  check('H13 新建档保存成功 → toast「档案已建立」', toasts[0] === '档案已建立' && children.byName('小满') !== null, toasts)
  await tick(700)
  check('H14 保存成功后返回档案页（没上一页就回档案页）', navBacks.length === 1, navBacks)

  const dupCtx = ctxOf(editPage)
  dupCtx.onLoad({})
  await tick(20)
  toasts.length = 0
  dupCtx.onInput({ currentTarget: { dataset: { key: 'name' } }, detail: { value: '乐乐' } })
  dupCtx.onCls({ detail: { value: children.CLASSES.indexOf('大一班') } })
  dupCtx.onSave()
  check('H15 同一个班重名 → 页面把数据层那句提示弹出来', toasts.length === 1 && toasts[0].indexOf('重名会点错人') > -1, toasts)

  const updCtx = ctxOf(editPage)
  updCtx.onLoad({ id: 'mumu' })
  await tick(20)
  toasts.length = 0
  updCtx.onInput({ currentTarget: { dataset: { key: 'note' } }, detail: { value: '中午要多留意' } })
  updCtx.onSave()
  check('H16 改档保存 → toast「档案已更新」，id 不变、名单没多出来',
    toasts[0] === '档案已更新' && children.get('mumu').note === '中午要多留意' && children.count() === 4, toasts)
  await tick(700)

  setDemo('staff')
  const staffEdit = ctxOf(editPage, { editId: 'tian' })
  staffEdit.checkIdentity()
  await tick(20)
  check('H17 普通老师进建档页：只有锁卡片，表单一个字都不填',
    staffEdit.data.canEdit === false && staffEdit.data.demoLock === role.CHILD_TIP && staffEdit.data.name === '', staffEdit.data.demoLock)
  toasts.length = 0
  staffEdit.onSave()
  check('H18 普通老师点保存被拦（绕过界面也存不了）', toasts.length === 1 && toasts[0] === role.CHILD_TIP, toasts)
  toasts.length = 0
  staffEdit.onAdd3()
  check('H19 普通老师点「＋3 课时」被拦', toasts.length === 1 && toasts[0] === role.CHILD_TIP, toasts)
  toasts.length = 0
  staffEdit.onDelete()
  check('H20 普通老师点删除被拦（档案还在）', toasts.length === 1 && toasts[0] === role.CHILD_TIP && children.get('tian') !== null, toasts)

  setDemo('parent')
  const parentEdit = ctxOf(editPage, { editId: 'lele' })
  parentEdit.checkIdentity()
  await tick(20)
  check('H21 家长端进建档页：给的是家长端专属说明', parentEdit.data.canEdit === false && parentEdit.data.demoLock === role.CHILD_PARENT_TIP, parentEdit.data.demoLock)
  toasts.length = 0
  const leleLeftH = billing.hoursStat('lele').left
  parentEdit.onAdd3()
  check('H22 家长端点「＋3 课时」被拦，乐乐课时一分没动', toasts.length === 1 && toasts[0] === role.CHILD_PARENT_TIP && billing.hoursStat('lele').left === leleLeftH, toasts)

  setDemo('admin')
  const addCtx = ctxOf(editPage)
  addCtx.onLoad({ id: 'tian' })
  await tick(20)
  const tianLeft = billing.hoursStat('tian').left
  const leleLeft2 = billing.hoursStat('lele').left
  toasts.length = 0
  addCtx.onAdd3()
  await tick(20)
  check('H23 「＋3 课时」记在这个孩子头上（别的孩子不动）',
    toasts[0] === '已补 3 课时' && billing.hoursStat('tian').left === tianLeft + 3 && billing.hoursStat('lele').left === leleLeft2, billing.hoursStat('tian').left)
  check('H24 补完课时卡片上的数字立刻刷新', addCtx.data.leftText.indexOf('剩 ' + (tianLeft + 3) + ' 课时') > -1, addCtx.data.leftText)
  addCtx.onAdd3()
  await tick(20)
  check('H25 补课时故意不写 ref：可以重复点（再点一次又 +3）', billing.hoursStat('tian').left === tianLeft + 6, billing.hoursStat('tian').left)
  check('H26 补课时的流水写着这个孩子的名字', (function () {
    const hit = ledger().filter(function (r) {
      return r.childId === 'tian' && r.typeName === '补课时（测试）'
    })
    return hit.length === 2 && hit[0].childName === '甜甜'
  })())

  const xiaoman = children.byName('小满')
  await billing.applyHours({ amount: 2, type: 'gift', typeName: '测试补课时', childId: xiaoman.id, childName: '小满' })
  const delCtx = ctxOf(editPage)
  delCtx.onLoad({ id: xiaoman.id })
  await tick(20)
  toasts.length = 0
  navBacks.length = 0
  delCtx.onDelete()
  check('H27 删除走数据层真删（档案没了）', toasts.length === 1 && toasts[0] === '档案已删除（课时记录仍留在账单里）' && children.get(xiaoman.id) === null, toasts)
  await tick(700)
  check('H28 删完返回档案页，课时流水还留着',
    navBacks.length === 1 && (await billing.listLedger(50, xiaoman.id)).length === 1 && billing.hoursStat(xiaoman.id).left === 2, billing.hoursStat(xiaoman.id).left)

  const editWxml = fs.readFileSync(path.join(root, 'pages/children-edit/children-edit.wxml'), 'utf8')
  check('H29 姓名输入框：最多 8 个字 + 绑 onInput + data-key=name',
    editWxml.indexOf('maxlength="8"') > -1 && editWxml.indexOf('data-key="name"') > -1 && editWxml.indexOf('bindinput="onInput"') > -1)
  check('H30 备注框：最多 40 个字 + data-key=note', editWxml.indexOf('maxlength="40"') > -1 && editWxml.indexOf('data-key="note"') > -1)
  check('H31 家长手机号框：数字键盘 + 11 位 + data-key=parentPhone',
    editWxml.indexOf('type="number"') > -1 && editWxml.indexOf('maxlength="11"') > -1 && editWxml.indexOf('data-key="parentPhone"') > -1)
  check('H32 生日选择器不能选到今天以后（end = 今天）', editWxml.indexOf('end="{{today}}"') > -1 && editWxml.indexOf('bindchange="onBirth"') > -1)
  check('H33 班级选择器：range 用数据层的班级名单', editWxml.indexOf('range="{{clsList}}"') > -1 && editWxml.indexOf('bindchange="onCls"') > -1)
  check('H34 性别胶囊：点一下选中（on 标记由 js 算）', editWxml.indexOf('bindtap="onPickSex"') > -1 && editWxml.indexOf('{{item.on') > -1)
  check('H35 「＋3 课时（测试用）」只在「有改档权限 + 演示账号」时出现', editWxml.indexOf('wx:if="{{canEdit && demo}}" hover-class="add3-btn-hover" bindtap="onAdd3"') > -1)
  check('H36 删除按钮只在编辑老档时出现（新建档没有）', editWxml.indexOf('wx:if="{{editId}}" bindtap="onDelete"') > -1)
  check('H37 保存按钮文案跟着「新建 / 改档 / 保存中」变', editWxml.indexOf("{{saving ? '正在保存…' : (editId ? '保存修改' : '建立档案')}}") > -1)
  check('H38 三分支相邻：正在校验 / 锁卡片 / 表单（中间不夹注释）',
    editWxml.indexOf('wx:if="{{!checked}}"') > -1 &&
    editWxml.indexOf('wx:elif="{{!canEdit}}"') > editWxml.indexOf('wx:if="{{!checked}}"') &&
    editWxml.indexOf('<block wx:else>') > editWxml.indexOf('wx:elif="{{!canEdit}}"'))
  check('H39 锁卡片上写着「建档只有管理员能做」+ 当前身份', editWxml.indexOf('建档只有管理员能做') > -1 && editWxml.indexOf('{{demoLock}}') > -1 && editWxml.indexOf('{{curName}}') > -1)
  check('H40 课时卡（＋3 课时）排在「孩子信息」表单前面：一进页面就看见',
    editWxml.indexOf('add3-btn') > -1 && editWxml.indexOf('add3-btn') < editWxml.indexOf('孩子信息'))
  const editWxss = fs.readFileSync(path.join(root, 'pages/children-edit/children-edit.wxss'), 'utf8')
  check('H41 详情页按钮做大了：橙色卡片高亮（.add3-card）+ 大号橙色实心按钮（.add3-btn 有定义）',
    editWxss.indexOf('.add3-card {') > -1 && editWxss.indexOf('.add3-btn {') > -1 &&
    editWxss.indexOf('linear-gradient(135deg, #FFB020, #F08A00)') > -1)

  console.log(bad ? '\n❌ 失败 ' + bad + ' 项' : '\n✅ 孩子档案 + 按孩子分账冒烟测试全部通过')
  process.exit(bad ? 1 : 0)
}

main().catch(function (e) {
  console.log('❌ 抛异常：' + (e && e.stack ? e.stack : e))
  process.exit(1)
})
