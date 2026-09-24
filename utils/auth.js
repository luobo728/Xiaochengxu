// utils/auth.js —— 登录系统数据层（微信一键登录 + 可选的姓名/手机号）
//
// 两种模式：
//   'local'（当前）—— 一键登录用「设备标识」当身份，登录态存本机，**不需要云函数**，马上能用；
//                      （注意：设备标识不等于真实微信身份，换手机就是另一个账号）
//   'cloud'（后端已写好）—— 调云函数 auth。云开发能直接拿到调用者的微信身份（openid），
//                     首次进入自动注册，之后点一下按钮就登录；补充资料也走云端。
//
// 备用登录：姓名 + 手机号（演示账号 1 / 1），在页面上作为次要入口保留。
const MODE = 'local' // 'local' | 'cloud'

const SESSION_KEY = 'auth_session_v1'
const DEVICE_KEY = 'auth_device_v1'
const FUNCTION_NAME = 'auth'
const DEMO = { name: '1', phone: '1' }

// 本地模式备用账号表（真实账号在云端 users 集合）
const LOCAL_USERS = [{ name: '1', phone: '1', role: '管理员', note: '开发用账号' }]

function pad(n) {
  return n < 10 ? '0' + n : '' + n
}

function nowText() {
  const d = new Date()
  return (
    d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes())
  )
}

function isCloudReady() {
  try {
    const app = getApp()
    return !!(app && app.globalData && app.globalData.cloudReady)
  } catch (e) {
    return false
  }
}

function callCloud(action, data) {
  return new Promise(function (resolve, reject) {
    if (!isCloudReady()) {
      reject(new Error('云开发未就绪'))
      return
    }
    wx.cloud.callFunction({
      name: FUNCTION_NAME,
      data: Object.assign({ action: action }, data || {}),
      success: function (res) {
        resolve((res && res.result) || {})
      },
      fail: function (err) {
        reject(new Error((err && err.errMsg) || '云函数调用失败'))
      }
    })
  })
}

/* ---------------- 登录态（同步读本机缓存） ---------------- */

// { name, phone, role, token, wx, isNew, loginAt, loginAtText } 或 null
function getUser() {
  try {
    const s = wx.getStorageSync(SESSION_KEY)
    // 有 token 就算已登录（一键登录时姓名/手机号可能还没填）
    if (s && (s.token || (s.name && s.phone))) return s
  } catch (e) {
    // 读失败按未登录处理
  }
  return null
}

function isLoggedIn() {
  return !!getUser()
}

function saveUser(user) {
  const session = {
    name: user.name || '',
    phone: user.phone || '',
    role: user.role || '家长',
    token: user.token || '',
    wx: !!user.wx,
    isNew: !!user.isNew,
    loginAt: Date.now(),
    loginAtText: nowText()
  }
  try {
    wx.setStorageSync(SESSION_KEY, session)
  } catch (e) {
    // 写失败不影响本次登录
  }
  return session
}

// 本机设备标识（只在 local 模式下当身份用）
function deviceId() {
  let id = ''
  try {
    id = wx.getStorageSync(DEVICE_KEY) || ''
  } catch (e) {
    id = ''
  }
  if (!id) {
    id = 'd' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
    try {
      wx.setStorageSync(DEVICE_KEY, id)
    } catch (e) {
      // 忽略
    }
  }
  return id
}

/* ---------------- 微信一键登录 ---------------- */

function wxLogin() {
  if (MODE === 'cloud') {
    return callCloud('wxlogin').then(function (res) {
      if (!res || !res.ok) {
        return { ok: false, msg: (res && res.msg) || '一键登录失败，请重试' }
      }
      const user = saveUser(Object.assign({}, res.user || {}, { token: res.token || '', wx: true, isNew: !!res.isNew }))
      return { ok: true, user: user }
    })
  }

  // 本地模式：先调一次 wx.login（流程与真机一致），再用设备标识当身份
  const prev = getUser()
  return new Promise(function (resolve) {
    const finish = function () {
      resolve({
        ok: true,
        user: saveUser({
          name: (prev && prev.name) || '',
          phone: (prev && prev.phone) || '',
          role: '家长',
          token: 'local-' + deviceId(),
          wx: true,
          isNew: !(prev && prev.name)
        })
      })
    }
    if (typeof wx.login === 'function') {
      wx.login({ success: finish, fail: finish })
    } else {
      finish()
    }
  })
}

/* ---------------- 补充资料（一键登录后填姓名/手机号） ---------------- */

function updateProfile(name, phone) {
  const n = String(name || '').trim()
  const p = String(phone || '').trim()
  if (!n || !p) return Promise.resolve({ ok: false, msg: '姓名和手机号都要填' })

  if (MODE === 'cloud') {
    const session = getUser()
    if (!session || !session.token) return Promise.resolve({ ok: false, msg: '请先登录' })
    return callCloud('profile', { token: session.token, name: n, phone: p }).then(function (res) {
      if (!res || !res.ok) return { ok: false, msg: (res && res.msg) || '保存失败，请重试' }
      return { ok: true, user: saveUser(Object.assign({}, session, { name: n, phone: p })) }
    })
  }

  const session = getUser()
  if (!session) return Promise.resolve({ ok: false, msg: '请先登录' })
  return Promise.resolve({ ok: true, user: saveUser(Object.assign({}, session, { name: n, phone: p })) })
}

/* ---------------- 备用登录：姓名 + 手机号 ---------------- */

function login(name, phone) {
  const n = String(name || '').trim()
  const p = String(phone || '').trim()

  if (!n || !p) {
    return Promise.resolve({ ok: false, msg: '请填写姓名和手机号' })
  }

  if (MODE === 'cloud') {
    return callCloud('login', { name: n, phone: p }).then(function (res) {
      if (!res || !res.ok) {
        return { ok: false, msg: (res && res.msg) || '登录失败，请稍后重试' }
      }
      return { ok: true, user: saveUser(Object.assign({}, res.user || {}, { token: res.token || '' })) }
    })
  }

  for (let i = 0; i < LOCAL_USERS.length; i++) {
    const u = LOCAL_USERS[i]
    if (u.name === n && u.phone === p) {
      return Promise.resolve({ ok: true, user: saveUser(u) })
    }
  }
  return Promise.resolve({ ok: false, msg: '姓名和手机号不匹配，请检查后重试' })
}

function logout() {
  const clear = function () {
    try {
      wx.removeStorageSync(SESSION_KEY)
    } catch (e) {
      // 忽略
    }
    return { ok: true }
  }

  if (MODE === 'cloud') {
    const session = getUser()
    if (session && session.token) {
      return callCloud('logout', { token: session.token }).then(clear, clear)
    }
  }
  return Promise.resolve(clear())
}

function demoAccount() {
  return { name: DEMO.name, phone: DEMO.phone }
}

module.exports = {
  mode: MODE,
  getUser: getUser,
  isLoggedIn: isLoggedIn,
  wxLogin: wxLogin,
  updateProfile: updateProfile,
  login: login,
  logout: logout,
  demoAccount: demoAccount
}
