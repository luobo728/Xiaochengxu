// pages/children-edit/children-edit.js —— 建立 / 编辑孩子档案
//
// 这一页是「点名 → 扣课时」整条链路的起点：
//   ① 建档：姓名必填（同一个班不许重名 —— 重名会点错人）；
//   ② 建好档，这个孩子就进了点名名单（点名页的名单就是这份档案）；
//   ③ 每个孩子各一本课时账：点谁的课只扣谁的课时，互相不影响。
//
// 页面只做「显示 + 把用户填的东西交给数据层」，校验和保存都在 utils/children.js。
//
// 权限（判断只有一份，在 utils/demo-role.js）：
//   超级管理员 / 管理员 —— 能建档、改档、删档
//   普通老师、家长端     —— 进不来（页面显示锁卡片，不是空白）
//   真登录账号           —— 照旧走云端白名单 / 本机体验管理员
const app = getApp()
const children = require('../../utils/children.js')
const billing = require('../../utils/billing.js')
const role = require('../../utils/demo-role.js')
const account = require('../../utils/account.js')
const notice = require('../../utils/notice.js')
const nav = require('../../utils/nav.js')

// 生日选择器的上限：不能选到今天以后（未来的生日没有意义）
function pad2(n) {
  return n < 10 ? '0' + n : '' + n
}

function todayStr() {
  const d = new Date()
  return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate())
}

// 班级选择器的下标（新建档默认落在 CLASS_DEFAULT）
function clsIndexOf(cls) {
  const i = children.CLASSES.indexOf(cls)
  return i < 0 ? children.CLASSES.indexOf(children.CLASS_DEFAULT) : i
}

// 性别 / 班级的选中态（WXML 里不做运算，都在这里算好）
function sexRows(sex) {
  const out = []
  for (let i = 0; i < children.SEXES.length; i++) {
    const k = children.SEXES[i]
    out.push({ key: k, on: k === sex })
  }
  return out
}

