// 云函数 auth —— 家长登录（姓名 + 手机号）
//
// 集合 users 每条记录：
//   { name, phone, role, enabled, lastToken, lastOpenid, lastLoginAt }
//   · name  家长姓名（与手机号一起作为登录凭据）
//   · phone 手机号（建议建索引，并设为唯一）
//   · role  '家长' | '老师' | '管理员'
//   · enabled  false 表示停用，登录时会被拒
//
// action：
//   wxlogin                      -> { ok, user, token, isNew }  微信一键登录（按 openid 自动注册/登录）
//   login   { name, phone }      -> { ok, user, token }          备用：姓名 + 手机号
//   profile { token, name, phone } -> { ok, user }               补充资料（姓名 / 手机号）
//   me      { token }            -> { ok, user }
//   logout  { token }            -> { ok }
//
// 开发用账号：姓名 1 / 手机号 1（生产前把本函数的环境变量 ALLOW_DEV_ACCOUNT 设为 0 关掉）
const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()
const USERS = 'users'
const DB_TIMEOUT = 1500

function ok(data) {
  return Object.assign({ ok: true }, data || {})
}

function fail(msg) {
  return { ok: false, msg: msg || '操作失败' }
}

// 数据库查询内部超时：不让整个云函数卡到平台超时
function withTimeout(promise, ms, fallback) {
  return Promise.race([
    promise
      .then(function (v) {
        return v
      })
      .catch(function () {
        return fallback
      }),
    new Promise(function (resolve) {
      setTimeout(function () {
        resolve(fallback)
      }, ms)
    })
  ])
}

function randomToken() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 10)
}

function devAllowed() {
  return process.env.ALLOW_DEV_ACCOUNT !== '0'
}

exports.main = async (event) => {
  const openid = cloud.getWXContext().OPENID || ''
  const action = (event && event.action) || ''

  /* ---------- 微信一键登录 ---------- */
  // 云开发能直接拿到调用者的微信身份（openid）：首次进入自动建账号，之后点一下按钮就是登录
  if (action === 'wxlogin') {
    if (!openid) return fail('拿不到微信身份，请在微信里打开小程序')

    const found = await withTimeout(
      db.collection(USERS).where({ openid: openid }).limit(1).get(),
      DB_TIMEOUT,
      null
    )
    let user = ((found && found.data) || [])[0]
    let isNew = false

    if (!user) {
      isNew = true
      const doc = {
        openid: openid,
        name: '',
        phone: '',
        role: '家长',
        enabled: true,
        createTime: db.serverDate()
      }
      const added = await withTimeout(db.collection(USERS).add({ data: doc }), DB_TIMEOUT, null)
      if (!added || !added._id) return fail('账号创建失败，请稍后重试')
      user = Object.assign({ _id: added._id }, doc)
    }
    if (user.enabled === false) return fail('账号已停用，请联系老师')

    const token = randomToken()
    try {
      await withTimeout(
        db.collection(USERS).doc(user._id).update({
          data: { lastToken: token, lastLoginAt: db.serverDate(), lastOpenid: openid }
        }),
        DB_TIMEOUT,
        null
      )
    } catch (e) {
      // 记录登录痕迹失败不影响登录本身
    }

    return ok({
      user: { name: user.name || '', phone: user.phone || '', role: user.role || '家长' },
      token: token,
      isNew: isNew
    })
  }

  /* ---------- 登录 ---------- */
  if (action === 'login') {
    const name = String(event.name || '').trim()
    const phone = String(event.phone || '').trim()
    if (!name || !phone) return fail('请填写姓名和手机号')

    // 开发用账号（生产前关掉）
    if (devAllowed() && name === '1' && phone === '1') {
      return ok({
        user: { name: '1', phone: '1', role: '管理员', dev: true },
        token: 'dev-' + randomToken()
      })
    }

    const res = await withTimeout(
      db.collection(USERS).where({ phone: phone, name: name }).limit(1).get(),
      DB_TIMEOUT,
      null
    )
    const user = ((res && res.data) || [])[0]
    if (!user) return fail('姓名和手机号不匹配，请联系老师核对')
    if (user.enabled === false) return fail('账号已停用，请联系老师')

    const token = randomToken()
    try {
      await withTimeout(
        db.collection(USERS).doc(user._id).update({
          data: {
            lastToken: token,
            lastOpenid: openid,
            lastLoginAt: db.serverDate()
          }
        }),
        DB_TIMEOUT,
        null
      )
    } catch (e) {
      // 记录登录痕迹失败不影响登录本身
    }

    return ok({
      user: { name: user.name, phone: user.phone, role: user.role || '家长' },
      token: token
    })
  }

  /* ---------- 补充资料（一键登录后填姓名 / 手机号） ---------- */
  if (action === 'profile') {
    const token = String(event.token || '')
    const name = String(event.name || '').trim()
    const phone = String(event.phone || '').trim()
    if (!token) return fail('请先登录')
    if (!name || !phone) return fail('姓名和手机号都要填')

    // 开发账号发的 token 以 dev- 开头，直接放行（受 ALLOW_DEV_ACCOUNT 控制）
    if (devAllowed() && token.indexOf('dev-') === 0) {
      return ok({ user: { name: name, phone: phone, role: '管理员', dev: true } })
    }

    const found = await withTimeout(db.collection(USERS).where({ lastToken: token }).limit(1).get(), DB_TIMEOUT, null)
    const user = ((found && found.data) || [])[0]
    if (!user) return fail('登录已失效，请重新登录')

    try {
      await withTimeout(
        db.collection(USERS).doc(user._id).update({ data: { name: name, phone: phone } }),
        DB_TIMEOUT,
        null
      )
    } catch (e) {
      return fail('保存失败，请稍后重试')
    }
    return ok({ user: { name: name, phone: phone, role: user.role || '家长' } })
  }

  /* ---------- 校验登录态 / 退出 ---------- */
  if (action === 'me' || action === 'logout') {
    const token = String(event.token || '')
    if (!token) return fail('未登录')

    // 开发账号发的 token 以 dev- 开头，直接放行（同样受开关控制）
    if (devAllowed() && token.indexOf('dev-') === 0) {
      if (action === 'me') return ok({ user: { name: '1', phone: '1', role: '管理员', dev: true } })
      return ok({})
    }

    const res = await withTimeout(
      db.collection(USERS).where({ lastToken: token }).limit(1).get(),
      DB_TIMEOUT,
      null
    )
    const user = ((res && res.data) || [])[0]

    if (action === 'logout') {
      if (user) {
        try {
          await withTimeout(db.collection(USERS).doc(user._id).update({ data: { lastToken: '' } }), DB_TIMEOUT, null)
        } catch (e) {
          // 忽略
        }
      }
      return ok({})
    }

    if (!user) return fail('登录已失效，请重新登录')
    return ok({ user: { name: user.name, phone: user.phone, role: user.role || '家长' } })
  }

  return fail('未知操作：' + action)
}
