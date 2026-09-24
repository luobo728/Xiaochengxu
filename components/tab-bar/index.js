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
      try {
        const ds = (e && e.currentTarget && e.currentTarget.dataset) || {}
        const index = Number(ds.index)
        const url = ds.path
        if (!url) return

        // 用「当前真实页面」判断，而不是用高亮值判断：高亮偶尔落后也能切过去
        if (this.currentRoute() === url) {
          this.setData({ active: index })
          wx.pageScrollTo({ scrollTop: 0, duration: 200, fail() {} })
          return
        }

        // 先高亮，点击反馈更跟手
        this.setData({ active: index })
        this.goTab(url)
      } catch (err) {
        // 任何意外都不能让导航栏变成「点不动」
        wx.showToast({ title: '切换失败，请再点一次', icon: 'none' })
      }
    },

    // 切换模块，三层保险：
    //   ① switchTab
    //   ② 失败后 80ms 自动重试一次
    //   ③ 900ms 后如果还停在原页面，用 reLaunch 强制打开目标页
    //      （reLaunch 会清空页面栈，能破掉「卡在某一页、怎么点都切不动」的状态）
    goTab(url) {
      const from = this.currentRoute()
      this._pendingUrl = url

      wx.switchTab({
        url,
        fail: () => {
          setTimeout(() => {
            wx.switchTab({ url, fail: () => {} })
          }, 80)
        }
      })

      setTimeout(() => {
        // 只有「最后一次点的那个 tab」才有资格兜底，避免乱跳
        if (this._pendingUrl !== url) return
        if (this.currentRoute() === from && from !== url) {
          this._pendingUrl = ''
          wx.reLaunch({
            url,
            fail: () => {
              wx.showToast({ title: '切换失败，请再点一次', icon: 'none' })
            }
          })
        }
      }, 900)
    },

    // 点中间「+」：进入「扫码 / 拍照」二合一页面（默认扫码）
    onScan() {
      wx.navigateTo({
        url: '/pages/camera/camera',
        fail() {
          wx.showToast({ title: '相机页打开失败', icon: 'none' })
        }
      })
    }
  }
})
