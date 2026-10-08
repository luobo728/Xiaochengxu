// mutations_children.js —— 变异测试：证明「孩子档案 + 按孩子分账」的断言真能抓住坏代码
// 做法：把源码改成「坏的」→ 跑自检 → 必须失败（且失败项正是期望的那条）→ 还原 → md5 校验
// 范围：utils/children.js、utils/billing.js、pages/children、pages/children-edit
//       （故意不动 utils/schedule.js 和 pages/attendance —— 那部分有另一套自检在管）
// 跑法：node tools/mutations_children.js
const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const { execFileSync } = require('child_process')

const ROOT = path.resolve(__dirname, '..')
const TMP = path.join(__dirname, '.tmp') // 临时备份目录（.gitignore 里已排除）
const SMOKE = path.join(__dirname, 'smoke_children.js')
const BAK = path.join(TMP, 'bak_children')

const md5 = function (f) {
  return crypto.createHash('md5').update(fs.readFileSync(f)).digest('hex')
}

const M = [
  /* ---------- 数据层：演示档案（种一次 / 家长端绑乐乐 / 展示字段） ---------- */
  {
    n: '1 数据层：演示档案每次都重种（用户删掉的孩子又冒出来）',
    f: 'utils/children.js',
    from: '  if (seeded()) return list',
    to: '  if (false) return list',
    want: 'A9 演示档案只种一次'
  },
  {
    n: '2 数据层：家长端没绑孩子（乐乐妈妈看不到自己孩子）',
    f: 'utils/children.js',
    from: "const OWNER = { parent: 'lele' }",
    to: 'const OWNER = {}',
    want: 'A6 家长端绑定的是乐乐'
  },
  {
    n: '3 数据层：手机号不打码（整串亮出来）',
    f: 'utils/children.js',
    from: "  return p.slice(0, 3) + '****' + p.slice(7)",
    to: '  return p',
    want: 'A12 展示字段：头像取姓名首字'
  },

  /* ---------- 数据层：建档校验（写坏数据一律拦下来） ---------- */
  {
    n: '4 数据层：姓名空着也照存',
    f: 'utils/children.js',
    from: "  if (!name) return '请填写孩子姓名'",
    to: "  if (false) return '请填写孩子姓名'",
    want: 'B1 姓名为空要拦下来'
  },
  {
    n: '5 数据层：姓名超长不拦（页面会撑坏）',
    f: 'utils/children.js',
    from: "  if (name.length > NAME_MAX) return '姓名最多 ' + NAME_MAX + ' 个字'",
    to: "  if (false) return '姓名最多 ' + NAME_MAX + ' 个字'",
    want: 'B3 姓名超过 8 个字要拦下来'
  },
  {
    n: '6 数据层：班级不在名单里也放行',
    f: 'utils/children.js',
    from: "  if (CLASSES.indexOf(cls) === -1) return '班级要选：' + CLASSES.join(' / ')",
    to: "  if (false) return '班级要选：' + CLASSES.join(' / ')",
    want: 'B5 班级必须在名单里'
  },
  {
    n: '7 数据层：生日是未来也不拦',
    f: 'utils/children.js',
    from: "    if (!t || t > Date.now()) return '生日不能是还没到的日期'",
    to: "    if (false) return '生日不能是还没到的日期'",
    want: 'B9 生日不能是还没到的日期'
  },
  {
    n: '8 数据层：手机号格式不校验（填 10 位也过）',
    f: 'utils/children.js',
    from: "  if (phone && !/^1\\d{10}$/.test(phone)) return '家长手机号要填 11 位数字'",
    to: "  if (false) return '家长手机号要填 11 位数字'",
    want: 'B11 家长手机号必须是 1 开头的 11 位数字'
  },
  {
    n: '9 数据层：备注超长不拦',
    f: 'utils/children.js',
    from: "  if (trim(f.note).length > NOTE_MAX) return '备注最多 ' + NOTE_MAX + ' 个字'",
    to: "  if (false) return '备注最多 ' + NOTE_MAX + ' 个字'",
    want: 'B14 备注超过 40 个字要拦下来'
  },
  {
    n: '10 数据层：同班重名不拦（点名会点错人）',
    f: 'utils/children.js',
    from: '    if (all[i].name === name && trim(all[i].cls) === cls) {',
    to: '    if (false) {',
    want: 'B15 同一个班重名要拦住'
  },
  {
    n: '11 数据层：改档时把自己也当成重名（自己的档都存不回去）',
    f: 'utils/children.js',
    from: '    if (all[i].id === editingId) continue',
    to: '    if (false) continue',
    want: 'B17 改自己的档不算重名'
  },
  {
    n: '12 数据层：一个班 30 人上限不拦',
    f: 'utils/children.js',
    from: '  if (!editId && list().length >= KID_MAX) {',
    to: '  if (false) {',
    want: 'B18 一个班最多 30 个孩子'
  },

  /* ---------- 数据层：建档 / 改档 / 删档要落盘 ---------- */
  {
    n: '13 数据层：建档不写盘（刷新就没了）',
    f: 'utils/children.js',
    from: '  writeKids(all)\n  return {\n    ok: true,',
    to: '  return {\n    ok: true,',
    want: 'B20 建档真的落盘了'
  },
  {
    n: '14 数据层：改档换了 id（改一次多出一个孩子）',
    f: 'utils/children.js',
    from: '    id: editId || makeId(),',
    to: '    id: makeId(),',
    want: 'B22 改档：id 不变'
  },
  {
    n: '15 数据层：删档不写盘（名单里还在）',
    f: 'utils/children.js',
    from: '  writeKids(out)\n  return { ok: true, child: hit,',
    to: '  return { ok: true, child: hit,',
    want: 'B25 删档真的落盘了'
  },

  /* ---------- 数据层：课时按孩子分账 ---------- */
  {
    n: '16 数据层：课时不按孩子分格（回到一本设备大账）',
    f: 'utils/billing.js',
    from: '  if (childId) {',
    to: '  if (false) {',
    want: 'D3 每个孩子只动自己那一格'
  },
  {
    n: '17 数据层：账本不记「已完成课时」（课时页的已扣永远是 0）',
    f: 'utils/billing.js',
    from: "    if (it.type === 'consume') b.spent = round2((b.spent || 0) + Math.abs(amount))",
    to: "    if (it.type === 'consume') b.spent = 0",
    want: 'D3 每个孩子只动自己那一格'
  },
  {
    n: '18 数据层：流水不带 childId（老 bug 的样子：看不出是谁的课时）',
    f: 'utils/billing.js',
    from: "    childId: item.childId || '',",
    to: "    childId: '',",
    want: 'D4 一条流水对应一个孩子'
  },
  {
    n: '19 数据层：流水不写孩子名字',
    f: 'utils/billing.js',
    from: "    childName: item.childName || '',",
    to: "    childName: '',",
    want: 'D4 一条流水对应一个孩子'
  },
  {
    n: '20 数据层：按孩子查流水不过滤（把别人的账也倒出来）',
    f: 'utils/billing.js',
    from: '    if (s.ledger[i].childId === id) out.push(s.ledger[i])',
    to: '    out.push(s.ledger[i])',
    want: 'D8 按孩子查流水只倒出他自己的'
  },
  {
    n: '21 数据层：按孩子查课时不看这个孩子的格子（永远 0）',
    f: 'utils/billing.js',
    from: '    const b = kids[id] || { hours: 0, spent: 0 }',
    to: '    const b = { hours: 0, spent: 0 }',
    want: 'H5 老档顶部显示这个孩子自己的账'
  },

  /* ---------- 页面：pages/children ---------- */
  {
    n: '22 页面：家长端也能看全班（别人家的孩子也列出来）',
    f: 'pages/children/children.js',
    from: '      if (!that.mine || all[i].id === that.mine) list.push(all[i])',
    to: '      list.push(all[i])',
    want: 'G13 家长端只看得到自己孩子那一份'
  },
  {
    n: '23 页面：点一行不判断权限（家长端也能进编辑页）',
    f: 'pages/children/children.js',
    from: '    if (!this.data.canEdit) {\n      wx.showToast({\n        title: this.data.tip || role.CHILD_TIP,',
    to: '    if (false) {\n      wx.showToast({\n        title: this.data.tip || role.CHILD_TIP,',
    want: 'G15 家长端点行弹的是家长端那句说明'
  },
  {
    n: '24 页面：建档不看人数上限（第 31 个也放进去）',
    f: 'pages/children/children.js',
    from: '    if (children.count() >= children.KID_MAX) {',
    to: '    if (false) {',
    want: 'G18 满 30 人时「建立孩子档案」被拦住'
  },
  {
    n: '25 页面：家长端点「去点名」不拦（一票否决没了）',
    f: 'pages/children/children.js',
    from: '    if (role.canRoll() === false) {',
    to: '    if (false) {',
    want: 'G16 家长端点「去点名」被一票否决'
  },
  {
    n: '26 页面：点一行进编辑页不带孩子 id（进去不知道改谁）',
    f: 'pages/children/children.js',
    from: "    wx.navigateTo({ url: '/pages/children-edit/children-edit?id=' + id })",
    to: "    wx.navigateTo({ url: '/pages/children-edit/children-edit' })",
    want: 'G6 管理员点一行 → 进编辑页并带上这个孩子的 id'
  },
  {
    n: '27 页面结构：名单里的行不绑点击事件（点不进详情）',
    f: 'pages/children/children.wxml',
    from: 'data-id="{{item.id}}" bindtap="onTapRow"',
    to: 'data-id="{{item.id}}"',
    want: 'G23 名单里每一行都绑了 onTapRow'
  },
  {
    n: '28 页面结构：建档按钮不判断权限（家长端也看得到入口）',
    f: 'pages/children/children.wxml',
    from: 'wx:if="{{canEdit}}" bindtap="onAdd"',
    to: 'bindtap="onAdd"',
    want: 'G24 没有改档权限时不渲染'
  },
  {
    n: '29 页面结构：家长端和老师端都写「全班名单」',
    f: 'pages/children/children.wxml',
    from: "{{mine ? '只看自己孩子' : '全班名单'}}",
    to: '全班名单',
    want: 'G25 家长端卡片头写「只看自己孩子」'
  },

  /* ---------- 页面：pages/children-edit ---------- */
  {
    n: '30 页面：保存不看数据层校验结果（写坏数据也照存）',
    f: 'pages/children-edit/children-edit.js',
    from: '    if (!res.ok) {',
    to: '    if (false) {',
    want: 'H12 姓名空着保存'
  },
  {
    n: '31 页面：保存成功不返回档案页（停在表单上）',
    f: 'pages/children-edit/children-edit.js',
    from: "    setTimeout(function () {\n      nav.back('/pages/children/children')\n    }, 600)",
    to: '    setTimeout(function () {\n    }, 600)',
    want: 'H14 保存成功后返回档案页'
  },
  {
    n: '32 页面：新建档也报「档案已更新」',
    f: 'pages/children-edit/children-edit.js',
    from: "    wx.showToast({ title: res.created ? '档案已建立' : '档案已更新', icon: 'success' })",
    to: "    wx.showToast({ title: '档案已更新', icon: 'success' })",
    want: 'H13 新建档保存成功'
  },
  {
    n: '33 页面：删除不真删（只弹一句「已删除」）',
    f: 'pages/children-edit/children-edit.js',
    from: '        const out = children.remove(that.data.editId)',
    to: "        const out = { ok: true, msg: '档案已删除（课时记录仍留在账单里）' }",
    want: 'H27 删除走数据层真删'
  },
  {
    n: '34 页面：「＋3 课时」不带孩子（记进设备大锅饭）',
    f: 'pages/children-edit/children-edit.js',
    from: '        childId: id,',
    to: "        childId: '',",
    want: 'H23 「＋3 课时」记在这个孩子头上'
  },
  {
    n: '35 页面：「＋3 课时」不判断权限（家长端也能加）',
    f: 'pages/children-edit/children-edit.js',
    from: '    if (!this.data.canEdit || !id) {',
    to: '    if (!id) {',
    want: 'H22 家长端点「＋3 课时」被拦'
  },
  {
    n: '36 页面：保存不判断权限（普通老师也能存）',
    f: 'pages/children-edit/children-edit.js',
    from: "    if (!this.data.canEdit) {\n      wx.showToast({ title: this.data.demoLock || role.CHILD_TIP, icon: 'none', duration: 3000 })\n      return\n    }\n\n    const res = children.save({",
    to: "    if (false) {\n      wx.showToast({ title: this.data.demoLock || role.CHILD_TIP, icon: 'none', duration: 3000 })\n      return\n    }\n\n    const res = children.save({",
    want: 'H18 普通老师点保存被拦'
  },
  {
    n: '37 页面结构：姓名输入框不限字数（能填 80 个字）',
    f: 'pages/children-edit/children-edit.wxml',
    from: 'maxlength="8"',
    to: 'maxlength="80"',
    want: 'H29 姓名输入框'
  },
  {
    n: '38 页面结构：备注框不限字数',
    f: 'pages/children-edit/children-edit.wxml',
    from: 'maxlength="40"',
    to: 'maxlength="400"',
    want: 'H30 备注框'
  },
  {
    n: '39 页面结构：家长手机号框不限位数',
    f: 'pages/children-edit/children-edit.wxml',
    from: 'maxlength="11"',
    to: 'maxlength="111"',
    want: 'H31 家长手机号框'
  },
  {
    n: '40 页面结构：生日选择器能选到今天以后',
    f: 'pages/children-edit/children-edit.wxml',
    from: 'end="{{today}}"',
    to: 'end="{{tomorrow}}"',
    want: 'H32 生日选择器不能选到今天以后'
  },
  {
    n: '41 页面结构：「＋3 课时」不判断演示账号（真账号也冒出来）',
    f: 'pages/children-edit/children-edit.wxml',
    from: 'wx:if="{{canEdit && demo}}" hover-class="add3-btn-hover"',
    to: 'wx:if="{{canEdit}}" hover-class="add3-btn-hover"',
    want: 'H35 「＋3 课时（测试用）」只在'
  },
  {
    n: '42 页面结构：删除按钮新建档时也有（点下去删的是别人）',
    f: 'pages/children-edit/children-edit.wxml',
    from: 'wx:if="{{editId}}" bindtap="onDelete"',
    to: 'bindtap="onDelete"',
    want: 'H36 删除按钮只在编辑老档时出现'
  },
  {
    n: '43 页面结构：三分支不成套（锁卡片和表单的分支错位）',
    f: 'pages/children-edit/children-edit.wxml',
    from: 'wx:elif="{{!canEdit}}"',
    to: 'wx:if="{{!canEdit}}"',
    want: 'H38 三分支相邻'
  }
]

