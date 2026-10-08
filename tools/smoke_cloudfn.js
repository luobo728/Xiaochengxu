// smoke_cloudfn.js —— 云函数 noticeAdmin 自检
// 跑法：node tools/smoke_cloudfn.js
// 做法：自己写一个假的 wx-server-sdk（内存数据库沙箱），把云函数当模块 require 进来逐个 action 调，
//       逐条断言：whoami / list / save / remove / reset、定向推送范围、老数据兼容、管理员白名单。
const fs = require('fs')
const path = require('path')
const Module = require('module')

const root = path.resolve(__dirname, '..')
const FN = path.join(root, 'cloudfunctions/noticeAdmin/index.js')

/* ---------------- 假的 wx-server-sdk（内存数据库沙箱） ---------------- */
let sandbox = {} // { 集合名: { 文档id: 文档 } }
let seq = 0
let currentOpenid = ''

function resetDb() {
  sandbox = {}
  seq = 0
}
// 和真机一样：进出数据库都过一遍序列化（不共享对象引用）
function copy(v) {
  return v === undefined ? v : JSON.parse(JSON.stringify(v))
}
function notExists(name) {
  return new Error('collection ' + name + ' not exists')
}

function docApi(name, id) {
  return {
    get: function () {
      return new Promise(function (resolve, reject) {
        if (!sandbox[name]) return reject(notExists(name))
        if (!sandbox[name][id]) return reject(new Error('document not exists'))
        resolve({ data: copy(sandbox[name][id]) })
      })
    },
    update: function (o) {
      return new Promise(function (resolve, reject) {
        if (!sandbox[name]) return reject(notExists(name))
        if (!sandbox[name][id]) return reject(new Error('document not exists'))
        Object.assign(sandbox[name][id], copy((o && o.data) || {}))
        resolve({ stats: { updated: 1 } })
      })
    },
    remove: function () {
      return new Promise(function (resolve) {
        if (sandbox[name] && sandbox[name][id]) delete sandbox[name][id]
        resolve({ stats: { removed: 1 } })
      })
    }
  }
}

const dbApi = {
  createCollection: function (name) {
    return new Promise(function (resolve, reject) {
      if (sandbox[name]) return reject(new Error('collection already exists'))
      sandbox[name] = {}
      resolve({})
    })
  },
  collection: function (name) {
    return {
      doc: function (id) {
        return docApi(name, id)
      },
      add: function (o) {
        return new Promise(function (resolve, reject) {
          if (!sandbox[name]) return reject(notExists(name))
          seq++
          const id = 'doc' + seq
          sandbox[name][id] = copy((o && o.data) || {})
          resolve({ _id: id })
        })
      },
      limit: function () {
        return {
          get: function () {
            return new Promise(function (resolve, reject) {
              if (!sandbox[name]) return reject(notExists(name))
              const rows = Object.keys(sandbox[name]).map(function (id) {
                return Object.assign({ _id: id }, copy(sandbox[name][id]))
              })
              resolve({ data: rows })
            })
          }
        }
      },
      count: function () {
        return new Promise(function (resolve, reject) {
          if (!sandbox[name]) return reject(notExists(name))
          resolve({ total: Object.keys(sandbox[name]).length })
        })
      }
    }
  }
}

const fakeSdk = {
  DYNAMIC_CURRENT_ENV: 'DYNAMIC_CURRENT_ENV',
  init: function () {},
  database: function () {
    return dbApi
  },
  getWXContext: function () {
    return { OPENID: currentOpenid, APPID: 'wxtest', UNIONID: '' }
  }
}

// 把 require('wx-server-sdk') 换成沙箱（云函数本身一个字都不用改）
const origLoad = Module._load
Module._load = function (request) {
  if (request === 'wx-server-sdk') return fakeSdk
  return origLoad.apply(this, arguments)
}

