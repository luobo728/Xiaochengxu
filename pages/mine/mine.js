const app = getApp()
const menu = require('../../utils/menu.js')
// 计费数据层：本地版本存在手机里，以后联网只改这一个文件
const billing = require('../../utils/billing.js')
// 登录数据层：账号只存在手机本地，页面只负责展示与调用
const auth = require('../../utils/auth.js')
// 通知公告数据层：本地模式先跑通，联网只改这一个文件
const notice = require('../../utils/notice.js')
// 相册数据层：家长看相册 + 老师传照片共用
const album = require('../../utils/album.js')
// 演示账号（纯本机）：家长端 / 老师端一键切换，方便看双端区别
const account = require('../../utils/account.js')
// 演示账号身份底线：家长端永远不是管理员（判断只有一份，见 utils/demo-role.js）
const role = require('../../utils/demo-role.js')

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
    // 是否云端管理员（云函数判断）
    cloudAdmin: false,
    // 是否显示管理入口（云端管理员 或 本机体验管理员，合并结果）
    isAdmin: false,
    // 是否超级管理员（只有超级管理员能进「管理员设置」设置别人）
    isSuper: false,
    // 是否显示「相册管理」入口：管理员能建能删，普通老师进去只能传照片（演示账号按档位算）
    canAlbum: false,
    // 是否显示「点名」入口：老师（含普通老师）都能点名，家长端一票否决
    canRoll: false,
    // 演示账号（纯本机）：切换后头部、底部、设置里那一行都跟着变
    accountSide: '',
    accountSub: '一键切家长端 / 老师端，看两边区别',
    identitySub: '未登录 · 请先登录',
    identityFoot: '家长端',
    // 孩子档案
    child: {
      avatar: '王',
      name: '王小明',
      sub: '大一班 · 学号 20260118'
    },
    // 三列小统计
    miniStats: [
      { id: 1, num: '86', lbl: '在园天数' },
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
    version: 'v1.0.0',
    // 相册入口副标题（进页面后由数据层刷新）
    albumSub: '看看孩子在园的日常',
    // 课时与余额：数值全部来自 utils/billing.js，页面只负责展示
    hours: 0,
    balanceText: '0.00',
    checkinDays: 0,
    todayChecked: false,
    // 规则文案里的数值同样取自数据层，避免把奖励写死在页面
    claimHours: 0,
    checkinReward: 0,
    // 请求进行中：防连点，并让按钮进入 loading 态
    billingBusy: false,
    // ---------- 登录态 ----------
    // logged 同时控制「孩子档案」「课时与余额」两张卡片是否显示
    logged: false,
    userName: '',
    userPhone: '',
    // 头像方块里的姓名首字，WXML 里不做字符串处理，先在这里算好
    userInitial: '',
    loginAtText: '',
    // 登录表单
    loginName: '',
    loginPhone: '',
    logging: false,
    // 演示账号文案（取自数据层，避免把账号写死在页面）
    demoName: '',
    demoPhone: '',
    // 微信一键登录中：防连点 + 按钮文案
    wxLogging: false,
    // 「姓名 + 手机号」备用表单是否展开
    formOpen: false
  },

  onLoad() {
    this.setData({
      statusBarHeight: (app.globalData && app.globalData.statusBarHeight) || 20
    })
    // 规则数值（课时 / 奖励）由数据层提供，页面只做展示
    this.applyBillingRules()
  },

  onShow() {
    // 同步自定义 tabBar 的选中态
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().setData({ selected: 3 })
    }
    // 管理员身份校验：仅用于展示「食谱管理」入口，失败静默
    this.checkAdmin()
    // 打卡 / 领券都会改余额，每次进页面重新同步一次
    this.refreshBilling()
    // 登录态同步到 data，未登录时收起需要账号的卡片
    this.syncLoginState()
    // 演示账号身份（家长端 / 老师端）
    this.syncIdentity()
    // 相册入口副标题：本班 / 全园各有几本
    this.refreshAlbumSub()
  },

  // ---------- 登录 / 账号 ----------

  // 把数据层的登录态同步到 data；未登录时顺手清空账号信息，避免残留
  syncLoginState() {
    const demo = auth.demoAccount() || {}
    const user = auth.getUser()
    const base = {
      demoName: demo.name || '',
      demoPhone: demo.phone || ''
    }
    if (!user) {
      this.setData({
        logged: false,
        userName: '',
        userPhone: '',
        userInitial: '',
        loginAtText: '',
        demoName: base.demoName,
        demoPhone: base.demoPhone
      })
      return
    }
    // 微信一键登录可能还没有姓名 / 手机号：这里留空，界面用兜底文案展示
    const name = String(user.name || '').trim()
    this.setData({
      logged: true,
      userName: name,
      userPhone: String(user.phone || '').trim(),
      // 没有姓名时头像方块显示「微」
      userInitial: name ? name.charAt(0) : '微',
      loginAtText: user.loginAtText || '',
      demoName: base.demoName,
      demoPhone: base.demoPhone
    })
  },

  // 微信一键登录：本地模式用设备标识，云端模式由云函数按 openid 自动注册 / 登录
  onWxLogin() {
    if (this.data.wxLogging) return
    this.setData({ wxLogging: true })
    auth
      .wxLogin()
      .then((res) => {
        if (res && res.ok) {
          wx.showToast({ title: '登录成功', icon: 'success' })
          // 登录成功后不需要再展开备用表单
          this.setData({ wxLogging: false, formOpen: false })
          // 用数据层的返回值回填账号信息
          this.syncLoginState()
          // 课时与余额卡片刚显示出来，顺手拉一次最新数值
          this.refreshBilling()
          return
        }
        wx.showToast({ title: (res && res.msg) || '登录失败，请重试', icon: 'none' })
        this.setData({ wxLogging: false })
      })
      .catch(() => {
        wx.showToast({ title: '登录失败，请重试', icon: 'none' })
        this.setData({ wxLogging: false })
      })
  },

  // 展开 / 收起「姓名 + 手机号」备用登录表单
  onToggleForm() {
    this.setData({ formOpen: !this.data.formOpen })
  },

  onNameInput(e) {
    this.setData({ loginName: e.detail.value })
  },

  onPhoneInput(e) {
    this.setData({ loginPhone: e.detail.value })
  },

  // 家长登录：姓名 + 手机号，全部交给数据层校验
  onLogin() {
    if (this.data.logging) return
    const name = String(this.data.loginName || '').trim()
    const phone = String(this.data.loginPhone || '').trim()
    if (!name || !phone) {
      wx.showToast({ title: '请填写姓名和手机号', icon: 'none' })
      return
    }
    this.setData({ logging: true })
    auth
      .login(name, phone)
      .then((res) => {
        if (res && res.ok) {
          wx.showToast({ title: '登录成功', icon: 'success' })
          this.setData({
            logged: true,
            logging: false,
            loginName: '',
            loginPhone: ''
          })
          // 用数据层的返回值回填姓名 / 手机号 / 登录时间
          this.syncLoginState()
          // 课时与余额卡片刚显示出来，顺手拉一次最新数值
          this.refreshBilling()
          return
        }
        wx.showToast({ title: (res && res.msg) || '登录失败', icon: 'none' })
        this.setData({ logging: false })
      })
      .catch(() => {
        this.setData({ logging: false })
        wx.showToast({ title: '登录失败，请重试', icon: 'none' })
      })
  },

  // 完善资料：一键登录后补姓名与手机号（两步可输入弹窗）
  onEditProfile() {
    wx.showModal({
      title: '完善资料',
      editable: true,
      placeholderText: '请输入姓名',
      confirmText: '下一步',
      success: (res) => {
        if (!res.confirm) return
        const name = String(res.content || '').trim()
        if (!name) {
          wx.showToast({ title: '姓名不能为空', icon: 'none' })
          return
        }
        this.askProfilePhone(name)
      },
      fail() {
        // 弹窗没弹出来就没得输入，静默即可
      }
    })
  },

  // 第二步收手机号：最轻的校验，非空即可；填了就必须是 1~11 位数字
  askProfilePhone(name) {
    wx.showModal({
      title: '完善资料',
      editable: true,
      placeholderText: '请输入手机号',
      confirmText: '保存',
      success: (res) => {
        if (!res.confirm) return
        const phone = String(res.content || '').trim()
        if (phone && !/^\d{1,11}$/.test(phone)) {
          wx.showToast({ title: '手机号格式好像不对', icon: 'none' })
          return
        }
        this.saveProfile(name, phone)
      },
      fail() {
        // 弹窗没弹出来就没得输入，静默即可
      }
    })
  },

  // 姓名与手机号都拿到后交给数据层保存，成功刷新登录态
  saveProfile(name, phone) {
    auth
      .updateProfile(name, phone)
      .then((res) => {
        if (res && res.ok) {
          wx.showToast({ title: '资料已保存', icon: 'success' })
          this.syncLoginState()
          return
        }
        wx.showToast({ title: (res && res.msg) || '保存失败，请重试', icon: 'none' })
      })
      .catch(() => {
        wx.showToast({ title: '保存失败，请重试', icon: 'none' })
      })
  },

  // 账号卡片里的「切换账号 ›」和设置里的「切换演示账号」都走这里：一键切端
  onSwitchAccount() {
    const list = account.list()
    const items = []
    const curId = account.currentId()
    for (let i = 0; i < list.length; i++) {
      items.push(account.labelOf(list[i], curId))
    }
    items.push('退出登录')
    wx.showActionSheet({
      itemList: items,
      success: (res) => {
        const index = res && typeof res.tapIndex === 'number' ? res.tapIndex : -1
        if (index < 0 || index >= items.length) return
        // 最后一项是退出登录
        if (index === list.length) {
          this.doLogout()
          return
        }
        this.applyAccount(list[index].id)
      },
      fail: () => {
        // 老师点了取消：什么都不做
      }
    })
  },

  // 真正切过去：登录态 + 本机管理员标记都由 utils/account.js 负责改
  applyAccount(id) {
    const res = account.switchTo(id)
    if (!res || !res.ok) {
      wx.showToast({ title: (res && res.msg) || '切换失败，请重试', icon: 'none' })
      return
    }
    // 切完把跟身份有关的地方都刷一遍：账号卡片、管理入口、相册副标题
    this.setData({ formOpen: false })
    this.syncLoginState()
    this.refreshAdminEntry()
    this.syncIdentity()
    this.refreshAlbumSub()
    wx.showToast({ title: '已切到' + res.account.side + '（' + res.account.name + '）', icon: 'none' })
  },

  // 头部身份 / 底部端名 / 设置里那一行的说明，都从当前演示账号来
  syncIdentity() {
    const acc = account.current()
    this.setData({
      accountSide: acc ? acc.side : '',
      accountSub: acc ? acc.desc : '一键切家长端 / 老师端，看两边区别',
      identitySub: account.identityText() || (auth.isLoggedIn() ? '家长账号 · 已绑定 1 名幼儿' : '未登录 · 请先登录'),
      identityFoot: account.sideName()
    })
  },

  // 退出登录的唯一出口：底部按钮和「切换账号」都走这里
  doLogout() {
    return auth
      .logout()
      .then(() => {
        this.setData({
          logged: false,
          userName: '',
          userPhone: '',
          userInitial: '',
          loginAtText: '',
          // 退出后回到默认状态：主推微信一键登录，备用表单收起
          formOpen: false
        })
        // 演示账号标记一起清掉，免得下次进来还以为在老师端
        account.clear()
        this.syncIdentity()
        wx.showToast({ title: '已退出登录', icon: 'none' })
      })
      .catch(() => {
        wx.showToast({ title: '退出失败，请重试', icon: 'none' })
      })
  },

  // ---------- 课时与余额 ----------

  // 从数据层取规则，避免把奖励写死在页面里
  applyBillingRules() {
    const rules = billing.rules() || {}
    this.setData({
      claimHours: rules.claimHours,
      checkinReward: rules.checkinReward
    })
  },

  // 拉取汇总：失败时保留上一次展示，不打断页面
  refreshBilling() {
    return billing
      .getSummary()
      .then((s) => {
        if (!s) return
        this.setData({
          hours: s.hours,
          // WXML 里不做运算，金额先在 JS 里格式化成两位小数字符串
          balanceText: (Number(s.balance) || 0).toFixed(2),
          checkinDays: s.checkinDays,
          todayChecked: !!s.todayChecked
        })
      })
      .catch(() => {
        // 本地读取失败：保持原值，不弹错打扰家长
      })
  },

  // 「账单明细 ›」入口
  onBillingDetail() {
    // 防连点：连点两次会压入两个一模一样的页面，用户点一次返回时会以为「退不出去」
    const now = Date.now()
    if (now - (this._lastNavAt || 0) < 800) return
    this._lastNavAt = now
    wx.navigateTo({
      url: '/pages/billing/billing',
      fail() {
        wx.showToast({ title: '打开失败', icon: 'none' })
      }
    })
  },

  // 扫码领课时：扫码用不了时退化为手动输入券码
  onScanClaim() {
    if (this.data.billingBusy) return
    wx.scanCode({
      onlyFromCamera: false,
      scanType: ['qrCode', 'barCode'],
      success: (res) => {
        this.claimWithCode((res && res.result) || '')
      },
      fail: () => {
        // 用户取消，或开发者工具里没有摄像头 → 用输入券码兜底
        this.askCodeManually()
      }
    })
  },

  // 手动输入券码（演示环境下就是主路径）
  askCodeManually() {
    const codes = billing.demoCodes() || []
    const demo = (codes[0] && codes[0].code) || ''
    wx.showModal({
      title: '输入券码',
      editable: true,
      placeholderText: demo ? '请输入券码（演示可用：' + demo + '）' : '请输入券码',
      confirmText: '领取',
      success: (res) => {
        if (!res.confirm) return
        const code = (res.content || '').trim()
        if (!code) {
          wx.showToast({ title: '券码不能为空', icon: 'none' })
          return
        }
        this.claimWithCode(code)
      },
      fail() {
        // 弹窗没弹出来就没法输入，静默即可
      }
    })
  },

  // 真正的领取请求：busy 期间防连点，结束一定复位
  claimWithCode(code) {
    this.setData({ billingBusy: true })
    wx.showLoading({ title: '领取中', mask: true })
    billing
      .claimByCode(code)
      .then((res) => {
        wx.hideLoading()
        if (res && res.ok) {
          // 课时变了，刷新后卡片才是新数字
          this.refreshBilling()
          const hours = (res.summary && res.summary.hours) || 0
          wx.showModal({
            title: '领取成功',
            content: '+' + res.hours + ' 课时，当前课时 ' + hours,
            showCancel: false
          })
        } else {
          // 失败不改数据，所以不刷新
          wx.showToast({ title: (res && res.msg) || '券码无效', icon: 'none' })
        }
      })
      .catch(() => {
        wx.hideLoading()
        wx.showToast({ title: '领取失败，请重试', icon: 'none' })
      })
      .then(() => this.setData({ billingBusy: false }))
  },

  // 今日打卡：成功返余额
  onCheckin() {
    if (this.data.billingBusy) return
    if (this.data.todayChecked) {
      // 今天已打过卡，不再发请求，只提示
      wx.showToast({ title: '今天已打卡，明天再来', icon: 'none' })
      return
    }
    this.setData({ billingBusy: true })
    wx.showLoading({ title: '打卡中', mask: true })
    billing
      .checkin()
      .then((res) => {
        wx.hideLoading()
        if (res && res.ok) {
          this.refreshBilling()
          const days = (res.summary && res.summary.checkinDays) || 0
          wx.showModal({
            title: '打卡成功',
            content: '返 ¥' + Number(res.reward || 0).toFixed(2) + ' 到账户余额，连续打卡 ' + days + ' 天',
            showCancel: false
          })
        } else {
          wx.showToast({ title: (res && res.msg) || '打卡失败', icon: 'none' })
        }
      })
      .catch(() => {
        wx.hideLoading()
        wx.showToast({ title: '打卡失败，请重试', icon: 'none' })
      })
      .then(() => this.setData({ billingBusy: false }))
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
      success: (res) => {
        if (res.confirm) this.doLogout()
      },
      fail() {
        // 弹窗没弹出来就没得确认，静默即可
      }
    })
  },

  // 管理员身份校验：云端管理员（本地缓存秒显，缓存缺失才走云函数）或本机体验管理员
  checkAdmin() {
    // 演示账号：管理权限只由「管理员名单」决定（家长端永远不是管理员），
    // 所以不查云端、不看 whoami 缓存、也不看本机标记，直接收口
    if (role.isDemo()) {
      this.setData({ cloudAdmin: false })
      this.refreshAdminEntry()
      return
    }
    const cached = menu.cachedWhoami()
    if (cached) {
      this.setData({ cloudAdmin: !!cached.isAdmin })
      this.refreshAdminEntry()
      return
    }
    menu
      .whoami()
      .then((res) => {
        this.setData({ cloudAdmin: !!(res && res.isAdmin) })
        this.refreshAdminEntry()
      })
      .catch(() => {
        // 云端不可用：本机体验管理员仍然可用
        this.refreshAdminEntry()
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

  // 管理员入口：通知公告管理端
  onNoticeAdminTap() {
    wx.navigateTo({
      url: '/pages/notice-admin/notice-admin',
      fail() {
        wx.showToast({ title: '打开失败', icon: 'none' })
      }
    })
  },

  // 家长入口：班级相册（本班 + 全园，只能看不能改）
  onAlbumTap() {
    wx.navigateTo({
      url: '/pages/album/album',
      fail() {
        wx.showToast({ title: '打开失败', icon: 'none' })
      }
    })
  },

  // 管理员入口：相册管理（新建相册、传照片）
  onAlbumAdminTap() {
    wx.navigateTo({
      url: '/pages/album-admin/album-admin',
      fail() {
        wx.showToast({ title: '打开失败', icon: 'none' })
      }
    })
  },

  // 超级管理员专属入口：管理员设置（设置 / 取消谁是管理员）
  onMemberAdminTap() {
    wx.navigateTo({
      url: '/pages/admin-members/admin-members',
      fail() {
        wx.showToast({ title: '打开失败', icon: 'none' })
      }
    })
  },

  // 老师入口：点名（给孩子点到课 / 请假 / 旷课，保存后由课时账本自动结算）
  onRollTap() {
    wx.navigateTo({
      url: '/pages/attendance/attendance',
      fail() {
        wx.showToast({ title: '打开失败', icon: 'none' })
      }
    })
  },

  // 相册入口副标题：本班 / 全园各有多少本，拿不到就保持原文案
  refreshAlbumSub() {
    const myClass = album.myClassSync()
    album
      .listAlbums(myClass)
      .then((rows) => {
        const list = rows || []
        const mineCount = list.filter((r) => myClass && r.className === myClass).length
        const allCount = list.filter((r) => r.className === album.ALL_CLASS).length
        let sub = this.data.albumSub
        if (!list.length) {
          sub = '还没有相册，等老师上传'
        } else if (myClass && mineCount) {
          sub = myClass + ' ' + mineCount + ' 本 · 全园 ' + allCount + ' 本'
        } else {
          sub = '全园 ' + allCount + ' 本'
        }
        this.setData({ albumSub: sub })
      })
      .catch(() => {
        // 云端拿不到就保持默认文案，不打扰家长
      })
  },

  // 云开发还没通时的兜底：开启「本机体验管理员」，只影响这一台手机
  offerLocalAdmin() {
    // 演示账号的家长端：和长按版本号一样，不给开、也不提示（静默退出）
    if (role.isParent()) return
    // 其他演示账号：权限只由「管理员名单」决定，本机标记对演示账号不生效（静默退出）
    if (role.isDemo()) return
    if (notice.isLocalAdmin()) {
      wx.showModal({
        title: '本机体验管理员已开启',
        content: '你可以到「我的 → 通知公告管理」编辑通知。要关掉吗？',
        confirmText: '关掉',
        cancelText: '继续用',
        success: (r) => {
          if (!r.confirm) return
          notice.setLocalAdmin(false)
          this.refreshAdminEntry()
          wx.showToast({ title: '已关闭体验管理员', icon: 'none' })
        }
      })
      return
    }
    wx.showModal({
      title: '云开发还没准备好',
      content: '要先用「本机体验管理员」的方式管理通知吗？开启后你在这台手机上就能发布、修改通知（内容只保存在这台手机里，不会发给家长）。',
      confirmText: '开启体验',
      cancelText: '暂不',
      success: (r) => {
        if (!r.confirm) return
        notice.setLocalAdmin(true)
        this.refreshAdminEntry()
        wx.showModal({
          title: '已开启',
          content: '现在去「通知公告管理」试试吧。',
          confirmText: '去管理',
          cancelText: '稍后',
          success: (r2) => {
            if (r2.confirm) this.onNoticeAdminTap()
          }
        })
      }
    })
  },

  // 刷新管理入口是否显示：云端管理员 或 本机体验管理员，任一为真就显示
  refreshAdminEntry() {
    // 管理入口在两种身份体系下算法不同：
    //   演示账号 —— 只看「管理员名单」：家长端永远不是管理员，老师端看名单里有没有他
    //   真登录账号 —— 老规矩：云端白名单 或 本机体验管理员
    const isAdmin = role.isDemo() ? role.canManage() : (!!this.data.cloudAdmin || notice.isLocalAdmin())
    // 「管理员设置」入口只有超级管理员可见（演示账号里的老师端 · 李老师）
    const isSuper = role.isSuper()
    // 「相册管理」入口老师都能看见：管理员进去能建能删，普通老师进去只能传照片
    const canAlbum = role.isDemo() ? role.canUploadAlbum() : isAdmin
    // 「点名」入口老师都能看见（家长端一票否决）：点名保存后自动扣课时
    const canRoll = role.isDemo() ? !role.isParent() : isAdmin
    if (
      isAdmin !== this.data.isAdmin ||
      isSuper !== this.data.isSuper ||
      canAlbum !== this.data.canAlbum ||
      canRoll !== this.data.canRoll
    ) {
      this.setData({ isAdmin: isAdmin, isSuper: isSuper, canAlbum: canAlbum, canRoll: canRoll })
    }
  },

  // 隐藏入口：长按页面底部版本号
  //   已是管理员 → 显示并复制 openid
  //   还没有管理员 → 一键把自己设成本园管理员
  //   已设置过但不是管理员 → 提示把 openid 发给园长
  onOpenIdLongPress() {
    // 演示账号的家长端：整条链路直接掐掉，连提示都不给（长按等于没按）——
    // 页面底部那行字看上去就只是个版本号，不能让人以为「按一下说不定有权限」
    if (role.isParent()) return
    // 其他演示账号：只给一句短提示就结束，不再走 whoami / 本机体验管理员那条路
    //（演示账号的管理权限只由「管理员名单」决定，长按改不了任何东西）
    if (role.isDemo()) {
      wx.showToast({ title: role.demoShort(), icon: 'none', duration: 3000 })
      return
    }
    if (!menu.isCloudReady()) {
      // 云开发还没通：不硬卡住，先让园长在本机把通知管起来
      this.offerLocalAdmin()
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
    // 演示账号不给这条路：家长端永远不是管理员；其他演示账号要管，先让超级管理员把你加进名单
    if (role.isParent()) {
      wx.showToast({ title: role.PARENT_SHORT, icon: 'none', duration: 3000 })
      return
    }
    if (role.isDemo()) {
      wx.showToast({ title: role.SUPER_SHORT, icon: 'none', duration: 3000 })
      return
    }
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
        this.setData({ cloudAdmin: true })
        this.refreshAdminEntry()
        // 身份已变更，清掉本地身份缓存，否则下次进「我的」页入口会被旧缓存藏掉
        menu.clearWhoamiCache()
        wx.showModal({
          title: '设置成功',
          content: '你现在是管理员了：可以上传食谱图片，也可以编辑通知公告。要现在去上传食谱图片吗？',
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
