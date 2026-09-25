// pages/children/children.js —— 孩子档案（建档 / 改档 / 删档；点名名单的唯一来源）
//
// 这一页解决什么问题：课时是「按孩子」算的 —— 谁上了哪节课、扣了谁几课时、
// 谁还剩几课时，都要记在孩子自己名下。名单在档案里维护好之后：
//   ① 点名页的名单 = 这份档案（建好档就能点名，不用改代码）；
//   ② 每点一次名，只扣「这一个孩子」的课时，几个孩子各记一本账，互不影响；
//   ③ 「课时」页选中哪个孩子，就看他自己那本账；明细里每笔都写着是谁的课时。
//
// 权限（判断只有一份，在 utils/demo-role.js）：
//   超级管理员（李老师）/ 管理员（王老师）—— 能建档、改档、删档
//   普通老师（陈老师）                    —— 能看，改档案由管理员负责
//   家长端演示账号（乐乐妈妈）            —— 只看自己孩子的档案，改不了
//   真登录账号                            —— 照旧走云端白名单 / 本机体验管理员
const app = getApp()
const children = require('../../utils/children.js')
const billing = require('../../utils/billing.js')
const role = require('../../utils/demo-role.js')
const account = require('../../utils/account.js')
const notice = require('../../utils/notice.js')
const nav = require('../../utils/nav.js')

// 头像底色（本项目不放图片资源，头像 = 名字第一个字 + 渐变底）
const TONES = [
  'linear-gradient(135deg, #5AA9FF, #2E6BFF)',
  'linear-gradient(135deg, #FFB35A, #F08A00)',
  'linear-gradient(135deg, #2FD0C7, #0A9C95)',
  'linear-gradient(135deg, #A98BFF, #6A5BEF)',
  'linear-gradient(135deg, #FF8A8A, #E05252)'
]

// 一行档案的显示字段（WXML 里不做运算，都在这里算好）
function rowOf(child, st, i) {
  const left = st ? st.left : 0
  const sex = children.sexText(child)
  return {
    id: child.id,
    avatar: children.avatarOf(child),
    tone: TONES[i % TONES.length],
    name: child.name,
    sexText: sex,
    sexClass: sex === '男' ? 'sex-boy' : 'sex-girl',
    cls: child.cls || '',
    sub: children.subOf(child),
    note: child.note || '',
    leftNum: left,
    leftText: '余 ' + left + ' 课时',
    leftClass: left <= 4 ? 'low' : '',
    spentText: st ? '已扣 ' + st.spent + ' 课时' : '还没上过课'
  }
}

