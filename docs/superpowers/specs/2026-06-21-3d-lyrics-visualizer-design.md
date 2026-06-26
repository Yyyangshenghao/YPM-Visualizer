# 3D 歌词可视化 — 设计文档

**日期**: 2026-06-21
**状态**: 设计确认，待实现

---

## 1. 概述

为 YesPlayMusic 新增一个 3D 音频驱动的歌词可视化模式，灵感来自 sonic-topography 项目。使用 Three.js 渲染 80×80 地形网格，通过 Web Audio API 频谱分析驱动柱子高度和颜色变化，歌词文字以 CSS3DRenderer 内嵌 3D 场景中。

### 核心特性

- 80×80 InstancedMesh 地形网格，自定义 GLSL 着色器
- 音频频谱驱动地形高度、颜色、波纹效果
- CSS3DRenderer 渲染歌词文字，3D 透视漂浮
- 摄像机自动漫游，极简沉浸式体验
- 与现有歌词页通过设置切换，互不影响

---

## 2. 用户交互

### 键盘快捷键
- **Esc** — 退出 3D 歌词页，回到主界面
- **Space** — 播放/暂停
- **← →** — 上一首/下一首

### 鼠标
- **点击歌词行** — 跳转到该时间点
- 不提供拖拽旋转（保持自动漫游纯净体验）

### 设置入口
- 在 `settings.vue` 的「歌词」区域新增「歌词显示模式」选项
- 选项：`经典` / `3D 可视化`
- 存储于 `settings.lyricsMode`，默认 `'classic'`

---

## 3. 架构

```
Vue 2 App
├── settings.vue ──toggle──▶ settings.lyricsMode
├── App.vue ──if 'visualizer'──▶ VisualizerLyrics.vue (新组件)
│       │
│       ├── TerrainScene.js (Three.js 场景管理)
│       │   ├── InstancedMesh (80×80 地形柱)
│       │   ├── Custom ShaderMaterial (GLSL 顶点/片段着色器)
│       │   └── OrbitControls (autoRotate 自动漫游)
│       │
│       ├── LyricsPlane.js (CSS3D 歌词文字层)
│       │
│       └── AudioAnalyzer.js (Web Audio 频谱分析)
│           └── 从 Howler.js 内部获取 AudioContext
│
└── Player.js (Howler.js) — 暴露 AudioContext 节点
```

---

## 4. 文件变更清单

### 新增文件
| 文件 | 说明 |
|------|------|
| `src/views/visualizerLyrics.vue` | 3D 歌词页主组件，管理生命周期 |
| `src/components/Visualizer/TerrainScene.js` | Three.js 场景初始化、地形网格、渲染循环 |
| `src/components/Visualizer/LyricsPlane.js` | CSS3DRenderer 歌词文字层 |
| `src/components/Visualizer/shaders.js` | GLSL 顶点着色器 + 片段着色器 |
| `src/utils/AudioAnalyzer.js` | Web Audio API 频谱分析，输出频段 + 音色指标 |

### 修改文件
| 文件 | 变更内容 |
|------|---------|
| `src/utils/Player.js` | 暴露 `_howler` 的 AudioContext 节点，供 AudioAnalyzer 连接 |
| `src/store/initLocalStorage.js` | 新增 `lyricsMode: 'classic'` 设置项 |
| `src/views/settings.vue` | 新增歌词模式切换选项 |
| `src/App.vue` | 条件渲染两种歌词模式 |
| `package.json` | 新增 `three` 依赖 |

---

## 5. 数据流

### 音频 → 地形
```
Howler.js 播放
  → AudioContext.createAnalyser() (FFT 1024, 512 bins)
  → getByteFrequencyData() 每帧读取
  → 8 频段: subBass, bass, lowMid, mid, highMid, presence, brilliance, air
  → 6 音色指标: warmth, brightness, sharpness, smoothness, density, spectralCentroid
  → 指数平滑 (dt=0.15)
  → GLSL uniforms → 驱动地形高度 + 颜色
```

### 播放进度 → 歌词
```
Player._progress (seek)
  → findIndex() 匹配歌词时间戳
  → 当前行索引
  → CSS3D Plane 更新高亮行
  → 歌词行平滑滚动
```

