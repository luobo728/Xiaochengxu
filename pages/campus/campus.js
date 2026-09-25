const app = getApp()
const monitor = require('../../utils/monitor.js')
const album = require('../../utils/album.js')
const albumView = require('../../utils/album-view.js')

// 校园页监控分区最多展示几路画面
const MAX_CAM_ROWS = 3
// 校园页「班级相册」最多展示几本（其余去相册页看）
const MAX_ALBUM_ROWS = 6

Page({
  data: {
    statusBarHeight: 20,
    // 头部统计
    attendToday: 28,
    attendTotal: 30,
    weekEvents: 3,
    // 校园快讯
    news: [
      {
        id: 1,
        ico: '讯',
        title: '春游通知 · 本周五 8:30 园门口集合',
        time: '今天 08:20',
        bg: 'linear-gradient(135deg,#4FD1A5,#12A182)'
      },
      {
        id: 2,
        ico: '安',
        title: '春季消防安全演练已完成',
        time: '昨天 15:40',
        bg: 'linear-gradient(135deg,#59A2FF,#2E6BFF)'
      },
      {
        id: 3,
        ico: '活',
        title: '亲子运动会报名开始，名额 30 名',
        time: '04-12 09:00',
        bg: 'linear-gradient(135deg,#FFB45B,#F08A24)'
      },
      {
        id: 4,
        ico: '餐',
        title: '本周食谱已更新，请查收',
        time: '04-11 17:30',
        bg: 'linear-gradient(135deg,#9B8CFF,#6A5BEF)'
      }
    ],
    // 班级相册：从 utils/album.js 拿真实数据（本班 + 全园），没数据时显示空状态提示
    albumCards: [],
    albumClass: '',
    albumCount: 0,
    // 本周食谱
    menu: [
      { day: '周一', dish: '番茄牛腩 · 时蔬 · 紫菜蛋花汤' },
      { day: '周二', dish: '香菇滑鸡 · 清炒西兰花 · 冬瓜汤' },
      { day: '周三', dish: '土豆烧肉 · 蒜蓉青菜 · 玉米排骨汤' },
      { day: '周四', dish: '虾仁蒸蛋 · 手撕包菜 · 番茄豆腐汤' },
      { day: '周五', dish: '红烧鸡翅 · 上汤娃娃菜 · 罗宋汤' }
    ],
    // 园区监控
    monitorReady: false, // 是否已接入监控后端
    camLoaded: false,    // 列表是否已成功拉到（区分「还没拉到」与「确实没有」）
    windowText: '',      // 开放时段说明
    cameras: [],         // 已接入时展示的摄像头（最多前 MAX_CAM_ROWS 路）
    camTotal: 0          // 摄像头总数
  },

  onLoad() {
    this.setData({
      statusBarHeight: (app.globalData && app.globalData.statusBarHeight) || 20
    })
    // 园区监控：未接入时只显示占位状态，不去请求接口
    const monitorReady = monitor.isReady()
    this.setData({ monitorReady: monitorReady, windowText: monitor.openWindowText() || '' })
    if (monitorReady) this.loadCameras()
  },

  onShow() {
    // 同步自定义 tabBar 的选中态
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().setData({ selected: 2 })
    }
    // 班级相册：每次回到这一页都重新画一次（老师刚传的照片要能立刻看到）
    this.refreshAlbums()
  },

  // 统一轻量交互（还没做好的入口）
  onMoreTap() {
    wx.showToast({ title: '功能开发中', icon: 'none' })
  },

  /* ---------------- 班级相册 ---------------- */

  // 先用本机数据把相册块画出来（不等网络），再拉一次最新覆盖
  refreshAlbums() {
    const myClass = album.myClassSync()
    this.setData({ albumClass: myClass })
    this.paintAlbums(album.listAlbumsSync(myClass))
    album
      .listAlbums(myClass)
      .then((rows) => {
        this.paintAlbums(rows)
      })
      .catch(() => {
        // 网络不通就继续用本机数据
      })
  },

  // 数据行 → 校园页的相册小块（封面字 / 说明 / 底色都用 utils/album-view.js 算好的）
  paintAlbums(rows) {
    const cards = albumView.toCards(rows)
    const list = []
    for (let i = 0; i < cards.length && i < MAX_ALBUM_ROWS; i++) {
      const card = cards[i]
      list.push({
        id: card.id,
        word: card.word,
        cover: card.cover,
        hasCover: card.hasCover,
        bg: card.bg,
        cap: card.className + ' · ' + card.date
      })
    }
    this.setData({ albumCards: list, albumCount: cards.length })
  },

  // 点某一本：直接进相册页看那一本的照片
  onAlbumTap(e) {
    const id = (e.currentTarget.dataset || {}).id || ''
    this.openAlbum(id)
  },

  // 点「更多」：进相册页看列表
  onAlbumMore() {
    this.openAlbum('')
  },

  openAlbum(id) {
    wx.navigateTo({
      url: '/pages/album/album' + (id ? '?id=' + encodeURIComponent(id) : ''),
      fail: () => {
        wx.showToast({ title: '相册页暂时打不开', icon: 'none' })
      }
    })
  },

  // ---------- 园区监控 ----------

  // 拉取摄像头列表；失败静默，卡片保持未接入占位状态
  loadCameras() {
    monitor
      .getCameras()
      .then((list) => {
        const all = list || []
        this.setData({
          cameras: all.slice(0, MAX_CAM_ROWS),
          camTotal: all.length,
          camLoaded: true
        })
      })
      .catch(() => {})
  },

  // 点击某一路画面 / 查看全部：已接入进监控页，未接入只提示
  onCamTap(e) {
    if (!this.data.monitorReady) {
      wx.showToast({ title: '监控正在对接中', icon: 'none' })
      return
    }
    const ds = (e && e.currentTarget && e.currentTarget.dataset) || {}
    wx.navigateTo({
      url: '/pages/monitor/monitor' + (ds.id ? '?id=' + encodeURIComponent(ds.id) : ''),
      fail: () => {
        wx.showToast({ title: '监控页暂时打不开', icon: 'none' })
      }
    })
  }
})
