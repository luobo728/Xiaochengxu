# 计费模块说明（课时 + 余额）

## 现在是什么状态

**本地模式**：数据存在手机本地，**不需要云函数**，打开就能用（方便先演示）。
所以现在：换一台手机 / 清缓存，数据就回到 0 —— 这是正常的，接入云端后就不会了。
课时（上课自动扣）同样已经在本机模式跑通：点名即结算，课时页 / 账单页看真数据，方案见 `docs/课时自动计算方案.md`。

## 规则在哪里改（只改一个文件）

`utils/billing.js` 顶部：

```js
const RULES = {
  checkinReward: 1.5,      // 每天打卡返多少元余额
  claimHours: 2,           // 默认券码送多少课时
  ...
}

// 上课扣课时口径（自动计算课时的唯一真值，点名页 / 课时页都读它）
const ATTEND = {
  perLesson: 1,        // 到课扣 1 课时
  leaveFree: true,     // 请假不扣
  absentCharge: true,  // 旷课照扣
  trialFree: true,     // 试听不扣
  unitMinutes: 45,     // 将来按分钟排课：45 分钟 = 1 课时
  lowWarn: 4,          // 剩余 ≤ 4 课时提醒家长续费
  allowNegative: true  // 课时不够照扣成负数（关掉 = 没课时不让上课）
}

const DEMO_CODES = [
  { code: 'NEW-2026',    hours: 2, note: '新生扫码礼' },
  { code: 'FRIEND-2026', hours: 1, note: '老带新推荐礼' }
]
```

- **新生扫码领课时**：园所把券码（如 `NEW-2026`）做成二维码，贴在门口或发到群里；家长在小程序里点「扫码领课时」扫它 → 课时进账（同一码限领一次）。
- **打卡返余额**：每天 1 次，返 ¥1.5；连续打卡天数会自动累计（断了从 1 重新算）。
- **上课扣课时（自动计算）**：老师点一次名 → 到课的孩子各扣 1 课时（请假不扣、旷课照扣、试听不扣）→ 自动写进账本，课时页与账单明细立刻同步；**每个孩子各一本账，点一次名按人头各扣一次，扣谁的写谁的名字**；细节见 `docs/课时自动计算方案.md` 与 `docs/孩子档案.md`。演示数据第一次打开给每个已建档的孩子各送 20 课时（`demo_gift_v1:<id>`，只送一次），否则余额是 0 没法演示。

## 数据层接口（页面只调这些）

| 方法 | 说明 |
| --- | --- |
| `getSummary(childId?)` | `{ hours, balance, checkinDays, todayChecked, claimCount }`；传 `childId` 就只算这个孩子那一本账 |
| `listLedger(limit, childId?)` | 收支明细（含 `typeName / amount / unit / note / timeText / afterText / childId / childName`）；传 `childId` 只看这个孩子的流水 |
| `claimByCode(code, childId?, childName?)` | 领券 → `{ ok, msg, hours, summary }`（内部走 `applyHours`，同一码另有 ref 判重；课时落到 `childId` 那本账，判重 key 始终是券码本身） |
| `checkin()` | 今日打卡 → `{ ok, msg, reward, summary }` |
| `rules()` | 计费规则（页面展示用，避免页面写死数字） |
| **`applyHours(item)`** | **课时唯一原子写入口**：`{ amount, type, typeName, note, ref, childId, childName }` → `{ ok, dup, msg, summary }`；`ref` 重复直接返回 `dup: true`，一笔账都不写；带 `childId` 就记到这个孩子账上（`note` 里也会写清是谁） |
| **`hoursStat(childId?)`** | 课时统计 → `{ left, spent, total }`；传 `childId` 就是这个孩子的那本账，不传 = 全部孩子 + 旧账合计（课时页的「剩余 / 已完成 / 本学期」就是这三个数） |
| **`kidsStat(ids)`** | 一次拿多个孩子的账 → `Promise<[{ childId, left, spent, total }]>`（点名页 / 课时页按孩子展示用） |
| **`attendRules()`** | 上课扣课时口径（点名页 / 课时页展示用，真值只有 `ATTEND` 一处） |
| `demoCodes()` | 演示可用的券码 |
| `mode` | 当前模式 `'local'` / `'cloud'` |

## 以后要联网（不改任何页面）

1. 新建云函数 `billing`，实现 action：`summary` / `ledger` / `claim` / `checkin` / **`settle`（上课结算，课时自动计算用）**
   - 券码存集合 `billing_codes`：`{ code, hours, usedBy: [openid], expireAt, enabled }`
   - 账户存集合 `billing_accounts`：文档 ID = `openid + '_' + childId`（一个孩子一本账），字段 `{ openid, childId, hours, balance, checkinDays, lastCheckinDate }`
   - 流水存集合 `billing_ledger`：`{ openid, childId, childName, type, amount, unit, note, ref, createTime }`
   - 课表 / 点名存集合 `lesson_schedules` / `attendance_marks`（课时自动计算，P3）
   - **判重都必须在服务端**：同一 openid 同一天只能打一次卡、同一码只能领一次（券码判重 key 始终是券码本身）、同一节课同一个孩子只能结算一次（靠 `ref` 唯一索引）
2. 把 `utils/billing.js` 的 `MODE` 改成 `'cloud'`，并按 cloud 分支调用云函数
   （页面代码一行都不用改，接口签名保持不变）

## 真机怎么测「扫码领课时」

- 开发者工具里点「扫码领课时」通常调不出摄像头 → 会自动弹出**手动输入券码**的输入框，输入 `NEW-2026` 即可
- 真机：任意二维码生成网站把 `NEW-2026` 生成二维码，用小程序里的「扫码领课时」扫它

## 两条铁律（课时 = 钱）

1. **所有课时增减只走一个入口**：`applyHours({ amount, type, typeName, note, ref, childId, childName })`（正数进、负数扣，内部按 `ref` 判重，带 `childId` 就记到那个孩子账上）。页面、点名页、券码……谁都不许自己改 `hours` 这个数字。
2. **余额永远由流水算出来**：`hoursStat(childId?)` 给 `{ left, spent, total }`，其中 `total` 恒等于账本里 `unit: 'hour'` 的金额合计 —— 不传 `childId` 是全部孩子 + 旧账的合计，传了就是这一个孩子的那本账。对不上就说明有代码绕过了入口。

## 安全提醒（接云端时）

- 券码要在服务端校验 + 判重 + 设有效期，客户端只做展示
- 余额/课时是**钱**：所有增减都必须走服务端，客户端不能直接改数字
- 上课扣课时同理：云端由云函数 `billing` 的 `settle` 结算，集合建唯一索引 `openid + childId + lessonId`（本机模式靠流水 `ref` 判重）
