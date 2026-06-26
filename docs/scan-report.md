# 项目自动巡检报告

> 本文件由「每日项目巡检」定时任务自动维护。每次扫描在最上方新增一节（按日期倒序），
> 记录潜在风险 / Bug 与文档更新项。仅做只读分析 + 维护文档，不改业务代码、不自动提交。
> 严重度：高 = 可能崩溃/听不到声/明显故障；中 = 体验或资源问题；低 = 健壮性/边角情况。

---

> ✅ **已完成（2026-06-26）**：下方 2026-06-26 节列出的 5 项风险/Bug（#1~#5）均已修复并通过独立子 agent 复审（全部 PASS），`vue-cli-service lint` 无新增 error。详见各节末尾的「修复记录」。

---

## 2026-06-26

**扫描范围**：`feat/visualizer` 分支当前工作区（含未提交改动）。重点：3D 可视化歌词相关文件
（`visualizerLyrics.vue`、`TerrainScene.js`、新增 `CoverParticleScene.js`、`AudioAnalyzer.js`、
`settings.vue`、`initLocalStorage.js`）。

### 风险 / Bug

| # | 文件:行号 | 严重度 | 问题 | 建议 |
|---|-----------|--------|------|------|
| 1 | `src/utils/AudioAnalyzer.js:104-126`, `dispose 258-274` | 中 | 全局 `window.yesplaymusic._sharedAudioCtx / _sharedSource / _lastAudioElement` 永不清理。`dispose()` 只把实例字段置 null，全局仍持有已销毁的 `<audio>` 元素与旧 source，反复进出可视化会累积引用、阻碍 GC。AudioContext 复用是有意设计，但 `_lastAudioElement` 长期持有旧元素无必要。 | dispose 时清理 `_lastAudioElement`（保留 ctx 复用）；或在文档中明确该全局状态的生命周期与复用意图。 |
| 2 | `src/views/visualizerLyrics.vue:487-497, 558-588` | 中 | 全屏状态下若直接退出 3D 歌词（`exit()` / Esc 由浏览器处理），`cleanup()` 未调用 `document.exitFullscreen()`，可能残留在浏览器全屏。 | `cleanup()` 中检测 `document.fullscreenElement` 并退出，或在 `exit()` 前归位。 |
| 3 | `src/components/Visualizer/CoverParticleScene.js:330-334` | 低 | `_loadCover` 用 `'https' + url.slice(4)` 强转协议，假设 url 以 `http` 开头；若 picUrl 为协议相对 `//...` 或其它形式会得到错误地址。网易云通常返回 `http://`，影响有限。 | 改用更稳健的协议规整（如正则 `^https?:` 替换 / 处理 `//` 前缀）。 |
| 4 | `src/components/Visualizer/CoverParticleScene.js:157, 350-393` | 中 | 粒子网格 190×190 = 36100 粒子 ×2（主层+辉光层），每次切歌在主线程同步 `getImageData` + 36100 次循环重采样封面，低端机切歌瞬间可能掉帧。 | 可降采样分辨率、或把像素采样移到 `requestIdleCallback` / 分帧处理。 |
| 5 | `src/views/visualizerLyrics.vue:396-418` | 低 | 音频更新 interval 固定 16ms（~60Hz）持续运行，即便场景已被 30fps 限流仍按 60Hz 计算音频数据，存在冗余 CPU 开销。 | 音频采样频率可对齐到场景 `targetFPS`，或合并进场景的 rAF 循环。 |

### 观察 / 可维护性（非缺陷）

