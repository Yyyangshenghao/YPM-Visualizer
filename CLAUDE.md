# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

YesPlayMusic 是一个第三方网易云音乐播放器，同一份代码同时构建为**浏览器 PWA** 和 **Electron 桌面应用**。

## 常用命令

```sh
yarn install            # 安装依赖（Node 14 或 16，见 .nvmrc）
cp .env.example .env    # 首次需要创建本地环境变量

# 浏览器开发：需另开终端跑 API（见下）
yarn serve              # 端口由 .env 的 DEV_SERVER_PORT 决定（当前为 20201，非默认 8080）
yarn netease_api:run    # 启动网易云 API，端口 3000，被 dev-server 的 /api 代理

# Electron 开发：内置 API，无需单独启动
yarn electron:serve     # 自动在 10754 端口内嵌启动网易云 API

yarn lint               # ESLint
yarn prettier           # 格式化 src/（husky pre-commit 会自动跑）

yarn build              # 构建 Web 产物到 dist/
yarn electron:build-mac # 打包桌面端，另有 -win / -linux / -all，产物在 dist_electron/

./dev.sh                # 交互式菜单，封装了上述开发/打包命令
```

- 仓库**没有测试套件**（package.json 无 test 脚本）。
- 构建脚本里的 `NODE_OPTIONS=--openssl-legacy-provider` 是必需的（webpack 4 + 新版 Node 的 OpenSSL 兼容问题），改命令时不要丢掉。

## 架构要点

**双构建目标**：所有平台差异通过 `process.env.IS_ELECTRON`（仅 Electron 构建中被 webpack 定义）分支。浏览器端用 history 路由，Electron 端用 hash 路由（见 `src/router/index.js`）。新增涉及桌面/浏览器差异的代码时务必用此标志守卫。

**播放器核心 `src/utils/Player.js`**：一个约 30KB 的单例类，基于 Howler.js 管理整个播放流程（播放列表、私人 FM、随机/循环、歌词、scrobble 等）。它在 `src/store/index.js` 中实例化一次，并被 `Proxy` 包裹——**每次属性写入都会自动持久化到 localStorage，并在 Electron 下通过 IPC 同步到主进程**。可通过 `store.state.player` 和 `window.yesplaymusic.player` 访问。

**状态管理**：Vuex（`src/store/`，state/mutations/actions 分文件）。设置项存在 localStorage 并镜像进 Vuex，`store/plugins/localStorage` 在 mutation 时写回。

**网易云 API 接入**（这是最容易踩坑的部分）：
- `src/api/*` 是对 `src/utils/request.js`（axios 实例）的薄封装，baseURL 按 `IS_ELECTRON` 切换。
- **浏览器**：请求打到 `/api`（`VUE_APP_NETEASE_API_URL`），dev-server 把 `/api` 代理到 `localhost:3000`（即 `yarn netease_api:run` 跑的 `@neteaseapireborn/api`）。
- **Electron**：`src/background.js` 在主进程内嵌启动 API（`src/electron/services.js`，端口 10754，含匿名 token 注册 + 随机中国 IP 以规避风控）；同时起一个 Express（端口 27232）既托管打包后的渲染进程，又把 `/api` 代理到 10754。渲染进程开发时直连 `VUE_APP_ELECTRON_API_URL_DEV`（10754）。
- `src/ncmModDef.js` 白名单式声明 Electron 内嵌 API 加载哪些模块。

**Electron 主进程层**：`src/background.js`（`Background` 类，管理窗口/单例锁/更新/代理）+ `src/electron/*`（ipcMain↔ipcRenderer 桥、tray、menu、touchBar、mpris、globalShortcut）。窗口配置为 `nodeIntegration: true` + `contextIsolation: false`，因此渲染进程直接用 `window.require('electron')`。

**本地缓存**：`src/utils/db.js` 用 Dexie/IndexedDB 缓存歌曲音频（仅 Electron）、歌曲详情、歌词、专辑，并按 `settings.cacheLimit` 清理超额缓存。

**视图与歌词浮层**：`src/views/*` 为路由页面，`src/components/*` 为共享组件。注意 **`lyrics.vue` 和 `visualizerLyrics.vue` 不是路由**，而是 `App.vue` 中的全屏浮层，由 `showLyrics` 控制显隐，并按 `settings.lyricsMode`（`'visualizer'` 与否）二选一渲染。

**3D 可视化歌词**（当前 `feat/visualizer` 分支）：基于 three.js 的音频反应地形场景。`src/utils/AudioAnalyzer.js` 通过 Web Audio 的 `createMediaElementSource` 接到 Howler 的 `<audio>` 元素上，结构为 `source → GainNode（永久连接 destination）→ AnalyserNode`，因此**切歌时只换上游 source，音频通路不中断**。渲染逻辑在 `src/components/Visualizer/{TerrainScene,shaders}.js`，设计文档在 `docs/superpowers/`。

**解灰**：`@unblockneteasemusic/rust-napi`（原生 `.node` 模块，经 node-loader 加载、在 electron-builder 中 externalize）用于替换变灰歌曲的播放链接。

## 约定

- Prettier 经 husky pre-commit 强制执行：单引号、带分号、2 空格、`arrowParens: avoid`、`trailingComma: es5`。
- 多语言用 vue-i18n（`src/locale`）；SVG 图标经 svg-sprite-loader 从 `src/assets/icons` 注入。
- node_modules 被 esbuild-loader 转译到 ES2015（webpack 4 无法解析较新语法），见 `vue.config.js`。
