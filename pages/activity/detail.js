// pages/activity/detail.js —— 活动详情：公众号文章正文风格
const app = getApp()
const activity = require('../../utils/activity.js')
const nav = require('../../utils/nav.js')

Page({
  data: {
    statusBarHeight: 20,
    // 是否找到这条活动：false 时显示空态
    found: false,
    // 展示字段全部来自数据层，页面不改写文案
    tag: '',
    title: '',
    desc: '',
    thumbText: '',
    bg: '',
    source: '',
    dateText: '',
    readCount: 0,
    // 正文段落
    paragraphs: []
  },

  onLoad(options) {
    const opts = options || {}
    const id = opts.id ? decodeURIComponent(opts.id) : ''
    this.setData({
      statusBarHeight: (app.globalData && app.globalData.statusBarHeight) || 20
    })
    if (!id) {
      return
    }
    // 进来就算看过：活动中心的置顶会跟着更新
    activity.markViewed(id)
    const d = activity.getDetail(id)
    if (!d) {
      return
    }
    this.setData({
      found: true,
      tag: d.tag || '',
      title: d.title || '',
      desc: d.desc || '',
      thumbText: d.thumbText || '',
      bg: d.bg || '',
      source: d.source || '',
      dateText: d.dateText || '',
      readCount: d.readCount || 0,
      paragraphs: d.paragraphs || []
    })
  },

  onJoin() {
    wx.showToast({ title: '报名功能待接入', icon: 'none' })
  },

  goBack() {
    // 没有上一页时（如从分享直接进入）回活动中心
    nav.back('/pages/activity/activity')
  }
})
