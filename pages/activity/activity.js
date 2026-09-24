// pages/activity/activity.js —— 活动中心：公众号消息列表风格的活动列表
const app = getApp()
// 活动数据层：orderedList() 已把「最近查看」的那条排到最前
const activity = require('../../utils/activity.js')
const nav = require('../../utils/nav.js')

Page({
  data: {
    statusBarHeight: 20,
    // 完整列表（置顶项与其余项都由它切出来）
    list: [],
    // 置顶卡：列表第一条
    topItem: null,
    // 下面的「全部活动」：去掉置顶那条，避免重复出现
    rest: [],
    total: 0
  },

  onLoad(options) {
    const opts = options || {}
    // 从首页活动卡带 id 进来：先记「最近查看」，这条就会被置顶
    if (opts.id) {
      activity.markViewed(String(opts.id))
    }
    this.setData({
      statusBarHeight: (app.globalData && app.globalData.statusBarHeight) || 20
    })
    this.loadList()
  },

  onShow() {
    // 从详情返回时「最近查看」可能已经变了，重新排一次置顶（首次进入 onLoad 已排过）
    if (this.ready) {
      this.loadList()
    }
    this.ready = true
  },

  // 读取列表并切成「置顶 + 其余」
  loadList() {
    const list = activity.orderedList() || []
    this.setData({
      list: list,
      topItem: list[0] || null,
      rest: list.slice(1),
      total: list.length
    })
  },

  onOpenTop() {
    this.openDetail(this.data.topItem && this.data.topItem.id)
  },

  onOpenItem(e) {
    const ds = (e && e.currentTarget && e.currentTarget.dataset) || {}
    this.openDetail(ds.id)
  },

  // 打开详情：先记「最近查看」，返回本页时这条会置顶
  openDetail(id) {
    if (!id) {
      wx.showToast({ title: '活动信息不完整', icon: 'none' })
      return
    }
    activity.markViewed(id)
    wx.navigateTo({
      url: '/pages/activity/detail?id=' + encodeURIComponent(id),
      fail: () => {
        wx.showToast({ title: '打开活动详情失败', icon: 'none' })
      }
    })
  },

  goBack() {
    // 没有上一页时（如从分享直接进入）回首页
    nav.back('/pages/index/index')
  }
})
