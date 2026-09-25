# 班级相册 —— 后端对接说明

给**班级相册**用的后端：家长看照片（只读），管理员建相册、传照片、删照片。

- 照片**本体**存在**云存储**（手机直接上传），云函数只登记和删除
- 云函数：`cloudfunctions/albumAdmin/`（**已写好，还没部署**）
- 数据层：`utils/album.js`（**全项目只有它碰相册数据**，页面只调用它）
- 界面页：家长端 `pages/album`（只读：选班级 → 看相册 → 点开看照片/大图）、管理端 `pages/album-admin`（建相册、改名、传照片、删照片/相册、恢复演示）
- 入口：校园 tab 相册块「更多」、我的 → 班级相册（所有人）；我的 → 相册管理（管理员，长按版本号开启）

---

## 一、现在就能演示（本地模式，不用云开发）

`utils/album.js` 文件开头：

```js
const MODE = 'local'
```

本地模式的行为：

- 相册和照片记录都写在**这一台手机**里，换手机看不到
- 第一次打开自动写入 **3 个演示相册 + 13 张照片**；照片没有真实图片（页面会给灰底块 + 「照片 1」这样的文字），所以不违反「不用图片资源」的约定
- 「本机体验管理员」和**通知共用一把钥匙**：长按「我的」页底部版本号开一次，通知和相册同时生效
- 想还原演示数据：调用 `album.resetDemo()`（只在本地模式有效；云端模式会提示「请在相册页手动删除」）
- 演示数据**只写一次**（本机标记 `album_seeded_v1`）：老师把相册全删了就保持为空，不会又冒出演示相册；想找回用管理页的「恢复演示相册」

---

## 二、想给所有家长同步看：切到云端（3 步）

### 第 1 步：部署云函数

在微信开发者工具左侧文件树里：

1. 右键 `cloudfunctions/albumAdmin` 文件夹
2. 选 **上传并部署：云端安装依赖（不上传 node_modules）**
3. 等右下角提示上传成功（第一次约 1~3 分钟）

> 顶部如果写着「未选择环境」，先点它选 `cloud1-d8g6wktjobb841cee`。

### 第 2 步：确认管理员名单

名单和「食谱管理」「通知公告」**共用一份**，不用再配一遍：

- 云函数 `menuAdmin` 的环境变量 `ADMIN_OPENIDS`（多个 openid 用英文逗号隔开），或
- 云数据库集合 `menu_admins`，文档 ID 就是管理员的 openid

还没设过管理员：在「我的」页**长按版本号** → 弹「还没有设置管理员」→ 点「确定设置」（这一步走的是 `menuAdmin`）。

> `albumAdmin` **故意不提供**「自助成为管理员」的分支，只认已有白名单 —— 少一个提权口子更安全。

### 第 3 步：把数据层切到云端

把 `utils/album.js` 第 23 行改成：

```js
const MODE = 'cloud'
```

然后重新编译。之后：

- 管理员建的相册、传的照片进云数据库，**所有家长都能看到**
- 家长端读不到云函数时自动退回本机缓存（不白屏）
- 云函数名不是 `albumAdmin` 时，改 `utils/env.js` 的 `ALBUM_FUNCTION`（目录名也要一起改）

---

## 三、云端数据长什么样（3 个集合）

集合会在第一次写入时自动创建，不用手动建。

| 集合 | 一条记录 | 谁写 |
| --- | --- | --- |
| `albums` | `{ _id, className, title, date, cover, count, createdAt, updatedAt, creator }` | 仅管理员（云函数） |
| `album_photos` | `{ _id, albumId, fileID, sort, createdAt, creator }` | 仅管理员（云函数） |
| `album_members` | 文档 ID = 家长 openid，`{ className, updatedAt }` | 家长自己（云函数） |
| `menu_admins` | 文档 ID = 管理员 openid（与食谱、通知共用） | 园长维护 |

字段说明（`albums`）：

- `className`：班级名，如 `中班`、`全园`
- `title`：相册名，如「春游去动物园」
- `date`：`'YYYY-MM-DD'`，页面按这个倒序排
- `cover`：封面用哪张照片的 `fileID`（默认第一张，被删了自动换下一张）
- `count`：里面有几张照片（增删时自动重数）

照片文件在云存储里的路径：

```
album/{相册id}/{时间戳}_{序号}_{随机数}.jpg
```

> `<image src="{{photo.src}}">` **直接用 `cloud://` 就能显示**，不用先换 https；要保存到手机或分享时才需要换临时链接（见 `tempUrls`）。

---

## 四、云函数接口（`albumAdmin`）

统一约定：入参都是 `{ action, ... }`，返回 `{ ok: true, ... }` 或 `{ ok: false, msg }`。

任何人（家长）可调：

| action | 入参 | 返回 |
| --- | --- | --- |
| `whoami` | — | `{ openid, isAdmin, initialized }`（`initialized` = 园里是否已有人认领管理员） |
| `myClass` | — | `{ className }`（没设过就是空串） |
| `setMyClass` | `{ className }` | `{ className }` |
| `listAlbums` | `{ className? }` | `{ albums: [...] }`（不传 = 全部；传了就只要这个班） |
| `listPhotos` | `{ albumId, skip? }` | `{ album, photos: [...], skip, hasMore, total }` |
| `tempUrls` | `{ fileIDs: [...] }` | `{ urls: [{ fileID, url }] }`（只处理 `cloud://`） |

仅管理员可调（其他人返回「没有管理权限」）：

