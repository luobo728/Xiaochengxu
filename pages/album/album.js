// pages/album/album.js —— 班级相册（家长看的页面，只读）
//
// 家长在这里只做三件事：选班级 → 看相册列表 → 点开看照片、看大图。
// 增删改都在 pages/album-admin（只有管理员看得到入口）。
// 数据全部来自 utils/album.js，页面只负责显示与触发操作。
const app = getApp()
const album = require('../../utils/album.js')
const view = require('../../utils/album-view.js')
const nav = require('../../utils/nav.js')

// 家长页一次最多列出多少本相册（真到几十本也能翻，留个上限防止极端数据把页面撑爆）
const MAX_CARDS = 60

Page({
  data: {
    statusBarHeight: 20,

    // 家长选的班级：选过会记在本机，下次进来还在
    classes: album.CLASSES,
    myClass: '',
    classPicked: false,

    // 相册列表
    albums: [],
    loading: false,

    // 'list' 看列表 / 'detail' 看某一本的照片（同一页里切，不用退来退去）
    view: 'list',
    cur: null,
    photos: [],
    total: 0,
    totalText: '',
    realCount: 0, // 有真照片的张数：全是占位图时给家长一句说明
    hasMore: false,
    loadingMore: false,

    // 演示数据提示（本地模式才有）
    modeTip: ''
  },

  // 从校园页点某一本相册进来时会带 ?id=xxx，等列表拉到手再自动打开那一本
  onLoad(options) {
    const opts = options || {}
    this._pendingId = opts.id ? decodeURIComponent(opts.id) : ''
    this.setData({
      statusBarHeight: (app.globalData && app.globalData.statusBarHeight) || 20
    })
    // 本地模式：先跟家长说清楚现在看到的是演示数据
    if (album.MODE !== 'cloud') {
      this.setData({
        modeTip: '演示数据：相册只保存在这台手机上。连上云端后（见 docs/album-cloud-setup.md），全园家长看到的是同一份相册。'
      })
    }
    // 本机记的班级先秒显（云端模式随后再问一次云端）
    const mine = album.myClassSync()
    this.setData({ myClass: mine, classPicked: !!mine })
    this.refreshList().then(() => {
      if (!this._pendingId) return
      const id = this._pendingId
      this._pendingId = ''
      this.openAlbum(id)
    })
  },

  onShow() {
    // 同步自定义 tabBar 的选中态（相册从「校园」进来，所以高亮校园）
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().setData({ selected: 2 })
    }
    // 从别的页面回来时刷新一次；首次进入由 onLoad 负责，避免重复请求
    if (this._entered) {
      this.refreshList()
      if (this.data.view === 'detail' && this.data.cur) this.loadPhotos(this.data.cur.id, 0)
    }
    this._entered = true
  },

  // 下拉刷新：在哪一层就刷新哪一层
  onPullDownRefresh() {
    const done = () => {
      wx.stopPullDownRefresh()
    }
    if (this.data.view === 'detail' && this.data.cur) {
      this.loadPhotos(this.data.cur.id, 0).then(done)
      return
    }
    this.refreshList().then(done)
  },

  /* ---------------- 相册列表 ---------------- */

  // 先用本机数据把列表画出来（不等网络），再拉一次最新覆盖
  refreshList() {
    this.paintList(album.listAlbumsSync(this.data.myClass))
    return Promise.resolve(album.listAlbums(this.data.myClass))
      .then((rows) => {
        this.paintList(rows)
      })
      .catch(() => {
        // 网络不通就继续用本机数据
      })
  },

  paintList(rows) {
    this.setData({
      albums: view.toCards(rows).slice(0, MAX_CARDS),
      loading: false
    })
  },

  // 选班级：家长自己就能改，不需要管理员
  onClassTap(e) {
    const name = (e.currentTarget.dataset || {}).class || ''
    if (!name || name === this.data.myClass) return
    Promise.resolve(album.setMyClass(name))
      .then((res) => {
        if (!res || !res.ok) {
          wx.showToast({ title: (res && res.msg) || '保存失败', icon: 'none' })
          return
        }
        this.setData({ myClass: name, classPicked: true })
        this.refreshList()
        wx.showToast({ title: '已切到 ' + name, icon: 'none' })
      })
      .catch(() => {
        wx.showToast({ title: '保存失败，请重试', icon: 'none' })
      })
  },

  /* ---------------- 某一本相册的照片 ---------------- */

  onAlbumTap(e) {
    const id = (e.currentTarget.dataset || {}).id || ''
    if (!id) return
    this.openAlbum(id)
  },

  // 打开某一本相册看照片（从校园页带 ?id= 直达时，列表可能还没画出来，就用本机缓存兜底）
  openAlbum(id) {
    if (!id) return
    const list = this.data.albums || []
    let card = null
    for (let i = 0; i < list.length; i++) {
      if (list[i].id === id) card = list[i]
    }
    if (!card) {
      const row = album.getAlbum(id)
      card = row ? view.toCard(row, 0) : null
    }
    if (!card) {
      wx.showToast({ title: '这本相册已经不在了', icon: 'none' })
      return
    }
    // 先画本机缓存的照片（秒开），随后再拉最新
    const cells = view.toCells(album.listPhotosSync(id))
    this.setData({
      view: 'detail',
      cur: card,
      photos: cells,
      total: card.count,
      totalText: card.count ? '共 ' + card.count + ' 张' : '还没有照片',
      realCount: countReal(cells),
      hasMore: false,
      loadingMore: false
    })
    wx.pageScrollTo({ scrollTop: 0, duration: 200 })
    this.loadPhotos(id, 0)
  },

  // 返回相册列表（同一页里切回去，不用退页）
  backToList() {
    this.setData({
      view: 'list',
      cur: null,
      photos: [],
      total: 0,
      totalText: '',
      realCount: 0,
      hasMore: false,
      loadingMore: false
    })
    wx.pageScrollTo({ scrollTop: 0, duration: 200 })
  },

  // 拉某一本的照片；skip 用于「加载更多」
  loadPhotos(albumId, skip) {
    return Promise.resolve(album.listPhotos(albumId, { skip: skip }))
      .then((res) => {
        if (!res || !res.ok) {
          wx.showToast({ title: (res && res.msg) || '这本相册暂时打不开', icon: 'none' })
          this.setData({ loadingMore: false })
          return
        }
        const cells = view.toCells(res.photos)
        const total = Number(res.total) || 0
        const patch = {
          photos: cells,
          total: total,
          totalText: total ? '共 ' + total + ' 张' : '还没有照片',
          realCount: countReal(cells),
          hasMore: !!res.hasMore,
          loadingMore: false
        }
        // 第一页顺手把相册信息（数量 / 封面）更新到标题上
        if (!skip && res.album) {
          const fresh = view.toCard(res.album, 0)
          if (fresh) {
            patch.cur = Object.assign({}, this.data.cur, {
              title: fresh.title,
              cover: fresh.cover,
              hasCover: fresh.hasCover,
              word: fresh.word,
              date: fresh.date,
              count: fresh.count,
              countText: fresh.countText,
              classTag: fresh.classTag,
              classTone: fresh.classTone
            })
          }
        }
        this.setData(patch)
      })
      .catch(() => {
        this.setData({ loadingMore: false })
      })
  },

  onLoadMore() {
    if (this.data.loadingMore || !this.data.hasMore || !this.data.cur) return
    this.setData({ loadingMore: true })
    this.loadPhotos(this.data.cur.id, this.data.photos.length)
  },

  // 点一张照片：有真图就开大图，占位图就说明一句
  onPhotoTap(e) {
    const index = Number((e.currentTarget.dataset || {}).index)
    const list = this.data.photos || []
    const cell = list[index]
    if (!cell) return
    if (!cell.hasImg) {
      wx.showToast({ title: '这张还是占位图，等老师传上真照片', icon: 'none' })
      return
    }
    // 只把有真图的挑出来交给数据层：云端会先换成临时链接再开大图
    const urls = []
    for (let i = 0; i < list.length; i++) {
      if (list[i].hasImg) urls.push(list[i].src)
    }
    Promise.resolve(album.previewPhotos(urls, cell.src)).then((res) => {
      if (!res || !res.ok) {
        wx.showToast({ title: (res && res.msg) || '打不开大图', icon: 'none' })
      }
    })
  },

  goBack() {
    // 没有上一页时回「校园」
    nav.back('/pages/campus/campus')
  }
})

// 数一数这批格子里有几张是真照片
function countReal(cells) {
  let n = 0
  for (let i = 0; i < (cells || []).length; i++) {
    if (cells[i].hasImg) n++
  }
  return n
}
