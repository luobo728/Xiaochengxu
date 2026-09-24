// pages/monitor/monitor.js —— 园区监控播放页（深色播放器）
// 只做三件事：列出摄像头、向数据层取播放地址、用 <video> 播放。
// 不引入 live-player（需额外类目权限），也不使用任何图片资源，图标全部 CSS 绘制。
const app = getApp()
const monitor = require('../../utils/monitor.js')

// 链接剩余有效期小于该值时视为「即将过期」，进页面后自动补取一次流
const EXPIRE_SOON_MS = 60 * 1000
// 自动补取的延迟
const RELOAD_DELAY_MS = 30 * 1000

Page({
  data: {
    statusBarHeight: 20,
    ready: false,      // 是否已接入监控后端
    cameras: [],       // 摄像头列表
    current: '',       // 当前选中的摄像头 id
    camName: '',       // 当前摄像头名称
    camOnline: false,  // 当前摄像头是否在线
    playUrl: '',       // 播放地址，空串表示暂无画面
    windowText: '',    // 开放时段说明
    loading: false,    // 是否正在取流
    tip: ''            // 错误 / 空流提示
  },

  onLoad(options) {
    const wantId = (options && options.id) || ''
    this.setData({
      statusBarHeight: (app.globalData && app.globalData.statusBarHeight) || 20,
      ready: monitor.isReady(),
      windowText: monitor.openWindowText() || ''
    })
    // 未接入：不请求任何接口，直接显示占位层
    if (!this.data.ready) return
    this.loadCameras(wantId)
  },

  onUnload() {
    // 必须清掉自动补取的定时器，避免页面销毁后仍触发请求
    this.clearReloadTimer()
  },

  // 摄像头列表 -> 选中目标（options.id 优先，否则第一路）-> 取流
  loadCameras(wantId) {
    monitor
      .getCameras()
      .then((list) => {
        const cameras = list || []
        if (!cameras.length) {
          this.setData({
            cameras: [],
            current: '',
            camName: '',
            camOnline: false,
            loading: false,
            playUrl: '',
            tip: '暂无可用画面'
          })
          return
        }
        let cam = cameras[0]
        for (let i = 0; i < cameras.length; i++) {
          if (cameras[i].id === wantId) {
            cam = cameras[i]
            break
          }
        }
        this.setData({ cameras: cameras })
        this.pickCamera(cam)
        this.loadUrl(cam.id)
      })
      .catch(() => {
        // 列表拿不到：保持占位层，页面不崩、不弹错误
        this.setData({ loading: false, playUrl: '', tip: '暂时拿不到画面' })
      })
  },

  // 写入当前摄像头信息（名称 / 在线状态），并允许该路重新安排补取
  pickCamera(cam) {
    this._reloadDone = false
    this.setData({
      current: cam.id,
      camName: cam.name || '园区画面',
      camOnline: !!cam.online
    })
  },

  // 取流：空地址与异常都回到占位层，只切换文案
  loadUrl(camId) {
    const id = camId || this.data.current
    if (!id) {
      this.setData({ loading: false, playUrl: '', tip: '暂无可用画面' })
      return
    }
    this.clearReloadTimer()
    this.setData({ loading: true, playUrl: '', tip: '' })
    monitor
      .getPlayUrl(id)
      .then((res) => {
        const url = (res && res.url) || ''
        if (!url) {
          this.setData({ loading: false, playUrl: '', tip: '当前不在开放时段或暂无画面' })
          return
        }
        this.setData({ loading: false, playUrl: url, tip: '' })
        // 链接有有效期：安排在原链接过期前 60 秒自动补取一次，
        // 避免家长看着看着画面突然断掉（每路画面只补一次）
        const expireAt = (res && res.expireAt) || 0
        if (expireAt) {
          this.scheduleReload(id, expireAt - Date.now() - EXPIRE_SOON_MS)
        }
      })
      .catch(() => {
        this.setData({ loading: false, playUrl: '', tip: '暂时拿不到画面' })
      })
  },

  // 自动补取一次流：每路画面最多补一次，避免变成无限轮询
  scheduleReload(camId, waitMs) {
    if (this._reloadDone) return
    this._reloadDone = true
    // 默认 30 秒；若知道链接还有多久过期，就安排在过期前 60 秒补取
    let delay = typeof waitMs === 'number' && waitMs > 0 ? waitMs : RELOAD_DELAY_MS
    delay = Math.max(RELOAD_DELAY_MS, Math.min(delay, 30 * 60 * 1000))
    this._reloadTimer = setTimeout(() => {
      this._reloadTimer = null
      this.loadUrl(camId)
    }, delay)
  },

  clearReloadTimer() {
    if (this._reloadTimer) {
      clearTimeout(this._reloadTimer)
      this._reloadTimer = null
    }
  },

  // 手动重新获取（占位层按钮）
  reload() {
    if (!this.data.ready) {
      wx.showToast({ title: '监控正在对接中', icon: 'none' })
      return
    }
    this._reloadDone = false
    this.loadUrl(this.data.current)
  },

  // 切换摄像头：更新选中态并重新取流
  onCamTap(e) {
    const id = (e && e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.id) || ''
    if (!id || id === this.data.current) return
    const cameras = this.data.cameras
    for (let i = 0; i < cameras.length; i++) {
      if (cameras[i].id === id) {
        this.pickCamera(cameras[i])
        break
      }
    }
    this.loadUrl(id)
  },

  // 视频加载失败：清空地址回到占位层，由用户点「重新获取」重试
  onVideoError() {
    this.setData({ playUrl: '', loading: false, tip: '画面加载失败，请点重新获取' })
  },

  goBack() {
    wx.navigateBack({
      delta: 1,
      fail() {
        wx.switchTab({ url: '/pages/campus/campus' })
      }
    })
  }
})
