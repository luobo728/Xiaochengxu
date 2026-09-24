# 计费模块说明（课时 + 余额）

## 现在是什么状态

**本地模式**：数据存在手机本地，**不需要云函数**，打开就能用（方便先演示）。
所以现在：换一台手机 / 清缓存，数据就回到 0 —— 这是正常的，接入云端后就不会了。

## 规则在哪里改（只改一个文件）

`utils/billing.js` 顶部：

```js
const RULES = {
  checkinReward: 1.5,      // 每天打卡返多少元余额
  claimHours: 2,           // 默认券码送多少课时
  ...
}
const DEMO_CODES = [
  { code: 'NEW-2026',    hours: 2, note: '新生扫码礼' },
  { code: 'FRIEND-2026', hours: 1, note: '老带新推荐礼' }
]
```

- **新生扫码领课时**：园所把券码（如 `NEW-2026`）做成二维码，贴在门口或发到群里；家长在小程序里点「扫码领课时」扫它 → 课时进账（同一码限领一次）。
- **打卡返余额**：每天 1 次，返 ¥1.5；连续打卡天数会自动累计（断了从 1 重新算）。

## 页面接口（7 个）

| 方法 | 说明 |
| --- | --- |
| `getSummary()` | `{ hours, balance, checkinDays, todayChecked, claimCount }` |
| `listLedger(limit)` | 收支明细（含 `typeName / amount / unit / note / timeText / afterText`） |
| `claimByCode(code)` | 领券 → `{ ok, msg, hours, summary }` |
| `checkin()` | 今日打卡 → `{ ok, msg, reward, summary }` |
| `rules()` | 计费规则（页面展示用，避免页面写死数字） |
| `demoCodes()` | 演示可用的券码 |
| `mode` | 当前模式 `'local'` / `'cloud'` |

## 以后要联网（不改任何页面）

1. 新建云函数 `billing`，实现 4 个 action：`summary` / `ledger` / `claim` / `checkin`
   - 券码存集合 `billing_codes`：`{ code, hours, usedBy: [openid], expireAt, enabled }`
   - 账户存集合 `billing_accounts`：文档 ID = `openid`，字段 `{ hours, balance, checkinDays, lastCheckinDate }`
   - 流水存集合 `billing_ledger`：`{ openid, type, amount, unit, note, createTime }`
   - **打卡与领券都必须在服务端判重**（同一 openid 同一天只能打一次、同一码只能领一次）
2. 把 `utils/billing.js` 的 `MODE` 改成 `'cloud'`，并按 cloud 分支调用云函数
   （页面代码一行都不用改，接口签名保持不变）

## 真机怎么测「扫码领课时」

- 开发者工具里点「扫码领课时」通常调不出摄像头 → 会自动弹出**手动输入券码**的输入框，输入 `NEW-2026` 即可
- 真机：任意二维码生成网站把 `NEW-2026` 生成二维码，用小程序里的「扫码领课时」扫它

## 安全提醒（接云端时）

- 券码要在服务端校验 + 判重 + 设有效期，客户端只做展示
- 余额/课时是**钱**：所有增减都必须走服务端，客户端不能直接改数字
