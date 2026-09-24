// custom-tab-bar/index.js —— 自定义底部导航（4 个 tab + 中间「+」调起相机）
Component({
  data: {
    selected: 0
  },

  methods: {
    // 切换 tab
    onTab(e) {
      const ds = e.currentTarget.dataset
      const index = Number(ds.index)
      const url = ds.path
      if (!url) return
      // 再次点击当前 tab：回到页面顶部（对齐原生 tabBar 行为）
      if (index === this.data.selected) {
        wx.pageScrollTo({ scrollTop: 0, duration: 200, fail() {} })
        return
      }

      wx.switchTab({
        url,
        fail() {
          wx.showToast({ title: '页面跳转失败', icon: 'none' })
        }
      })
    },

    // 点击中间「+」：调起设备相机
    onScan() {
      // 长按扫码刚触发过，短时间内忽略点击，避免同时跳相机页
      if (Date.now() - (this._lastLongPress || 0) < 900) return

      wx.navigateTo({
        url: '/pages/camera/camera',
        fail() {
          wx.showToast({ title: '相机页打开失败', icon: 'none' })
        }
      })
    },

    // 长按中间「+」：使用微信扫一扫
    onScanLongPress() {
      this._lastLongPress = Date.now()
      wx.scanCode({
        onlyFromCamera: false,
        scanType: ['barCode', 'qrCode', 'datamatrix', 'pdf417'],
        success(res) {
          const text = (res && res.result) || ''
          wx.showToast({
            title: text ? '识别成功：' + text.slice(0, 12) : '识别成功',
            icon: 'none'
          })
        },
        fail() {
          // 用户取消扫码不提示
        }
      })
    }
  }
})
