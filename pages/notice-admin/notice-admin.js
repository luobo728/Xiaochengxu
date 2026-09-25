// pages/notice-admin/notice-admin.js —— 通知公告管理（只有管理员能进）
// 家长端首页「最新通知」显示的内容，就是在这里发布和修改的。
// 两种身份来源都支持（判断逻辑在 utils/notice.js 里，页面不自己算）：
//   云端管理员 —— 云函数 menuAdmin 白名单里的 openid
//   本机体验管理员 —— 云端没连上时，长按「我的」页版本号开启，数据只存这台手机
const app = getApp()
const notice = require('../../utils/notice.js')
const nav = require('../../utils/nav.js')
// 演示账号身份底线：家长端永远不是管理员（和 utils/notice.js 用的是同一份判断）
const role = require('../../utils/demo-role.js')

// 分类 → 标签配色（配色 class 见 app.wxss 的 .tag-*）
const TONES = {
  通知: 'tag-blue',
  活动: 'tag-orange',
  保健: 'tag-green',
  提示: 'tag-gray',
  食谱: 'tag-orange'
}

Page({
  data: {
    statusBarHeight: 20,

    // 身份相关
    checked: false,
    isAdmin: false,
    openid: '',
    modeTip: '',
    // 演示账号的家长端被拦住时显示的那句话（不是家长端就是空）
    demoLock: '',

    // 表单：editId 为空 = 正在写一条新通知；有值 = 正在改这一条
    editId: '',
    editTitle: '', // 正在修改哪一条（表单上方提示条显示用）
    title: '',
    tags: notice.TAGS,
    tagIndex: 0,
    body: '',
    top: false,
    maxTitle: notice.MAX_TITLE,
    maxBody: notice.MAX_BODY,
    titleLeft: notice.MAX_TITLE,
    bodyLeft: notice.MAX_BODY,
    saving: false,

    // 已有通知列表
    rows: []
  },

  onLoad(options) {
    const opts = options || {}
    const id = opts.id ? decodeURIComponent(opts.id) : ''
    this.setData({
      statusBarHeight: (app.globalData && app.globalData.statusBarHeight) || 20
    })
    this.checkAdmin(id)
  },

  // 校验身份：是管理员才把表单和列表显示出来
  checkAdmin(pendingId) {
    // 演示账号的家长端：不查云端、不看本机标记，一律按「不是管理员」收口
    if (role.isParent()) {
      this.setData({ checked: true, isAdmin: false, openid: '', demoLock: role.PARENT_TIP })
      return
    }
    notice.adminStatus().then((res) => {
      const isAdmin = !!(res && res.isAdmin)
      this.setData({
        checked: true,
        isAdmin: isAdmin,
        openid: (res && res.openid) || '',
        modeTip: (res && res.tip) || ''
      })
      if (!isAdmin) return
      this.refreshList()
      // 从通知详情页点「编辑这条通知」进来时，直接把那条填进表单
      if (pendingId) this.fillForm(pendingId)
    }).catch(() => {
      this.setData({ checked: true, isAdmin: false })
    })
  },

  /* ---------------- 列表 ---------------- */

  // 刷新「已有通知」列表：先用本机数据秒显（不等网络），再拉一次最新覆盖
  refreshList() {
    this.paintList(notice.listSync())
    Promise.resolve(notice.list())
      .then((rows) => {
        this.paintList(rows)
      })
      .catch(() => {
        // 网络不通就继续用本机数据
      })
  },

  paintList(rows) {
    const list = (rows || []).map(function (row) {
      return {
        id: row.id,
        title: row.title,
        tag: row.tag,
        tone: TONES[row.tag] || 'tag-blue',
        time: row.time,
        top: !!row.top,
        bodyLen: (row.body || '').length
      }
    })
    this.setData({ rows: list })
  },

  /* ---------------- 表单 ---------------- */

  // 把某条通知填进表单：本机有就直接填；本机没有（云端模式缓存刚被清）就先拉一次最新
  fillForm(id) {
    const row = notice.getById(id)
    if (row) {
      this.applyRowToForm(row)
      return
    }
    Promise.resolve(notice.list())
      .then((rows) => {
        this.paintList(rows)
        const again = notice.getById(id)
        if (!again) {
          wx.showToast({ title: '这条通知已经不在了', icon: 'none' })
          return
        }
        this.applyRowToForm(again)
      })
      .catch(() => {
        wx.showToast({ title: '这条通知已经不在了', icon: 'none' })
      })
  },

  // 真正把一条通知写进表单，并滚回页面顶部
  applyRowToForm(row) {
    let tagIndex = 0
    for (let i = 0; i < notice.TAGS.length; i++) {
      if (notice.TAGS[i] === row.tag) {
        tagIndex = i
        break
      }
    }
    this.applyForm({
      editId: row.id,
      editTitle: row.title,
      title: row.title,
      tagIndex: tagIndex,
      body: row.body,
      top: !!row.top
    })
    wx.pageScrollTo({ scrollTop: 0, duration: 200 })
  },

  // 改表单（同时更新还能写几个字）
  applyForm(patch) {
    const title = patch.title === undefined ? this.data.title : String(patch.title || '')
    const body = patch.body === undefined ? this.data.body : String(patch.body || '')
    const next = Object.assign({}, patch, {
      titleLeft: Math.max(0, notice.MAX_TITLE - title.length),
      bodyLeft: Math.max(0, notice.MAX_BODY - body.length)
    })
    this.setData(next)
  },

  // 回到「写一条新通知」
  onNewTap() {
    this.applyForm({ editId: '', editTitle: '', title: '', tagIndex: 0, body: '', top: false })
  },

  onTitleInput(e) {
    this.applyForm({ title: (e.detail && e.detail.value) || '' })
  },

  onBodyInput(e) {
    this.applyForm({ body: (e.detail && e.detail.value) || '' })
  },

  onTagTap(e) {
    const index = Number((e.currentTarget.dataset || {}).index) || 0
    this.setData({ tagIndex: index })
  },

  onTopChange(e) {
    this.setData({ top: !!(e.detail && e.detail.value) })
  },

  /* ---------------- 保存 / 删除 / 置顶 ---------------- */

  onSave() {
    if (this.data.saving) return
    const title = String(this.data.title || '').replace(/^\s+|\s+$/g, '')
    if (!title) {
      wx.showToast({ title: '请先写标题', icon: 'none' })
      return
    }
    this.setData({ saving: true })
    // 这次是「改已有的」还是「新写一条」，保存前先记住，好给出不一样的提示
    const wasEdit = !!this.data.editId
    Promise.resolve(notice.save({
      id: this.data.editId,
      title: title,
      tag: notice.TAGS[this.data.tagIndex] || '通知',
      body: this.data.body,
      top: this.data.top
    })).then((res) => {
      this.setData({ saving: false })
      if (!res || !res.ok) {
        wx.showToast({ title: (res && res.msg) || '保存失败', icon: 'none' })
        return
      }
      // 存完继续保持「修改」状态：再点保存是改这一条，不会又建一条新的
      const saved = res.item && res.item.id ? res.item : null
      this.applyForm({
        editId: saved ? saved.id : this.data.editId,
        editTitle: saved ? (saved.title || title) : this.data.editTitle
      })
      this.refreshList()
      wx.showToast({ title: wasEdit ? '已保存修改' : '已发布，首页马上能看到', icon: 'none' })
    }).catch(() => {
      this.setData({ saving: false })
      wx.showToast({ title: '保存失败，请检查网络', icon: 'none' })
    })
  },

  onRowTap(e) {
    const id = (e.currentTarget.dataset || {}).id || ''
    if (id) this.fillForm(id)
  },

  onTopTap(e) {
    const id = (e.currentTarget.dataset || {}).id || ''
    if (!id) return
    Promise.resolve(notice.toggleTop(id)).then((res) => {
      if (!res || !res.ok) {
        wx.showToast({ title: (res && res.msg) || '操作失败', icon: 'none' })
        return
      }
      this.refreshList()
      wx.showToast({ title: res.top ? '已置顶' : '已取消置顶', icon: 'none' })
    }).catch(() => {})
  },

  onDelTap(e) {
    const id = (e.currentTarget.dataset || {}).id || ''
    if (!id) return
    let title = ''
    const rows = this.data.rows || []
    rows.forEach(function (row) {
      if (row.id === id) title = row.title
    })
    wx.showModal({
      title: '删除这条通知？',
      content: title || '删掉后家长端不再显示',
      confirmText: '删除',
      confirmColor: '#E5453D',
      success: (r) => {
        if (!r.confirm) return
        Promise.resolve(notice.remove(id)).then((res) => {
          if (!res || !res.ok) {
            wx.showToast({ title: (res && res.msg) || '删除失败', icon: 'none' })
            return
          }
          // 删掉的正是正在编辑的那条：表单切回「写一条新通知」
          if (this.data.editId === id) this.onNewTap()
          this.refreshList()
          wx.showToast({ title: '已删除', icon: 'none' })
        }).catch(() => {})
      }
    })
  },

  onReset() {
    wx.showModal({
      title: '恢复演示通知？',
      content: '会把通知恢复成最初的 4 条演示内容，你写的通知会被清掉',
      confirmText: '恢复',
      success: (r) => {
        if (!r.confirm) return
        Promise.resolve(notice.resetDemo()).then((res) => {
          if (!res || !res.ok) {
            wx.showToast({ title: (res && res.msg) || '恢复失败', icon: 'none' })
            return
          }
          this.onNewTap()
          this.refreshList()
          wx.showToast({ title: '已恢复演示通知', icon: 'none' })
        }).catch(() => {})
      }
    })
  },

  goBack() {
    // 没有上一页时回「我的」
    nav.back('/pages/mine/mine')
  }
})
