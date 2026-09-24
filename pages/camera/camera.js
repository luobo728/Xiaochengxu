// pages/camera/camera.js —— 点击底部导航中间的「+」进入，调起设备相机拍照
const app = getApp()

Page({
  data: {
    statusBarHeight: 20,
    ready: false,          // 权限检查是否完成
    authorized: false,     // 是否可渲染原生相机
    devicePosition: 'back', // back | front
    flash: 'off',          // off | torch
    shooting: false,
    photo: ''              // 拍照后的临时文件路径
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

  // 拍照
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
