# 3D 歌词可视化 — 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 YesPlayMusic 新增 3D 音频驱动地形 + 歌词可视化模式

**Architecture:** Three.js 原生 API 渲染 80×80 InstancedMesh 地形 + 自定义 GLSL 着色器。Web Audio API 通过 MediaElementAudioSourceNode 从 Howler.js 的 HTMLAudioElement 捕获音频做频谱分析。歌词文字用 Vue 模板 + CSS 3D 透视变换渲染，叠加在 WebGL canvas 上方。摄像机自动漫游。

**Tech Stack:** Three.js ^0.170, Vue 2.6, Howler.js, Web Audio API, GLSL

---

## 文件结构

| 文件 | 职责 |
|------|------|
| `src/utils/AudioAnalyzer.js` | Web Audio API 频谱分析，输出频段 + 音色指标 |
| `src/components/Visualizer/shaders.js` | GLSL 顶点着色器 + 片段着色器字符串 |
| `src/components/Visualizer/TerrainScene.js` | Three.js 场景初始化、InstancedMesh 地形、渲染循环、摄像机控制 |
| `src/views/visualizerLyrics.vue` | Vue 组件：Three.js 场景容器 + CSS 3D 歌词层 + 键盘事件 |

---

### Task 1: 安装 Three.js 依赖

**Files:**
- Modify: `package.json`

- [ ] **Step 1: 安装 three**

```bash
cd /Users/yangshenghao/github/YesPlayMusic && yarn add three@^0.170.0
```

Expected: 成功安装 three 到 dependencies

---

### Task 2: 创建 AudioAnalyzer.js

**Files:**
- Create: `src/utils/AudioAnalyzer.js`

- [ ] **Step 1: 创建文件**