const ADMIN = 'op-admin' // 环境变量白名单（第一个）
const ADMIN_SPACE = 'op-two' // 环境变量白名单（前后带空格，验证 trim）
const ADMIN_DB = 'op-dbadmin' // 只在数据库 menu_admins 里
const PARENT = 'op-parent' // 谁的白名单都不在
process.env.ADMIN_OPENIDS = ADMIN + ',  ' + ADMIN_SPACE + ' ,op-three'

const fn = require(FN)

// 客户端那份班级名单（云函数是独立部署包，自己又抄了一份，两边必须一致）
const localTargets = require(path.join(root, 'utils/notice.js')).TARGETS

function setOpenid(id) {
  currentOpenid = id
}
async function call(action, data, openid) {
  setOpenid(openid === undefined ? ADMIN : openid)
  return await fn.main(Object.assign({ action: action }, data || {}))
}
function docOf(id) {
  return sandbox.notices && sandbox.notices[id] ? sandbox.notices[id] : null
}
function findRow(rows, id) {
  for (let i = 0; i < rows.length; i++) {
    if (rows[i].id === id) return rows[i]
  }
  return null
}
// 直接往沙箱里塞一条文档（模拟升级前的老数据：没有 to 字段）
function seedLegacy(id, extra) {
  if (!sandbox.notices) sandbox.notices = {}
  sandbox.notices[id] = Object.assign(
    {
      title: '老数据：升级前存的通知',
      tag: '通知',
      time: '04-01',
      body: '升级前存下的通知',
      top: false,
      createdAt: 1000,
      updatedAt: 1000
    },
    extra || {}
  )
}

let bad = 0
function check(name, cond, extra) {
  console.log((cond ? '✅ ' : '❌ ') + name + (extra === undefined ? '' : '  → ' + JSON.stringify(extra)))
  if (!cond) bad++
}

