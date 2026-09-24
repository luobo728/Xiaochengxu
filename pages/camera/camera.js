// pages/camera/camera.js —— 底部导航中间「+」进入：扫码 / 拍照 二合一
const app = getApp()

// 横滑切换模式的位移阈值（px）：小于该值视为点击，交给按钮处理
const SWIPE_THRESHOLD = 60
// 同一扫码内容在该时间窗内只处理一次（camera scanCode 会重复回调）
const SCAN_DEDUP_MS = 3000

Page({
  data: {
    statusBarHeight: 20,
    ready: false,          // 权限检查是否完成
    authorized: false,     // 是否可渲染原生相机
    devicePosition: 'back', // back | front
    flash: 'off',          // off | torch
    shooting: false,
    photo: '',             // 拍照后的临时文件路径
    mode: 'scan',          // scan | photo：入口叫「扫一扫」，默认扫码
    scanResult: ''         // 最近一次识别到的内容
  },

  onLoad() {
    this.setData({
      statusBarHeight: (app.globalData && app.globalData.statusBarHeight) || 20
    })
    this.checkAuth()
  },

  onUnload() {
    this.cameraCtx = null
    if (this._toastTimer) {
      clearTimeout(this._toastTimer)
      this._toastTimer = null
    }
    this._touchStartX = null
  },

  // 权限：从未询问过则主动申请；已拒绝则展示引导页（不再挂载相机，避免报错）
  checkAuth() {
    wx.getSetting({
      success: (res) => {
        const setting = (res && res.authSetting) || {}
        if (setting['scope.camera'] === false) {
          this.setData({ ready: true, authorized: false })
          return
        }
        wx.authorize({
          scope: 'scope.camera',
          success: () => this.setData({ ready: true, authorized: true }),
          fail: (err) => {
            const msg = (err && err.errMsg) || ''
            // 只有用户明确拒绝才进引导页；其它异常（如 scope 不受支持）仍挂载相机
            if (msg.indexOf('deny') > -1 || msg.indexOf('cancel') > -1) {
              this.setData({ ready: true, authorized: false })
            } else {
              this.setData({ ready: true, authorized: true })
            }
          }
        })
      },
      fail: () => {
        // getSetting 失败时直接尝试挂载相机，由相机自身触发授权
        this.setData({ ready: true, authorized: true })
      }
    })
  },

  onCameraStop() {
    // 相机停止（切后台等），无需处理
  },

  onCameraError(e) {
    const msg = (e && e.detail && e.detail.errMsg) || ''
    if (msg.indexOf('auth') > -1 || msg.indexOf('deny') > -1 || msg.indexOf('permission') > -1) {
      this.setData({ authorized: false })
      return
    }
    wx.showToast({ title: '相机启动失败，请重试', icon: 'none' })
  },

  // ---------- 模式切换：扫码 / 拍照 ----------

  // 点击分段控件（wxml 通过 data-mode 传值）
  onModeChange(e) {
    const next = (e && e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.mode) || ''
    this.applyMode(next)
  },

  // 横滑切换：左滑 → 拍照，右滑 → 扫码
  onTouchStart(e) {
    const touch = (e && e.changedTouches && e.changedTouches[0]) || null
    this._touchStartX = touch ? touch.clientX : null
  },

  onTouchEnd(e) {
    const startX = this._touchStartX
    this._touchStartX = null
    if (startX === null || startX === undefined) return
    // 权限引导页 / 照片预览时不响应滑动，避免误切
    if (!this.data.ready || !this.data.authorized || this.data.photo) return
    const touch = (e && e.changedTouches && e.changedTouches[0]) || null
    if (!touch) return
    const dx = touch.clientX - startX
    if (Math.abs(dx) <= SWIPE_THRESHOLD) return
    this.applyMode(dx < 0 ? 'photo' : 'scan')
  },

  // 统一的模式落地：切模式时清掉上次识别结果与去重记录，避免旧卡片残留
  applyMode(mode) {
    if (mode !== 'scan' && mode !== 'photo') return
    if (mode === this.data.mode) return
    this._lastScan = null
    // 切模式会重建 <camera> 实例，旧 context 失效，置空以便下次拍照重新创建
    this.cameraCtx = null
    this.setData({ mode: mode, scanResult: '' })
  },

  // ---------- 扫码 ----------

  onScanCode(e) {
    const text = (e && e.detail && e.detail.result) || ''
    if (!text) return

    const now = Date.now()
    const last = this._lastScan
    // scanCode 模式下码持续在镜头里会反复回调：同内容 3s 内忽略，不同内容立即处理
    if (last && last.text === text && now - last.time < SCAN_DEDUP_MS) return
    this._lastScan = { text: text, time: now }

    try {
      wx.vibrateShort({ type: 'light', fail() {} })
    } catch (err) {
      // 忽略：部分机型 / 开发者工具不支持震动
    }
    this.setData({ scanResult: text })
  },

  // 继续扫码：只收起卡片，保留去重记录，避免同一个码立刻又弹出来
  clearScanResult() {
    this.setData({ scanResult: '' })
  },

  copyScanResult() {
    const text = this.data.scanResult
    if (!text) return
    wx.setClipboardData({
      data: text,
      success: () => wx.showToast({ title: '已复制', icon: 'none' }),
      fail: () => wx.showToast({ title: '复制失败，请重试', icon: 'none' })
    })
  },

  // ---------- 拍照 ----------

  takePhoto() {
    if (this.data.shooting || this.data.photo) return

    let ctx = this.cameraCtx
    if (!ctx) {
      try {
        ctx = wx.createCameraContext()
        this.cameraCtx = ctx
      } catch (e) {
        ctx = null
      }
    }
    if (!ctx) {
      wx.showToast({ title: '相机未就绪', icon: 'none' })
      return
    }

    this.setData({ shooting: true })
    ctx.takePhoto({
      quality: 'high',
      success: (res) => {
        this.setData({ photo: res.tempImagePath, shooting: false })
        try {
          wx.vibrateShort({ type: 'light', fail() {} })
        } catch (e) {
          // 忽略：部分机型 / 开发者工具不支持震动
        }
      },
      fail: () => {
        this.setData({ shooting: false })
        wx.showToast({ title: '拍照失败，请重试', icon: 'none' })
      }
    })
  },

  // 重拍
  retake() {
    // 组件销毁重建后旧 context 失效，置空以便下次拍照重新创建
    this.cameraCtx = null
    this.setData({ photo: '' })
  },

  // 使用照片：暂存路径并返回上一页
  usePhoto() {
    const path = this.data.photo
    if (!path) return

    if (app.globalData) {
      app.globalData.lastPhotoPath = path
    }
    try {
      wx.setStorageSync('lastPhotoPath', path)
    } catch (e) {
      // 存储失败不影响主流程
    }

    wx.showToast({ title: '照片已保存', icon: 'success', duration: 800 })
    this._toastTimer = setTimeout(() => {
      this.goBack()
    }, 850)
  },

  // 前后摄像头切换
  switchCamera() {
    const next = this.data.devicePosition === 'back' ? 'front' : 'back'
    const patch = { devicePosition: next }
    // 前置摄像头不支持常亮补光
    if (next === 'front' && this.data.flash === 'torch') {
      patch.flash = 'off'
    }
    this.setData(patch)
  },

  // 闪光灯（常亮补光）开关
  toggleFlash() {
    if (!this.data.authorized) return
    const on = this.data.flash !== 'torch'
    const patch = { flash: on ? 'torch' : 'off' }
    if (on && this.data.devicePosition === 'front') {
      patch.devicePosition = 'back'
    }
    this.setData(patch)
    wx.showToast({ title: on ? '闪光灯已开启' : '闪光灯已关闭', icon: 'none', duration: 900 })
  },

  // 相册选择（权限被拒时的兜底方案）
  pickFromAlbum() {
    wx.chooseMedia({
      count: 1,
      mediaType: ['image'],
      sourceType: ['album', 'camera'],
      sizeType: ['compressed'],
      success: (res) => {
        const file = res && res.tempFiles && res.tempFiles[0]
        if (file && file.tempFilePath) {
          this.setData({ photo: file.tempFilePath, authorized: true })
          this.checkAuth()
        }
      },
      fail: () => {
        // 用户取消不提示
      }
    })
  },

  // 去设置页开启权限
  openSetting() {
    wx.openSetting({
      success: (res) => {
        const setting = (res && res.authSetting) || {}
        if (setting['scope.camera']) {
          this.setData({ authorized: true })
        }
      },
      fail: () => {
        wx.showToast({ title: '打开设置失败', icon: 'none' })
      }
    })
  },

  goBack() {
    wx.navigateBack({
      delta: 1,
      fail: () => {
        wx.switchTab({ url: '/pages/index/index' })
      }
    })
  }
})