Page({
  data: {
    statusBarHeight: 20,

    // 身份
    checked: false, // 校验完了没有（校验中先显示一句话，别闪一下）
    canEdit: false, // 能不能建档 / 改档 / 删档
    demoLock: '', // 不能改时的一句说明（不是拦人，是说明白该找谁）
    curName: '', // 当前身份，例如「家长端 · 乐乐妈妈」
    tip: '', // 家长端顶部的一句话
    roleTip: '', // 老师端顶部的一句话
    mine: '', // 家长端：只看这个孩子的档案（'' = 看全班）

    // 档案列表
    rows: [],
    count: 0,
    sumLeft: 0, // 剩余课时合计（含历史未分账）
    sumSpent: 0, // 已扣课时合计

    // 说明文案（进页面时由数据层填，避免加载期读存储）
    modeTip: '',
    steps: [
      { id: 1, no: '1', txt: '点下面的「＋ 建立孩子档案」给孩子建档（姓名必填，班级 / 生日 / 家长电话选填）。建好档，点名名单里立刻就有他。' },
      { id: 2, no: '2', txt: '到「我的 → 点名」选一天：点名表里的名单就是这份档案。没有档案的孩子不会出现在名单里。' },
      { id: 3, no: '3', txt: '给几个孩子分别点状态（到课 / 请假 / 旷课 / 试听）再保存：每个孩子只扣自己的课时，账单明细里每笔都写着是谁的课时 —— 不会再出现「点一次名像扣了三次」。' },
      { id: 4, no: '4', txt: '切到家长端（乐乐妈妈）看这一页：只能看到自己孩子的档案，改不了；老师端才有建档、改档、删档。' }
    ]
  },

  onLoad() {
    this.setData({
      statusBarHeight: (app.globalData && app.globalData.statusBarHeight) || 20,
      modeTip: '演示数据：档案存在这台手机上，改了立刻生效。点名名单和「课时」页都读这份档案 —— 每个孩子各记一本账。'
    })
    this.checkIdentity()
  },

  onShow() {
    // 首次进入：onLoad 已经填过一次了，这里不重复
    if (!this.shown) {
      this.shown = true
      return
    }
    // 去别的页切过演示账号、或者从编辑页建档回来：重新校验 + 重新读一遍
    this.checkIdentity()
  },

  // 身份校验：能不能改档案（能看是所有人的权利：家长看自己孩子的）
  checkIdentity() {
    const that = this
    const acc = account.current()
    const lv = role.level()
    const mine = acc && acc.id === role.PARENT ? children.OWNER[acc.id] : ''
    const can = role.canEditChildren()
    this.mine = mine || ''

    const base = {
      checked: true,
      curName: acc ? acc.side + ' · ' + acc.name : '',
      tip: lv === 'parent' ? role.CHILD_PARENT_TIP : '',
      roleTip: lv === 'super' || lv === 'admin' || lv === 'none' ? role.CHILD_STAFF_TIP : '',
      mine: this.mine
    }

    if (can === null) {
      // 真登录账号：照旧走云端白名单 / 本机体验管理员（本机拿不到就当只能看）
      return notice
        .adminStatus()
        .then(
          function (res) {
            that.gate = !!(res && res.isAdmin)
            that.apply(base, that.gate, '')
          },
          function () {
            that.gate = false
            that.apply(base, false, '查看模式：当前账号没有管理员权限，建档 / 改档 / 删档做不了。')
          }
        )
    }

    this.gate = can
    this.apply(base, can, can ? '' : role.CHILD_TIP)
  },

  // 把身份结论落到页面上（canEdit 决定按不按得了；tip 说明白为什么）
  apply(base, canEdit, lock) {
    this.gate = canEdit
    this.setData({
      checked: base.checked,
      canEdit: canEdit,
      demoLock: lock,
      curName: base.curName,
      tip: base.tip,
      roleTip: base.roleTip,
      mine: base.mine
    })
    this.load()
  },

  // 读档案 + 每个孩子的课时（家长端只看自己孩子）
  load() {
    const that = this
    const all = children.list()
    const list = []
    for (let i = 0; i < all.length; i++) {
      if (!that.mine || all[i].id === that.mine) list.push(all[i])
    }
    const ids = []
    for (let j = 0; j < list.length; j++) ids.push(list[j].id)

    return billing.kidsStat(ids).then(
      function (stats) {
        const rows = []
        for (let i = 0; i < list.length; i++) rows.push(rowOf(list[i], stats[i], i))
        const agg = billing.hoursStat()
        that.setData({
          rows: rows,
          count: list.length,
          sumLeft: agg.left,
          sumSpent: agg.spent
        })
      },
      function () {
        // 课时读不到不该让档案页空白：至少把孩子列出来
        const rows = []
        for (let i = 0; i < list.length; i++) rows.push(rowOf(list[i], null, i))
        that.setData({ rows: rows, count: list.length })
      }
    )
  },

  // 点一行：能改就进编辑页，只能看就说清楚（家长端点不出编辑页）
  onTapRow(e) {
    const ds = (e && e.currentTarget && e.currentTarget.dataset) || {}
    const id = ds.id
    if (!id) return
    if (!this.data.canEdit) {
      wx.showToast({
        title: this.data.tip || role.CHILD_TIP,
        icon: 'none',
        duration: 3000
      })
      return
    }
    wx.navigateTo({ url: '/pages/children-edit/children-edit?id=' + id })
  },

  // 建立孩子档案
  onAdd() {
    if (!this.data.canEdit) {
      wx.showToast({ title: this.data.demoLock || role.CHILD_TIP, icon: 'none', duration: 3000 })
      return
    }
    if (children.count() >= children.KID_MAX) {
      wx.showToast({ title: '一个班最多 ' + children.KID_MAX + ' 个孩子', icon: 'none' })
      return
    }
    wx.navigateTo({ url: '/pages/children-edit/children-edit' })
  },

  // 去点名：档案建好就能点名（点名名单就是这一页的档案）
  // 家长端一票否决；真登录账号不在这里判断，交给点名页自己校验（判断只有一份）
  onRoll() {
    if (role.canRoll() === false) {
      wx.showToast({ title: role.ROLL_PARENT_TIP, icon: 'none', duration: 3000 })
      return
    }
    wx.navigateTo({ url: '/pages/attendance/attendance' })
  },

  // 返回上一页；没有上一页时回「我的」
  goBack() {
    nav.back('/pages/mine/mine')
  }
})
