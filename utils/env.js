// utils/env.js —— 云开发与外部服务配置
// ENV_ID：云开发环境的唯一编号（下面已填好本项目的环境）。
// 填了它，小程序就一定会把请求发到这个环境，不会再去猜「默认环境」。
module.exports = {
  ENV_ID: 'cloud1-d8g6wktjobb841cee',

  // 食谱管理云函数名（改名时这里同步改，云函数目录名也要一致）
  FUNCTION_NAME: 'menuAdmin',
  // 通知公告管理云函数名（改名时这里同步改，云函数目录名也要一致）
  // 班级相册云函数名（改名时这里同步改，云函数目录名也要一致）
  ALBUM_FUNCTION: 'albumAdmin',

  // ===== 园区监控接入配置（详细契约见 docs/monitor-api.md）=====
  // MODE 决定监控数据从哪里来：
  //   'off'   —— 还没接入（默认）：客户端显示「监控正在对接中」，不会发任何请求
  //   'cloud' —— 走云函数（推荐）：在云函数 FUNCTION 里对接萤石云/乐橙等平台，密钥不出服务端
  //   'http'  —— 走自建后端：客户端直接请求 API（需要在小程序后台配置 request 合法域名）
  MONITOR: {
    MODE: 'off',

    // MODE = 'http' 时填后端前缀，例如 'https://api.your-school.com/monitor'
    // 客户端会请求 {API}/cameras 与 {API}/play?id=xxx
    API: '',

    // MODE = 'cloud' 时的云函数名（该函数需实现 cameras / play 两个 action）
    FUNCTION: 'monitor',

    // 页面显示的开放时段文案
    WINDOW_TEXT: '每日 08:00-17:00 开放',

    // 需要鉴权时，家长登录后把令牌写进这个 storage key，
    // 客户端会自动以 Authorization: Bearer <令牌> 发送（详见文档）
    TOKEN_KEY: 'monitor_token'
  }
}
