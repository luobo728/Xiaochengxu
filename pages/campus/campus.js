const app = getApp()
const monitor = require('../../utils/monitor.js')

// 校园页监控分区最多展示几路画面
const MAX_CAM_ROWS = 3

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
    // 班级相册（纯 CSS 绘制，无图片资源）
    album: [
      {
        id: 1,
        word: '运动会',
        cap: '大一班 · 04-12',
        bg: 'linear-gradient(135deg,#FF8A6B,#F0343C)'
      },
      {
        id: 2,
        word: '手工课',
        cap: '大一班 · 04-10',
        bg: 'linear-gradient(135deg,#59A2FF,#2E6BFF)'
      },
      {
        id: 3,
        word: '春游日',
        cap: '春晖园 · 04-09',
        bg: 'linear-gradient(135deg,#4FD1A5,#12A182)'
      },
      {
        id: 4,
        word: '绘本角',
        cap: '大一班 · 04-08',
        bg: 'linear-gradient(135deg,#FFB45B,#F08A24)'
      },
      {
        id: 5,
        word: '午餐时',
        cap: '大一班 · 04-08',
        bg: 'linear-gradient(135deg,#9B8CFF,#6A5BEF)'
      },
      {
        id: 6,
        word: '音乐课',
        cap: '大一班 · 04-07',
        bg: 'linear-gradient(135deg,#4CC5E8,#1A93C8)'
      }
    ],
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
  },

  // 统一轻量交互
  onMoreTap() {
    wx.showToast({ title: '功能开发中', icon: 'none' })
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
