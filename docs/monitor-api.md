# 园区监控 · 接入接口说明

> 现状：**校园页已经有了「园区监控」分区，监控播放页 `pages/monitor/monitor` 也已建好**。
> 现在默认是「未接入」状态（`MODE: 'off'`），客户端**不会发任何请求**，页面显示「监控正在对接中，敬请期待」。
> 等你有了监控流，按下文接入即可，**页面代码一行都不用改**。

---

## 一、三个方法就够（客户端已实现，不要改）

全部集中在 `utils/monitor.js`，页面只调用这 4 个：

| 方法 | 返回值 | 说明 |
| --- | --- | --- |
| `isReady()` | `boolean` | 是否已配置。为 `false` 时页面显示占位，不发请求 |
| `getCameras()` | `Promise<Camera[]>` | 摄像头列表（家长能看到哪几路） |
| `getPlayUrl(cameraId)` | `Promise<{url, type, expireAt}>` | 取播放地址。**每次实时取，不在本地缓存** |
| `openWindowText()` | `string` | 页面上显示的开放时段文案 |

```js
Camera      = { id: string, name: string, place: string, online: boolean }
PlayResult  = { url: string, type: 'hls' | 'mp4', expireAt: number }
// url 为空串 => 页面显示「当前不在开放时段或暂无画面」
// expireAt = 毫秒时间戳，链接过期时间；为 0 表示不确定（客户端不自动刷新）
```

---

## 二、怎么切换接入方式

只改 `utils/env.js` 里这一段：

```js
MONITOR: {
  MODE: 'off',                 // 'off' 未接入 | 'cloud' 走云函数 | 'http' 走自建后端
  API: '',                     // MODE='http' 时填后端前缀，如 https://api.your-school.com/monitor
  FUNCTION: 'monitor',         // MODE='cloud' 时的云函数名
  WINDOW_TEXT: '每日 08:00-17:00 开放',
  TOKEN_KEY: 'monitor_token'   // 需要鉴权时，家长令牌存在这个 storage key（见第四节）
}
```

---

## 三、方式 A：走云函数（**推荐**）

新建一个云函数 **`monitor`**（目录 `cloudfunctions/monitor/`，做法与现有的 `menuAdmin` 一样：右键 →「创建并部署」，选带**云端安装依赖**的那个），实现两个 action：

```js
// cloudfunctions/monitor/index.js（骨架）
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

exports.main = async (event) => {
  const openid = cloud.getWXContext().OPENID || ''
  const action = (event && event.action) || ''

  // TODO 1：鉴权 —— 查家长绑定关系，得出这个 openid 允许看哪几路
  //   例如：db.collection('parents').where({ _openid: openid }) → 拿到孩子所在班级
  //   再映射到该班级的摄像头 id 列表；不在名单里的摄像头一律拒绝
  const allowedIds = await getAllowedCameraIds(openid)
  if (!allowedIds.length) return { ok: false, msg: '没有监控查看权限' }

  if (action === 'cameras') {
    const list = CAMERAS.filter(c => allowedIds.includes(c.id))   // CAMERAS 可存数据库
    return { ok: true, list }                                     // [{id,name,place,online}]
  }

  if (action === 'play') {
    const id = event.id
    if (!allowedIds.includes(id)) return { ok: false, msg: '没有该画面的权限' }

    // TODO 2：调用监控平台的开放接口换取播放地址
    //   萤石云：/api/lapp/live/address/get（需要 accessToken + 设备序列号 + 通道号）
    //   乐橙  ：/openapi/accessToken + /openapi/getLiveStreamInfo
    //   自建 NVR / SRS / ZLMediaKit：直接拼 HLS 地址 + 短时效签名
    const url = await getLiveUrl(id)          // 返回形如 https://.../live/room101.m3u8?token=xxx&expire=...
    return { ok: true, url, type: 'hls', expireAt: Date.now() + 10 * 60 * 1000 }
  }

  return { ok: false, msg: '未知操作' }
}
```

**为什么推荐云函数**：`appKey` / `appSecret` / 设备序列号全部留在服务端，小程序包里不会有任何密钥；而且能在这里做「**哪个家长能看哪一路**」的鉴权。

---

## 四、方式 B：自建后端接口

```
GET {API}/cameras
Headers: Authorization: Bearer <家长令牌>        ← 客户端自动带上（见下）
200 {
  "code": 0,
  "data": [
    { "id": "room101", "name": "大一班教室", "place": "教学楼 2 楼", "online": true },
    { "id": "playground", "name": "户外操场", "place": "园区东侧", "online": true }
  ]
}
```