| action | 入参 | 返回 |
| --- | --- | --- |
| `createAlbum` | `{ className, title, date? }` | `{ album }`（日期不填 = 今天，按中国时区算） |
| `updateAlbum` | `{ albumId, title?, className?, date?, cover? }` | `{ album }` |
| `removeAlbum` | `{ albumId }` | `{ removed: 1, photos: 删掉几张 }`（连带删云存储文件） |
| `addPhotos` | `{ albumId, fileIDs: [...] }` | `{ added, album }`（`fileID` 必须以 `cloud://` 开头） |
| `removePhotos` | `{ ids: [...] }` | `{ removed }`（删记录 + 删文件 + 重数数量 + 换封面） |

上限（前后端一致，改了记得两边一起改）：

| 项目 | 上限 |
| --- | --- |
| 相册名 | 30 字 |
| 班级名 | 12 字 |
| 一个相册的照片 | 300 张 |
| 一次登记 / 删除 | 30 张 |
| 一次列相册 | 100 个 |
| 一次返回照片 | 60 张（翻页用 `skip`，如 `skip: 60`） |
| 一次换临时链接 / 删云存储文件 | 50 个 |

---

## 五、家长看到哪些相册（班级规则）

- 家长第一次进相册页时选一次「孩子所在的班」，存进 `album_members`，**换手机也记得**
- 家长看到的相册 = **自己班 + 全园**（`全园` 这个班名的相册大家都能看）
- 班级**不做白名单**：推荐列表在数据层的 `album.CLASSES`（`全园/小班/中班/大班/学前班`）。园里要加「托班」「大一班」，在 `album.js` 加一个词即可，云函数不用改
- 列表页拿数据用 `album.listAlbums(className)`：云端一次拉全量（≤100）再在本机按班级过滤，页面不用管过滤逻辑

---

## 六、后端怎么验证（不用写页面）

在微信开发者工具里：**云开发控制台 → 云函数 → `albumAdmin` → 云端测试（云端测试/本地调试旁的「测试」）**，把下面的 JSON 一条条粘进去点「运行」。

1. 先看自己是谁（应该返回 `isAdmin: false`）：

```json
{ "action": "whoami" }
```

2. 看相册列表（刚开始是空的，返回 `{ "ok": true, "albums": [] }`）：

```json
{ "action": "listAlbums" }
```

3. 给自己设一个班级：

```json
{ "action": "setMyClass", "className": "中班" }
```

4. **建一个相册**（这一步要管理员才会成功；不是管理员会返回「没有管理权限」，说明白名单没配好）：

```json
{ "action": "createAlbum", "className": "中班", "title": "春游去动物园", "date": "2026-04-18" }
```

5. 把第 4 步返回的 `album.id` 填进下面，看这个相册（此时照片是空的）：

```json
{ "action": "listPhotos", "albumId": "把上一步的 album.id 粘到这里" }
```

6. 想看数据本身：**云开发控制台 → 数据库 → 集合 `albums` / `album_photos`**，能看到刚写进去的记录。

> 照片是「手机先上传云存储 → 再把 `fileID` 交给云函数登记」，所以云端测试里**没法直接测 `addPhotos`**（它只收 `cloud://` 开头的 fileID）。等相册界面页做好，在手机上点「＋」传一张，就能看到 `albums.count` 从 0 变 1。

---

## 七、常见问题

**Q：调用返回「没有管理权限」？**
A：当前微信不在白名单里。长按「我的」页底部版本号会显示你的 openid → 复制给园长，加到 `ADMIN_OPENIDS`（多个用英文逗号）或集合 `menu_admins`（文档 ID = openid）。

**Q：报 `-501002` 或「超时」？**
A：第一次调用冷启动慢，客户端会自动重试一次。还失败就检查：开发者工具顶部是否「未选择环境」；云函数是否真的上传成功；把云函数超时时间调到 20 秒。

**Q：家长看不到照片？**
A：先看相册的 `className` 和家长的班级是否对得上（规则是「本班 + 全园」）。家长班级看集合 `album_members`，文档 ID 就是他的 openid。

**Q：删了相册，云存储里的图还在吗？**
A：不在。`removeAlbum` / `removePhotos` 会**连文件一起删**（每批 50 个，文件已不在时忽略）。只有一种例外：照片传上去了但登记失败（当时提示「照片传上去了，但记账没成功，请再点一次」），这类「孤儿文件」暂不自动清理。

**Q：照片会不会过期？**
A：云存储的 `fileID` 长期有效，`cloud://` 可以直接给 `<image>` 用。换出来的 https 临时链接约 2 小时有效，所以**只在保存/分享那一刻**才换。

**Q：相册内容给家长看，隐私上要注意什么？**
A：现在是「本班 + 全园」可见。要更严可以按 openid 建家长-孩子关系表再过滤（属于后续增强，改动在 `albumAdmin` 的 `listAlbums/listPhotos` 两处）。

**Q：本地模式重启小程序后照片变灰块？**
A：正常。本地模式记的是手机临时路径，重启后可能失效 —— 页面会画灰块提示，重新传一次即可（这也是切云端后解决的问题）。

---

## 八、上线前建议

1. 部署 `albumAdmin` 后把 `utils/album.js` 的 `MODE` 改成 `'cloud'`，让家长看到同一份相册
2. 相册页若要「长按删除」，务必只在 `album.adminStatus()` 返回 `isAdmin: true` 时才显示入口
3. 定期看一眼云存储用量（照片是主要占用）；单相册 300 张的上限够日常用，不够再调
