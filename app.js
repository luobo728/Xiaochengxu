// app.js —— 全局逻辑与共享数据

// 顶部红色滚动屏展示的活动（bg 为卡片渐变背景，cover 留空则只用渐变）
const ACTIVITIES = [
  {
    id: 'act-1',
    tag: '大型活动',
    title: '2026 春季亲子运动会',
    desc: '4月18日 09:00 · 中心操场 · 全员参与',
    thumbText: '运动会',
    bg: 'linear-gradient(135deg,#3A5BFF,#1E2F8F)',
    cover: ''
  },
  {
    id: 'act-2',
    tag: '报名中',
    title: '六一文艺汇演报名',
    desc: '截止 5月10日 · 每班限 3 个节目',
    thumbText: '报名表',
    bg: 'linear-gradient(135deg,#FF7A59,#F0432B)',
    cover: ''
  },
  {
    id: 'act-3',
    tag: '保健',
    title: '春季健康体检安排',
    desc: '4月22日 · 保健室 · 请携带体检本',
    thumbText: '体检表',
    bg: 'linear-gradient(135deg,#22C1A6,#0E9E8A)',
    cover: ''
  },
  {
    id: 'act-4',
    tag: '食谱',
    title: '本周营养食谱已更新',
    desc: '周一至周五 · 三餐两点',
    thumbText: '食谱',
    bg: 'linear-gradient(135deg,#FFB020,#F08A00)',
    cover: ''
  },
  {
    id: 'act-5',
    tag: '安全',
    title: '消防演练与安全教育周',
    desc: '4月25日 · 全园 · 请家长配合',
    thumbText: '演练',
    bg: 'linear-gradient(135deg,#8A6BFF,#5B34E8)',
    cover: ''
  }
]

// 顶部跑马灯滚动公告
const NOTICES = [
  { id: 'n1', title: '周六亲子运动会报名截止 4月15日 18:00', time: '04-14', tag: '活动' },
  { id: 'n2', title: '春季流感高发，请为宝贝准备一件外套', time: '04-13', tag: '保健' },
  { id: 'n3', title: '4月20日 家长开放日，欢迎家长准时参加', time: '04-12', tag: '通知' },
  { id: 'n4', title: '本周五 16:00 结束接送，请提前安排', time: '04-11', tag: '提示' }
]

App({
  globalData: {
    statusBarHeight: 20,
    navBarHeight: 44,
    activities: ACTIVITIES,
    notices: NOTICES,
    lastPhotoPath: ''
  },

  onLaunch() {
    this.initSystemInfo()
  },

  // 兼容取状态栏高度：新版 API 优先，异常时兜底 20px
  initSystemInfo() {
    let statusBarHeight = 20
    try {
      const win = typeof wx.getWindowInfo === 'function'
        ? wx.getWindowInfo()
        : wx.getSystemInfoSync()
      if (win && win.statusBarHeight) {
        statusBarHeight = win.statusBarHeight
      }
    } catch (e) {
      statusBarHeight = 20
    }

    let navBarHeight = 44
    try {
      const rect = wx.getMenuButtonBoundingClientRect()
      if (rect && rect.height) {
        navBarHeight = (rect.top - statusBarHeight) * 2 + rect.height
      }
    } catch (e) {
      navBarHeight = 44
    }

    this.globalData.statusBarHeight = statusBarHeight
    this.globalData.navBarHeight = navBarHeight
  }
})
