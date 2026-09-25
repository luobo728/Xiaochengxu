// pages/admin-members/admin-members.js —— 管理员设置（只有超级管理员能进）
//
// 干什么用：超级管理员在这里把某个账号设成管理员 / 取消管理员，用来演示
// 「超级管理员能设置谁是管理员，管理员自己设置不了」这件事。
//
// 页面只做「显示 + 转发用户操作」，真正的读写都在 utils/admins.js 里：
//   名单存本机（admin_members_v1），设置 / 取消都只有超级管理员有权（两层都会拦一次）。
// 规则：
//   超级管理员（李老师）—— 固定是，取消不了
//   管理员 / 普通老师     —— 超级管理员说了算（王老师默认是，陈老师默认不是）
//   家长（乐乐妈妈）      —— 固定不是，设置不了
const app = getApp()
const admins = require('../../utils/admins.js')
const role = require('../../utils/demo-role.js')
const account = require('../../utils/account.js')
const nav = require('../../utils/nav.js')

Page({
  data: {
    statusBarHeight: 20,
    // 是否已校验完身份（校验中先显示一句提示，避免闪一下锁屏卡片）
    checked: false,
    // 能不能设置（只有超级管理员是 true）
    canSet: false,
    // 不能进时的说明（长句，空表示不锁）
    demoLock: '',
    // 花名册
    rows: [],
    count: 0,
    summary: '',
    // 当前身份，例如「超级管理员 · 李老师」
    curName: '',
    // 「怎么测」的步骤文案（纯展示，让演示时一看就懂怎么验）
    steps: [
      { id: 1, no: '1', txt: '现在登录的是超级管理员（李老师），所以这一页能进；换成管理员（王老师）或普通老师（陈老师），点进来看到的是「只有超级管理员能设置管理员」的提示。' },
      { id: 2, no: '2', txt: '打开某个老师右边的开关 = 设置为管理员，关掉 = 取消管理员。王老师默认是管理员，可以直接试「取消」；陈老师默认不是，可以试「设置」。' },
      { id: 3, no: '3', txt: '改完回到「我的 → 切换演示账号」切到那个人：食谱管理、通知公告管理这两个入口会跟着出现或消失；「相册管理」老师一直都能进 —— 管理员能建相册 / 删相册，普通老师进去只能上传照片。' },
      { id: 4, no: '4', txt: '李老师那一行右边没有开关（超级管理员固定，取消不了），乐乐妈妈那行也没有（家长端固定不是管理员），点开关也改不了。' }
    ]
  },

  onLoad() {
    this.setData({
      statusBarHeight: (app.globalData && app.globalData.statusBarHeight) || 20
    })
    this.checkAdmin()
  },

  // 从别的页切过演示账号再回到这一页时，权限可能已经变了，重新校验一次
  onShow() {
    if (this.data.checked) this.checkAdmin()
  },

  // 身份校验：只有超级管理员能进这一页（判断只有一份，在 utils/demo-role.js）
  checkAdmin() {
    const lock = role.settingsTip()
    const acc = account.current()
    if (lock) {
      this.setData({
        checked: true,
        canSet: false,
        demoLock: lock,
        rows: [],
        count: 0,
        summary: '',
        curName: acc ? acc.side + ' · ' + acc.name : ''
      })
      return
    }
    this.setData({ checked: true, canSet: true, demoLock: '' })
    this.refresh()
  },

  // 刷新花名册：列表、管理员人数、当前身份
  refresh() {
    const rows = admins.list()
    const count = admins.adminCount()
    const acc = account.current()
    this.setData({
      rows: rows,
      count: count,
      summary: '现在有 ' + count + ' 个管理员（含超级管理员）',
      curName: acc ? account.roleNameOf(acc) + ' · ' + acc.name : ''
    })
  },

  // 拨动某一行的开关：设置 / 取消管理员
  onToggle(e) {
    const id = (e && e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.id) || ''
    const on = !!(e && e.detail && e.detail.value)
    const res = admins.setAdmin(id, on)
    if (res && res.ok) {
      this.refresh()
      wx.showToast({ title: on ? '已设为管理员' : '已取消管理员', icon: 'success' })
      return
    }
    // 没改成：说清原因，并把这一行按真实状态重画一遍（开关自动弹回原位）
    wx.showToast({ title: (res && res.msg) || '没设置成功，请再试一次', icon: 'none', duration: 3000 })
    this.refresh()
  },

  // 恢复默认名单：方便反复测试（默认只有王老师是管理员）
  onReset() {
    wx.showModal({
      title: '恢复默认名单？',
      content: '名单会变回默认状态：李老师是超级管理员，王老师是管理员，陈老师是普通老师。',
      confirmText: '恢复',
      cancelText: '取消',
      success: (r) => {
        if (!r.confirm) return
        const res = admins.reset()
        if (!res || !res.ok) {
          wx.showToast({ title: (res && res.msg) || '没恢复成功，请再试一次', icon: 'none', duration: 3000 })
          return
        }
        this.refresh()
        wx.showToast({ title: '已恢复默认名单', icon: 'success' })
      }
    })
  },

  // 返回上一页；没有上一页时回「我的」
  goBack() {
    nav.back('/pages/mine/mine')
  }
})