function main() {
  const files = {}
  M.forEach(function (m) {
    files[m.f] = true
  })
  fs.mkdirSync(BAK, { recursive: true })
  Object.keys(files).forEach(function (f) {
    fs.copyFileSync(path.join(ROOT, f), path.join(BAK, f.replace(/\//g, '_')))
  })
  const base = {}
  Object.keys(files).forEach(function (f) {
    base[f] = md5(path.join(ROOT, f))
  })
  console.log('备份 + md5 完成：' + Object.keys(files).length + ' 个文件 → ' + BAK)

  let caught = 0
  const bad = []
  M.forEach(function (m) {
    const file = path.join(ROOT, m.f)
    const bak = path.join(BAK, m.f.replace(/\//g, '_'))
    fs.copyFileSync(bak, file)
    const src = fs.readFileSync(file, 'utf8')
    const hits = src.split(m.from).length - 1
    if (hits !== 1 || base[m.f] !== md5(file)) {
      bad.push(m.n + '  →  变异锚点异常（出现 ' + hits + ' 次 / md5 不一致），跳过')
      console.log('❌ ' + bad[bad.length - 1])
      return
    }
    fs.writeFileSync(file, src.replace(m.from, m.to))

    let out = ''
    let failed = false
    try {
      out = execFileSync('node', [SMOKE], { cwd: ROOT, encoding: 'utf8' })
    } catch (e) {
      failed = true
      out = String((e && e.stdout) || '') + String((e && e.stderr) || '')
    }

    fs.copyFileSync(bak, file)
    if (md5(file) !== base[m.f]) {
      bad.push(m.n + '  →  ⚠️ 还原后 md5 不一致！立刻停下')
      console.log(bad[bad.length - 1])
      process.exit(1)
    }

    const hitWrong = out.indexOf(m.want) > -1
    if (failed && hitWrong) {
      caught++
      console.log('✅ 抓到：' + m.n + '（自检报出 ' + m.want + '）')
    } else {
      bad.push(m.n + '  →  ' + (failed ? '失败了但没报出 ' + m.want : '居然没失败（测试漏了）'))
      console.log('❌ ' + bad[bad.length - 1])
      console.log('   ' + out.split('\n').slice(-6).join('\n   '))
    }
  })

  let dirty = 0
  Object.keys(files).forEach(function (f) {
    if (md5(path.join(ROOT, f)) !== base[f]) dirty++
  })
  console.log('')
  console.log('变异 ' + M.length + ' 组：抓到 ' + caught + ' 组 / 源码还原后不一致 ' + dirty + ' 个文件')
  if (bad.length || dirty) {
    console.log('❌ 有问题的：')
    bad.forEach(function (b) {
      console.log('   - ' + b)
    })
    process.exitCode = 1
    return
  }
  console.log('✅ 全部变异都被自检抓住，源码已还原（md5 逐文件校验一致）')
}

main()
