// tools/check_anchors.js —— 只读检查：各变异测试脚本的锚点在当前源码里是否唯一
//
// 为什么需要：变异测试的 `from` 必须在源码里**只出现一次**（不然改错地方，测试结论就没意义）。
// 改完源码（尤其是重构）之后，先跑这个 —— 不用真的跑变异，秒级，而且不改任何文件。
// 跑法：node tools/check_anchors.js
const fs = require('fs')
const path = require('path')

const root = path.resolve(__dirname, '..')
const files = fs.readdirSync(__dirname).filter(function (f) {
  return f.indexOf('mutations_') === 0 && f.slice(-3) === '.js'
})

// 把 JS 字符串字面量里的转义还原成真实字符
function unquote(raw) {
  return String(raw)
    .replace(/\\n/g, '\n')
    .replace(/\\t/g, '\t')
    .replace(/\\r/g, '\r')
    .replace(/\\'/g, "'")
    .replace(/\\"/g, '"')
    .replace(/\\\\/g, '\\')
}

let totalBad = 0
files.forEach(function (name) {
  const src = fs.readFileSync(path.join(__dirname, name), 'utf8')
  // 每组：n → f →（可能有别的键，比如 smoke）→ from
  const re = /n:\s*'([^']*)',\s*\n\s*f:\s*'([^']*)',\s*\n(?:\s*[A-Za-z_$][\w$]*:[^\n]*,\s*\n)*\s*from:\s*('([^']*)'|"([^"]*)")/g
  let m
  let total = 0
  let bad = 0
  while ((m = re.exec(src))) {
    total++
    const label = m[1]
    const target = m[2]
    const from = unquote(m[4] !== undefined ? m[4] : m[5])
    let text = ''
    try {
      text = fs.readFileSync(path.join(root, target), 'utf8')
    } catch (e) {
      console.log('  ❌ ' + label + '：找不到文件 ' + target)
      bad++
      continue
    }
    const hits = text.split(from).length - 1
    if (hits !== 1) {
      console.log('  ⚠️  ' + label + '：锚点在 ' + target + ' 里出现 ' + hits + ' 次（应为 1）')
      bad++
    }
  }
  if (total === 0) {
    console.log(name + '：没解析出变异组（脚本格式变了？）  ❌')
    bad++
  } else {
    console.log(name + '：共 ' + total + ' 组，锚点异常 ' + bad + ' 组' + (bad ? '  ❌' : '  ✅'))
  }
  totalBad += bad
})

console.log(totalBad ? '❌ 有 ' + totalBad + ' 个锚点需要修' : '✅ 所有变异锚点都唯一')
process.exitCode = totalBad ? 1 : 0
