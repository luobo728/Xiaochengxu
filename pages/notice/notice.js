// pages/notice/notice.js —— 通知详情：公众号文章正文风格
// 家长从首页点通知进来看到这里；管理员在这个页面上多一个「编辑这条通知」按钮
const app = getApp()
const notice = require('../../utils/notice.js')
const nav = require('../../utils/nav.js')

Page({
  data: {
    statusBarHeight: 20,
    // 是否找到这条通知：false 时显示空态（找不到 / 定向推送看不到，文案不一样）
    found: false,
    // 空态文案：数据层和页面都可能改写它
    emptyText: '这条通知已被删除',
    id: '',
    // 展示字段全部来自数据层，页面不改写文案
    title: '',
    tag: '',
    time: '',
    top: false,
    // 正文段落（按换行拆开，一段一个 view）
    paragraphs: [],
    // 定向推送的范围（如「仅 大一班」）：全园时为空串，页面不显示标签
    rangeText: '',
    rangeTone: 'tag-blue',
    // 管理员才会出现底部的「编辑这条通知」
    isAdmin: false
  },

  onLoad(options) {
    const opts = options || {}
    const id = opts.id ? decodeURIComponent(opts.id) : ''
    this.setData({
      statusBarHeight: (app.globalData && app.globalData.statusBarHeight) || 20,
      id: id
    })
    this.load()
    this.checkAdmin()
  },

  onShow() {
    // 从编辑页返回时重新读一次：刚才改的内容马上能看到
    if (this.data.id) this.load()
  },

  // 读这一条通知：本机有就直接显示；本机没有（云端模式刚清过缓存）就先拉一次最新
  load() {
    const row = notice.getById(this.data.id)
    if (row) {
      this.paintRow(row)
      return
    }
    // 本地模式没有更多来源了，直接显示空态
    if (notice.MODE !== 'cloud' || !notice.isCloudReady()) {
      this.paintMissing('这条通知已被删除')
      return
    }
    Promise.resolve(notice.list())
      .then((rows) => {
        const again = notice.getById(this.data.id)
        if (!again) {
          this.paintMissing('这条通知已被删除')
          return
        }
        this.paintRow(again)
      })
      .catch(() => {
        this.paintMissing('这条通知已被删除')
      })
  },

  // 把一条通知画到页面上
  paintRow(row) {
    // 定向推送：不属于自己班的通知看不到（从分享链接直接点进来也一样挡住）
    if (!notice.canSee(row)) {
      this.paintMissing('这条通知只推送给「' + notice.targetOf(row) + '」的家长')
      return
    }
    this.setData({
      found: true,
      emptyText: '这条通知已被删除',
      title: row.title,
      tag: row.tag,
      time: row.time,
      top: !!row.top,
      rangeText: this.rangeChip(row),
      rangeTone: notice.rangeTone(row),
      paragraphs: this.splitBody(row.body)
    })
  },

  // 详情页的范围小标签：定向推送才显示（「全园」不显示，免得每条都挂个灰标签）
  rangeChip(row) {
    return notice.targetOf(row) === notice.ALL_CLASS ? '' : notice.rangeText(row)
  },

  // 找不到 / 看不到这条通知时统一走这里，只有文案不一样
  paintMissing(text) {
    this.setData({
      found: false,
      paragraphs: [],
      emptyText: text || '这条通知已被删除'
    })
  },

  // 正文按换行拆成段落；空行不显示
  splitBody(body) {
    return String(body || '')
      .split('\n')
      .map(function (line) { return String(line).replace(/^\s+|\s+$/g, '') })
      .filter(function (line) { return !!line })
  },

  // 判断是不是管理员：是的话显示编辑按钮（判断逻辑在数据层，页面不自己算）
  checkAdmin() {
    notice.adminStatus().then((res) => {
      this.setData({ isAdmin: !!(res && res.isAdmin) })
    }).catch(() => {
      this.setData({ isAdmin: false })
    })
  },

  toEdit() {
    if (!this.data.id) return
    wx.navigateTo({
      url: '/pages/notice-admin/notice-admin?id=' + encodeURIComponent(this.data.id),
      fail() {
        wx.showToast({ title: '编辑页打开失败', icon: 'none' })
      }
    })
  },

  goBack() {
    // 没有上一页时（如从分享直接进入）回首页
    nav.back('/pages/index/index')
  },

  onShareAppMessage() {
    return {
      title: this.data.title || '阳光幼儿园 · 通知公告',
      path: '/pages/notice/notice?id=' + encodeURIComponent(this.data.id || '')
    }
  }
})