- `TerrainScene` 与 `CoverParticleScene` 在帧率限流（`_animate` 中 `_frameInterval` 逻辑）、`_applyViewOffset`、`dispose` 结构上高度重复，可抽取公共基类 / mixin，降低后续维护成本与不一致风险。
- `visualizerLyrics.vue` 的事件监听（keydown/resize/mousemove/fullscreenchange）与多个 timer 在 `cleanup()` 中均已成对移除，`onAudioSourceChanged` 也已 `delete`，未发现监听器泄漏。✔
- 已核实 `TerrainScene.dispose():249` 的 `this.mesh.dispose()` 合法——`this.mesh` 是 `InstancedMesh`（:138），该类型确有 `dispose()`，非缺陷。
- `visualizerType` 默认值三处一致（`initLocalStorage.js` `'terrain'`、`settings.vue` getter 兜底 `'terrain'`、`_buildScene` 判 `'cover'` 否则地形），未发现默认值漂移。✔
- `AudioAnalyzer.init` 对同一 `<audio>` 重复 `createMediaElementSource` 抛错的情况已用 try/catch + `_sharedSource` 兜底；`getImageData` 的 CORS 污染也已 try/catch 处理。✔

### 文档更新

- **CLAUDE.md 漂移（建议补充）**：「3D 可视化歌词」段仅描述 `TerrainScene` 地形场景，未覆盖本分支新增内容：
  - 新增 `CoverParticleScene.js`（封面粒子场景），与 `TerrainScene` 共享 `init/updateAudioData/resize/dispose/setCover` 接口；
  - 新增 `settings.visualizerType`（`'terrain'` | `'cover'`）设置项，由 `visualizerLyrics.vue` 的 `_buildScene` 二选一实例化；
  - `visualizerLyrics.vue` 新增播放控制栏（音量/上一首/播放暂停/下一首/全屏/退出）、滚轮浏览歌词、鼠标静止自动隐藏控制栏等交互。
  - 本次仅记录漂移，未自动改写 CLAUDE.md（属项目核心说明文档，改动留待人工确认）。
- `docs/` 目录目前仅有 `superpowers/` 设计文档，建议后续补一份可视化歌词模块的运行/接口说明（场景接口契约、音频通路、设置项）。

### 小结

本次发现 **5 项风险/Bug**（中 3 / 低 2）、**2 项文档更新建议**；另有 3 条可维护性观察。报告写入 `docs/scan-report.md`。未改动任何业务代码，未提交 git。

### 修复记录（2026-06-26 完成）

5 项风险/Bug 均已修复，并由独立子 agent 逐项复审（结论 PASS），`vue-cli-service lint` 无新增 error（仅剩与本次无关的既有 warning）。

| # | 文件 | 修复要点 |
|---|------|----------|
| 1 | `src/utils/AudioAnalyzer.js` | `dispose()` 末尾清理全局 `_lastAudioElement`（带 `window.yesplaymusic` 守卫），释放对旧 `<audio>` 的引用。保留 `_sharedAudioCtx` 复用与 `_sharedSource` 兜底设计不动——后者是切歌时 `createMediaElementSource` 重复调用抛错后的回退依赖；并在 JSDoc 注明三个全局的生命周期。 |
| 2 | `src/views/visualizerLyrics.vue` | `cleanup()` 检测 `document.fullscreenElement`，存在则 `document.exitFullscreen()` 并 `.catch(() => {})` 吞掉 reject，覆盖退出按钮/组件销毁路径，避免残留浏览器全屏。 |
| 3 | `src/components/Visualizer/CoverParticleScene.js` | `_loadCover` 协议规整改正则：`http://`→`https://`、协议相对 `//`→ 补 `https:`、其余（已 https/相对路径）保持原样；不动 `crossOrigin`/`onload`/`onerror`。 |
| 4 | `src/components/Visualizer/CoverParticleScene.js` | 36100 像素重采样改为分帧 chunking（每帧 32 列，`requestIdleCallback` + `setTimeout` 兜底）；用 `_rebuildToken` 防快速切歌竞态，`dispose` 取消挂起句柄；最终视觉与原实现一致。 |
| 5 | `src/views/visualizerLyrics.vue` | 音频采样 interval 由固定 16ms 改为对齐场景帧率 `_frameInterval`（≈33ms，fallback `1000/30`）；场景已同步构建故取值安全，基于墙钟时间的健康检查不受影响。 |

> 备注：本次仅处理风险/Bug 项；文档更新建议（CLAUDE.md 漂移、可视化模块运行说明）与 3 条可维护性观察留待后续，未在此次范围内。
