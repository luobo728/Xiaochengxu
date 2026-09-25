// pages/course/course.js —— 课时（这本账的展示页）
//
// 页面自己一个课时都不算，数字全来自本机课时账本：
//   本学期课时 / 已完成 / 剩余     ← billing.hoursStat()（总 = 已完成 + 剩余）
//   本周进度 / 本周课程 / 近 30 天明细 ← utils/schedule.js（课表 + 账本）
// 老师在「点名」页保存后，这一页会自动跟着变（进页面就重读一次账）。
const app = getApp()
const schedule = require('../../utils/schedule.js')

Page({
  data: {
    statusBarHeight: 20,
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
  },

  onShow() {
    // 同步自定义 tabBar 的选中态
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().setData({ selected: 1 })
    }
    // 每次回到这一页都重读账本：老师点名、家长领课时都会让这里变化
    this.refresh()
  },

  // 读账：顺手把过期没点名的课补算掉（和点名页同一套规则）
  refresh() {
    const that = this
    schedule
      .courseStats()
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
    this.setData({
      totalHours: d.totalHours || 0,
      doneHours: d.doneHours || 0,
      leftHours: d.leftHours || 0,
      weekDone: d.weekDone || 0,
      weekTotal: d.weekTotal || 0,
      weekPercent: d.weekPercent || 0,
      weekCourses: d.weekCourses || [],
      records: d.records || []
    })
  },

  // 统一轻量交互
  onMoreTap() {
    wx.showToast({ title: '功能开发中', icon: 'none' })
  }
})
