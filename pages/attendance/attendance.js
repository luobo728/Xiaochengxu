// pages/attendance/attendance.js —— 点名（老师端）
//
// 这一页只干一件事：把某一天每节课「谁到课 / 谁请假 / 谁旷课 / 谁试听」记下来，
// 保存后由 utils/schedule.js 按规则自动结算课时 —— 点错能改，重复保存不会重扣。
// 页面只做「显示 + 转发用户操作」，课时一个数字都不自己算。
//
// 谁能进（判断只有一份，在 utils/demo-role.js）：
//   家长端演示账号 —— 进不来（一票否决，页面显示锁卡片）
//   老师端演示账号 —— 超级管理员 / 管理员 / 普通老师都能点名
//   真登录账号     —— 照旧走云端白名单 / 本机体验管理员（和通知、相册同一份判断）
const app = getApp()
const schedule = require('../../utils/schedule.js')
const billing = require('../../utils/billing.js')
const nav = require('../../utils/nav.js')
const role = require('../../utils/demo-role.js')
const notice = require('../../utils/notice.js')
const account = require('../../utils/account.js')
const auth = require('../../utils/auth.js')

Page({
  data: {
    statusBarHeight: 20,

    // 身份
    checked: false, // 校验完了没有（校验中先显示一句话，别闪一下锁卡片）
    canRoll: false, // 能不能点名
    demoLock: '', // 进不来时那句说明（长句，空表示不锁）
    curName: '', // 当前身份，例如「家长端 · 乐乐妈妈」
    staffTip: '', // 老师进来时的一句说明

    // 课表
    cls: schedule.CLS,
    day: '',
    dayText: '',
    isToday: true,
    lessons: [],
    kidCount: schedule.STUDENTS.length,
    perLesson: billing.attendRules().perLesson,

    // 本机这本账（课时按设备记：切换演示账号看的是同一本账）
    left: 0,
    spent: 0,

    // 有改动还没保存（点过状态、还没点「保存点名」）
    dirty: false,

    // 说明文案（进页面时由数据层填，避免加载期读存储）
    modeTip: '',
    lowTip: ''
  },

  onLoad() {
    this.setData({
      statusBarHeight: (app.globalData && app.globalData.statusBarHeight) || 20,
      day: schedule.today(),
      modeTip: schedule.modeTip()
    })
    this.checkIdentity()
  },

  onShow() {
    // 首次进入：onLoad 已经填过一次了，这里不重复
    if (!this.shown) {
      this.shown = true
      return
    }
    // 去别的页面切过演示账号再回来：身份可能已经变了，重新校验一次
    if (this.level !== role.level()) {
      this.checkIdentity()
      return
    }
    // 同一个人回到本页：当天课表重读一遍（可能在别处点过名，或者时间又过了一节）
    if (this.data.canRoll) this.fill(this.data.day)
  },

  // 身份校验：能进就填课表，进不去就显示锁卡片（三分支相邻，中间不能夹注释）
  checkIdentity() {
    const that = this
    this.level = role.level()
    const acc = account.current()
    const lock = role.rollTip()
    if (lock) {
      // 家长端演示账号：直接收口，不查云端、不看本机标记
      that.setData({
        checked: true,
        canRoll: false,
        demoLock: lock,
        curName: acc ? acc.side + ' · ' + acc.name : '',
        staffTip: '',
        lessons: [],
        lowTip: ''
      })
      return
    }
    if (role.isDemo()) {
      // 老师端演示账号：三个档位都能点名（点名的门槛和「谁是管理员」不是一回事）
      that.setData({ checked: true, canRoll: true, demoLock: '', curName: '', staffTip: role.ROLL_STAFF_TIP })
      that.fill(that.data.day || schedule.today())
      return
    }
    // 真登录账号：照旧走云端白名单 / 本机体验管理员
    notice
      .adminStatus()
      .then(function (res) {
        const ok = !!(res && res.isAdmin)
        that.setData({ checked: true, canRoll: ok, demoLock: '', curName: '', staffTip: ok ? role.ROLL_STAFF_TIP : '' })
        if (ok) that.fill(that.data.day || schedule.today())
        else that.setData({ lessons: [], lowTip: '' })
      })
      .catch(function () {
        // 云端拿不到：按进不来处理，说明白是什么身份，不弹错
        const me = account.current()
        that.setData({
          checked: true,
          canRoll: false,
          demoLock: '',
          curName: me ? me.side + ' · ' + me.name : '',
          staffTip: '',
          lessons: [],
          lowTip: ''
        })
      })
  },

  // 读一天的课表（进页面 / 换天 / 保存后都走这里）
  //   bootstrap：第一次进来自动生成演示课表 + 送一次演示课时（判重，只送一次）
  //   settleDue：把「时间已过、还没点名」的课按到课补上并结算（这就是「自动」的部分）
  fill(day) {
    const that = this
    const d = day || schedule.today()
    return schedule
      .bootstrap()
      .then(
        function () {
          return schedule.settleDue()
        },
        function () {
          return schedule.settleDue()
        }
      )
      .then(
        function () {
          that.renderDay(d)
        },
        function () {
          that.renderDay(d)
        }
      )
  },

  // 画这一天：课表 + 提醒 + 顶部那两个数字
  renderDay(day) {
    const data = schedule.listDay(day)
    this.setData({
      day: data.date,
      dayText: data.title,
      isToday: data.isToday,
      lessons: data.lessons,
      dirty: false,
      lowTip: schedule.lowTip()
    })
    this.refreshStats()
  },

  // 本机这本账（课时按设备记：切换演示账号看的是同一本账）
  refreshStats() {
    const st = billing.hoursStat()
    this.setData({ left: st.left, spent: st.spent })
  },

  // 前一天
  onPrevDay() {
    if (!this.data.canRoll) return
    this.fill(schedule.shift(this.data.day || schedule.today(), -1))
  },

  // 后一天
  onNextDay() {
    if (!this.data.canRoll) return
    this.fill(schedule.shift(this.data.day || schedule.today(), 1))
  },

  // 回到今天
  onToday() {
    if (!this.data.canRoll) return
    if (this.data.isToday) return
    this.fill(schedule.today())
  },

  // 点某个孩子的某个状态（到课 / 请假 / 旷课 / 试听）
  // 只改这一行的显示，扣不扣课时仍然由 utils/schedule.js 的 kidRow() 算，页面不写规则
  onPill(e) {
    if (!this.data.canRoll) return
    const ds = (e && e.currentTarget && e.currentTarget.dataset) || {}
    const li = Number(ds.li)
    const ki = Number(ds.ki)
    const key = ds.key
    const ls = this.data.lessons[li]
    if (!ls || !key) return
    const kid = ls.kids[ki]
    if (!kid || kid.status === key) return

    // 改过状态的这一行先按「还没保存」显示：保存后才显示「已结算 · 扣 N 课时」
    const next = schedule.kidRow(key, ls.hours, { saved: false, applied: 0 })
    next.id = kid.id
    next.studentId = kid.studentId
    next.studentName = kid.studentName

    const kids = ls.kids.slice()
    kids[ki] = next
    const copy = {}
    for (const k in ls) {
      if (Object.prototype.hasOwnProperty.call(ls, k)) copy[k] = ls[k]
    }
    copy.kids = kids
    const lessons = this.data.lessons.slice()
    lessons[li] = copy
    this.setData({ lessons: lessons, dirty: true })
  },

  // 保存这一节课的点名：扣多少课时由数据层算（点错能改、重复保存不重扣）
  onSave(e) {
    if (!this.data.canRoll) return
    if (this.saving) return
    const ds = (e && e.currentTarget && e.currentTarget.dataset) || {}
    const li = Number(ds.li)
    const ls = this.data.lessons[li]
    if (!ls) return

    const rows = []
    for (let i = 0; i < ls.kids.length; i++) {
      rows.push({ studentId: ls.kids[i].studentId, status: ls.kids[i].status })
    }
    const who = this.byName()

    this.saving = true
    wx.showLoading({ title: '结算中', mask: true })
    schedule
      .saveMarks(ls.id, rows, who)
      .then((res) => {
        wx.hideLoading()
        this.saving = false
        wx.showToast({ title: (res && res.msg) || '已保存', icon: 'none', duration: 2500 })
        this.fill(this.data.day)
      })
      .catch(() => {
        wx.hideLoading()
        this.saving = false
        wx.showToast({ title: '没保存成功，请再试一次', icon: 'none', duration: 2500 })
      })
  },

  // 谁点的名：演示账号用演示账号名，真登录账号用登录名，都没有就兜底
  byName() {
    const acc = account.current()
    if (acc && acc.name) return acc.name
    const user = auth.getUser()
    if (user && user.name) return user.name
    return '本机体验老师'
  },

  // 返回上一页；没有上一页时回「我的」
  goBack() {
    nav.back('/pages/mine/mine')
  }
})
