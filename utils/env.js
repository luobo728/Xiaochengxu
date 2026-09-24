// utils/env.js —— 云开发环境配置
// ENV_ID 留空时会使用当前账号的「默认环境」（第一个创建的环境）；
// 如果账号下有多个环境，请把目标环境 ID 填进来（形如 cloud1-0gxxxxxx）。
module.exports = {
  ENV_ID: '',

  // 食谱管理云函数名（改名时这里同步改，云函数目录名也要一致）
  FUNCTION_NAME: 'menuAdmin'
}
