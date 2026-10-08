// tools/run_all.js —— 一条命令跑完全部自检（静态检查 + 冒烟测试 + 变异测试）
//
// 跑法（在仓库根目录）：
//   node tools/run_all.js                跑全部
//   node tools/run_all.js --no-mutations 跳过变异测试（快，日常用这个）
//   node tools/run_all.js --only smoke_  只跑名字里含 smoke_ 的
//
// 每个脚本的约定：自己模拟 wx / 云函数，打印「✅ …」逐项结果，最后一句给总结，
// 失败时退出码非 0。本脚本只看退出码，外加把最后一行和 ✅ 个数抄进汇总表。
const fs = require('fs')
const path = require('path')
const { execFileSync } = require('child_process')

const DIR = __dirname
const args = process.argv.slice(2)
const noMutations = args.indexOf('--no-mutations') > -1
const onlyIdx = args.indexOf('--only')
const only = onlyIdx > -1 ? args[onlyIdx + 1] || '' : ''

// 收集脚本：静态检查 → 冒烟 → 变异（变异最慢，放最后）
const groups = [
  { kind: '静态检查', prefix: 'check' },
  { kind: '冒烟测试', prefix: 'smoke_' },
  { kind: '变异测试', prefix: 'mutations_' }
]

const rows = []
let failed = 0
groups.forEach(function (g) {
  if (g.prefix === 'mutations_' && noMutations) return
  const names = fs
    .readdirSync(DIR)
    .filter(function (f) {
      return f.indexOf(g.prefix) === 0 && f.slice(-3) === '.js'
    })
    .filter(function (f) {
      return !only || f.indexOf(only) > -1
    })
    .sort()
  names.forEach(function (f) {
    const label = f.slice(0, -3)
    const t0 = Date.now()
    let out = ''
    let ok = true
    try {
      out = execFileSync('node', [path.join(DIR, f)], { cwd: path.join(DIR, '..'), encoding: 'utf8' })
    } catch (e) {
      ok = false
      out = String((e && e.stdout) || '') + String((e && e.stderr) || '')
    }
    const lines = out.split('\n').filter(function (l) {
      return l.replace(/\s/g, '') !== ''
    })
    const last = lines.length ? lines[lines.length - 1].replace(/^\s+/, '') : ''
    const pass = (out.match(/✅/g) || []).length
    const fail = (out.match(/❌/g) || []).length
    if (!ok) failed++
    rows.push({
      kind: g.kind,
      name: label,
      ok: ok,
      sec: ((Date.now() - t0) / 1000).toFixed(1),
      pass: pass,
      fail: fail,
      last: last.slice(0, 70)
    })
    console.log((ok ? '✅ ' : '❌ ') + '[' + g.kind + '] ' + label + '  （' + rows[rows.length - 1].sec + 's，✅' + pass + (fail ? ' ❌' + fail : '') + '）')
    if (!ok) console.log('     ' + last)
  })
})

if (!rows.length) {
  console.log('没有找到要跑的脚本（--only ' + only + '）')
  process.exit(1)
}

console.log('')
console.log('======== 汇总 ========')
rows.forEach(function (r) {
  console.log((r.ok ? '✅' : '❌') + ' ' + r.name.padEnd(24, ' ') + r.kind + '  ✅' + r.pass + (r.fail ? ' ❌' + r.fail : '') + '  ' + r.sec + 's')
})
console.log(failed ? '❌ 有 ' + failed + ' 个脚本失败' : '✅ 全部通过（' + rows.length + ' 个脚本）')
process.exit(failed ? 1 : 0)