Page({
  data: {
    statusBarHeight: 20,

    // 身份
    checked: false, // 校验完了没有（校验中先显示一句话，别闪一下）
    canEdit: false, // 能不能建档 / 改档 / 删档
    demoLock: '', // 不能改时那句说明（长句，空表示不锁）
    curName: '', // 当前身份，例如「管理员 · 王老师」

    // 表单
    editId: '', // '' = 新建档；有 id = 改这个孩子的档案
    title: '建立孩子档案',
    sub: '建档 → 点名 → 按孩子各扣各的课时',
    name: '',
    sex: '女',
    birthday: '',
    cls: children.CLASS_DEFAULT,
    parentName: '',
    parentPhone: '',
    note: '',
    sexList: [],
    clsList: children.CLASSES,
    clsIndex: 0,
    today: '',
    saving: false,

    // 编辑时：这个孩子自己的课时账
    leftText: '',

    // 说明文案（进页面时填，避免加载期读存储）
    modeTip: ''
  },

  onLoad(query) {
    const id = (query && query.id) || ''
    this.setData({
      statusBarHeight: (app.globalData && app.globalData.statusBarHeight) || 20,
      today: todayStr(),
      editId: id,
      title: id ? '编辑孩子档案' : '建立孩子档案',
      sexList: sexRows('女'),
      clsIndex: clsIndexOf(children.CLASS_DEFAULT),
      modeTip: id
        ? '演示数据：改完点下面的「保存修改」立刻生效 —— 点名名单读的就是这份档案。'
        : '演示数据：建好档，这个孩子立刻进点名名单，课时记在他自己名下（几个孩子各算各的）。'
    })
    this.checkIdentity()
  },

  // 身份校验：这一页只有管理员能进（能改档案的才能来）
  checkIdentity() {
    const that = this
    const acc = account.current()
    const can = role.canEditChildren()
    const curName = acc ? acc.side + ' · ' + acc.name : ''

    if (can === null) {
      // 真登录账号：照旧走云端白名单 / 本机体验管理员
      return notice
        .adminStatus()
        .then(
          function (res) {
            that.apply(curName, !!(res && res.isAdmin), '')
          },
          function () {
            that.apply(curName, false, '查看模式：当前账号没有管理员权限，建档 / 改档 / 删档做不了。')
          }
        )
    }

    this.apply(curName, can, can ? '' : this.whyNot())
  },

  // 老师端普通老师 / 家长端的拦人文案（家长端说清楚：找老师）
  whyNot() {
    return role.level() === 'parent' ? role.CHILD_PARENT_TIP : role.CHILD_TIP
  },

  apply(curName, canEdit, lock) {
    this.setData({ checked: true, canEdit: canEdit, demoLock: lock, curName: curName })
    if (canEdit) this.loadForm()
  },

  // 把档案读进表单（新建档用空白表单）
  loadForm() {
    const that = this
    const id = this.data.editId
    if (!id) {
      const f = children.emptyForm()
      this.setData({
        name: f.name,
        sex: f.sex,
        birthday: f.birthday,
        cls: f.cls,
        parentName: f.parentName,
        parentPhone: f.parentPhone,
        note: f.note,
        sexList: sexRows(f.sex),
        clsIndex: clsIndexOf(f.cls)
      })
      return
    }

    const kid = children.get(id)
    if (!kid) {
      // 档案被删了就退回列表，不要停在一个读不到人的表单上
      wx.showToast({ title: '这个孩子的档案已经不在了', icon: 'none' })
      setTimeout(function () {
        nav.back('/pages/children/children')
      }, 600)
      return
    }

    this.setData({
      name: kid.name,
      sex: children.sexText(kid),
      birthday: kid.birthday || '',
      cls: kid.cls || children.CLASS_DEFAULT,
      parentName: kid.parentName || '',
      parentPhone: kid.parentPhone || '',
      note: kid.note || '',
      sexList: sexRows(children.sexText(kid)),
      clsIndex: clsIndexOf(kid.cls)
    })

    // 这个孩子自己那本账（别的孩子扣多少都不影响这里）
    billing.kidsStat([id]).then(
      function (stats) {
        const st = stats[0]
        if (!st) return
        that.setData({
          leftText: '这个孩子目前剩 ' + st.left + ' 课时，已经上掉 ' + st.spent + ' 课时 —— 只算他自己的，别的孩子扣多少都不影响这里。'
        })
      },
      function () {
        that.setData({ leftText: '' })
      }
    )
  },

  // 输入框：姓名 / 家长称呼 / 家长手机号 / 备注（data-key 决定写哪个字段）
  onInput(e) {
    const ds = (e && e.currentTarget && e.currentTarget.dataset) || {}
    const key = ds.key
    if (!key) return
    const val = e && e.detail ? e.detail.value : ''
    const upd = {}
    upd[key] = val
    this.setData(upd)
  },

  // 选性别
  onPickSex(e) {
    const key = ((e && e.currentTarget && e.currentTarget.dataset) || {}).key
    if (!key) return
    this.setData({ sex: key, sexList: sexRows(key) })
  },

  // 选生日（不能选到今天以后）
  onBirth(e) {
    const val = e && e.detail ? e.detail.value : ''
    this.setData({ birthday: val })
  },

  // 选班级
  onCls(e) {
    const idx = Number(e && e.detail ? e.detail.value : 0)
    const cls = children.CLASSES[idx] || children.CLASS_DEFAULT
    this.setData({ cls: cls, clsIndex: clsIndexOf(cls) })
  },

  // 保存：校验在数据层，这里只把结果告诉用户
  onSave() {
    if (this.data.saving) return
    if (!this.data.canEdit) {
      wx.showToast({ title: this.data.demoLock || role.CHILD_TIP, icon: 'none', duration: 3000 })
      return
    }

    const res = children.save({
      id: this.data.editId,
      name: this.data.name,
      sex: this.data.sex,
      birthday: this.data.birthday,
      cls: this.data.cls,
      parentName: this.data.parentName,
      parentPhone: this.data.parentPhone,
      note: this.data.note
    })

    if (!res.ok) {
      wx.showToast({ title: res.msg, icon: 'none', duration: 3000 })
      return
    }

    this.setData({ saving: true })
    wx.showToast({ title: res.created ? '档案已建立' : '档案已更新', icon: 'success' })
    setTimeout(function () {
      nav.back('/pages/children/children')
    }, 600)
  },

  // 删除：删的是名单，课时流水留着（账单里还查得到）
  onDelete() {
    const that = this
    if (!this.data.canEdit) {
      wx.showToast({ title: this.data.demoLock || role.CHILD_TIP, icon: 'none', duration: 3000 })
      return
    }
    wx.showModal({
      title: '删除这个孩子的档案？',
      content: '删了就回到没建档：点名名单里没有他，不能再给他点名。已经记下的课时流水不会删，账单里还查得到。',
      confirmText: '删除',
      cancelText: '再想想',
      success(res) {
        if (!res.confirm) return
        const out = children.remove(that.data.editId)
        wx.showToast({ title: out.msg, icon: 'none', duration: 2000 })
        setTimeout(function () {
          nav.back('/pages/children/children')
        }, 600)
      }
    })
  },

  // 返回上一页；没有上一页时回「孩子档案」
  goBack() {
    nav.back('/pages/children/children')
  }
})
