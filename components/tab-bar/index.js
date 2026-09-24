// components/tab-bar/index.js —— 底部导航（首页 / 课时 / 校园 / 我的 + 中间「+」按钮）
// 这个组件被两处使用：
//   1) custom-tab-bar/index      → 4 个 tab 页的底部导航
//   2) 子页面（今日食谱 / 食谱管理）→ 让用户在这些页面里也能直接切换模块
//
// 关键设计：高亮与「点了要不要切」都以「当前真实页面路径」为准（getCurrentPages），
// 不单纯依赖外部传入的选中值 —— 这样即使外部状态偶尔没同步上，
// 点击也一定能切过去，不会出现「只能滑动、点导航没反应」。
const TAB_URLS = [
  '/pages/index/index',
  '/pages/course/course',
  '/pages/campus/campus',
  '/pages/mine/mine'
]

Component({
  properties: {
    // 外部传入的当前选中 tab（0~3），-1 表示都不选中
    selected: {
      type: Number,
      value: 0
    },
    // 旧参数：早期用来区分「子页面」和「tab 页」。现在由「当前页面路径」自动判断，
    // 传不传都不影响行为，保留只是为了不改动已经引用它的子页面
    plain: {
      type: Boolean,
      value: false
    }
  },

  data: {
    // 实际用于高亮的值：既可由外部 selected 同步，也会按当前页面路径自我校正
    active: 0
  },

  observers: {
    selected: function (value) {
      if (typeof value === 'number' && value >= 0 && value !== this.data.active) {
        this.setData({ active: value })
      }
    }
  },

  lifetimes: {
    attached() {
      this.syncActiveFromRoute()
    }
  },

  pageLifetimes: {
    // 所属页面每次显示时，按页面路径校正高亮（外部忘记同步也能自动纠正）
    show() {
      this.syncActiveFromRoute()
    }
  },

  methods: {
    // 当前真实页面路径，例如 '/pages/mine/mine'
    currentRoute() {
      const pages = getCurrentPages()
      if (!pages || !pages.length) return ''
      return '/' + pages[pages.length - 1].route
    },

    // 按当前路径校正高亮
    syncActiveFromRoute() {
      const index = TAB_URLS.indexOf(this.currentRoute())
      if (index > -1 && index !== this.data.active) {
        this.setData({ active: index })
      }
    },

    onTab(e) {
      const ds = e.currentTarget.dataset
      const index = Number(ds.index)
      const url = ds.path
      if (!url) return

      // 用「当前真实页面」判断，而不是用高亮值判断：
      // 在同一页上再点一次 → 回到顶部；其它情况一律切换
      if (this.currentRoute() === url) {
        this.setData({ active: index })
        wx.pageScrollTo({ scrollTop: 0, duration: 200, fail() {} })
        return
      }

      // 先高亮，点击反馈更跟手
      this.setData({ active: index })
      this.safeSwitch(url, false)
    },

    // switchTab 偶发失败（例如上一次跳转还没结束时点击）时自动重试一次，
    // 避免出现「点了没反应」的感觉
    safeSwitch(url, isRetry) {
      wx.switchTab({
        url,
        fail: () => {
          if (isRetry) {
            // 两次都失败：把高亮纠正回真实页面，并提示
            this.syncActiveFromRoute()
            wx.showToast({ title: '切换失败，请再点一次', icon: 'none' })
            return
          }
          // 重试等待从 200ms 缩短到 80ms：失败的切换能更快重试，用户少等一截
          setTimeout(() => {
            this.safeSwitch(url, true)
          }, 80)
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
