// utils/album-view.js —— 相册页面的展示小工具（只管「页面要显示成什么样」，不读写任何数据）
//
// 为什么单独放一份：家长页（pages/album）、管理页（pages/album-admin）、校园页（pages/campus）
// 都要画同一套相册卡片与照片格子。整理逻辑写三遍容易走样，所以集中在这里。
// 真正的相册数据只由 utils/album.js 负责，页面只调用这两个文件。
const album = require('./album.js')

// 封面占位色：没有真照片时画一块渐变 + 相册名前几个字（本项目不用图片资源）
const TONES = [
  'linear-gradient(135deg,#59A2FF,#2E6BFF)',
  'linear-gradient(135deg,#4FD1A5,#12A182)',
  'linear-gradient(135deg,#FFB45B,#F08A24)',
  'linear-gradient(135deg,#9B8CFF,#6A5BEF)',
  'linear-gradient(135deg,#FF8A6B,#F0343C)',
  'linear-gradient(135deg,#4CC5E8,#1A93C8)'
]

function text(v) {
  return String(v === undefined || v === null ? '' : v).replace(/^\s+|\s+$/g, '')
}

// 第 index 张卡片用哪套封面底色（同一页里轮换，看着不单调）
function tone(index) {
  const n = Number(index) || 0
  return TONES[Math.abs(n) % TONES.length]
}

// 封面块上的字：相册名前 4 个字
function word(title) {
  const name = text(title).replace(/\s+/g, '')
  return name.slice(0, 4) || '相册'
}

// 一条相册 → 页面用的卡片
// 字段：id / title / className / date / cover / hasCover / word / bg
//       count / countText / classTag / classTone
// 注意：WXML 里不做字符串拼接以外的运算，所以能算的都先算好。
function toCard(row, index) {
  if (!row) return null
  const id = text(row.id || row._id)
  if (!id) return null
  const cover = text(row.cover)
  const count = Math.max(0, Number(row.count) || 0)
  const className = text(row.className) || album.ALL_CLASS
  return {
    id: id,
    title: text(row.title),
    className: className,
    date: text(row.date),
    cover: cover,
    hasCover: !!cover,
    word: word(row.title),
    bg: tone(index),
    count: count,
    countText: count ? count + ' 张' : '还没有照片',
    // 全园相册给绿色标签，班级相册给蓝色标签：家长一眼看出为什么自己能看
    classTag: className,
    classTone: className === album.ALL_CLASS ? 'tag-green' : 'tag-blue'
  }
}

// 一批相册 → 一批卡片
function toCards(rows) {
  const list = []
  ;(rows || []).forEach(function (row, index) {
    const card = toCard(row, index)
    if (card) list.push(card)
  })
  return list
}

// 一张照片 → 页面用的格子；src 为空时页面画灰块（本地模式重启后手机临时路径会失效）
function toCell(row) {
  if (!row) return null
  const id = text(row.id || row._id)
  if (!id) return null
  const src = text(row.src || row.fileID)
  return {
    id: id,
    fileID: src,
    src: src,
    hasImg: !!src,
    label: text(row.label) || '照片'
  }
}

function toCells(rows) {
  const list = []
  ;(rows || []).forEach(function (row) {
    const cell = toCell(row)
    if (cell) list.push(cell)
  })
  return list
}

module.exports = {
  TONES: TONES,
  tone: tone,
  word: word,
  toCard: toCard,
  toCards: toCards,
  toCell: toCell,
  toCells: toCells
}
