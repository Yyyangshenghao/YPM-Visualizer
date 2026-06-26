<br />
<p align="center">
  <img src="images/logo.png" alt="Logo" width="156" height="156">
  <h2 align="center" style="font-weight: 600">YPM Visualizer</h2>
  <p align="center">
    基于 YesPlayMusic 的高颜值第三方网易云播放器<br/>
    新增 Three.js 驱动的 <strong>3D 音频可视化歌词</strong>界面
    <br /><br />
    <a href="#-3d-可视化歌词"><strong>✨ 查看 3D 效果</strong></a>&nbsp;&nbsp;|&nbsp;&nbsp;
    <a href="#️-安装"><strong>📦 下载安装</strong></a>&nbsp;&nbsp;|&nbsp;&nbsp;
    <a href="#-开发环境"><strong>🛠 本地开发</strong></a>
  </p>
</p>

---

## ✨ 3D 可视化歌词

> 在原版歌词界面基础上，新增沉浸式 3D 音频可视化模式。

![3D Visualizer](images/visualizer.jpg)

| 功能 | 说明 |
|------|------|
| 🏔 地形音频场景 | 80×80 InstancedMesh 地形网格，随音频频谱实时起伏 |
| 🎨 自定义着色器 | GLSL 顶点/片段着色器，颜色随节奏动态变化 |
| 📝 3D 歌词悬浮 | CSS3DRenderer 渲染歌词，以 3D 透视漂浮在场景中 |
| 🎥 自动漫游镜头 | 摄像机自动漫游，沉浸式体验，无需手动操作 |
| 🔄 模式无缝切换 | 设置中一键切换经典歌词 / 3D 可视化，互不影响 |
| ⌨️ 快捷键支持 | Space 播放暂停，← → 切歌，Esc 退出，点击歌词跳转 |

---

## 🎵 播放器特性

继承自 [YesPlayMusic](https://github.com/qier222/YesPlayMusic) 的全部功能：

- 🔴 网易云账号登录（扫码 / 手机 / 邮箱）
- 📺 MV 播放
- 📃 歌词显示（经典模式 + 3D 可视化模式）
- 📻 私人 FM / 每日推荐
- 🌎 海外用户直接播放（需登录网易云账号）
- 🔐 [UnblockNeteaseMusic](https://github.com/UnblockNeteaseMusic/server) 自动解灰变灰歌曲
- 🌚 Light / Dark 自动切换
- 👆 Touch Bar 支持
- 🖥 PWA 支持
- 🟥 Last.fm Scrobble
- ☁️ 音乐云盘
- ⌨️ 自定义快捷键 / 全局快捷键
- 🎧 Mpris 支持

---

## 🖼️ 截图

> 播放器主界面截图

[![library](images/library.png)](images/library.png)

<details>
<summary>更多截图</summary>

![lyrics](images/lyrics.png)
![library-dark](images/library-dark.png)
![album](images/album.png)
![home](images/home.png)
![explore](images/explore.png)
![artist](images/artist.png)
![search](images/search.png)

</details>

---

## 📦️ 安装

支持 macOS、Windows、Linux。

前往 [Releases](https://github.com/Yyyangshenghao/YPM-Visualizer/releases) 页面下载对应平台的安装包。

> 注：当前 3D 可视化功能在 `feat/visualizer` 分支开发中，Release 包以 master 分支为准。如需体验 3D 功能，请参考下方本地开发章节。

---

## 🛠 开发环境

需要 Node.js 14 或 16（见 `.nvmrc`）。

```sh
# 安装依赖
yarn install

# 创建本地环境变量
cp .env.example .env

# 网页端开发（需另开终端跑 API）
yarn serve                # 开发服务器，端口见 .env 的 DEV_SERVER_PORT
yarn netease_api:run      # 网易云 API，端口 3000

# Electron 桌面端开发（内置 API，无需单独启动）
yarn electron:serve
```

也可使用交互式脚本：

```sh
./dev.sh
```

---

## 📦 打包

```sh
yarn build              # 构建 Web 产物到 dist/
yarn electron:build-mac # 打包 macOS，产物在 dist_electron/
```

| 命令 | 说明 |
|------|------|
| `yarn electron:build --windows nsis:ia32` | Windows 32 位 |
| `yarn electron:build --windows nsis:arm64` | Windows ARM |
| `yarn electron:build --linux deb:armv7l` | Debian armv7l |
| `yarn electron:build --macos dir:arm64` | macOS ARM |

---

## ⚙️ 部署至 Vercel

1. 部署网易云 API：[Binaryify/NeteaseCloudMusicApi](https://neteasecloudmusicapi.vercel.app)

2. Fork 本仓库，在仓库根目录新建 `vercel.json`：

```json
{
  "rewrites": [
    {
      "source": "/api/:match*",
      "destination": "https://your-netease-api.example.com/:match*"
    }
  ]
}
```

3. 在 [Vercel](https://vercel.com) 导入仓库，设置环境变量 `VUE_APP_NETEASE_API_URL` 为 `/api`，部署即可。

---

## 🙏 致谢

本项目基于以下开源项目构建：

- [qier222/YesPlayMusic](https://github.com/qier222/YesPlayMusic) — 播放器主体，MIT License
- [Binaryify/NeteaseCloudMusicApi](https://github.com/Binaryify/NeteaseCloudMusicApi) — 网易云 API
- [Three.js](https://threejs.org) — 3D 渲染引擎
- [Howler.js](https://howlerjs.com) — 音频播放

---

## 📜 开源许可

本项目仅供个人学习研究使用，禁止用于商业及非法用途。

基于 [MIT License](LICENSE) 开源。
