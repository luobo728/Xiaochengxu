// pages/course-admin/course-admin.js —— 课程内容管理（老师端）
//
// 老师在这里改「这一节课」的内容：课程名 / 老师 / 每节几课时 / 内容简介。
// 改完点名页和课时页立刻跟着变（页面不自己存数据，全部走 utils/schedule.js）。
//
// 一条硬规则：已经点过名的课，课时数不让改 —— 课时=钱，账已经按旧的数字记下了，
// 页面再显示新数字就对不上账。想改先到点名页把这一天「清空今日点名」。
//
// 谁能进（判断只有一份，在 utils/demo-role.js）：
//   家长端演示账号 —— 进不来（一票否决，页面显示锁卡片）
//   老师端演示账号 —— 超级管理员 / 管理员 / 普通老师都能改
//   真登录账号     —— 照旧走云端白名单 / 本机体验管理员（和通知、点名同一份判断）
const app = getApp()
const schedule = require('../../utils/schedule.js')
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
    canEdit: false, // 能不能改课程内容
    demoLock: '', // 进不来时那句说明（空表示不锁）
    staffTip: '', // 老师进来时的一句说明

    // 正在改哪一节（editing 为假时编辑区只显示一句引导）
    editing: false,
    editId: '',
    editTitle: '', // 「04-15 周三 09:20」
    // 添加一节课（老师自己排课）
    adding: false,
    date: '',
    time: '',
    minDate: '', // 日期选择器的最早可选日期（今天）
    name: '',
    teacher: '',
    desc: '',
    hours: 1,
    hoursChoices: schedule.HOURS_CHOICES,
    hoursLocked: false,
    hoursLockTip: '',
    maxName: schedule.MAX_NAME,
    maxTeacher: schedule.MAX_TEACHER,
    maxDesc: schedule.MAX_DESC,
    nameLeft: schedule.MAX_NAME,
    teacherLeft: schedule.MAX_TEACHER,
    descLeft: schedule.MAX_DESC,
    saving: false,

    // 课表列表
    rows: [],
    total: 0,
    dayCount: 0,

    modeTip: '演示模式：课表从昨天起 2 周自动生成。这里改的是「这一节课」的内容，改完点名页和课时页立刻跟着变。'
  },

  onLoad() {
    this.setData({
      statusBarHeight: (app.globalData && app.globalData.statusBarHeight) || 20,
      minDate: schedule.today() // 日期选择器最早只能选今天：过去的课会被自动补算
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
    // 同一个人回到本页：课表重读一遍（可能在点名页点过名，课时数就锁上了）
    if (this.data.canEdit) this.refreshList()
  },

  // 身份校验：能改就填课表，不能改就显示锁卡片（三分支相邻，中间不能夹注释）
  checkIdentity() {
    const that = this
    this.level = role.level()
    const lock = role.courseTip()
    if (lock) {
      // 家长端演示账号：直接收口，不查云端、不看本机标记
      this.setData({
        checked: true,
        canEdit: false,
        demoLock: lock,
        staffTip: '',
        editing: false,
        rows: [],
        total: 0,
        dayCount: 0
      })
      return
    }
    if (role.isDemo()) {
      // 老师端演示账号：三个档位都能改课程内容（和点名同一档）
      this.setData({ checked: true, canEdit: true, demoLock: '', staffTip: role.COURSE_STAFF_TIP })
      this.refreshList()
      return
    }
    // 真登录账号：照旧走云端白名单 / 本机体验管理员
    notice
      .adminStatus()
      .then(function (res) {
        const ok = !!(res && res.isAdmin)
        that.setData({ checked: true, canEdit: ok, demoLock: '', staffTip: ok ? role.COURSE_STAFF_TIP : '' })
        if (ok) that.refreshList()
        else that.setData({ editing: false, rows: [], total: 0, dayCount: 0 })
      })
      .catch(function () {
        // 云端拿不到：按进不来处理，不弹错
        that.setData({ checked: true, canEdit: false, demoLock: '', staffTip: '', editing: false, rows: [], total: 0, dayCount: 0 })
      })
  },

  /* ---------------- 课表列表 ---------------- */

  refreshList() {
    this.paint(schedule.listLessons())
  },

  // 列表按天分组：每天第一条标 dayHead，页面上就只出现一个日期小标题
  // （wxml 里不做计算，副标题也在这里拼好）
  paint(rows) {
    const list = rows || []
    const out = []
    let lastDay = ''
    let days = 0
    for (let i = 0; i < list.length; i++) {
      const r = list[i]
      const head = r.date !== lastDay
      if (head) days++
      lastDay = r.date
      out.push({
        id: r.id,
        dayText: r.dayText,
        dayHead: head,
        time: r.time,
        name: r.name,
        teacher: r.teacher,
        hours: r.hours,
        desc: r.desc,
        sub: (r.teacher || '还没填老师') + (r.desc ? ' · ' + r.desc : ''),
        statusText: r.statusText,
        tagClass: r.tagClass,
        rolledText: r.rolledText,
        hoursLocked: r.hoursLocked
      })
    }
    this.setData({ rows: out, total: out.length, dayCount: days })
  },

  /* ---------------- 编辑区 ---------------- */

  // 点一行 → 把这一节填进编辑区，并滚回页面顶部
  onRowTap(e) {
    const id = (e.currentTarget.dataset || {}).id || ''
    if (id) this.fillForm(id)
  },

  fillForm(id) {
    const rows = this.data.rows || []
    let row = null
    for (let i = 0; i < rows.length; i++) {
      if (rows[i].id === id) row = rows[i]
    }
    if (!row) {
      wx.showToast({ title: '这节课已经不在了，刷新一下再试', icon: 'none' })
      return
    }
    this.applyForm({
      editing: true,
      editId: row.id,
      editTitle: row.dayText + ' ' + row.time,
      name: row.name,
      teacher: row.teacher,
      desc: row.desc,
      hours: row.hours,
      hoursLocked: !!row.hoursLocked,
      hoursLockTip: row.hoursLocked ? '已经点过名：课时数改不了（先到点名页「清空今日点名」）' : ''
    })
    wx.pageScrollTo({ scrollTop: 0, duration: 200 })
  },

  // 改表单（同时更新还能写几个字）
  applyForm(patch) {
    const name = patch.name === undefined ? this.data.name : String(patch.name || '')
    const teacher = patch.teacher === undefined ? this.data.teacher : String(patch.teacher || '')
    const desc = patch.desc === undefined ? this.data.desc : String(patch.desc || '')
    const next = Object.assign({}, patch, {
      nameLeft: Math.max(0, schedule.MAX_NAME - name.length),
      teacherLeft: Math.max(0, schedule.MAX_TEACHER - teacher.length),
      descLeft: Math.max(0, schedule.MAX_DESC - desc.length)
    })
    this.setData(next)
  },

  // 不改了：编辑区回到「点下面任意一节课来改」
  // 不改了 / 不添加了：编辑区回到「选一节课来改」
  onCancelEdit() {
    this.applyForm({
      adding: false,
      editing: false,
      editId: '',
      editTitle: '',
      name: '',
      teacher: '',
      desc: '',
      hours: 1,
      date: '',
      time: '',
      hoursLocked: false,
      hoursLockTip: ''
    })
  },

  onNameInput(e) {
    this.applyForm({ name: (e.detail && e.detail.value) || '' })
  },

  onTeacherInput(e) {
    this.applyForm({ teacher: (e.detail && e.detail.value) || '' })
  },

  onDescInput(e) {
    this.applyForm({ desc: (e.detail && e.detail.value) || '' })
  },

  // 每节几课时：点胶囊选中（已经点过名的课不让改，点一下只说一句）
  onHoursTap(e) {
    if (this.data.hoursLocked) {
      wx.showToast({ title: this.data.hoursLockTip || '这节课已经点过名了，课时数改不了', icon: 'none' })
      return
    }
    const index = Number((e.currentTarget.dataset || {}).index) || 0
    const hours = schedule.HOURS_CHOICES[index]
    if (hours) this.applyForm({ hours: hours })
  },

  /* ---------------- 添加一节课 ---------------- */

  // 切到「添加一节课」：日期默认今天（只能选今天以后），时间要自己选
  onAddTap() {
    this.applyForm({
      adding: true,
      editing: false,
      editId: '',
      editTitle: '',
      name: '',
      teacher: '',
      desc: '',
      hours: 1,
      date: schedule.today(),
      time: '',
      hoursLocked: false,
      hoursLockTip: ''
    })
    wx.pageScrollTo({ scrollTop: 0, duration: 200 })
  },

  // 不添加了
  onCancelAdd() {
    this.applyForm({ adding: false, date: '', time: '' })
  },

  onDateChange(e) {
    this.applyForm({ date: (e.detail && e.detail.value) || '' })
  },

  onTimeChange(e) {
    this.applyForm({ time: (e.detail && e.detail.value) || '' })
  },

  // 添加：数据层会拦「时间已经过了 / 这一天这个点已经有课 / 字段不合规」
  onAddSave() {
    if (this.data.saving) return
    this.setData({ saving: true })
    const res = schedule.addLesson({
      date: this.data.date,
      time: this.data.time,
      name: this.data.name,
      teacher: this.data.teacher,
      desc: this.data.desc,
      hours: this.data.hours
    }, this.byName())
    this.setData({ saving: false })
    if (!res || !res.ok) {
      wx.showToast({ title: (res && res.msg) || '添加失败', icon: 'none', duration: 2500 })
      return
    }
    const item = res.item || {}
    this.refreshList()
    // 加完直接进「修改这一节」：老师能接着改，也能看到它排在课表哪儿
    this.applyForm({
      adding: false,
      editing: true,
      editId: item.id || '',
      editTitle: (item.dayText || '') + ' ' + (item.time || ''),
      date: '',
      time: '',
      hours: item.hours === undefined ? this.data.hours : item.hours,
      hoursLocked: !!item.hoursLocked,
      hoursLockTip: ''
    })
    wx.showToast({ title: '已添加：' + (item.dayText || '') + ' ' + (item.time || ''), icon: 'none' })
  },

  /* ---------------- 删除一节课 ---------------- */

  // 编辑区里的「删除这一节课」
  onDelTap() {
    if (!this.data.editing || !this.data.editId) {
      wx.showToast({ title: '先点下面课表里的一节课', icon: 'none' })
      return
    }
    this.askDelete(this.data.editId, this.data.editTitle)
  },

  // 列表每行的「删除」
  onRowDelTap(e) {
    const id = (e.currentTarget.dataset || {}).id || ''
    if (!id) return
    const rows = this.data.rows || []
    let row = null
    for (let i = 0; i < rows.length; i++) {
      if (rows[i].id === id) row = rows[i]
    }
    this.askDelete(id, row ? row.dayText + ' ' + row.time : '')
  },

  // 删之前问一句；点过名的课数据层会拦（账已经记了，想删先清空点名）
  askDelete(id, title) {
    wx.showModal({
      title: '删除这节课？',
      content: (title ? '「' + title + '」' : '这一节') + '删掉后课表里就没有它了；已经点过名的课删不了，得先到点名页「清空今日点名」',
      confirmText: '删除',
      confirmColor: '#E5453D',
      success: (r) => {
        if (!r.confirm) return
        const res = schedule.removeLesson(id, this.byName())
        if (!res || !res.ok) {
          wx.showToast({ title: (res && res.msg) || '删除失败', icon: 'none', duration: 2500 })
          return
        }
        // 删掉的正是正在改的那一节：编辑区收起来
        if (this.data.editId === id) this.onCancelEdit()
        this.refreshList()
        wx.showToast({ title: '已删除这一节课', icon: 'none' })
      }
    })
  },
  /* ---------------- 保存 ---------------- */

  onSave() {
    if (this.data.saving) return
    if (!this.data.editing) {
      wx.showToast({ title: '先点下面课表里的一节课', icon: 'none' })
      return
    }
    const name = String(this.data.name || '').replace(/^\s+|\s+$/g, '')
    if (!name) {
      wx.showToast({ title: '课程名不能空着', icon: 'none' })
      return
    }
    this.setData({ saving: true })
    const id = this.data.editId
    const res = schedule.updateLesson(id, {
      name: name,
      teacher: this.data.teacher,
      desc: this.data.desc,
      hours: this.data.hours
    }, this.byName())
    this.setData({ saving: false })
    if (!res || !res.ok) {
      wx.showToast({ title: (res && res.msg) || '保存失败', icon: 'none', duration: 2500 })
      return
    }
    // 保存完继续保持「正在修改」这一节：接着改还是改它，不会改错别的
    const item = res.item || {}
    this.applyForm({
      hours: item.hours === undefined ? this.data.hours : item.hours,
      hoursLocked: !!item.hoursLocked,
      hoursLockTip: item.hoursLocked ? '已经点过名：课时数改不了（先到点名页「清空今日点名」）' : ''
    })
    this.refreshList()
    wx.showToast({ title: '已保存修改', icon: 'none' })
  },

  // 谁改的：演示账号用演示账号名，真登录账号用登录名，都没有就兜底
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
