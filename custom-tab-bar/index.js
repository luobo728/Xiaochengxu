// custom-tab-bar/index.js —— 框架要求的自定义 tabBar 外壳
// 真正的 UI 与交互在 components/tab-bar 里（子页面复用同一个组件）
// 各 tab 页在 onShow 里调用 this.getTabBar().setData({ selected: N }) 同步选中态
Component({
  data: {
    selected: 0
  }
})
