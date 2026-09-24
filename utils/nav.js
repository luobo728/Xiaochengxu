// utils/nav.js —— 统一的「返回」逻辑
//
// 为什么需要它：wx.navigateBack 在「页面栈里没有上一页」时**不一定**会触发 fail 回调，
// 于是只写 fail 兜底的页面就会显得「点了返回没反应、退不出去」。
// 这里先自己判断页面栈深度，再决定是返回还是切到指定 tab，最后还有 reLaunch 兜底。

// 返回上一页；没有上一页时切到 fallbackTabUrl（默认首页）
function back(fallbackTabUrl) {
  const pages = getCurrentPages() || []
  if (pages.length > 1) {
    wx.navigateBack({
      delta: 1,
      fail: () => toTab(fallbackTabUrl)
    })
    return
  }
  toTab(fallbackTabUrl)
}

// 切到某个 tab 页（失败就用 reLaunch 强开，再失败才提示）
function toTab(url) {
  const target = url || '/pages/index/index'
  wx.switchTab({
    url: target,
    fail: () => {
      wx.reLaunch({
        url: target,
        fail: () => {
          wx.showToast({ title: '返回失败，请点左上角重新进入', icon: 'none' })
        }
      })
    }
  })
}

module.exports = {
  back: back,
  toTab: toTab
}