async function main() {
  /* ================= A. whoami：我是谁 ================= */
  resetDb()
  let res = await call('whoami')
  check('A1 谁都能问 whoami：返回 ok 和自己的 openid', res.ok === true && res.openid === ADMIN, res)
  res = await call('whoami', {}, ADMIN)
  check('A2 环境变量白名单里的 openid 是管理员', res.isAdmin === true, res.isAdmin)
  res = await call('whoami', {}, ADMIN_SPACE)
  check('A3 白名单里带空格的 openid 也认（ADMIN_OPENIDS 逗号 + 空格）', res.isAdmin === true, res.isAdmin)
  res = await call('whoami', {}, PARENT)
  check('A4 不在白名单里的就是普通用户（家长）', res.isAdmin === false, res.isAdmin)
  check('A5 还没设置过管理员时 initialized = false', res.initialized === false, res.initialized)

  sandbox.menu_admins = {}
  sandbox.menu_admins[ADMIN_DB] = { at: 1 }
  res = await call('whoami', {}, ADMIN_DB)
  check('A6 数据库 menu_admins 里的文档也算管理员（两个来源都认）', res.isAdmin === true, res.isAdmin)
  res = await call('whoami', {}, PARENT)
  check('A7 名单里已经有管理员时 initialized = true', res.initialized === true, res.initialized)

  /* ================= B. list：读通知（谁都能读） ================= */
  resetDb()
  res = await call('list', {}, PARENT)
  check('B1 集合还不存在时 list 不报错，返回空列表', res.ok === true && res.rows.length === 0, res.rows.length)
  res = await call('list', {}, PARENT)
  check('B2 家长（非管理员）也能读列表', res.ok === true)

  await call('save', { title: 'B 置顶的一条', tag: '通知', to: '大班', top: true })
  await call('save', { title: 'B 普通一条', tag: '通知', to: '全园' })
  res = await call('list', {}, PARENT)
  check('B3 存进去的通知 list 拿得到', res.ok === true && res.rows.length === 2, res.rows.length)
  check('B4 list 每条都带 id（文档 _id）', res.rows.every(function (r) {
    return typeof r.id === 'string' && r.id.length > 0
  }), res.rows[0] && res.rows[0].id)
  check('B5 list 里每条的 to 都合法（和小程序端那份班级名单一致）', res.rows.every(function (r) {
    return localTargets.indexOf(r.to) > -1
  }), res.rows.map(function (r) {
    return r.to
  }))
  check('B6 list 排好序：置顶的排最前', res.rows[0].title === 'B 置顶的一条' && res.rows[0].top === true, res.rows[0].title)

  seedLegacy('legacy1')
  res = await call('list', {}, PARENT)
  const legacyRow = findRow(res.rows, 'legacy1')
  check('B7 老数据（文档里没有 to 字段）读出来按「全园」', !!legacyRow && legacyRow.to === '全园', legacyRow && legacyRow.to)

  /* ================= C. save：新增 / 修改 ================= */
  res = await call('save', { title: '家长想偷偷发一条' }, PARENT)
  check('C1 不是管理员不能存（没有管理权限）', res.ok === false && res.msg.indexOf('没有管理权限') > -1, res.msg)
  res = await call('save', { title: '   ' })
  check('C2 标题空着不让存', res.ok === false && res.msg.indexOf('请先填写标题') > -1, res.msg)
  res = await call('save', { title: '标'.repeat(41) })
  check('C3 标题超长不让存', res.ok === false && res.msg.indexOf('标题最多 40 个字') > -1, res.msg)
  res = await call('save', { title: 'C 正文超长', body: '字'.repeat(1001) })
  check('C4 正文超长不让存', res.ok === false && res.msg.indexOf('正文最多 1000 个字') > -1, res.msg)

  const noTo = await call('save', { title: 'C5 新增不带范围', tag: '提示', body: '正文' })
  check('C5 新增：不带 to 默认推给「全园」', noTo.ok === true && noTo.item.to === '全园', noTo.item && noTo.item.to)
  const withTo = await call('save', { title: 'C6 新增带范围', tag: '通知', to: '大一班', body: '正文' })
  check('C6 新增：带 to 就按带的存（大一班）', withTo.ok === true && withTo.item.to === '大一班', withTo.item && withTo.item.to)
  const weird = await call('save', { title: 'C7 范围乱写', to: '火星班' })
  check('C7 新增：范围乱写回落「全园」', weird.ok === true && weird.item.to === '全园', weird.item && weird.item.to)
  check('C8 新增返回的 item 带 id / 日期 / 置顶', !!weird.item && weird.item.id.length > 0 && /^\d{2}-\d{2}$/.test(weird.item.time) && weird.item.top === false, weird.item)
  const listed = await call('list', {}, PARENT)
  check('C9 新增后 list 里能找到它（id 对得上）', !!findRow(listed.rows, weird.item.id), weird.item.id)
  const badTag = await call('save', { title: 'C10 分类乱写', tag: '胡说', to: '全园' })
  check('C10 分类乱写按「通知」存', badTag.ok === true && badTag.item.tag === '通知', badTag.item && badTag.item.tag)

  const changed = await call('save', { id: withTo.item.id, title: 'C11 改成中班', to: '中班', body: '正文' })
  check('C11 改通知：带 to 能改（大一班 → 中班）', changed.ok === true && changed.item.to === '中班' && docOf(withTo.item.id).to === '中班', changed.item && changed.item.to)
  await call('save', { id: withTo.item.id, title: 'C11 恢复成大一班', to: '大一班', body: '正文' })
  const keep = await call('save', { id: withTo.item.id, title: 'C12 只改标题不带范围', body: '正文' })
  check('C12 改通知：不带 to 沿用原来的范围（还是大一班，不会悄悄变全园）', keep.ok === true && keep.item.to === '大一班' && docOf(withTo.item.id).to === '大一班', keep.item && keep.item.to)
  const legacySave = await call('save', { id: 'legacy1', title: 'C13 老数据改标题', body: '正文' })
  check('C13 改通知：老数据（没有 to）不带 to 保存 → 按「全园」', legacySave.ok === true && legacySave.item.to === '全园', legacySave.item && legacySave.item.to)
  res = await call('save', { id: 'doc-不存在', title: 'C14 改一条不存在的' })
  check('C14 改一条不存在的通知：给明确提示', res.ok === false && res.msg.indexOf('这条通知已经不在了') > -1, res.msg)
  const topped = await call('save', { id: noTo.item.id, title: 'C15 置顶这条', to: '全园', top: true })
  const afterTop = await call('list', {}, PARENT)
  check('C15 置顶能存，并且排在列表最前面', topped.ok === true && topped.item.top === true && afterTop.rows[0].id === noTo.item.id, afterTop.rows[0].title)

  /* ================= D. remove：删除 ================= */
  res = await call('remove', { id: badTag.item.id }, PARENT)
  check('D1 不是管理员不能删（没有管理权限）', res.ok === false && res.msg.indexOf('没有管理权限') > -1, res.msg)
  res = await call('remove', { id: badTag.item.id })
  const afterDel = await call('list', {}, PARENT)
  check('D2 删掉后 list 里真的没了', res.ok === true && findRow(afterDel.rows, badTag.item.id) === null)
  res = await call('remove', {})
  check('D3 删一条不带 id：给明确提示', res.ok === false && res.msg.indexOf('缺少 id') > -1, res.msg)
  check('D4 只删这一条，别的通知都还在', !!findRow(afterDel.rows, withTo.item.id) && !!findRow(afterDel.rows, noTo.item.id))

  /* ================= E. reset：恢复演示通知 ================= */
  res = await call('reset', {}, PARENT)
  check('E1 不是管理员不能恢复（没有管理权限）', res.ok === false && res.msg.indexOf('没有管理权限') > -1, res.msg)
  res = await call('reset')
  check('E2 reset 写回 5 条演示通知', res.ok === true && res.reset === 5, res.reset)
  const afterReset = await call('list', {}, PARENT)
  check('E3 reset 后 list 正好 5 条', afterReset.rows.length === 5, afterReset.rows.length)
  const onlyClass = afterReset.rows.filter(function (r) {
    return r.to === '大一班'
  })
  check('E4 reset 后有一条定向推给「大一班」（演示里那条写生通知）', onlyClass.length === 1 && onlyClass[0].title.indexOf('写生') > -1, onlyClass[0] && onlyClass[0].title)
  check('E5 reset 后另外 4 条都是「全园」', afterReset.rows.filter(function (r) {
    return r.to === '全园'
  }).length === 4)
  check('E6 reset 会清掉之前写的通知（只剩演示那 5 条）', !findRow(afterReset.rows, withTo.item.id) && !findRow(afterReset.rows, 'legacy1'))

  /* ================= F. 未知 action ================= */
  res = await call('saveAll')
  check('F1 未知 action：给明确提示（不静默成功）', res.ok === false && res.msg.indexOf('未知操作：') > -1, res.msg)
  res = await call('saveAll', {}, PARENT)
  check('F2 非管理员调未知 action：先被权限挡住', res.ok === false && res.msg.indexOf('没有管理权限') > -1, res.msg)

  /* ================= G. 安全与接口面（源码级） ================= */
  const src = fs.readFileSync(FN, 'utf8')
  check('G1 云函数里没有「自助成为管理员」的分支（提权口子只在 menuAdmin）', src.indexOf("action === 'init'") === -1 && src.indexOf('setAdmin') === -1 && src.indexOf('claim') === -1)
  check('G2 五个 action 都还在（whoami / list / save / remove / reset）', ["action === 'whoami'", "action === 'list'", "action === 'save'", "action === 'remove'", "action === 'reset'"].every(function (s) {
    return src.indexOf(s) > -1
  }))

  console.log(bad ? '\n❌ 失败 ' + bad + ' 项' : '\n✅ 云函数 noticeAdmin 冒烟测试全部通过')
  process.exit(bad ? 1 : 0)
}

main().catch(function (e) {
  console.log('❌ 抛异常：' + (e && e.stack ? e.stack : e))
  process.exit(1)
})