```javascript
// src/utils/AudioAnalyzer.js

/**
 * Web Audio API 频谱分析器。
 * 从 HTMLAudioElement 创建 MediaElementAudioSourceNode，
 * 输出 8 个频段能量 + 6 个音色指标。
 */
export class AudioAnalyzer {
  constructor() {
    /** @type {AudioContext|null} */
    this.audioCtx = null;
    /** @type {AnalyserNode|null} */
    this.analyser = null;
    /** @type {MediaElementAudioSourceNode|null} */
    this.source = null;
    /** @type {Uint8Array} */
    this.dataArray = new Uint8Array(0);

    this.isPlaying = false;

    // 平滑后的输出数据
    this.smoothedData = {
      subBass: 0, bass: 0, lowMid: 0, mid: 0,
      highMid: 0, presence: 0, brilliance: 0, air: 0,
      warmth: 0, brightness: 0, sharpness: 0,
      smoothness: 0, density: 0, spectralCentroid: 0,
      energy: 0,
    };

    // 上一帧频谱数据（用于计算变化率）
    this.prevData = new Array(512).fill(0);
    this.prevBrightness = 0;
  }

  /**
   * 初始化 AudioContext 并连接到指定的 HTMLAudioElement。
   * 每次音源切换时需重新调用。
   * @param {HTMLAudioElement} audioElement
   */
  init(audioElement) {
    if (!audioElement) return;

    if (!this.audioCtx) {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      this.audioCtx = new AudioContext();
      this.analyser = this.audioCtx.createAnalyser();
      this.analyser.fftSize = 1024;
      this.analyser.smoothingTimeConstant = 0.8;
      this.dataArray = new Uint8Array(this.analyser.frequencyBinCount);
    }

    if (this.audioCtx.state === 'suspended') {
      this.audioCtx.resume();
    }

    // 断开旧 source
    if (this.source) {
      this.source.disconnect();
      this.source = null;
    }

    try {
      this.source = this.audioCtx.createMediaElementSource(audioElement);
      this.source.connect(this.analyser);
      // 必须连接到 destination 才能听到声音
      this.analyser.connect(this.audioCtx.destination);
    } catch (e) {
      // 如果该 audio element 已经被连接过，忽略错误
      console.warn('[AudioAnalyzer] MediaElementSource already connected:', e);
    }
  }

  /** 标记为播放中 */
  play() {
    this.isPlaying = true;
    if (this.audioCtx?.state === 'suspended') {
      this.audioCtx.resume();
    }
  }

  /** 标记为暂停 */
  pause() {
    this.isPlaying = false;
  }

  /**
   * 每帧调用，返回平滑后的音频数据。
   * @returns {Object} 包含 8 频段 + 6 音色指标
   */
  getAudioData() {
    if (!this.analyser) {
      return { ...this.smoothedData };
    }

    const binCount = this.dataArray.length; // 512
    let energySum = 0;
    let centroidNum = 0;
    let centroidDen = 0;
    let subBassSum = 0, bassSum = 0, lowMidSum = 0, midSum = 0;
    let highMidSum = 0, presenceSum = 0, brillianceSum = 0, airSum = 0;
    let jumpVolatilitySum = 0;

    if (this.isPlaying) {
      this.analyser.getByteFrequencyData(this.dataArray);

      for (let i = 0; i < binCount; i++) {
        const val = this.dataArray[i] / 255.0;
        energySum += val;
        centroidNum += i * val;
        centroidDen += val;

        const prevVal = this.prevData[i] || 0;
        jumpVolatilitySum += Math.abs(val - prevVal);
        this.prevData[i] = val;

        if (i <= 1) subBassSum += val;
        else if (i <= 3) bassSum += val;
        else if (i <= 7) lowMidSum += val;
        else if (i <= 18) midSum += val;
        else if (i <= 46) highMidSum += val;
        else if (i <= 93) presenceSum += val;
        else if (i <= 186) brillianceSum += val;
        else if (i <= 372) airSum += val;
      }
    } else {
      // 暂停时衰减
      for (let i = 0; i < binCount; i++) {
        this.dataArray[i] = Math.floor(this.dataArray[i] * 0.94);
        this.prevData[i] = 0;
      }
    }

    const energy = energySum / binCount;
    const subBass = subBassSum / 2;
    const bass = bassSum / 2;
    const lowMid = lowMidSum / 4;
    const mid = midSum / 11;
    const highMid = highMidSum / 28;
    const presence = presenceSum / 47;
    const brilliance = brillianceSum / 93;
    const air = airSum / 186;

    const warmth = energySum > 0
      ? (subBassSum + bassSum + lowMidSum + midSum) / energySum
      : 0;
    const brightness = energySum > 0
      ? (presenceSum + brillianceSum + airSum) / energySum
      : 0;
    const sharpness = Math.max(0, brightness - this.prevBrightness) * 10;
    this.prevBrightness = brightness;
    const smoothnessVal = Math.max(0, 1.0 - (jumpVolatilitySum / binCount) * 2.0);

    const activeThreshold = energy * 1.5;
    let activeBands = 0;
    if (subBass > activeThreshold) activeBands++;
    if (bass > activeThreshold) activeBands++;
    if (lowMid > activeThreshold) activeBands++;
    if (mid > activeThreshold) activeBands++;
    if (highMid > activeThreshold) activeBands++;
    if (presence > activeThreshold) activeBands++;
    if (brilliance > activeThreshold) activeBands++;
    if (air > activeThreshold) activeBands++;
    const density = activeBands / 8;
    const spectralCentroid = centroidDen > 0 ? centroidNum / centroidDen : 0;

    // 指数平滑
    const hasAudio = this.isPlaying && energySum > 0;
    const dt = hasAudio ? 0.15 : 0.035;

    const s = this.smoothedData;
    s.subBass += (subBass - s.subBass) * dt;
    s.bass += (bass - s.bass) * dt;
    s.lowMid += (lowMid - s.lowMid) * dt;
    s.mid += (mid - s.mid) * dt;
    s.highMid += (highMid - s.highMid) * dt;
    s.presence += (presence - s.presence) * dt;
    s.brilliance += (brilliance - s.brilliance) * dt;
    s.air += (air - s.air) * dt;
    s.warmth += (warmth - s.warmth) * dt;
    s.brightness += (brightness - s.brightness) * dt;
    s.sharpness += (sharpness - s.sharpness) * dt;
    s.smoothness += (smoothnessVal - s.smoothness) * dt;
    s.density += (density - s.density) * dt;
    s.spectralCentroid += (spectralCentroid - s.spectralCentroid) * dt;
    s.energy += (energy - s.energy) * dt;

    return { ...s };
  }

  /**
   * 释放所有资源。
   */
  dispose() {
    if (this.source) {
      this.source.disconnect();
      this.source = null;
    }
    if (this.analyser) {
      this.analyser.disconnect();
      this.analyser = null;
    }
    if (this.audioCtx) {
      this.audioCtx.close();
      this.audioCtx = null;
    }
  }
}

export default AudioAnalyzer;
```

---

### Task 3: 创建着色器文件

**Files:**
- Create: `src/components/Visualizer/shaders.js`

- [ ] **Step 1: 创建文件**

