const app = getApp()
// 计费数据层：目前数据存在本机，以后联网只改这一个文件
const billing = require('../../utils/billing.js')
const nav = require('../../utils/nav.js')
const auth = require('../../utils/auth.js')

// 明细类型 → 左侧方块的颜色与单字（数据层只给 type，配色属于展示层）
const LEDGER_ICONS = {
  claim: { txt: '领', bg: 'linear-gradient(135deg,#59A2FF,#2E6BFF)' },
  checkin: { txt: '卡', bg: 'linear-gradient(135deg,#3FC5A0,#12A182)' },
  gift: { txt: '赠', bg: 'linear-gradient(135deg,#FFB45B,#F08A24)' },
  consume: { txt: '耗', bg: 'linear-gradient(135deg,#9B8CFF,#6A5BEF)' }
}
const LEDGER_ICON_DEFAULT = { txt: '账', bg: 'linear-gradient(135deg,#C6CDDA,#9AA4B6)' }

Page({
  data: {
    statusBarHeight: 20,
    // 汇总
    hours: 0,
    balanceText: '0.00',
    checkinDays: 0,
    claimCount: 0,
    // 计费规则（文案在 JS 里拼，数值取自数据层）
    rules: [],
    // 收支明细（已补好展示字段）
    ledger: [],
    loading: true
  },

  onLoad() {
    this.setData({
      statusBarHeight: (app.globalData && app.globalData.statusBarHeight) || 20
    })
    // 登录守卫：没登录就退回「我的」，避免绕过登录直接看账单
    if (!auth.isLoggedIn()) {
      wx.showToast({ title: '请先登录', icon: 'none' })
      setTimeout(() => {
        nav.back('/pages/mine/mine')
      }, 600)
      return
    }
    this.applyRules()
  },

  onShow() {
    // 打卡 / 领券是异步的，返回本页时重新拉一次才准
    this.loadData()
  },

  // 规则数值由数据层提供，页面不写死奖励金额
  applyRules() {
    const r = billing.rules() || {}
    this.setData({
      rules: [
        { id: 'claim', ico: '领', txt: '新生扫码领课时：每个券码限领一次，领取后直接进课时余额' },
        { id: 'checkin', ico: '卡', txt: '每日打卡返余额：每天 1 次，返 ¥' + (r.checkinReward || 0) + '（连续打卡天数会累计）' },
        { id: 'consume', ico: '耗', txt: '课时消耗：上课时按课时扣减，明细可在下方查看' }
      ]
    })
  },

  // 汇总 + 明细一起拉，任一步失败都只是空展示，不弹错
  loadData() {
    return Promise.all([billing.getSummary(), billing.listLedger(50)])
      .then((res) => {
        const summary = res[0] || {}
        const list = res[1] || []
        this.setData({
          hours: summary.hours,
          balanceText: (Number(summary.balance) || 0).toFixed(2),
          checkinDays: summary.checkinDays,
          claimCount: summary.claimCount,
          ledger: (list || []).map((it) => this.decorate(it))
        })
      })
      .catch(() => {
        // 读不到就当没数据，页面保持可用
      })
      .then(() => {
        if (this.data.loading) this.setData({ loading: false })
      })
  },

  // 给一条明细补上图标与显示文本：WXML 里不做运算，颜色/格式都在这里定
  decorate(it) {
    const item = it || {}
    const ico = LEDGER_ICONS[item.type] || LEDGER_ICON_DEFAULT
    const amount = Number(item.amount) || 0
    const abs = Math.abs(amount)
    const amountText =
      (amount >= 0 ? '+' : '-') + (item.unit === 'yuan' ? '¥' + abs.toFixed(2) : abs + ' 课时')
    return {
      id: item.id,
      timeText: item.timeText,
      typeName: item.typeName,
      note: item.note,
      icoTxt: ico.txt,
      icoBg: ico.bg,
      amountText: amountText,
      up: amount >= 0
    }
  },

  // 返回：没有上一页（比如从分享进入）时退回「我的」
  goBack() {
    // 栈里还有上一页就返回；没有上一页（例如直接扫码进本页）就切回「我的」
    nav.back('/pages/mine/mine')
  }
})
