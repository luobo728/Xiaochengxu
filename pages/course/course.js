// pages/course/course.js —— 课时（这本账的展示页）
//
// 页面自己一个课时都不算，数字全来自本机课时账本：
//   本学期课时 / 已完成 / 剩余     ← utils/schedule.js 的 courseStats(childId)
//   本周进度 / 本周课程 / 近 30 天明细 ← utils/schedule.js（课表 + 账本）
//
// 重要：课时是「按孩子」算的 —— 这一页一次只看一个孩子，各看各的：
//   家长端演示账号 —— 看自己孩子（OWNER 里那一个，只给看一个，不给切换）
//   老师端演示账号 / 真登录账号 —— 记住上次看的孩子，默认档案里第一个
// 老师在「点名」页保存后，这一页会自动跟着变（进页面就重读一次账）。
const app = getApp()
const schedule = require('../../utils/schedule.js')
const children = require('../../utils/children.js')
const role = require('../../utils/demo-role.js')
const account = require('../../utils/account.js')

// 老师来回看不同孩子时记住上一个（只存一个孩子 id）
const KEY_PICK = 'course_kid_v1'

Page({
  data: {
    statusBarHeight: 20,
    // 在看谁
    kidId: '',
    kidName: '全园合计',
    multiKid: false, // 档案里不止一个孩子 → 才谈得上「切换」
    kidLock: false, // 家长端演示账号：只看自己孩子，不给切换
    // 本学期课时统计
    totalHours: 0,
    doneHours: 0,
    leftHours: 0,
    // 本周课时进度
    weekDone: 0,
    weekTotal: 0,
    weekPercent: 0,
    // 本周课程列表
    weekCourses: [],
    // 课时明细（近 30 天）
    records: []
  },

  onLoad() {
    this.setData({
      statusBarHeight: (app.globalData && app.globalData.statusBarHeight) || 20
    })
    this.pickKid()
  },

  onShow() {
    // 同步自定义 tabBar 的选中态
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().setData({ selected: 1 })
    }
    // 每次回到这一页都重读账本：老师点名、家长领课时都会让这里变化；
    // 顺手重定一次「看谁」——去别的页面切过演示账号，这一页也该跟着变
    this.pickKid()
  },

  // 决定这一页看谁：家长端锁自己孩子，其他身份看记住的那个（默认档案里第一个）
  pickKid() {
    const acc = account.current()
    const accId = acc ? acc.id : ''
    const lock = role.isParent()
    let id = ''
    if (!lock) {
      // 记住的选择只在孩子还在档案里时作数（孩子被删了就自动回默认，不留空页）
      const saved = String(wx.getStorageSync(KEY_PICK) || '')
      if (saved && children.get(saved)) id = saved
    }
    if (!id) id = children.defaultChildId(accId)
    const kid = id ? children.get(id) : null
    this.setData({
      kidId: id,
      kidName: kid ? kid.name : '全园合计',
      // 一个孩子都没有 / 家长锁着：都没必要显示「切换」
      multiKid: children.count() > 1,
      kidLock: lock
    })
    this.refresh()
  },

  // 换一个孩子看（家长端不给切：课时是他自己孩子的）
  onPickKid() {
    if (this.data.kidLock) {
      wx.showToast({ title: '课时是你自己孩子的，只能看他一个', icon: 'none' })
      return
    }
    const list = children.pickerList()
    if (list.length < 2) {
      wx.showToast({ title: '档案里只有一个孩子，不用切换', icon: 'none' })
      return
    }
    const items = []
    let cur = -1
    for (let i = 0; i < list.length; i++) {
      items.push(list[i].name + (list[i].id === this.data.kidId ? '（当前）' : ''))
      if (list[i].id === this.data.kidId) cur = i
    }
    const that = this
    wx.showActionSheet({
      itemList: items,
      success(res) {
        const idx = res && typeof res.tapIndex === 'number' ? res.tapIndex : -1
        if (idx < 0 || idx >= list.length || idx === cur) return
        // 记住这次的选择，下次进来还是看他
        wx.setStorageSync(KEY_PICK, list[idx].id)
        that.setData({ kidId: list[idx].id, kidName: list[idx].name })
        that.refresh()
      },
      fail() {
        // 点了取消：什么都不做
      }
    })
  },

  // 读账：只读这一个孩子的（顺手把过期没点名的课补算掉，和点名页同一套规则）
  refresh() {
    const that = this
    schedule
      .courseStats(this.data.kidId)
      .then((st) => {
        that.render(st)
      })
      .catch(() => {
        // 读不到就给一份空数据，页面不白屏、不弹错
        that.render(null)
      })
  },

  // 把算好的数字铺到页面上
  render(st) {
    const d = st || {}
    const patch = {
      totalHours: d.totalHours || 0,
      doneHours: d.doneHours || 0,
      leftHours: d.leftHours || 0,
      weekDone: d.weekDone || 0,
      weekTotal: d.weekTotal || 0,
      weekPercent: d.weekPercent || 0,
      weekCourses: d.weekCourses || [],
      records: d.records || []
    }
    // 名字以账本那边算出来的为准（一个孩子都没有时就是「全园合计」）
    if (d.kidName) patch.kidName = d.kidName
    this.setData(patch)
  },

  // 统一轻量交互
  onMoreTap() {
    wx.showToast({ title: '功能开发中', icon: 'none' })
  }
})