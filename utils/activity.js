// utils/activity.js —— 活动数据层（活动中心 / 活动详情）
//
// 现在活动数据来自 app.js 的 ACTIVITIES（首页滚动屏那 5 条），本层负责两件事：
//   ① 补齐「文章」需要的字段：来源 / 发布日期 / 阅读数 / 正文段落
//   ② 记录「最近查看」的活动，并把它排到列表最前（便于快速回到刚才点的那条）
//
// 以后接后端：把 list() / getDetail() 换成云函数或接口即可，页面一行都不用改。
const VIEWED_KEY = 'activity_viewed_v1'

const SOURCE = '阳光幼儿园'

// 各活动的发布日与正文段落（演示内容；接后端后由服务端下发）
const META = {
  'act-1': {
    date: '2026-04-14',
    paragraphs: [
      '春季亲子运动会将在 4 月 18 日（周六）上午 9:00 在中心操场举行，全园小朋友和家长一起参加。',
      '当天安排：9:00 开幕式与入场式，9:30 亲子接力、拔河、袋鼠跳等 8 个项目，11:30 颁奖与合影。',
      '请家长为孩子准备：运动鞋、换洗衣物、水杯，并在 8:30 前到班级集合。遇雨顺延，另行通知。',
      '报名截止 4 月 15 日 18:00，可在本页下方「我要报名」，或直接告诉班主任老师。'
    ]
  },
  'act-2': {
    date: '2026-04-12',
    paragraphs: [
      '六一文艺汇演开始征集节目啦！每个班限报 3 个节目，形式不限：唱歌、舞蹈、绘本剧、乐器都可以。',
      '报名截止 5 月 10 日，请把节目名称、参加人数、大致时长报给班主任。',
      '5 月中旬我们会安排两次彩排（具体时间另行通知），演出服装由园所统一协调。',
      '欢迎家长志愿者参与幕后：化妆、摄影、道具都可以，有意向请在本页报名时备注。'
    ]
  },
  'act-3': {
    date: '2026-04-10',
    paragraphs: [
      '4 月 22 日（周三）上午，保健室将为全园小朋友做春季健康体检，项目包括身高体重、视力、口腔与内科检查。',
      '请家长在体检当天为孩子穿宽松易穿脱的衣物，并携带体检本。',
      '体检结果会在 3 个工作日内由班主任反馈给家长；如发现需要复查的项目，保健室会单独联系。',
      '近期如有发热、咳嗽等症状，请先在家休息，待痊愈后再补检。'
    ]
  },
  'act-4': {
    date: '2026-04-08',
    paragraphs: [
      '本周营养食谱已更新（周一至周五，三餐两点），可在「今日食谱」里按餐次查看每天的实际供餐照片。',
      '食谱由保健医与后厨共同制定，注意荤素搭配与粗细粮结合，每天保证一份奶制品与两种以上水果。',
      '如孩子有食物过敏或忌口，请提前告知班主任，我们会单独调整。'
    ]
  },
  'act-5': {
    date: '2026-04-06',
    paragraphs: [
      '4 月 25 日（周六）上午将开展消防演练与安全教育周活动，全园师生参加。',
      '内容包括：疏散演练、灭火器使用演示、交通安全与防拐骗小课堂。',
      '请家长在家和孩子一起复习「遇到危险先找老师、记住爸爸妈妈的电话」，演练当天请按时送园。'
    ]
  }
}

function baseList() {
  try {
    const app = getApp()
    return (app && app.globalData && app.globalData.activities) || []
  } catch (e) {
    return []
  }
}

function decorate(item, index) {
  const meta = META[item.id] || {}
  return Object.assign({}, item, {
    source: SOURCE,
    dateText: meta.date || '2026-04-01',
    readCount: 268 + index * 137
  })
}

// 活动列表（不含正文）
function list() {
  return baseList().map(function (item, index) {
    return decorate(item, index)
  })
}

// 找一条活动（含正文段落）
function getDetail(id) {
  const want = String(id || '')
  const all = list()
  let found = null
  for (let i = 0; i < all.length; i++) {
    if (all[i].id === want) {
      found = all[i]
      break
    }
  }
  if (!found) return null

  const meta = META[found.id] || {}
  return Object.assign({}, found, {
    paragraphs: meta.paragraphs && meta.paragraphs.length
      ? meta.paragraphs
      : [found.desc, '具体安排请留意班级群通知，如有疑问可咨询班主任老师。']
  })
}

/* ---------------- 最近查看（列表置顶用） ---------------- */

function getLastViewedId() {
  try {
    return wx.getStorageSync(VIEWED_KEY) || ''
  } catch (e) {
    return ''
  }
}

function markViewed(id) {
  const v = String(id || '').trim()
  if (!v) return
  try {
    wx.setStorageSync(VIEWED_KEY, v)
  } catch (e) {
    // 记录失败不影响跳转
  }
}

// 列表，已把「最近查看」的那条排到最前，其余保持原顺序
function orderedList() {
  const all = list()
  const last = getLastViewedId()
  if (!last) return all

  let index = -1
  for (let i = 0; i < all.length; i++) {
    if (all[i].id === last) {
      index = i
      break
    }
  }
  if (index <= 0) return all

  const top = all.splice(index, 1)[0]
  all.unshift(top)
  return all
}

module.exports = {
  list: list,
  getDetail: getDetail,
  getLastViewedId: getLastViewedId,
  markViewed: markViewed,
  orderedList: orderedList
}
