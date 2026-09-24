const app = getApp()
const menu = require('../../utils/menu.js')

// 把云端返回的原始错误翻译成「人话」，方便照着做
function explainCloudError(err) {
  const raw = (err && (err.errMsg || err.message)) || '未知错误'
  let tip = '请把上面这行「原因」截图发给帮你做小程序的人。'

  if (/FunctionName|not exist|不存在|-501000/i.test(raw)) {
    tip = '看起来云函数还没成功上传。请回去做第 2 件事：右键 cloudfunctions 里面的 menuAdmin 文件夹 →「创建并部署」，并选择带「云端安装依赖」的那个。'
  } else if (/-504002|Cannot find module|MODULE_NOT_FOUND/i.test(raw)) {
    tip = '云函数缺少依赖，所以跑不起来。请重新部署一次：右键 menuAdmin →「创建并部署」，这一次一定要选带「云端安装依赖」的那个。'
  } else if (/env|环境/i.test(raw)) {
    tip = '云开发环境不对。请确认第 1 件事里已经创建过云环境，并且只创建了一个。'
  } else if (/-501002|ESOCKETTIMEDOUT|resource server timeout/i.test(raw)) {
    tip = '云函数响应超时。按顺序检查：① 开发者工具顶部是否显示「未选择环境」——没选云环境时，调用会一直超时；点它选中你的环境后，重新「创建并部署」一次云函数；② 云函数刚部署时第一次调用会比较慢，等 10 秒再长按一次；③ 到云开发控制台 → 云函数 → menuAdmin → 配置，把「超时时间」改大（比如 20 秒）；④ 如果正开着 VPN 或代理软件，先关掉再试。'
  } else if (/timeout|超时|网络|fail to fetch/i.test(raw)) {
    tip = '网络超时了，不是你做错。请等 10 秒，再长按一次版本号试试。'
  }

  return '原因：' + raw + '\n\n' + tip
}

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

  // 管理员身份校验：优先读本地缓存秒显，缓存缺失才走云端（省掉每次进页面等云函数的几百毫秒）
  checkAdmin() {
    const cached = menu.cachedWhoami()
    if (cached) {
      if (this.data.isAdmin !== !!cached.isAdmin) {
        this.setData({ isAdmin: !!cached.isAdmin })
      }
      return
    }
    menu
      .whoami()
      .then((res) => {
        this.setData({ isAdmin: !!(res && res.isAdmin) })
      })
      .catch(() => {
        // 云端不可用时保持不显示管理入口
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

  // 隐藏入口：长按页面底部版本号
  //   已是管理员 → 显示并复制 openid
  //   还没有管理员 → 一键把自己设成本园管理员
  //   已设置过但不是管理员 → 提示把 openid 发给园长
  onOpenIdLongPress() {
    if (!menu.isCloudReady()) {
      wx.showModal({
        title: '还不能使用',
        content: '云开发还没准备好。请先完成说明里的第 1 步（开通云开发）和第 2 步（上传云函数）。',
        showCancel: false
      })
      return
    }

    wx.showLoading({ title: '读取中', mask: true })
    menu
      .whoami()
      .then((res) => {
        wx.hideLoading()
        const openid = (res && res.openid) || ''
        if (!openid) {
          wx.showModal({
            title: '读取失败',
            content: '请确认云函数 menuAdmin 已经「上传并部署」。',
            showCancel: false
          })
          return
        }
        if (res.isAdmin) {
          this.showOpenId(openid, '你已经是管理员')
          return
        }
        if (!res.initialized) {
          wx.showModal({
            title: '还没有设置管理员',
            content: '要把现在这台微信设置为本园的管理员吗？设置好以后你就可以上传食谱图片了。',
            confirmText: '确定设置',
            success: (r) => {
              if (r.confirm) this.becomeAdmin()
            }
          })
          return
        }
        this.showOpenId(openid, '本园已设置过管理员，请把这段 openid 发给园长添加')
      })
      .catch((err) => {
        wx.hideLoading()
        wx.showModal({
          title: '读取失败',
          content: explainCloudError(err),
          showCancel: false
        })
      })
  },

  // 显示 openid 并可一键复制
  showOpenId(openid, title) {
    wx.showModal({
      title: title || '当前 openid',
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
  },

  // 一键成为管理员
  becomeAdmin() {
    wx.showLoading({ title: '设置中', mask: true })
    menu
      .initAdmin()
      .then((res) => {
        wx.hideLoading()
        if (!res || !res.ok) {
          wx.showModal({
            title: '设置失败',
            content: (res && res.msg) || '请稍后重试',
            showCancel: false
          })
          return
        }
        this.setData({ isAdmin: true })
        // 身份已变更，清掉本地身份缓存，否则下次进「我的」页入口会被旧缓存藏掉
        menu.clearWhoamiCache()
        wx.showModal({
          title: '设置成功',
          content: '你现在是管理员了。要现在去上传食谱图片吗？',
          confirmText: '去上传',
          cancelText: '稍后',
          success: (r) => {
            if (r.confirm) {
              wx.navigateTo({
                url: '/pages/menu-admin/menu-admin',
                fail() {
                  wx.showToast({ title: '打开失败', icon: 'none' })
                }
              })
            }
          }
        })
      })
      .catch((err) => {
        wx.hideLoading()
        wx.showModal({
          title: '设置失败',
          content: explainCloudError(err),
          showCancel: false
        })
      })
  }
})
