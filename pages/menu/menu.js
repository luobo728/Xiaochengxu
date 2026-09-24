// pages/menu/menu.js —— 今日食谱（客户端只读）
// 只做两件事：加载管理员上传的食谱图片、按餐次分组展示；
// 不提供任何上传/删除/保存入口。
const app = getApp()
const menu = require('../../utils/menu.js')
const mealUtil = require('../../utils/meal.js')

const DAY_COUNT = 7
const WEEK = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']

function pad(n) {
  return n < 10 ? '0' + n : '' + n
}

function fmt(date) {
  return date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate())
}

// 最近 7 天（含今天），今天的标签直接写「今天」
function buildDays() {
  const list = []
  const now = new Date()
  for (let i = 0; i < DAY_COUNT; i++) {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i)
    let week = WEEK[d.getDay()]
    if (i === 0) week = '今天'
    else if (i === 1) week = '昨天'
    list.push({
      date: fmt(d),
      week: week,
      label: d.getMonth() + 1 + '/' + d.getDate()
    })
  }
  return list
}

Page({
  data: {
    statusBarHeight: 20,
    days: [],
    date: '',
    dateText: '',
    cloudReady: true,
    cloudError: '',
    loading: true,
    failed: false,
    groups: [],
    total: 0
  },

  onLoad() {
    const days = buildDays()
    this.setData({
      statusBarHeight: (app.globalData && app.globalData.statusBarHeight) || 20,
      days: days,
      date: days[0].date,
      dateText: days[0].date + ' ' + days[0].week,
      cloudReady: menu.isCloudReady(),
      cloudError: menu.cloudError()
    })

    if (menu.isCloudReady()) {
      this.load()
    } else {
      this.setData({ loading: false })
    }
  },

  onPullDownRefresh() {
    if (!menu.isCloudReady()) {
      wx.stopPullDownRefresh()
      return
    }
    this.load(true)
  },

  // 切换日期
  onDayTap(e) {
    const date = e.currentTarget.dataset.date
    if (!date || date === this.data.date) return

    let text = date
    for (let i = 0; i < this.data.days.length; i++) {
      if (this.data.days[i].date === date) {
        text = this.data.days[i].date + ' ' + this.data.days[i].week
        break
      }
    }

    this.setData({
      date: date,
      dateText: text,
      loading: true,
      failed: false,
      groups: [],
      total: 0
    })
    this.load()
  },

  // 加载指定日期的图片记录
  load(isPull) {
    const date = this.data.date
    // 竞态保护：快速切日期时丢弃过期响应，避免显示成另一天的图片
    const seq = (this._seq = (this._seq || 0) + 1)

    menu
      .listByDate(date)
      .then((rows) => {
        if (seq !== this._seq || this.data.date !== date) {
          if (isPull) wx.stopPullDownRefresh()
          return
        }
        const groups = menu.groupByMeal(rows, mealUtil.MEALS)
        let total = 0
        for (let i = 0; i < groups.length; i++) {
          total += groups[i].photos.length
        }
        this.setData({ groups: groups, total: total, loading: false, failed: false })
        if (isPull) wx.stopPullDownRefresh()
      })
      .catch(() => {
        if (seq !== this._seq) {
          if (isPull) wx.stopPullDownRefresh()
          return
        }
        this.setData({ loading: false, failed: true })
        if (isPull) wx.stopPullDownRefresh()
      })
  },

  onRetry() {
    // 云开发未就绪时先重新初始化一次，避免只能靠重启小程序
    if (!menu.isCloudReady()) {
      if (app && typeof app.initCloud === 'function') app.initCloud()
      this.setData({ cloudReady: menu.isCloudReady(), cloudError: menu.cloudError() })
      if (!menu.isCloudReady()) return
    }
    this.setData({ loading: true, failed: false })
    this.load()
  },

  // 点击图片：只做全屏浏览（不提供保存/分享等入口）
  onPreview(e) {
    const ds = e.currentTarget.dataset
    const group = this.findGroup(ds.meal)
    if (!group || !group.photos.length) return

    const ids = group.photos.map(function (p) {
      return p.fileID
    })
    const index = Number(ds.index) || 0

    menu.previewUrls(ids).then(function (urls) {
      if (!urls.length) return
      wx.previewImage({
        current: urls[index] || urls[0],
        urls: urls,
        fail() {
          // 极少数机型/基础库不支持云文件 ID 直接预览时会走到这里
          wx.showToast({ title: '图片加载失败，请下拉刷新后重试', icon: 'none' })
        }
      })
    })
  },

  findGroup(mealKey) {
    const groups = this.data.groups || []
    for (let i = 0; i < groups.length; i++) {
      if (groups[i].key === mealKey) return groups[i]
    }
    return null
  },

  goBack() {
    wx.navigateBack({
      delta: 1,
      fail() {
        wx.switchTab({ url: '/pages/index/index' })
      }
    })
  }
})
