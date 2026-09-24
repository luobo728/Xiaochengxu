const app = getApp()

Page({
  data: {
    statusBarHeight: 20,
    // 孩子档案
    child: {
      avatar: '王',
      name: '王小明',
      sub: '大一班 · 学号 20260118'
    },
    // 三列小统计
    miniStats: [
      { id: 1, num: '52', lbl: '课时余额' },
      { id: 2, num: '18', lbl: '本月出勤' },
      { id: 3, num: '960', lbl: '成长值' }
    ],
    // 常用功能
    tools: [
      {
        id: 1,
        ico: '报',
        name: '我的报名',
        sub: '亲子运动会 · 待参加',
        bg: 'linear-gradient(135deg,#59A2FF,#2E6BFF)'
      },
      {
        id: 2,
        ico: '费',
        name: '缴费记录',
        sub: '本学期已缴清',
        bg: 'linear-gradient(135deg,#4FD1A5,#12A182)'
      },
      {
        id: 3,
        ico: '假',
        name: '请假申请',
        sub: '提交请假、查看审批',
        bg: 'linear-gradient(135deg,#FFB45B,#F08A24)'
      },
      {
        id: 4,
        ico: '师',
        name: '联系老师',
        sub: '王老师 · 大一班主班',
        bg: 'linear-gradient(135deg,#9B8CFF,#6A5BEF)'
      }
    ],
    // 设置项
    noticeOn: true,
    cacheSize: '12.6 MB',
    version: 'v1.0.0'
  },

  onLoad() {
    this.setData({
      statusBarHeight: (app.globalData && app.globalData.statusBarHeight) || 20
    })
  },

  onShow() {
    // 同步自定义 tabBar 的选中态
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().setData({ selected: 3 })
    }
  },

  // 统一轻量交互
  onMoreTap() {
    wx.showToast({ title: '功能开发中', icon: 'none' })
  },

  // 消息通知开关
  onSwitchChange(e) {
    const on = e.detail.value
    this.setData({ noticeOn: on })
    wx.showToast({ title: on ? '已开启消息通知' : '已关闭消息通知', icon: 'none' })
  },

  // 退出登录
  onLogout() {
    wx.showModal({
      title: '退出登录',
      content: '确定要退出当前家长账号吗？',
      confirmColor: '#2E6BFF',
      success(res) {
        if (res.confirm) {
          wx.showToast({ title: '已退出登录', icon: 'none' })
        }
      }
    })
  }
})
