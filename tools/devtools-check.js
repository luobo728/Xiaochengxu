// tools/devtools-check.js —— 跑「会改源码」的测试前提醒一句
//
// 为什么需要它：变异测试（mutations_*）会每几秒把源码改坏一行、再还原。
// 如果这时微信开发者工具开着（而且「编译热重载」是开的），它会跟着疯狂重编译，
// 模拟器很容易卡在「半渲染」的乱版状态（页面样式只生效一半、文字挤到左边）。
// 这个文件就是查一下开发者工具是不是刚还在写日志 —— 是的话，跑之前先提醒。
//
// 用法（在 mutations_*.js 开头）：
//   require(path.join(__dirname, 'devtools-check.js')).warn()
const fs = require('fs')
const os = require('os')
const path = require('path')

// 微信开发者工具的日志目录：%LOCALAPPDATA%\微信开发者工具\User Data\<一串 hash>\WeappLog\logs
function logDirs() {
  const base = path.join(os.homedir(), 'AppData', 'Local', '微信开发者工具', 'User Data')
  const out = []
  let entries = []
  try {
    entries = fs.readdirSync(base, { withFileTypes: true })
  } catch (e) {
    return out
  }
  for (let i = 0; i < entries.length; i++) {
    if (!entries[i].isDirectory()) continue
    const dir = path.join(base, entries[i].name, 'WeappLog', 'logs')
    try {
      if (fs.statSync(dir).isDirectory()) out.push(dir)
    } catch (e) {
      // 没有这个目录就跳过
    }
  }
  return out
}

// 最新的日志文件多久之前还在写（毫秒）；拿不到就返回 null
function newestLogAgeMs() {
  const dirs = logDirs()
  let newest = 0
  for (let i = 0; i < dirs.length; i++) {
    let files = []
    try {
      files = fs.readdirSync(dirs[i])
    } catch (e) {
      continue
    }
    for (let j = 0; j < files.length; j++) {
      if (files[j].slice(-4) !== '.log') continue
      try {
        const t = fs.statSync(path.join(dirs[i], files[j])).mtimeMs
        if (t > newest) newest = t
      } catch (e) {
        // 读不到就跳过
      }
    }
  }
  return newest ? Date.now() - newest : null
}

// 开发者工具好像开着就提醒（只在 120 秒内有日志写入才算「开着」）
function warn() {
  const age = newestLogAgeMs()
  if (age === null || age > 120000) return false
  console.log('⚠️  微信开发者工具好像正开着（它的日志 ' + Math.round(age / 1000) + ' 秒前还在写）')
  console.log('    接下来这个测试会每几秒改一次源码再还原，开发者工具会跟着重编译，')
  console.log('    模拟器有可能卡成「半渲染」的乱版（样式只生效一半、文字挤到左边）。')
  console.log('    建议先关掉开发者工具再跑；真要现在跑也行 —— 跑完源码会自动还原，')
  console.log('    回到开发者工具点一下「编译」（或重新打开项目）就恢复了。')
  console.log('')
  return true
}

module.exports = { warn: warn, newestLogAgeMs: newestLogAgeMs }
