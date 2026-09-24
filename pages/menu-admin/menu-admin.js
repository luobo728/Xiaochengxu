// pages/menu-admin/menu-admin.js —— 食谱管理端：管理员上传 / 删除每日每餐次的食谱图片
const app = getApp()
const menu = require('../../utils/menu.js')
const mealUtil = require('../../utils/meal.js')

const WEEK = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']
const MAX_PER_MEAL = 9      // 单个餐次最多 9 张
const DEFAULT_MEAL = 'breakfast'

// Date → 'YYYY-MM-DD'
function toDateStr(d) {
  const m = d.getMonth() + 1
  const day = d.getDate()
  return d.getFullYear() + '-' + (m < 10 ? '0' + m : m) + '-' + (day < 10 ? '0' + day : day)
}

// 'YYYY-MM-DD' → '2026-04-16 周四'
function toDateLabel(str) {
  const s = String(str || '')
  const parts = s.split('-')
  if (parts.length !== 3) return s
  const d = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]))
  const week = WEEK[d.getDay()] || ''
  return week ? s + ' ' + week : s
}

Page({
  data: {
    statusBarHeight: 20,
    today: '',
    date: '',
    dateLabel: '',
    meal: DEFAULT_MEAL,
    mealLabel: '早餐',
    meals: mealUtil.MEALS,
    cloudReady: true,
    cloudError: '',
    checked: false,     // 是否已拿到身份结果
    isAdmin: false,
    openid: '',
    list: [],           // 当前日期全部记录
    current: [],        // 当前日期 + 当前餐次的记录
    stats: [],          // 当日各餐次张数（概览卡）
    uploading: false,
    done: 0,
    total: 0,
    percent: 0          // 上传进度百分比
  },

  onLoad() {
    const today = toDateStr(new Date())
    this.setData({
      statusBarHeight: (app.globalData && app.globalData.statusBarHeight) || 20,
      today: today,
      date: today,
      dateLabel: toDateLabel(today),
      mealLabel: mealUtil.mealName(DEFAULT_MEAL) || '早餐',
      stats: this.buildStats([])
    })
    this.checkCloud()
  },

  onShow() {
    // 从其它页返回时云端数据可能已变化，管理员身份确认后重新拉取
    if (this.data.checked && this.data.isAdmin) {
      this.loadList()
    }
  },

  // 云开发是否就绪：未就绪时不调用 whoami，只在卡片里解释原因
  checkCloud() {
    let ready = false
    let err = ''
    try {
      ready = !!menu.isCloudReady()
      err = ready ? '' : (menu.cloudError() || '')
    } catch (e) {
      ready = false
      err = ''
    }
    if (!ready) {
      this.setData({
        cloudReady: false,
        cloudError: err || '云开发不可用，请检查小程序云开发配置'
      })
      return
    }
    this.checkAdmin()
  },

  // 身份校验：失败兜底为非管理员（非管理员不渲染任何上传 / 删除 UI）
  checkAdmin() {
    let task = null
    try {
      task = menu.whoami()
    } catch (e) {
      task = null
    }
    if (!task || typeof task.then !== 'function') {
      this.setData({ checked: true, isAdmin: false })
      wx.showToast({ title: '身份校验失败，请检查云函数是否已部署', icon: 'none' })
      return
    }
    task.then((res) => {
      const isAdmin = !!(res && res.isAdmin)
      this.setData({
        checked: true,
        isAdmin: isAdmin,
        openid: (res && res.openid) || ''
      })
      if (isAdmin) this.loadList()
    }).catch(() => {
      this.setData({ checked: true, isAdmin: false })
      wx.showToast({ title: '身份校验失败，请检查云函数是否已部署', icon: 'none' })
    })
  },

  // 拉取当前日期全部记录并分组
  loadList() {
    if (!this.data.cloudReady || !this.data.isAdmin) return
    const date = this.data.date
    const seq = this._seq = (this._seq || 0) + 1

    let task = null
    try {
      task = menu.listByDates([date])
    } catch (e) {
      task = null
    }
    if (!task || typeof task.then !== 'function') {
      wx.showToast({ title: '加载失败，请重试', icon: 'none' })
      return
    }
    task.then((rows) => {
      if (seq !== this._seq) return        // 已切换日期，丢弃过期结果
      const list = Array.isArray(rows) ? rows : []
      this.setData({
        list: list,
        current: this.filterByMeal(list, this.data.meal),
        stats: this.buildStats(list)
      })
    }).catch(() => {
      if (seq !== this._seq) return
      wx.showToast({ title: '加载失败，请重试', icon: 'none' })
    })
  },

  // 取某个餐次的记录，按 sort 升序（sort 缺失按 0 处理）
  filterByMeal(list, meal) {
    const out = []
    const rows = list || []
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i]
      if (r && r.meal === meal) out.push(r)
    }
    out.sort((a, b) => (a.sort || 0) - (b.sort || 0))
    return out
  },

  // 当日各餐次张数（概览卡数据）
  buildStats(list) {
    const map = {}
    const rows = list || []
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i]
      if (r && r.meal) map[r.meal] = (map[r.meal] || 0) + 1
    }
    return mealUtil.MEALS.map((m) => ({
      key: m.key,
      name: m.name,
      count: map[m.key] || 0
    }))
  },

  // 切换日期：清空旧数据后重新拉取
  onDateChange(e) {
    const date = (e.detail && e.detail.value) || ''
    if (!date || date === this.data.date) return
    this.setData({
      date: date,
      dateLabel: toDateLabel(date),
      list: [],
      current: [],
      stats: this.buildStats([])
    })
    this.loadList()
  },

  // 切换餐次（上方胶囊与概览行共用）
  onMealTap(e) {
    const key = (e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.key) || ''
    if (!key || key === this.data.meal) return
    this.setData({
      meal: key,
      mealLabel: mealUtil.mealName(key) || key,
      current: this.filterByMeal(this.data.list, key)
    })
  },

  // 选择图片（相册 / 拍照）
  onChoose() {
    if (!this.data.cloudReady) {
      wx.showToast({ title: this.data.cloudError || '云开发不可用', icon: 'none' })
      return
    }
    if (!this.data.isAdmin || this.data.uploading) return
    if (this.data.current.length >= MAX_PER_MEAL) {
      wx.showToast({ title: '该餐次最多 ' + MAX_PER_MEAL + ' 张，请先删除', icon: 'none' })
      return
    }

    const date = this.data.date
    const meal = this.data.meal

    wx.chooseMedia({
      count: Math.max(1, MAX_PER_MEAL - this.data.current.length),
      mediaType: ['image'],
      sourceType: ['album', 'camera'],
      sizeType: ['compressed'],
      success: (res) => {
        const files = (res && res.tempFiles) || []
        const paths = []
        for (let i = 0; i < files.length; i++) {
          if (files[i] && files[i].tempFilePath) paths.push(files[i].tempFilePath)
        }
        if (!paths.length) return
        this.upload(paths, date, meal)
      },
      fail: () => {
        // 用户取消选择，不提示
      }
    })
  },

  // 逐张上传到云存储（顺序执行，保证 sort 与选择顺序一致），单张失败继续其余
  upload(paths, date, meal) {
    const items = []
    const base = Date.now()
    let failed = 0
    let index = 0

    this.setData({ uploading: true, done: 0, total: paths.length, percent: 0 })

    // 单张失败提示（提示本身异常不影响后续上传）
    const markFail = (i) => {
      failed += 1
      try {
        wx.showToast({ title: '第 ' + (i + 1) + ' 张上传失败', icon: 'none' })
      } catch (e) {
        // 忽略
      }
    }

    // 推进进度并继续下一张
    const step = (i) => {
      index = i + 1
      this.setData({
        done: index,
        percent: Math.round(index * 100 / paths.length)
      })
      next()
    }

    const next = () => {
      if (index >= paths.length) {
        this.finishUpload(items, failed)
        return
      }
      const i = index
      const filePath = paths[i]
      const ext = this.pickExt(filePath)
      const cloudPath = `menu/${date}/${meal}_${Date.now()}_${i}.${ext}`

      let task = null
      try {
        task = wx.cloud.uploadFile({ cloudPath: cloudPath, filePath: filePath })
      } catch (e) {
        task = null
      }
      if (!task || typeof task.then !== 'function') {
        markFail(i)
        step(i)
        return
      }
      task.then((res) => {
        if (res && res.fileID) {
          items.push({ date: date, meal: meal, fileID: res.fileID, sort: base + i })
        } else {
          markFail(i)
        }
      }, () => {
        markFail(i)
      }).then(() => {
        step(i)
      })
    }

    next()
  },

  // 从临时文件路径取扩展名，取不到用 png
  pickExt(filePath) {
    const m = /\.([a-zA-Z0-9]{1,8})(?:\?.*)?$/.exec(String(filePath || ''))
    return m ? m[1].toLowerCase() : 'png'
  },

  // 全部上传结束：一次性写入数据库 → 刷新列表
  finishUpload(items, failed) {
    const finish = () => {
      this.setData({ uploading: false, done: 0, total: 0, percent: 0 })
      this.loadList()
    }

    if (!items.length) {
      finish()
      wx.showToast({ title: failed ? '图片上传失败，请重试' : '没有可用图片', icon: 'none' })
      return
    }

    let task = null
    try {
      task = menu.addPhotos(items)
    } catch (e) {
      task = null
    }
    if (!task || typeof task.then !== 'function') {
      finish()
      wx.showToast({ title: '保存失败，请重试', icon: 'none' })
      return
    }
    task.then((res) => {
      if (res && res.ok) {
        if (failed) {
          wx.showToast({ title: '已添加 ' + items.length + ' 张，' + failed + ' 张失败', icon: 'none' })
        } else {
          wx.showToast({ title: '已添加 ' + items.length + ' 张', icon: 'success' })
        }
      } else {
        wx.showToast({ title: (res && res.msg) || '保存失败，请重试', icon: 'none' })
      }
      finish()
    }, () => {
      wx.showToast({ title: '保存失败，请重试', icon: 'none' })
      finish()
    })
  },

  // 删除单张图片（云存储文件由云函数一并删除）
  onDelete(e) {
    if (!this.data.isAdmin || this.data.uploading) return
    const id = (e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.id) || ''
    if (!id) return

    wx.showModal({
      title: '删除图片',
      content: '删除这张图片？',
      confirmColor: '#2E6BFF',
      success: (res) => {
        if (!res || !res.confirm) return
        let task = null
        try {
          task = menu.removePhoto(id)
        } catch (e2) {
          task = null
        }
        if (!task || typeof task.then !== 'function') {
          wx.showToast({ title: '删除失败，请重试', icon: 'none' })
          return
        }
        task.then((r) => {
          if (r && r.ok) {
            wx.showToast({ title: '已删除', icon: 'success' })
            this.loadList()
          } else {
            wx.showToast({ title: (r && r.msg) || '删除失败，请重试', icon: 'none' })
          }
        }).catch(() => {
          wx.showToast({ title: '删除失败，请重试', icon: 'none' })
        })
      }
    })
  },

  goBack() {
    wx.navigateBack({
      delta: 1,
      fail: () => {
        wx.switchTab({ url: '/pages/mine/mine' })
      }
    })
  }
})
