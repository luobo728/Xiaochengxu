// pages/index/index.js —— 首页：活动滚动屏 + 常用功能 + 今日安排 + 最新通知
const app = getApp()
const menu = require('../../utils/menu.js')

// 常用功能入口（bg 为渐变背景，icon 为中文单字，避免依赖图片资源）
const QUICK_ENTRIES = [
  { key: 'meal', text: '今日食谱', icon: '食', bg: 'linear-gradient(135deg,#FFB020,#F08A00)' },
  { key: 'leave', text: '请假申请', icon: '假', bg: 'linear-gradient(135deg,#4C8BFF,#2D5FEF)' },
  { key: 'notice', text: '通知公告', icon: '通', bg: 'linear-gradient(135deg,#3FC5A0,#12A182)' },
  { key: 'growth', text: '成长档案', icon: '档', bg: 'linear-gradient(135deg,#FF7A59,#F0432B)' }
]

const TODAY_PLANS = [
  { id: 'p1', time: '08:30', name: '晨间游戏与早操', teacher: '李老师', room: '中庭', done: true },
  { id: 'p2', time: '09:20', name: '主题课 · 春天的颜色', teacher: '王老师', room: '大一班', done: true },
  { id: 'p3', time: '10:30', name: '户外体能活动', teacher: '张老师', room: '中心操场', done: false }
]

Page({
  data: {
    statusBarHeight: 20,
    today: '',
    activities: [],
    actIndex: 0,
    marqueeText: '',
    marqueeDuration: 20,
    quickEntries: QUICK_ENTRIES,
    todayPlans: TODAY_PLANS,
    notices: [],
    // 页面是否在前台，用来暂停动画（隐藏时停掉跑马灯/轮播，省性能）
    pageActive: true
  },

  onLoad() {
    const g = app.globalData || {}
    const activities = g.activities || []
    const notices = g.notices || []
    const marqueeText = this.buildMarquee(notices)

    this.setData({
      statusBarHeight: g.statusBarHeight || 20,
      today: this.buildToday(),
      activities,
      notices: notices.slice(0, 3),
      marqueeText,
      // 按时长比例给滚动速度：约 0.4s 滚过一个字
      marqueeDuration: Math.min(60, Math.max(16, Math.round(marqueeText.length * 0.4)))
    })
  },

  onShow() {
    // 同步自定义 tabBar 选中态（首页 = 0）
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().setData({ selected: 0 })
    }
    // 回到前台恢复动画
    this.setData({ pageActive: true })
    // 后台预热「今日食谱」数据，等用户点进食谱页就不用再等网络
    menu.prefetchToday()
  },

  onHide() {
    // 页面不可见时停掉跑马灯与轮播，避免白耗性能导致切页发卡
    this.setData({ pageActive: false })
  },

  // 日期文案：4月16日 周三
  buildToday() {
    const d = new Date()
    const week = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][d.getDay()]
    return (d.getMonth() + 1) + '月' + d.getDate() + '日 ' + week
  },

  // 跑马灯文案（渲染两份实现无缝滚动）
  buildMarquee(notices) {
    if (!notices || !notices.length) return ''
    return notices.map(function (n) { return n.title }).join('　·　')
  },

  onActChange(e) {
    const current = e.detail.current
    // 值未变化时不回写，避免 swiper 在 circular + autoplay 下被重复 setData 打断
    if (current === this.data.actIndex) return
    this.setData({ actIndex: current })
  },

  onActTap(e) {
    const title = e.currentTarget.dataset.title || '活动'
    wx.showToast({ title: title + ' 详情待接入', icon: 'none' })
  },

  onBell() {
    wx.showToast({ title: '暂无新消息', icon: 'none' })
  },

  onQuickTap(e) {
    const key = e.currentTarget.dataset.key
    if (key === 'meal') {
      wx.navigateTo({ url: '/pages/menu/menu' })
      return
    }
    if (key === 'notice') {
      wx.switchTab({ url: '/pages/campus/campus' })
      return
    }
    wx.showToast({ title: (e.currentTarget.dataset.text || '功能') + ' 待接入', icon: 'none' })
  },

  onNoticeTap(e) {
    wx.showToast({ title: '通知详情待接入', icon: 'none' })
  },

  goCourse() {
    wx.switchTab({ url: '/pages/course/course' })
  },

  goCampus() {
    wx.switchTab({ url: '/pages/campus/campus' })
  },

  onShareAppMessage() {
    return {
      title: '阳光幼儿园 · 家园共育',
      path: '/pages/index/index'
    }
  }
})
