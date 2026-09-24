const app = getApp()

Page({
  data: {
    statusBarHeight: 20,
    // 本学期课时统计
    totalHours: 128,
    doneHours: 76,
    leftHours: 52,
    // 本周课时进度
    weekDone: 6,
    weekTotal: 10,
    weekPercent: 60,
    // 本周课程列表
    weekCourses: [
      {
        id: 1,
        ico: '主',
        name: '主题课 · 春天的颜色',
        sub: '周二 09:20 · 王老师',
        val: '剩 8 课时',
        bg: 'linear-gradient(135deg,#59A2FF,#2E6BFF)'
      },
      {
        id: 2,
        ico: '语',
        name: '绘本阅读 · 小种子旅行记',
        sub: '周三 10:00 · 李老师',
        val: '剩 10 课时',
        bg: 'linear-gradient(135deg,#4FD1A5,#12A182)'
      },
      {
        id: 3,
        ico: '音',
        name: '奥尔夫音乐 · 小手拍拍',
        sub: '周四 15:30 · 陈老师',
        val: '剩 12 课时',
        bg: 'linear-gradient(135deg,#FFB45B,#F08A24)'
      },
      {
        id: 4,
        ico: '体',
        name: '体能游戏 · 快乐跳跳跳',
        sub: '周五 09:20 · 张老师',
        val: '剩 16 课时',
        bg: 'linear-gradient(135deg,#9B8CFF,#6A5BEF)'
      }
    ],
    // 课时明细（近 30 天）
    records: [
      {
        id: 1,
        date: '04-15 周二',
        name: '主题课 · 春天的颜色',
        teacher: '王老师',
        val: '-1 课时',
        gray: false
      },
      {
        id: 2,
        date: '04-14 周一',
        name: '绘本阅读 · 小种子旅行记',
        teacher: '李老师',
        val: '-1 课时',
        gray: false
      },
      {
        id: 3,
        date: '04-12 周六',
        name: '美术延时班 · 手工风车',
        teacher: '陈老师',
        val: '补课 +1',
        gray: true
      },
      {
        id: 4,
        date: '04-11 周五',
        name: '体能游戏 · 快乐跳跳跳',
        teacher: '张老师',
        val: '-1 课时',
        gray: false
      },
      {
        id: 5,
        date: '04-10 周四',
        name: '奥尔夫音乐 · 小手拍拍',
        teacher: '陈老师',
        val: '-1 课时',
        gray: false
      }
    ]
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
  },

  // 统一轻量交互
  onMoreTap() {
    wx.showToast({ title: '功能开发中', icon: 'none' })
  }
})
