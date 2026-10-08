# tools/ —— 自检脚本（跟着仓库走，不再放临时目录）

这些脚本不是小程序运行时的一部分，**不会被打包进小程序**（微信开发者工具只编译 `app.json` 里注册的页面和它们引用的文件）。
它们的作用是：改完代码**一条命令证明没改坏**，并且能证明「测试真的抓得住坏代码」。

当前共 **13 个脚本**：静态检查 3 + 冒烟测试 6（合计 **509 项断言**）+ 变异测试 4（合计 **144 组坏代码，全部被抓住**）。

## 怎么跑

> ⚠️ **两个坑**（都踩过）：
> 1. `tools/` 已经在 `project.config.json` 的 `packOptions.ignore` 里排除 —— 别把这个目录从排除名单里删掉，否则微信开发者工具会把 `tools/*.js`（Node 脚本，`require('fs')`）当小程序代码编译，编译一报错**整个界面会变成半渲染的乱版**。
> 2. **跑变异测试（`mutations_*`）时先把微信开发者工具关掉**（或至少关掉「编译热重载」）：它会每几秒临时改一次源码再还原，开发者工具跟着疯狂重编译，模拟器会卡在渲染错乱的状态。

```bash
# 全部（静态检查 + 冒烟测试 + 变异测试）
node tools/run_all.js

# 日常：跳过变异测试（快）
node tools/run_all.js --no-mutations

# 只跑名字里含某段字的
node tools/run_all.js --only smoke_
```

也可以单独跑某一个：`node tools/smoke_schedule.js`。

## 三类脚本

| 前缀 | 是什么 | 干什么 |
| --- | --- | --- |
| `check_*` | 静态检查 | 只读源码做体检：wxml 的 `view` 标签是否配对、用到的 class 是否有定义、`bind*` 事件方法是否存在、wxml 里的字段是否在 js 里出现、身份判断的三个分支是否相邻……**不跑逻辑，秒级** |
| `smoke_*` | 冒烟测试 | 自己模拟 `wx`（storage / toast / modal / 导航）和云函数沙箱，把数据层和页面当模块 `require` 进来，**逐条断言业务规则**：课时怎么扣、谁看得到哪条通知、权限谁能进 |
| `mutations_*` | 变异测试 | 把源码**故意改坏**（一行），跑对应的冒烟测试：**必须失败，且失败项正是期望的那一条**，然后还原源码并用 md5 逐文件校验。用来证明冒烟测试不是「摆设」 |

## 约定（新增脚本请照这个来）

1. **路径**：`const root = path.resolve(__dirname, '..')` —— 从哪跑都能找到仓库。
2. **模拟 `wx`**：在 `require` 业务代码**之前**挂 `global.wx` / `global.getApp` / `global.getCurrentPages` / `global.Page`。
3. **页面测试**：`global.Page = (o) => { captured = o }` → `require` 页面文件 → 把方法拷到一个 `{}` 上，配 `data` 和 `setData`（见 `smoke_course.js` 的 `loadPage` / `ctxOf`）。
4. **storage 模拟要过序列化**：`JSON.parse(JSON.stringify(...))` 读写各一份。真机就是这样的；如果共享对象引用，会**掩盖「忘记写盘」这类 bug**。
5. **断言**：`check('编号 一句话', 条件, 可选的实际值)`，打印 `✅` / `❌`，最后给一句总结，**失败时 `process.exit(1)`**。
6. **断言编号**：`A1 / B2 / 16.25` 这类编号是**删除探测器** —— 中间删掉一条，后面编号会错位，一眼能看出来。
7. **变异测试**：备份目录固定放 `tools/.tmp/bak_*`（已在 `.gitignore` 里排除）；每条变异的 `from` 必须在源码里**唯一**（脚本会自己检查出现次数，不等于 1 就报错跳过）；跑完必须还原并 md5 一致。

## 现在有哪些

| 脚本 | 覆盖 |
| --- | --- |
| `check_pages.js` | 主要页面的 `bind*` 事件方法是否存在 |
| `check_album_pages.js` | 页面 wxml 的 view 配对 / class 定义 / 事件方法 |
| `check-menu-admin.js` | 食谱管理页 + 「我的」页的字段与事件接线 |
| `smoke_schedule.js` | 课表生成、点名结算（到课扣 / 请假不扣 / 旷课照扣 / 试听不扣）、幂等不重扣、改点法冲正、自动补算、**清空点名**、课时页统计 |
| `smoke_children.js` | 孩子档案（建档校验 / 重名 / 上限）、按孩子独立分账、点名连档案、家长端只能看自己孩子 |
| `smoke_account.js` | 演示账号四个档位、权限一票否决（云端白名单 / 缓存 / 本机标记 / 一键成为管理员四个来源全作废）、管理员花名册 |
| `smoke_notice.js` | 通知增删改置顶、**定向推送**（按班级筛选、详情页挡住、发布页胶囊）、首页与详情页接线 |
| `smoke_cloudfn.js` | 云函数 `noticeAdmin`（whoami / list / save / remove / reset、定向推送、老数据兼容） |
| `smoke_course.js` | **课程内容管理**（改课程名 / 老师 / 每节几课时 / 内容简介；点过名的课课时数锁住） |
| `mutations_clear.js` | 变异测试：清空点名的 17 组坏代码 |
| `mutations_children.js` | 变异测试：孩子档案 / 分账的坏代码 |
| `mutations_notice.js` | 变异测试：通知 + 定向推送的坏代码 |
| `mutations_course.js` | 变异测试：课程内容编辑的 27 组坏代码 |

> 说明：`smoke_album*.js`（班级相册）那套还没搬进来，见 `docs/项目进度.md` 的待办。
