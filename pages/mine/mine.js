const app = getApp()
const menu = require('../../utils/menu.js')

Page({
  data: {
    statusBarHeight: 20,
    // 是否管理员（仅控制「食谱管理」入口是否显示）
    isAdmin: false,
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
    // 管理员身份校验：仅用于展示「食谱管理」入口，失败静默
    this.checkAdmin()
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
  },

  // 管理员身份校验：仅决定入口是否显示，失败静默
  checkAdmin() {
    if (this.data.isAdmin) return
    let task = null
    try {
      task = menu.whoami()
    } catch (e) {
      task = null
    }
    if (!task || typeof task.then !== 'function') return
    task.then((res) => {
      if (res && res.isAdmin && !this.data.isAdmin) {
        this.setData({ isAdmin: true })
      }
    }).catch(() => {
      // 家长端不暴露校验失败
    })
  },

  // 管理员入口：食谱管理端
  onAdminTap() {
    wx.navigateTo({
      url: '/pages/menu-admin/menu-admin',
      fail() {
        wx.showToast({ title: '打开失败', icon: 'none' })
      }
    })
  },

  // 隐藏入口：长按底部版本号 → 显示并复制当前 openid（首次配置管理员白名单用）
  onOpenIdLongPress() {
    wx.showLoading({ title: '读取中', mask: true })
    menu
      .whoami()
      .then((res) => {
        wx.hideLoading()
        const openid = (res && res.openid) || ''
        if (!openid) {
          wx.showToast({ title: '读取失败：请先部署云函数 menuAdmin', icon: 'none' })
          return
        }
        wx.showModal({
          title: '当前 openid',
          content: openid,
          confirmText: '复制',
          cancelText: '关闭',
          success(r) {
            if (!r.confirm) return
            wx.setClipboardData({
              data: openid,
              success() {
                wx.showToast({ title: '已复制 openid', icon: 'none' })
              }
            })
          }
        })
      })
      .catch(() => {
        wx.hideLoading()
        wx.showToast({ title: '读取失败：请检查云开发与云函数', icon: 'none' })
      })
  }
})