```javascript
// src/components/Visualizer/shaders.js

/**
 * 顶点着色器：Simplex noise 空闲地形 + 6 频段音频驱动高度 + 波纹位移 + 边缘衰减
 */
export const vertexShader = /* glsl */ `
  uniform float uTime;
  uniform float uSubBass;
  uniform float uBass;
  uniform float uLowMid;
  uniform float uMid;
  uniform float uHighMid;
  uniform float uSmoothness;
  uniform float uDensity;
  uniform float uEnergy;

  varying vec2 vUv;
  varying float vElevation;
  varying float vDistance;
  varying vec3 vNormal;
  varying float vRelativeY;
  varying vec2 vInstancePos;

  // Simplex 3D noise
  vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
  vec2 mod289(vec2 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
  vec3 permute(vec3 x) { return mod289(((x*34.0)+1.0)*x); }

  float snoise(vec2 v) {
    const vec4 C = vec4(0.211324865405187, 0.366025403784439, -0.577350269189626, 0.024390243902439);
    vec2 i  = floor(v + dot(v, C.yy));
    vec2 x0 = v - i + dot(i, C.xx);
    vec2 i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
    vec4 x12 = x0.xyxy + C.xxzz; x12.xy -= i1;
    i = mod289(i);
    vec3 p = permute(permute(i.y + vec3(0.0, i1.y, 1.0)) + i.x + vec3(0.0, i1.x, 1.0));
    vec3 m = max(0.5 - vec3(dot(x0,x0), dot(x12.xy,x12.xy), dot(x12.zw,x12.zw)), 0.0);
    m = m*m; m = m*m;
    vec3 x = 2.0 * fract(p * C.www) - 1.0;
    vec3 h = abs(x) - 0.5;
    vec3 ox = floor(x + 0.5);
    vec3 a0 = x - ox;
    m *= 1.79284291400159 - 0.85373472095314 * (a0*a0 + h*h);
    vec3 g;
    g.x = a0.x * x0.x + h.x * x0.y;
    g.yz = a0.yz * x12.xz + h.yz * x12.yw;
    return 130.0 * dot(m, g);
  }

  float random(vec2 st) {
    return fract(sin(dot(st.xy, vec2(12.9898, 78.233))) * 43758.5453123);
  }

  void main() {
    vUv = uv;
    vNormal = normal;

    vec4 instancePos = instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
    vec2 pos2D = instancePos.xz;
    vInstancePos = pos2D;

    float centerDist = length(pos2D);
    vDistance = centerDist;

    float rnd = random(pos2D);

    // 1. 空闲地形
    vec2 movingPos = pos2D * 0.05 + vec2(uTime * 0.1, uTime * 0.05);
    float baseNoise = (snoise(movingPos) + 1.0) * 0.5;
    float wave = sin(pos2D.x * 0.15 + pos2D.y * 0.1 - uTime * 0.6) * 0.5 + 0.5;
    float globalFalloff = smoothstep(60.0, 30.0, centerDist);
    float idleElevation = mix(baseNoise, wave, uSmoothness * 0.5 + 0.2) * 0.8 * globalFalloff;

    // 2. 音频驱动高度
    // Sub-Bass: 中心隆起
    float subRegion = smoothstep(25.0, 0.0, centerDist);
    float subLift = uSubBass * subRegion * 5.0;

    // Bass: 块状隆起
    float bassNoise = snoise(pos2D * 0.1 - vec2(0.0, uTime * 0.2));
    float bassRegion = smoothstep(35.0, 5.0, centerDist + bassNoise * 5.0);
    float bassLift = uBass * bassRegion * smoothstep(0.0, 1.0, rnd + uDensity * 0.5) * 4.0;

    // Low Mid: 流动波浪
    float lowMidNoise = snoise(pos2D * 0.05 + vec2(uTime * 0.1, 0.0));
    float lowMidLift = uLowMid * (lowMidNoise * 0.5 + 0.5) * 2.5;

    // Mid: 河流状对角线
    float riverFlow = sin(pos2D.x * 0.2 + pos2D.y * 0.2 + snoise(pos2D * 0.1) * 2.0 - uTime * 2.0);
    float midLift = uMid * max(0.0, riverFlow) * 3.0;

    // High Mid: 随机尖刺
    float highMidRegion = smoothstep(10.0, 45.0, centerDist);
    float highMidLift = 0.0;
    if (fract(rnd * 13.3) > 0.8) {
      highMidLift = uHighMid * highMidRegion * fract(rnd * 7.7) * 2.5;
    }

    float audioElevation = subLift + bassLift + lowMidLift + midLift + highMidLift;

    // 能量尖峰
    if (rnd > 0.99) {
      audioElevation += uEnergy * 5.0;
    }

    audioElevation *= globalFalloff;
    float elevation = idleElevation + audioElevation;
    vElevation = elevation;

    float yPos = position.y + 0.5;
    vRelativeY = yPos;

    float totalHeight = 1.0 + elevation;
    vec3 pos = position;
    pos.y = -0.5 + yPos * totalHeight;

    vec4 worldPosition = instanceMatrix * vec4(pos, 1.0);
    gl_Position = projectionMatrix * viewMatrix * worldPosition;
  }
`;

/**
 * 片段着色器：高度→颜色映射 + 暖/冷色调 + 音色效果 + 大气雾
 */
export const fragmentShader = /* glsl */ `
  uniform float uTime;
  uniform float uPresence;
  uniform float uBrilliance;
  uniform float uAir;
  uniform float uWarmth;
  uniform float uBrightness;
  uniform float uSharpness;
  uniform float uGlowIntensity;

  uniform vec3 uBaseColor1;
  uniform vec3 uBaseColor2;
  uniform vec3 uCoolCore;
  uniform vec3 uCoolEdge;
  uniform vec3 uWarmCore;
  uniform vec3 uWarmEdge;

  varying vec2 vUv;
  varying float vElevation;
  varying float vDistance;
  varying vec3 vNormal;
  varying float vRelativeY;
  varying vec2 vInstancePos;

  float random(vec2 st) {
    return fract(sin(dot(st.xy, vec2(12.9898, 78.233))) * 43758.5453123);
  }

  void main() {
    bool isTop = vNormal.y > 0.5;
    float distFromTop = 1.0 - vRelativeY;
    float rnd = random(vInstancePos);
    float centerDist = length(vInstancePos);
    float normElevation = clamp(vElevation / 8.0, 0.0, 1.0);

    vec3 cBase1 = uBaseColor1;
    vec3 cBase2 = uBaseColor2;

    // 暖/冷色调混合
    float warmBlend = smoothstep(0.0, 1.0, uWarmth * 1.5 + (0.5 - centerDist / 80.0));
    vec3 zoneCore = mix(uCoolCore, uWarmCore, warmBlend);
    vec3 zoneEdge = mix(uCoolEdge, uWarmEdge, warmBlend);
    vec3 targetGlow = mix(zoneCore, zoneEdge, fract(rnd * 11.0));

    float distFade = 1.0 - smoothstep(40.0, 75.0, centerDist);
    targetGlow = mix(targetGlow, vec3(0.4, 0.8, 1.0), uBrightness * 0.6);

    vec3 currentGlow = mix(cBase2, targetGlow, normElevation) * uGlowIntensity * distFade;
    vec3 bodyColor = mix(cBase1, cBase2, vRelativeY * distFade);
    vec3 finalColor;

    if (isTop) {
      float topIntensity = smoothstep(0.0, 0.4, normElevation);

      // 地面闪烁 (Air)
      float twinkleDistFalloff = smoothstep(60.0, 30.0, centerDist);
      float twinkleMultiplier = mix(twinkleDistFalloff, 1.0, smoothstep(0.01, 0.1, normElevation));
      bool isSparkleTarget = fract(rnd * 31.0) > 0.95;
      if (isSparkleTarget && normElevation < 0.1) {
        topIntensity += uAir * 2.0 * twinkleMultiplier;
      }

      finalColor = mix(cBase2, currentGlow, topIntensity);

      // 顶面边缘发光
      float edgeX = smoothstep(0.05, 0.01, vUv.x) + smoothstep(0.95, 0.99, vUv.x);
      float edgeY = smoothstep(0.05, 0.01, vUv.y) + smoothstep(0.95, 0.99, vUv.y);
      float edge = min(edgeX + edgeY, 1.0);
      finalColor += currentGlow * edge * 0.8 * (topIntensity + 0.3);

      // Presence 闪烁
      float flashChance = smoothstep(0.3, 1.0, uPresence);
      if (fract(rnd * 53.0) > 0.98 - flashChance * 0.1) {
        float flashSync = sin(uTime * 40.0 + rnd * 100.0) * 0.5 + 0.5;
        finalColor += mix(vec3(1.0), vec3(0.5, 1.0, 1.0), rnd) * flashSync * uPresence * (1.0 + uSharpness * 2.0) * twinkleMultiplier;
      }

      // Brilliance 微火花
      if (edge > 0.5 && fract(rnd * 89.0 + uTime * 2.0) > 0.98) {
        finalColor += vec3(1.0) * uBrilliance * 3.0 * twinkleMultiplier;
      }
    } else {
      // 侧面
      float verticalFalloff = mix(1.0, 3.0, uSharpness);
      float sideGlow = smoothstep(0.5 / verticalFalloff, 0.0, distFromTop) * normElevation;
      if (normElevation < 0.02) sideGlow = 0.0;
      finalColor = mix(bodyColor, currentGlow, sideGlow * 1.5);

      // 顶部边缘
      float rimGlow = smoothstep(0.03, 0.0, distFromTop) * normElevation;
      finalColor += currentGlow * rimGlow;
    }

    // 大气雾
    float aerialFog = smoothstep(30.0, 65.0, vDistance);
    vec3 atmosphericColor = mix(cBase1, cBase2, 0.4);
    finalColor = mix(finalColor, atmosphericColor, aerialFog * 0.5);

    // 边缘 alpha 淡出
    float alphaFade = 1.0 - smoothstep(55.0, 78.0, vDistance);

    gl_FragColor = vec4(finalColor, alphaFade);
  }
`;
```

---

### Task 4: 创建 TerrainScene.js

**Files:**
- Create: `src/components/Visualizer/TerrainScene.js`

- [ ] **Step 1: 创建文件**

```javascript
// src/components/Visualizer/TerrainScene.js
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { vertexShader, fragmentShader } from './shaders';

// Nocturnal 主题颜色
const THEME = {
  baseColor1: new THREE.Color(0.01, 0.02, 0.04),
  baseColor2: new THREE.Color(0.03, 0.05, 0.09),
  coolCore: new THREE.Color(0.0, 0.3, 1.0),
  coolEdge: new THREE.Color(0.6, 0.2, 1.0),
  warmCore: new THREE.Color(1.0, 0.2, 0.1),
  warmEdge: new THREE.Color(1.0, 0.6, 0.0),
  glowIntensity: 1.0,
};

export class TerrainScene {
  /**
   * @param {HTMLElement} container - 容器 DOM 元素
   */
  constructor(container) {
    this.container = container;
    this.width = container.clientWidth;
    this.height = container.clientHeight;

    // Three.js 核心
    /** @type {THREE.Scene} */
    this.scene = null;
    /** @type {THREE.PerspectiveCamera} */
    this.camera = null;
    /** @type {THREE.WebGLRenderer} */
    this.renderer = null;
    /** @type {OrbitControls} */
    this.controls = null;
    /** @type {THREE.InstancedMesh} */
    this.mesh = null;
    /** @type {THREE.ShaderMaterial} */
    this.material = null;

    this.clock = new THREE.Clock();
    this.animationId = null;
    this.isDisposed = false;

    // 地形参数
    this.gridSize = 80;
    this.spacing = 1.5;
    this.count = this.gridSize * this.gridSize;
  }

  init() {
    // 场景
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x050510);
    this.scene.fog = new THREE.Fog(0x050510, 40, 100);

    // 摄像机
    this.camera = new THREE.PerspectiveCamera(
      50,
      this.width / this.height,
      1,
      200
    );
    this.camera.position.set(40, 50, 80);
    this.camera.lookAt(0, 0, 0);

    // 渲染器
    this.renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
    this.renderer.setSize(this.width, this.height);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.container.appendChild(this.renderer.domElement);

    // OrbitControls - 自动漫游
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.autoRotate = true;
    this.controls.autoRotateSpeed = 0.3;
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.05;
    this.controls.minDistance = 40;
    this.controls.maxDistance = 120;
    this.controls.maxPolarAngle = Math.PI / 2.2;
    this.controls.enablePan = false;
    this.controls.enableZoom = false;
    this.controls.target.set(0, 0, 0);

    // 创建地形 InstancedMesh
    const geometry = new THREE.BoxGeometry(1, 1, 1);
    this.material = new THREE.ShaderMaterial({
      vertexShader,
      fragmentShader,
      uniforms: {
        uTime: { value: 0 },
        uSubBass: { value: 0 },
        uBass: { value: 0 },
        uLowMid: { value: 0 },
        uMid: { value: 0 },
        uHighMid: { value: 0 },
        uPresence: { value: 0 },
        uBrilliance: { value: 0 },
        uAir: { value: 0 },
        uWarmth: { value: 0 },
        uBrightness: { value: 0 },
        uSharpness: { value: 0 },
        uSmoothness: { value: 0 },
        uDensity: { value: 0 },
        uSpectralCentroid: { value: 0 },
        uEnergy: { value: 0 },
        uGlowIntensity: { value: THEME.glowIntensity },
        uBaseColor1: { value: THEME.baseColor1 },
        uBaseColor2: { value: THEME.baseColor2 },
        uCoolCore: { value: THEME.coolCore },
        uCoolEdge: { value: THEME.coolEdge },
        uWarmCore: { value: THEME.warmCore },
        uWarmEdge: { value: THEME.warmEdge },
      },
      transparent: true,
    });

    this.mesh = new THREE.InstancedMesh(geometry, this.material, this.count);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);

    // 放置柱子
    const tempMatrix = new THREE.Matrix4();
    const offset = (this.gridSize * this.spacing) / 2;

    let idx = 0;
    for (let x = 0; x < this.gridSize; x++) {
      for (let z = 0; z < this.gridSize; z++) {
        const px = x * this.spacing - offset;
        const pz = z * this.spacing - offset;
        tempMatrix.makeTranslation(px, 0.5, pz);
        this.mesh.setMatrixAt(idx, tempMatrix);
        idx++;
      }
    }
    this.mesh.instanceMatrix.needsUpdate = true;

    this.scene.add(this.mesh);

    // 环境光
    const ambientLight = new THREE.AmbientLight(0x222244, 0.5);
    this.scene.add(ambientLight);

    // 开始渲染循环
    this._animate = this._animate.bind(this);
    this._animate();
  }

  /**
   * 更新音频数据到着色器 uniforms
   * @param {Object} audioData - 来自 AudioAnalyzer.getAudioData()
   */
  updateAudioData(audioData) {
    if (!this.material) return;
    const u = this.material.uniforms;
    u.uSubBass.value = audioData.subBass;
    u.uBass.value = audioData.bass;
    u.uLowMid.value = audioData.lowMid;
    u.uMid.value = audioData.mid;
    u.uHighMid.value = audioData.highMid;
    u.uPresence.value = audioData.presence;
    u.uBrilliance.value = audioData.brilliance;
    u.uAir.value = audioData.air;
    u.uWarmth.value = audioData.warmth;
    u.uBrightness.value = audioData.brightness;
    u.uSharpness.value = audioData.sharpness;
    u.uSmoothness.value = audioData.smoothness;
    u.uDensity.value = audioData.density;
    u.uSpectralCentroid.value = audioData.spectralCentroid;
    u.uEnergy.value = audioData.energy;
  }

  /**
   * 窗口大小变化时调用
   */
  resize() {
    if (this.isDisposed) return;
    this.width = this.container.clientWidth;
    this.height = this.container.clientHeight;
    this.camera.aspect = this.width / this.height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(this.width, this.height);
  }

  _animate() {
    if (this.isDisposed) return;
    this.animationId = requestAnimationFrame(this._animate);

    const elapsed = this.clock.getElapsedTime();
    this.material.uniforms.uTime.value = elapsed;

    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  }

  /**
   * 释放所有 GPU 资源
   */
  dispose() {
    this.isDisposed = true;
    if (this.animationId) {
      cancelAnimationFrame(this.animationId);
    }
    if (this.controls) {
      this.controls.dispose();
    }
    if (this.mesh) {
      this.mesh.geometry.dispose();
      this.mesh.dispose();
    }
    if (this.material) {
      this.material.dispose();
    }
    if (this.renderer) {
      this.renderer.dispose();
      if (this.renderer.domElement.parentNode) {
        this.renderer.domElement.parentNode.removeChild(this.renderer.domElement);
      }
    }
    this.scene = null;
    this.camera = null;
    this.renderer = null;
    this.controls = null;
    this.mesh = null;
    this.material = null;
  }
}

export default TerrainScene;
```

---

### Task 5: 创建 visualizerLyrics.vue

**Files:**
- Create: `src/views/visualizerLyrics.vue`

- [ ] **Step 1: 创建文件**

```vue
<template>
  <div class="visualizer-lyrics" @click.self="exit">
    <!-- Three.js 画布容器 -->
    <div ref="canvasContainer" class="canvas-container"></div>

    <!-- 歌词文字层 (CSS 3D 透视) -->
    <div class="lyrics-layer">
      <div class="lyrics-scene">
        <div
          v-for="(line, index) in displayLyrics"
          :key="index"
          class="lyric-line"
          :class="{
            active: index === activeIndex,
            prev: index < activeIndex,
            next: index > activeIndex,
          }"
          :style="{
            fontSize: index === activeIndex ? lyricFontSize + 'px' : (lyricFontSize - 4) + 'px',
            opacity: index === activeIndex ? 1 : 0.3,
          }"
          @click="seekTo(line.time)"
        >
          {{ line.content }}
        </div>
      </div>
    </div>

    <!-- 退出提示 -->
    <div class="hint">按 Esc 退出</div>
  </div>
</template>

<script>
import { mapState } from 'vuex';
import { TerrainScene } from '@/components/Visualizer/TerrainScene';
import { AudioAnalyzer } from '@/utils/AudioAnalyzer';
import { lyricParser } from '@/utils/lyrics';
import { getLyric } from '@/api/track';

export default {
  name: 'VisualizerLyrics',

  data() {
    return {
      terrainScene: null,
      audioAnalyzer: null,
      lyrics: [],
      activeIndex: 0,
      lyricUpdateTimer: null,
      audioUpdateTimer: null,
      audioElementConnected: false,
    };
  },

  computed: {
    ...mapState(['player', 'settings']),
    currentTrack() {
      return this.player.currentTrack;
    },
    lyricFontSize() {
      return this.settings.lyricFontSize || 28;
    },
    displayLyrics() {
      // 显示当前行前后各 5 行
      const start = Math.max(0, this.activeIndex - 5);
      const end = Math.min(this.lyrics.length, this.activeIndex + 6);
      return this.lyrics.slice(start, end);
    },
  },

  watch: {
    'currentTrack.id': {
      immediate: false,
      handler(newId) {
        if (newId) {
          this.loadLyrics(newId);
          this.connectAudio();
        }
      },
    },
    'player.playing'(playing) {
      if (this.audioAnalyzer) {
        if (playing) {
          this.audioAnalyzer.play();
        } else {
          this.audioAnalyzer.pause();
        }
      }
    },
  },

  mounted() {
    this.initTerrain();
    this.startLyricUpdate();
    this.startAudioUpdate();
    if (this.currentTrack.id) {
      this.loadLyrics(this.currentTrack.id);
    }
    window.addEventListener('keydown', this.handleKeydown);
    window.addEventListener('resize', this.handleResize);
  },

  beforeDestroy() {
    this.cleanup();
  },

  methods: {
    initTerrain() {
      const container = this.$refs.canvasContainer;
      if (!container) return;

      this.terrainScene = new TerrainScene(container);
      this.terrainScene.init();

      this.audioAnalyzer = new AudioAnalyzer();
      this.connectAudio();
    },

    connectAudio() {
      if (!this.audioAnalyzer) return;

      // 从 Howler.js 获取内部的 HTMLAudioElement
      const howler = this.player._howler;
      if (howler && howler._sounds && howler._sounds.length > 0) {
        const audioEl = howler._sounds[0]._node;
        if (audioEl && audioEl instanceof HTMLAudioElement) {
          this.audioAnalyzer.init(audioEl);
          this.audioElementConnected = true;
          if (this.player.playing) {
            this.audioAnalyzer.play();
          }
        }
      }
    },

    async loadLyrics(trackId) {
      try {
        const rawLyric = await getLyric(trackId);
        const parsed = lyricParser(rawLyric);
        this.lyrics = parsed.lyric || [];
        this.activeIndex = 0;
      } catch (e) {
        console.warn('[VisualizerLyrics] Failed to load lyrics:', e);
        this.lyrics = [];
        this.activeIndex = 0;
      }
    },

    startLyricUpdate() {
      this.lyricUpdateTimer = setInterval(() => {
        if (this.lyrics.length === 0) return;
        const progress = this.player.seek(null, false);
        // 找到当前歌词行
        let idx = 0;
        for (let i = this.lyrics.length - 1; i >= 0; i--) {
          if (progress >= this.lyrics[i].time) {
            idx = i;
            break;
          }
        }
        this.activeIndex = idx;
      }, 100);
    },

    startAudioUpdate() {
      this.audioUpdateTimer = setInterval(() => {
        if (!this.audioAnalyzer || !this.terrainScene) return;
        const data = this.audioAnalyzer.getAudioData();
        this.terrainScene.updateAudioData(data);

        // 如果音源切换了，重新连接
        if (!this.audioElementConnected) {
          this.connectAudio();
        }
      }, 16); // ~60fps
    },

    seekTo(time) {
      this.player.seek(time);
    },

    exit() {
      this.$store.commit('toggleLyrics');
    },

    handleKeydown(e) {
      switch (e.code) {
        case 'Escape':
          this.exit();
          break;
        case 'Space':
          e.preventDefault();
          this.player.playOrPause();
          break;
        case 'ArrowLeft':
          e.preventDefault();
          this.player.playPrevTrack();
          break;
        case 'ArrowRight':
          e.preventDefault();
          this.player.playNextTrack();
          break;
      }
    },

    handleResize() {
      if (this.terrainScene) {
        this.terrainScene.resize();
      }
    },

    cleanup() {
      window.removeEventListener('keydown', this.handleKeydown);
      window.removeEventListener('resize', this.handleResize);

      if (this.lyricUpdateTimer) {
        clearInterval(this.lyricUpdateTimer);
        this.lyricUpdateTimer = null;
      }
      if (this.audioUpdateTimer) {
        clearInterval(this.audioUpdateTimer);
        this.audioUpdateTimer = null;
      }
      if (this.audioAnalyzer) {
        this.audioAnalyzer.dispose();
        this.audioAnalyzer = null;
      }
      if (this.terrainScene) {
        this.terrainScene.dispose();
        this.terrainScene = null;
      }
    },
  },
};
</script>

<style lang="scss" scoped>
.visualizer-lyrics {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 100;
  background: #050510;
  overflow: hidden;
  user-select: none;
}

.canvas-container {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  z-index: 1;
}

.lyrics-layer {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 2;
  display: flex;
  align-items: center;
  justify-content: center;
  pointer-events: none;
  perspective: 600px;
}

.lyrics-scene {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  transform: rotateX(15deg);
  transform-style: preserve-3d;
  max-height: 80vh;
  overflow: hidden;
  mask-image: linear-gradient(
    to bottom,
    transparent 0%,
    rgba(0, 0, 0, 0.3) 15%,
    black 30%,
    black 70%,
    rgba(0, 0, 0, 0.3) 85%,
    transparent 100%
  );
}

.lyric-line {
  font-weight: 700;
  text-align: center;
  transition: all 0.4s cubic-bezier(0.25, 0.46, 0.45, 0.94);
  pointer-events: auto;
  cursor: pointer;
  letter-spacing: 2px;
  white-space: nowrap;
  padding: 2px 0;

  &.active {
    color: #ffffff;
    text-shadow:
      0 0 20px rgba(108, 92, 231, 0.8),
      0 0 40px rgba(108, 92, 231, 0.5),
      0 0 80px rgba(0, 206, 209, 0.3),
      0 0 120px rgba(108, 92, 231, 0.2);
    transform: translateZ(20px) scale(1.05);
  }

  &.prev,
  &.next {
    color: rgba(255, 255, 255, 0.35);
    text-shadow: 0 0 8px rgba(108, 92, 231, 0.2);
  }
}

.hint {
  position: absolute;
  bottom: 32px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 3;
  color: rgba(255, 255, 255, 0.25);
  font-size: 13px;
  letter-spacing: 1px;
}
</style>
```

---

### Task 6: 修改 Player.js — 暴露 AudioContext

**Files:**
- Modify: `src/utils/Player.js`

- [ ] **Step 1: 添加 getAudioElement 方法**

在 `Player.js` 类的末尾（`clearPlayNextList` 方法之后，`}` 之前），添加：

```javascript
  /**
   * 获取当前 Howler 实例内部的 HTMLAudioElement，
   * 供 AudioAnalyzer 创建 MediaElementAudioSourceNode。
   * @returns {HTMLAudioElement|null}
   */
  getAudioElement() {
    if (!this._howler || !this._howler._sounds) return null;
    const sound = this._howler._sounds[0];
    if (!sound) return null;
    return sound._node instanceof HTMLAudioElement ? sound._node : null;
  }
```

- [ ] **Step 2: 在 `_playAudioSource` 方法末尾添加事件通知**

在 `_playAudioSource` 方法的 `this.setOutputDevice();` 之后，添加：

```javascript
    // 通知 AudioAnalyzer 音源已切换
    if (window.yesplaymusic && window.yesplaymusic.onAudioSourceChanged) {
      window.yesplaymusic.onAudioSourceChanged(this.getAudioElement());
    }
```

---

### Task 7: 修改 initLocalStorage.js — 新增设置项

**Files:**
- Modify: `src/store/initLocalStorage.js`

- [ ] **Step 1: 添加 lyricsMode 设置**

在 `settings` 对象中，`lyricsBackground: true,` 之后添加：

```javascript
    lyricsMode: 'classic', // 'classic' | 'visualizer'
```

---

### Task 8: 修改 settings.vue — 新增歌词模式切换

**Files:**
- Modify: `src/views/settings.vue`

- [ ] **Step 1: 在模板中添加歌词模式选择**

在 `lyricsBackground` 的 `<div class="item">` 之后，添加：

```html
      <div class="item">
        <div class="left">
          <div class="title">歌词显示模式</div>
        </div>
        <div class="right">
          <select v-model="lyricsMode">
            <option value="classic">经典</option>
            <option value="visualizer">3D 可视化</option>
          </select>
        </div>
      </div>
```

- [ ] **Step 2: 添加 computed 属性**

在 `computed` 中，`lyricsBackground` 之后添加：

```javascript
    lyricsMode: {
      get() {
        return this.settings.lyricsMode || 'classic';
      },
      set(value) {
        this.$store.commit('updateSettings', {
          key: 'lyricsMode',
          value,
        });
      },
    },
```

---

### Task 9: 修改 App.vue — 条件渲染两种歌词模式

**Files:**
- Modify: `src/App.vue`

- [ ] **Step 1: 导入 visualizerLyrics 组件**

在 `<script>` 部分的 import 区域，添加：

```javascript
import VisualizerLyrics from './views/visualizerLyrics.vue';
```

- [ ] **Step 2: 注册组件**

在 `components` 中，添加：

```javascript
VisualizerLyrics,
```

- [ ] **Step 3: 修改模板的条件渲染**

将现有的：
```html
    <transition v-if="enablePlayer" name="slide-up">
      <Lyrics v-show="showLyrics" />
    </transition>
```

替换为：
```html
    <transition v-if="enablePlayer && settings.lyricsMode !== 'visualizer'" name="slide-up">
      <Lyrics v-show="showLyrics" />
    </transition>
    <VisualizerLyrics v-if="enablePlayer && settings.lyricsMode === 'visualizer' && showLyrics" />
```

---

### Task 10: 验证 — 安装依赖并检查编译

**Files:**
- 无

- [ ] **Step 1: 安装依赖**

```bash
cd /Users/yangshenghao/github/YesPlayMusic && yarn install
```

Expected: 无错误

- [ ] **Step 2: 检查构建**

```bash
cd /Users/yangshenghao/github/YesPlayMusic && yarn build 2>&1 | tail -20
```

Expected: 构建成功，无错误

---

### Task 11: 验证 — 功能测试

- [ ] **Step 1: 启动开发服务器**

```bash
cd /Users/yangshenghao/github/YesPlayMusic && yarn dev
```

- [ ] **Step 2: 手动测试**
  1. 打开设置页面，确认「歌词显示模式」选项出现
  2. 切换到「3D 可视化」模式
  3. 播放一首歌，打开歌词页
  4. 确认 3D 地形正常渲染
  5. 确认歌词文字以 3D 透视效果显示
  6. 确认当前行高亮
  7. 按 Esc 退出歌词页
  8. 按 Space 播放/暂停
  9. 切换回「经典」模式，确认原有歌词页正常

---

## 颜色主题

当前使用 Nocturnal（蓝紫色）主题，与 YesPlayMusic 的深色主题协调。后续可扩展为 4 套主题切换。

## 性能说明

- 80×80 = 6400 个 InstancedMesh 实例，单次 draw call
- CSS 3D 透视歌词层，DOM 元素数量少（约 11 行）
- 关闭时完整 dispose 释放 GPU 资源