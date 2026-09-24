// utils/auth.js —— 登录系统数据层（家长用「姓名 + 手机号」登录）
//
// 两种模式：
//   'local'（当前）—— 校验内置账号、登录状态存本机，**不需要云函数**，马上能用；
//   'cloud'（后端已写好）—— 调云函数 auth 到服务端校验（users 集合），
//                            登录成功拿到 token 存本机，服务端会记录本次登录。
//
// 演示账号：姓名 `1` / 手机号 `1`（见 LOCAL_USERS；生产前请在云函数里
// 把环境变量 ALLOW_DEV_ACCOUNT 设为 0 关掉它）
const MODE = 'local' // 'local' | 'cloud'

const SESSION_KEY = 'auth_session_v1'
const FUNCTION_NAME = 'auth'
const DEMO = { name: '1', phone: '1' }

// 本地模式的账号表（真实账号放在云端 users 集合里；这里只是让功能马上能演示）
const LOCAL_USERS = [
  { name: '1', phone: '1', role: '管理员', note: '开发用账号' }
]

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

/* ---------------- 登录状态（同步读本机缓存） ---------------- */

// { name, phone, role, token, loginAt, loginAtText } 或 null
function getUser() {
  try {
    const s = wx.getStorageSync(SESSION_KEY)
    if (s && s.name && s.phone) return s
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
    loginAt: Date.now(),
    loginAtText: nowText()
  }
  try {
    wx.setStorageSync(SESSION_KEY, session)
  } catch (e) {
    // 写失败也不影响本次登录（下次打开需要重新登录）
  }
  return session
}

/* ---------------- 登录 / 退出 ---------------- */

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

  // 本地模式：姓名与手机号都要对上
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

// 页面上展示「演示账号」用（避免把 1/1 写死在页面里）
function demoAccount() {
  return { name: DEMO.name, phone: DEMO.phone }
}

module.exports = {
  mode: MODE,
  getUser: getUser,
  isLoggedIn: isLoggedIn,
  login: login,
  logout: logout,
  demoAccount: demoAccount
}