```
GET {API}/play?id=room101
Headers: Authorization: Bearer <家长令牌>
200 {
  "code": 0,
  "data": {
    "url": "https://live.your-school.com/live/room101.m3u8?token=xxx&expire=1736670000",
    "type": "hls",
    "expireAt": 1736670000000
  }
}
```

约定：
- **鉴权**：家长在小程序里登录后，把后端下发的令牌写进本地存储：`wx.setStorageSync('monitor_token', token)`（key 可在 `utils/env.js` 的 `TOKEN_KEY` 改）。客户端会自动以 `Authorization: Bearer <令牌>` 发送；没令牌时也会发请求，由后端返回 401。
- **失败**：返回 HTTP 200 且 `code !== 0`（客户端读 `msg` 当提示文案），或直接返回 4xx/5xx 都行。
- **必须 HTTPS**，并到小程序后台「开发管理 → 开发设置 → 服务器域名 → request 合法域名」里加上你的域名（开发阶段可在开发者工具里临时勾「不校验合法域名」）。

---

## 五、播放地址的形态与平台限制（重要）

| 形式 | 能否直接用 | 说明 |
| --- | --- | --- |
| **HLS（.m3u8）** | ✅ 推荐 | `<video>` 可直接播；延迟通常 5~20 秒，家长看孩子在园情况完全够用 |
| MP4 | ✅ | 适合「回放某一段录像」的场景，不适合实时 |
| FLV / RTMP（低延迟） | ⚠️ | 需要 `live-player` 组件，而它要求小程序开通**「实时音视频」类目权限**（企业主体 + 相关资质），本页暂未使用。确有需要告诉我，我改成 live-player（代码改动不大） |
| 平台 SDK（萤石/乐橙） | ⚠️ | 它们的开放平台本质是「取流地址 + 令牌」，建议由云函数/后端代理后返回 HLS 地址，**不要把 appKey/secret 放进小程序** |

- 视频资源**不校验域名白名单**（`<video>` 可以直接播任意 https 地址），但**取地址的接口**（`wx.request`）要配合法域名。
- 建议后端返回**短有效期**（5~15 分钟）的地址；客户端会根据 `expireAt` 自动重取，避免地址被转发后长期可用。
- 并发提醒：多路家长同时观看会占带宽，建议后端做并发限制或只下发单路。

---

## 六、合规与隐私（上线前务必确认）

- **未成年人影像属于敏感个人信息**：建议与每个家庭**单独签署同意书**，说明用途、范围与保存期限。
- **只开放给已绑定该幼儿的家长**：在 `cameras` / `play` 里按 `openid` 校验「家长 ↔ 幼儿 ↔ 班级 ↔ 摄像头」的绑定关系，不要做成"任何人都能看"。
- **短时效 + 开放时段**：令牌与取流地址都要有有效期；配合 `WINDOW_TEXT` 只在开放时段提供流。
- **水印**：建议由监控平台/NVR 侧在画面上叠加园所名称与时间（客户端加水印不可靠，容易被绕过）。
- 页面**不提供下载 / 录屏入口**（当前实现里也没有），并在页面底部提示「请勿录屏或转发」。
- 别忘了在小程序**隐私协议**里补充「监控影像」这一项。

---

## 七、上线前检查清单

- [ ] 选好接入方式，改 `utils/env.js` 的 `MONITOR.MODE`（`cloud` 或 `http`）
- [ ] 云函数 `monitor` 或后端接口实现 `cameras` / `play`，并做好「家长 ↔ 摄像头」鉴权
- [ ] 方式 B 需要在**小程序后台配置 request 合法域名**
- [ ] **真机**测试播放（开发者工具里视频播放能力有限，模拟器常常放不出来）
- [ ] 家长同意书 + 隐私协议补充监控说明
- [ ] 确认监控平台允许的最大并发与流量，必要时做限制

---

## 八、未接入时的表现（现在就是这样）

- 校园页「园区监控」卡片：显示一行灰字「监控正在对接中，敬请期待」+「即将开放」标签，点击弹提示。
- 直接打开监控页：黑底占位（CSS 摄像头图标）+「监控尚未接入」+ 开放时段文案，**不会报错**。
- 一旦把 `MODE` 改成 `cloud` / `http` 并部署好后端，页面会自动切换成真实画面，**无需改任何页面代码**。
