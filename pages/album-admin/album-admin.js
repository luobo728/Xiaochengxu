// pages/album-admin/album-admin.js —— 相册管理（只有管理员能进）
// 家长端「班级相册」看到的相册和照片，就是在这里建、在这里传的。
// 页面只做「显示 + 转发用户操作」，真正的数据读写都在 utils/album.js 里。
// 身份判断也不自己算：调用 album.adminStatus()，两种情况都支持
//   云端管理员 —— 云函数白名单里的 openid（与「通知公告管理」共用一份名单）
//   本机体验管理员 —— 云端没连上时，长按「我的」页版本号开启，数据只存这台手机
const album = require('../../utils/album.js')
const view = require('../../utils/album-view.js')
const nav = require('../../utils/nav.js')

// 两位数补零：2025-4-6 → 2025-04-06
function pad2(n) {
  return (n < 10 ? '0' : '') + n
}

// 今天（日期选择器的上限，也是新建相册的默认日期）
function todayText() {
  const now = new Date()
  return now.getFullYear() + '-' + pad2(now.getMonth() + 1) + '-' + pad2(now.getDate())
}

function trimText(v) {
  return String(v === undefined || v === null ? '' : v).replace(/^\s+|\s+$/g, '')
}

Page({
  data: {
    statusBarHeight: 20,

    // 身份相关
    checked: false,
    isAdmin: false,
    openid: '',
    modeTip: '',

    // 表单：editId 为空 = 在建新相册；有值 = 正在改这一本
    editId: '',
    editTitle: '', // 正在改哪一本（表单上方提示条显示用）
    title: '',
    classes: album.CLASSES,
    classIndex: 0,
    date: '',
    today: '',
    maxTitle: album.MAX_TITLE,
    titleLeft: album.MAX_TITLE,
    saving: false,

    // 相册列表
    rows: [],
    total: 0,

    // 展开了照片的那一本（同一次只展开一本，页面不会太长）
    openId: '',
    openTitle: '',
    openPhotos: [],
    openTotal: 0,
    openTotalText: '',
    openHasMore: false,
    openLoading: false,

    // 上传中：防止连点重复上传
    uploading: false,
    maxPhotos: album.MAX_PHOTOS,
    maxPick: album.MAX_PICK
  },

  onLoad() {
    const app = getApp()
    const today = todayText()
    this.setData({
      statusBarHeight: (app.globalData && app.globalData.statusBarHeight) || 20,
      today: today,
      date: today
    })
    this.checkAdmin()
  },

  // 校验身份：是管理员才把表单和列表显示出来
  checkAdmin() {
    const that = this
    album.adminStatus().then(function (res) {
      const isAdmin = !!(res && res.isAdmin)
      that.setData({
        checked: true,
        isAdmin: isAdmin,
        openid: (res && res.openid) || '',
        modeTip: that.tipOf(res)
      })
      if (!isAdmin) return
      that.fillClass()
      that.refreshList()
    }).catch(function () {
      that.setData({ checked: true, isAdmin: false })
    })
  },

  // 提示条：演示模式 + 数据层给的提示（例如「云函数暂时没连上」）合成一句话
  tipOf(res) {
    const parts = []
    if (album.MODE !== 'cloud') {
      parts.push('演示模式：相册和照片只存在这台手机上，家长端看到的是内置的演示相册。配好云开发后（见 docs/album-cloud-setup.md），老师传一次所有家长都能看到。')
    }
    const tip = trimText(res && res.tip)
    if (tip) parts.push(tip)
    return parts.join(' ')
  },

  // 新建相册时默认选中「我的」页里那个班级，管理员不用每次重选
  fillClass() {
    const name = album.myClassSync()
    let index = 0
    for (let i = 0; i < album.CLASSES.length; i++) {
      if (album.CLASSES[i] === name) {
        index = i
        break
      }
    }
    this.setData({ classIndex: index })
  },

  /* ---------------- 列表 ---------------- */

  // 刷新相册列表：先用本机数据秒显（不等网络），再拉一次最新覆盖
  refreshList() {
    const that = this
    this.paintRows(album.listAlbumsSync())
    Promise.resolve(album.listAlbums())
      .then(function (rows) {
        that.paintRows(rows)
      })
      .catch(function () {
        // 网络不通就继续用本机数据
      })
  },

  // 数据行 → 页面卡片（封面占位、班级标签、张数文案都在 utils/album-view.js 里算好）
  paintRows(rows) {
    const cards = view.toCards(rows)
    const openId = this.data.openId
    let found = false
    let openTitle = this.data.openTitle
    let openTotal = this.data.openTotal
    let openTotalText = this.data.openTotalText
    for (let i = 0; i < cards.length; i++) {
      cards[i].open = cards[i].id === openId
      if (cards[i].open) {
        found = true
        openTitle = cards[i].title
        openTotal = cards[i].count
        openTotalText = cards[i].countText
      }
    }

    const patch = { rows: cards, total: cards.length }
    // 展开的那一本被删掉了（或云端已经没有了）：收起照片区，别留一块空的
    if (openId && !found) {
      patch.openId = ''
      patch.openTitle = ''
      patch.openPhotos = []
      patch.openTotal = 0
      patch.openTotalText = ''
      patch.openHasMore = false
      patch.openLoading = false
    } else {
      patch.openTitle = openTitle
      patch.openTotal = openTotal
      patch.openTotalText = openTotalText
    }
    this.setData(patch)
  },

  // 从当前列表里找一条卡片
  rowOf(id) {
    const rows = this.data.rows
    for (let i = 0; i < rows.length; i++) {
      if (rows[i].id === id) return rows[i]
    }
    return null
  },

  /* ---------------- 表单 ---------------- */

  onTitleInput(e) {
    const value = (e.detail && e.detail.value) || ''
    this.setData({
      title: value,
      titleLeft: Math.max(0, album.MAX_TITLE - value.length)
    })
  },

  onClassTap(e) {
    const index = Number(e.currentTarget.dataset.index) || 0
    this.setData({ classIndex: index })
  },

  onDateChange(e) {
    this.setData({ date: (e.detail && e.detail.value) || this.data.today })
  },

  // 「新建」：清空相册名，班级和日期留着（连着建几本省事）
  onNewTap() {
    this.setData({
      editId: '',
      editTitle: '',
      title: '',
      titleLeft: album.MAX_TITLE
    })
  },

  // 「改名」：把这一本填进表单（相册名 / 班级 / 日期一起填）
  onEditTap(e) {
    const id = e.currentTarget.dataset.id
    if (!id) return
    const card = this.rowOf(id)
    if (!card) return

    let classIndex = this.data.classIndex
    for (let i = 0; i < album.CLASSES.length; i++) {
      if (album.CLASSES[i] === card.className) {
        classIndex = i
        break
      }
    }
    this.setData({
      editId: card.id,
      editTitle: card.title,
      title: card.title,
      titleLeft: Math.max(0, album.MAX_TITLE - card.title.length),
      classIndex: classIndex,
      date: card.date || this.data.today
    })
    // 表单在页面最上面，滚回去让人看见「正在修改」
    wx.pageScrollTo({ scrollTop: 0, duration: 200 })
  },

  onCancelEdit() {
    this.onNewTap()
  },

  onSave() {
    const that = this
    if (this.data.saving) return

    const title = trimText(this.data.title)
    if (!title) {
      wx.showToast({ title: '请先填相册名', icon: 'none' })
      return
    }
    const className = album.CLASSES[this.data.classIndex] || album.CLASSES[0]
    const date = this.data.date || this.data.today
    const isEdit = !!this.data.editId

    this.setData({ saving: true })
    const task = isEdit
      ? album.updateAlbum({ albumId: this.data.editId, title: title, className: className, date: date })
      : album.createAlbum({ className: className, title: title, date: date })

    Promise.resolve(task).then(function (res) {
      that.setData({ saving: false })
      if (!res || !res.ok) {
        wx.showToast({ title: (res && res.msg) || '没保存成功，请再试一次', icon: 'none' })
        return
      }

      if (isEdit) {
        that.setData({ editId: '', editTitle: '', title: '', titleLeft: album.MAX_TITLE })
        wx.showToast({ title: '改好了', icon: 'none' })
        that.refreshList()
        return
      }

      // 新建成功：直接把这本展开，接着就能传照片
      const saved = res.album || null
      const id = saved ? saved.id : ''
      that.setData({
        editId: '',
        editTitle: '',
        title: '',
        titleLeft: album.MAX_TITLE,
        openId: id,
        openTitle: saved ? saved.title : title,
        openPhotos: [],
        openTotal: 0,
        openTotalText: '还没有照片',
        openHasMore: false
      })
      wx.showToast({ title: '建好了，接着传照片吧', icon: 'none' })
      that.refreshList()
      if (id) that.loadPhotos(id, 0)
    }).catch(function () {
      that.setData({ saving: false })
      wx.showToast({ title: '没保存成功，请检查网络', icon: 'none' })
    })
  },

  /* ---------------- 展开某一本：照片 ---------------- */

  // 点「管照片 / 收起照片」
  onOpenTap(e) {
    const id = e.currentTarget.dataset.id
    if (!id) return
    if (this.data.openId === id) {
      this.closeAlbum()
      return
    }
    const card = this.rowOf(id)
    this.setData({
      openId: id,
      openTitle: card ? card.title : '',
      openPhotos: [],
      openTotal: card ? card.count : 0,
      openTotalText: card ? card.countText : '',
      openHasMore: false
    })
    this.loadPhotos(id, 0)
  },

  closeAlbum() {
    this.setData({
      openId: '',
      openTitle: '',
      openPhotos: [],
      openTotal: 0,
      openTotalText: '',
      openHasMore: false,
      openLoading: false
    })
  },

  // 拉照片：skip = 0 时先用本机缓存秒显，再拉最新；skip > 0 是「加载更多」
  loadPhotos(albumId, skip) {
    const that = this
    const start = Math.max(0, Number(skip) || 0)
    if (start > 0 && (!this.data.openHasMore || this.data.openLoading)) return

    if (start === 0) {
      that.setData({
        openPhotos: view.toCells(album.listPhotosSync(albumId)),
        openLoading: true
      })
    } else {
      that.setData({ openLoading: true })
    }

    Promise.resolve(album.listPhotos(albumId, { skip: start }))
      .then(function (res) {
        if (!res || !res.ok) {
          that.setData({ openLoading: false })
          wx.showToast({ title: (res && res.msg) || '照片没拉下来', icon: 'none' })
          return
        }
        const cells = view.toCells(res.photos)
        const list = start > 0 ? that.data.openPhotos.concat(cells) : cells
        const total = Number(res.total) || 0
        that.setData({
          openPhotos: list,
          openTotal: total,
          openTotalText: total ? '共 ' + total + ' 张' : '还没有照片',
          openHasMore: !!res.hasMore,
          openLoading: false
        })
      })
      .catch(function () {
        that.setData({ openLoading: false })
        wx.showToast({ title: '照片没拉下来，请检查网络', icon: 'none' })
      })
  },

  onLoadMore() {
    if (!this.data.openId) return
    this.loadPhotos(this.data.openId, this.data.openPhotos.length)
  },

  // 传照片：一次最多 9 张，传完自动刷新张数
  onAddPhotos(e) {
    const that = this
    const id = e.currentTarget.dataset.id || this.data.openId
    if (!id || this.data.uploading) return

    const card = this.rowOf(id)
    const count = card ? card.count : this.data.openTotal
    if (count >= album.MAX_PHOTOS) {
      wx.showToast({ title: '这本相册已经满 ' + album.MAX_PHOTOS + ' 张了', icon: 'none' })
      return
    }

    const canPick = Math.min(album.MAX_PICK, album.MAX_PHOTOS - count)
    this.setData({ uploading: true })
    wx.showLoading({ title: '上传中', mask: true })

    Promise.resolve(album.pickAndUpload(id, canPick))
      .then(function (res) {
        wx.hideLoading()
        that.setData({ uploading: false })
        if (!res || !res.ok) {
          const msg = trimText(res && res.msg)
          // 老师自己点了取消：不弹提示
          if (/取消|cancel|没有选照片/i.test(msg)) return
          wx.showToast({ title: msg || '这次没传上，请再试一次', icon: 'none' })
          return
        }
        const added = Number(res.added) || 0
        const failed = Number(res.failed) || 0
        wx.showToast({
          title: failed ? '传好 ' + added + ' 张，' + failed + ' 张没成功' : '传好 ' + added + ' 张',
          icon: 'none'
        })
        that.refreshList()
        that.loadPhotos(id, 0)
      })
      .catch(function () {
        wx.hideLoading()
        that.setData({ uploading: false })
        wx.showToast({ title: '上传失败，请检查网络', icon: 'none' })
      })
  },

  // 看大图：把这一本里所有真照片拼成一串（占位方块点开只给一句提示）
  onPreviewTap(e) {
    const id = e.currentTarget.dataset.id
    const photos = this.data.openPhotos
    const list = []
    let current = ''
    for (let i = 0; i < photos.length; i++) {
      if (!photos[i].hasImg) continue
      list.push(photos[i].src)
      if (photos[i].id === id) current = photos[i].src
    }
    if (!list.length) {
      wx.showToast({ title: '这是演示占位，还没有真照片', icon: 'none' })
      return
    }
    album.previewPhotos(list, current || list[0])
  },

  // 删一张照片
  onDelPhoto(e) {
    const that = this
    const ds = e.currentTarget.dataset
    const photoId = ds.id
    const albumId = ds.album || this.data.openId
    if (!photoId) return

    wx.showModal({
      title: '删掉这张照片？',
      content: '删了之后家长那边也看不到了，找不回来。',
      confirmText: '删除',
      confirmColor: '#E5453D',
      success(res) {
        if (!res.confirm) return
        wx.showLoading({ title: '删除中', mask: true })
        Promise.resolve(album.removePhotos([photoId]))
          .then(function (r) {
            wx.hideLoading()
            if (!r || !r.ok) {
              wx.showToast({ title: (r && r.msg) || '没删掉，请再试一次', icon: 'none' })
              return
            }
            wx.showToast({ title: '删掉了', icon: 'none' })
            that.refreshList()
            if (albumId) that.loadPhotos(albumId, 0)
          })
          .catch(function () {
            wx.hideLoading()
            wx.showToast({ title: '删除失败，请检查网络', icon: 'none' })
          })
      }
    })
  },

  // 删一整本相册（连带里面的照片）
  onDelTap(e) {
    const that = this
    const id = e.currentTarget.dataset.id
    if (!id) return

    const card = this.rowOf(id)
    const count = card ? card.count : 0
    wx.showModal({
      title: '删掉这本相册？',
      content: (count ? '里面有 ' + count + ' 张照片，' : '') + '删了之后家长那边也看不到了。',
      confirmText: '删除',
      confirmColor: '#E5453D',
      success(res) {
        if (!res.confirm) return
        Promise.resolve(album.removeAlbum(id))
          .then(function (r) {
            if (!r || !r.ok) {
              wx.showToast({ title: (r && r.msg) || '没删掉，请再试一次', icon: 'none' })
              return
            }
            const patch = {}
            if (that.data.openId === id) {
              patch.openId = ''
              patch.openTitle = ''
              patch.openPhotos = []
              patch.openTotal = 0
              patch.openTotalText = ''
              patch.openHasMore = false
            }
            if (that.data.editId === id) {
              patch.editId = ''
              patch.editTitle = ''
              patch.title = ''
              patch.titleLeft = album.MAX_TITLE
            }
            that.setData(patch)
            wx.showToast({ title: '相册删掉了', icon: 'none' })
            that.refreshList()
          })
          .catch(function () {
            wx.showToast({ title: '删除失败，请检查网络', icon: 'none' })
          })
      }
    })
  },

  // 恢复演示相册（演示模式专用；云端模式数据层会拒绝）
  onReset() {
    const that = this
    wx.showModal({
      title: '恢复演示相册？',
      content: '会把相册和照片换成刚安装时的演示数据（只影响这台手机）。',
      confirmText: '恢复',
      success(res) {
        if (!res.confirm) return
        Promise.resolve(album.resetDemo())
          .then(function (r) {
            if (!r || !r.ok) {
              wx.showToast({ title: (r && r.msg) || '恢复失败', icon: 'none' })
              return
            }
            that.closeAlbum()
            that.onNewTap()
            wx.showToast({ title: '演示相册回来了', icon: 'none' })
            that.refreshList()
          })
          .catch(function () {
            wx.showToast({ title: '恢复失败，请再试一次', icon: 'none' })
          })
      }
    })
  },

  goBack() {
    nav.back('/pages/mine/mine')
  }
})