---

## 6. 技术细节

### 6.1 地形网格
- 80×80 = 6400 个 BoxGeometry 实例，通过 InstancedMesh 单次 draw call
- 顶点着色器：Simplex noise 空闲地形 + 6 频段驱动高度 + 波纹位移 + 边缘衰减
- 片段着色器：高度→颜色映射 + 暖/冷色调 + 音色效果（flicker, edge glow）+ 大气雾
- 每个柱子宽 1 单位，间距 1.5 单位，总地形约 120×120 单位

### 6.2 歌词文字
- CSS3DRenderer 独立渲染层，叠加在 WebGL canvas 之上
- 歌词以 HTML 元素渲染，保持清晰锐利（不受 WebGL 纹理分辨率限制）
- 3D 透视变换：rotateX(20deg) 模拟漂浮在地形上方
- 当前行：白色，字号放大，text-shadow 发光效果
- 前后行：半透明灰色，字号递减，创造深度感
- 设置中可调字体大小（复用 `settings.lyricFontSize`）

### 6.3 音频分析
- 从 Howler.js 的 `_howler._sounds[0]._node` 获取 AudioNode
- 创建 AnalyserNode 连接到同一 AudioContext
- FFT size 1024，产生 512 个频率 bin
- 频段划分参考 sonic-topography 的映射
- 指数平滑避免柱子抖动，播放时 dt=0.15，暂停时 dt=0.035

### 6.4 摄像机
- OrbitControls 配置 autoRotate=true，速度 0.3
- 初始位置：俯角 45°，距离 80 单位
- 限制：minDistance=40, maxDistance=120, maxPolarAngle=PI/2.2
- 无用户手动交互

### 6.5 颜色主题
- 复用 sonic-topography 的 4 套主题：Nocturnal（蓝紫）、Neon Tokyo（粉青）、Cyber Forest（绿）、Minimal Monochrome（银白）
- 默认使用 Nocturnal，与 YesPlayMusic 的深色主题协调
- 后续可扩展为与 app 主题色联动

---

## 7. 性能考量

| 场景 | 帧率预期 | 说明 |
|------|---------|------|
| 集成显卡 / 低配 | 30-45 FPS | 6400 实例 + 简化着色器 |
| 独立显卡 / 中配 | 55-60 FPS | 流畅运行 |
| 独立显卡 / 高配 | 60 FPS | 无压力 |

- Three.js 仅在歌词页打开时初始化，关闭时 `dispose()` 释放 GPU 资源
- CSS3DRenderer 元素数量少（仅可见歌词行），不影响性能
- 不影响主界面性能

---

## 8. 依赖

| 依赖 | 版本 | 说明 |
|------|------|------|
| three | ^0.170 | 核心 3D 渲染库，约 600KB gzipped |
| vue | 2.6 (现有) | 无变更 |
| howler | 2.2 (现有) | 无变更，通过内部 API 获取 AudioContext |

---

## 9. 风险与缓解

| 风险 | 缓解 |
|------|------|
| Howler.js 内部 API 变更导致无法获取 AudioContext | 创建独立的 AudioContext + MediaElementSource，不依赖 Howler 内部 |
| Three.js 在 Electron 中 WebGL 兼容性 | 测试 Electron 环境，必要时降级 WebGL 特性 |
| 低配机器性能不足 | 提供 50×50 降级网格选项，或自动检测帧率降级 |
| 歌词文字 CSS3D 与 WebGL 深度排序冲突 | CSS3DRenderer 始终在最上层渲染，不存在深度冲突 |

---

## 10. 验收标准

1. 在设置中切换「3D 可视化」模式后，打开歌词页显示 3D 地形
2. 地形随音乐节奏动态变化（高度、颜色、波纹）
3. 歌词文字正确显示当前行高亮，随播放进度滚动
4. 点击歌词行可跳转
5. Esc 可退出，Space 可播放/暂停
6. 切换回「经典」模式后，原有歌词页正常显示
7. 关闭歌词页后 Three.js 资源正确释放
8. Electron 环境下正常运行