// components/tab-bar/index.js —— 底部导航（首页 / 课时 / 校园 / 我的 + 中间「+」按钮）
// 这个组件被两处使用：
//   1) custom-tab-bar/index      → 4 个 tab 页的底部导航
//   2) 子页面（今日食谱 / 食谱管理）→ 让用户在这些页面里也能直接切换模块
Component({
  properties: {
    // 当前选中的 tab（0~3），传 -1 表示都不选中
    selected: {
      type: Number,
      value: 0
    },
    // 子页面传 true：点当前 tab 也直接切换（不做「回到顶部」）
    plain: {
      type: Boolean,
      value: false
    }
  },

  methods: {
    onTab(e) {
      const ds = e.currentTarget.dataset
      const index = Number(ds.index)
      const url = ds.path
      if (!url) return

      // 在 tab 页上再次点当前 tab：回到页面顶部（对齐原生 tabBar 行为）
      if (!this.data.plain && index === this.data.selected) {
        wx.pageScrollTo({ scrollTop: 0, duration: 200, fail() {} })
        return
      }

      this.safeSwitch(url, false)
    },

    // switchTab 偶发失败（例如上一次跳转还没结束时点击）时自动重试一次，
    // 避免出现「点了没反应」的感觉
    safeSwitch(url, isRetry) {
      wx.switchTab({
        url,
        fail: () => {
          if (isRetry) {
            wx.showToast({ title: '切换失败，请再点一次', icon: 'none' })
            return
          }
          setTimeout(() => {
            this.safeSwitch(url, true)
          }, 200)
        }
      })
    },

    // 点中间「+」：调起设备相机
    onScan() {
      if (Date.now() - (this._lastLongPress || 0) < 900) return
      wx.navigateTo({
        url: '/pages/camera/camera',
        fail() {
          wx.showToast({ title: '相机页打开失败', icon: 'none' })
        }
      })
    },

    // 长按「+」：使用微信扫一扫
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
