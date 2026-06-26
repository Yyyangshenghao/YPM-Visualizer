// src/components/Visualizer/CoverParticleScene.js
// 封面粒子可视化：把歌曲封面按像素拆成一面正对相机的圆形粒子墙，
// 粒子之间留有间隙（不是无缝平铺），随音频沿 Z 轴朝观众弹跳、
// 点尺寸随节拍涨缩，并叠加一层 additive 辉光，使律动明显可见。
// 参考开源项目 Mineradio 的封面粒子预设（SILK）实现。
// 与 TerrainScene 共享同一套接口：init / updateAudioData / resize / dispose / setCover。

import * as THREE from 'three';

const FOV = 45;

// 主粒子层 vertex shader：朝相机的平面，按频段沿 +Z 朝观众弹跳。
const particleVertexShader = /* glsl */ `
  uniform float uTime;
  uniform float uSubBass;
  uniform float uBass;
  uniform float uLowMid;
  uniform float uMid;
  uniform float uHighMid;
  uniform float uPresence;
  uniform float uAir;
  uniform float uEnergy;
  uniform float uGridHalf;
  uniform float uSpacing;
  uniform float uFocal;
  uniform float uDotScale;

  #define RIPPLE_COUNT 6
  uniform float uRippleTime[RIPPLE_COUNT];
  uniform float uRippleStrength[RIPPLE_COUNT];
  uniform vec2 uRippleCenter[RIPPLE_COUNT];
  uniform float uRippleBlast[RIPPLE_COUNT];

  attribute vec3 aColor;
  attribute float aBrightness;
  attribute float aRandom;

  varying vec3 vColor;
  varying float vLift;

  void main() {
    vColor = aColor;

    vec3 pos = position;
    float centerDist = length(pos.xy);
    float normDist = clamp(centerDist / uGridHalf, 0.0, 1.0);

    // 径向分频：中心吃低频、外圈吃高频，让弹跳在画面上有空间层次
    float innerRegion = smoothstep(0.6, 0.0, normDist);
    float midRegion = smoothstep(0.0, 0.5, normDist) * smoothstep(1.0, 0.45, normDist);
    float outerRegion = smoothstep(0.45, 1.0, normDist);

    // 朝观众（+Z）的弹跳位移，幅度相对网格间距很大 → 明显的“跳跃粒子”
    float lift = 0.0;
    lift += (uSubBass + uBass) * innerRegion * 11.0;
    lift += (uLowMid + uMid) * midRegion * 9.0;
    lift += (uHighMid + uPresence + uAir) * outerRegion * 7.5;

    // 每颗粒子的有机微抖 + 一个缓慢呼吸，安静时也不死板
    float phase = aRandom * 6.2831853;
    float shimmer = sin(uTime * 6.0 + phase + centerDist * 0.18);
    lift += shimmer * uEnergy * 4.0;
    lift += sin(uTime * 1.4 + phase) * 0.35;

    // 越亮的像素弹得越高，暗部保留底噪
    lift *= 0.5 + aBrightness * 0.8;

    // 鼓点涟漪：每道环从各自的随机爆点向外扩散（约 0.45s 抵达边缘），多点并发
    float ringWidth = uGridHalf * 0.12;
    float rippleEnv = 0.0;   // 当前粒子处最强的环包络，用于挑选飞出的粒子
    vec2 flyDir = vec2(0.0); // 逃逸方向：朝最强爆点的外侧
    float blast = 0.0;       // 该爆点的强鼓点权重，决定逃逸的范围与距离
    for (int r = 0; r < RIPPLE_COUNT; r++) {
      vec2 toCenter = pos.xy - uRippleCenter[r];
      float dist = length(toCenter);
      float rad = uRippleTime[r] * (uGridHalf / 0.45);
      float ring = exp(-pow((dist - rad) / ringWidth, 2.0)) * uRippleStrength[r];
      lift += ring * 6.5;
      if (ring > rippleEnv) {
        rippleEnv = ring;
        flyDir = dist > 0.001 ? toCenter / dist : vec2(0.0);
        blast = uRippleBlast[r];
      }
    }

    // 粒子飞出：普通鼓点约 15% 粒子被环轻带飞；强鼓点逃逸比例与距离都加大，
    // 方向沿爆点外侧；环移走后随 strength 衰减自然落回。
    float flyThreshold = mix(0.85, 0.5, blast);
    float flySelect = step(flyThreshold, aRandom);
    float fly = rippleEnv * flySelect;
    pos.xy += flyDir * fly * mix(7.0, 16.0, blast);
    lift += fly * (5.0 + blast * 6.0);

    pos.z += lift;
    vLift = lift;

    vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
    gl_Position = projectionMatrix * mvPosition;

    // 点尺寸 = 网格间距投影 * 圆点缩放（<1 留出间隙）* 音频涨缩
    // 涨缩刻意收小：律动主要靠 +Z 位移表现，避免点放大后互相重叠糊成一团
    float audioBoost = 1.0 + (uSubBass + uBass) * 0.4 + uEnergy * 0.2;
    gl_PointSize = (uSpacing * uFocal / -mvPosition.z) * uDotScale * audioBoost;
  }
`;

// 圆形软粒子 + 按弹跳量提亮
const particleFragmentShader = /* glsl */ `
  varying vec3 vColor;
  varying float vLift;

  void main() {
    float d = length(gl_PointCoord - vec2(0.5));
    if (d > 0.5) discard;
    float edge = smoothstep(0.5, 0.36, d);

    vec3 color = vColor * (1.0 + clamp(vLift, 0.0, 8.0) * 0.05);
    gl_FragColor = vec4(color, edge);
  }
`;

// 辉光层 fragment：更柔的圆斑，按弹跳量增亮，additive 叠加
const bloomFragmentShader = /* glsl */ `
  varying vec3 vColor;
  varying float vLift;

  void main() {
    float d = length(gl_PointCoord - vec2(0.5));
    if (d > 0.5) discard;
    float soft = smoothstep(0.5, 0.0, d);
    float glow = clamp(vLift, 0.0, 8.0) * 0.09;
    gl_FragColor = vec4(vColor * (0.45 + glow), soft * glow * 0.4);
  }
`;

export class CoverParticleScene {
  constructor(container) {
    this.container = container;
    this.width = container.clientWidth;
    this.height = container.clientHeight;

    this.scene = null;
    this.camera = null;
    this.renderer = null;
    this.points = null;
    this.bloomPoints = null;
    this.material = null;
    this.bloomMaterial = null;

    this.clock = new THREE.Clock();
    this.animationId = null;
    this.isDisposed = false;

    // 粒子网格参数：分辨率越高越接近原图；spacing 是粒子间距
    this.gridSize = 190; // 每边粒子数（更密）
    this.spacing = 0.5;
    this.count = this.gridSize * this.gridSize;
    this.gridHalf = (this.gridSize * this.spacing) / 2;

    // 离屏 canvas，用于采样封面像素
    this._sampleCanvas = document.createElement('canvas');
    this._sampleCanvas.width = this.gridSize;
    this._sampleCanvas.height = this.gridSize;
    this._sampleCtx = this._sampleCanvas.getContext('2d', {
      willReadFrequently: true,
    });

    this._coverUrl = null;
    this._coverImg = null;
    this._pixelRatio = Math.min(window.devicePixelRatio, 1.5);

    // 封面像素重采样分帧重建：每次新封面递增 token 以作废上一次未完成的重建，
    // _rebuildHandle 保存待执行的 rIC/timeout 句柄，dispose 时取消。
    this._rebuildToken = 0;
    this._rebuildHandle = null;

    // 渲染帧率上限：背景可视化 30fps 已足够流畅，可在高刷屏上大幅降低 GPU/CPU 占用
    this.targetFPS = 30;
    this._frameInterval = 1000 / this.targetFPS;
    this._lastFrameTime = 0;

    // 鼓点涟漪状态：多道并发涟漪，各自随机爆点中心（环形复用槽位），上一帧低频
    this._prevBass = 0;
    this._lastBeat = -99;
    this._rippleCount = 6;
    this._rippleStarts = new Array(this._rippleCount).fill(-99);
    this._ripplePeak = new Float32Array(this._rippleCount); // 每道涟漪的鼓点峰值强度
    this._rippleSlot = 0;
  }

  init() {
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x050510);

    this.camera = new THREE.PerspectiveCamera(
      FOV,
      this.width / this.height,
      1,
      400
    );
    // 略带透视地正视粒子墙；相机拉远使整体更小。粒子沿局部 +Z 朝相机弹出。
    const dist = this.gridHalf / Math.tan(THREE.MathUtils.degToRad(FOV) / 2);
    this.camera.position.set(0, 0, dist * 1.12);
    this.camera.lookAt(0, 0, 0);
    this._applyViewOffset();

    this.renderer = new THREE.WebGLRenderer({ alpha: true, antialias: false });
    this.renderer.setSize(this.width, this.height);
    this.renderer.setPixelRatio(this._pixelRatio);
    this.container.appendChild(this.renderer.domElement);

    // 几何体：N×N 粒子铺在 XY 平面（z=0），正对相机
    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(this.count * 3);
    const colors = new Float32Array(this.count * 3);
    const brightness = new Float32Array(this.count);
    const randoms = new Float32Array(this.count);

    const offset = this.gridHalf;
    let i = 0;
    for (let gx = 0; gx < this.gridSize; gx++) {
      for (let gy = 0; gy < this.gridSize; gy++) {
        positions[i * 3] = gx * this.spacing - offset;
        positions[i * 3 + 1] = gy * this.spacing - offset;
        positions[i * 3 + 2] = 0;
        // 初始为暗色，封面加载后覆盖
        colors[i * 3] = 0.1;
        colors[i * 3 + 1] = 0.12;
        colors[i * 3 + 2] = 0.18;
        brightness[i] = 0.15;
        randoms[i] = Math.random();
        i++;
      }
    }

    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('aColor', new THREE.BufferAttribute(colors, 3));
    geometry.setAttribute(
      'aBrightness',
      new THREE.BufferAttribute(brightness, 1)
    );
    geometry.setAttribute('aRandom', new THREE.BufferAttribute(randoms, 1));
    this._geometry = geometry;

    const uniforms = {
      uTime: { value: 0 },
      uSubBass: { value: 0 },
      uBass: { value: 0 },
      uLowMid: { value: 0 },
      uMid: { value: 0 },
      uHighMid: { value: 0 },
      uPresence: { value: 0 },
      uAir: { value: 0 },
      uEnergy: { value: 0 },
      uGridHalf: { value: this.gridHalf },
      uSpacing: { value: this.spacing },
      uFocal: { value: this._computeFocal() },
      uDotScale: { value: 0.42 }, // <1 → 粒子间留出间隙，呈离散圆点
      // 每个槽位：距其鼓点的秒数（初始很大→无涟漪）、随时间衰减的强度、
      // 随机爆点中心（初始放到画面外）、强鼓点逃逸权重
      uRippleTime: { value: new Float32Array(this._rippleCount).fill(99) },
      uRippleStrength: { value: new Float32Array(this._rippleCount) },
      uRippleCenter: {
        value: Array.from(
          { length: this._rippleCount },
          () => new THREE.Vector2(9999, 9999)
        ),
      },
      uRippleBlast: { value: new Float32Array(this._rippleCount) },
    };
    this._uniforms = uniforms;

    this.material = new THREE.ShaderMaterial({
      vertexShader: particleVertexShader,
      fragmentShader: particleFragmentShader,
      uniforms,
      transparent: true,
      depthWrite: true,
      depthTest: true,
    });

    // 辉光层：共享几何与 uniforms，更大更柔、additive 叠加
    const bloomUniforms = { ...uniforms, uDotScale: { value: 1.15 } };
    this._bloomUniforms = bloomUniforms;
    this.bloomMaterial = new THREE.ShaderMaterial({
      vertexShader: particleVertexShader,
      fragmentShader: bloomFragmentShader,
      uniforms: bloomUniforms,
      transparent: true,
      depthWrite: false,
      depthTest: false,
      blending: THREE.AdditiveBlending,
    });

    this.bloomPoints = new THREE.Points(geometry, this.bloomMaterial);
    this.bloomPoints.frustumCulled = false;
    this.bloomPoints.renderOrder = 0;

    this.points = new THREE.Points(geometry, this.material);
    this.points.frustumCulled = false;
    this.points.renderOrder = 1;

    // 嵌套 group：外层固定倾斜，内层缓慢自转（自转轴随倾斜后竖向）
    this.spinGroup = new THREE.Group();
    this.spinGroup.add(this.bloomPoints);
    this.spinGroup.add(this.points);
    this.tiltGroup = new THREE.Group();
    this.tiltGroup.rotation.x = 0; // 正面朝向相机；摇晃在 spinGroup 上做
    this.tiltGroup.add(this.spinGroup);
    this.scene.add(this.tiltGroup);

    // 若已有待加载封面则立即采样
    if (this._coverUrl) this._loadCover(this._coverUrl);

    this._animate = this._animate.bind(this);
    this._animate();
  }

  // 把世界尺寸映射到屏幕像素所需的焦距（基于设备像素的 drawingBuffer 高度）
  _computeFocal() {
    const bufferHeight = this.height * this._pixelRatio;
    return bufferHeight / (2 * Math.tan(THREE.MathUtils.degToRad(FOV) / 2));
  }

  /**
   * 设置当前封面 URL。切歌时调用。
   * @param {string} url 网易云封面 picUrl
   */
  setCover(url) {
    if (!url || url === this._coverUrl) return;
    this._coverUrl = url;
    if (this.renderer) this._loadCover(url);
  }

  _loadCover(url) {
    // 协议规整：http:// → https://；协议相对 // → 加 https:；其它（已是 https
    // 或相对路径）保持原样，避免对非 http 开头的 URL 误改。
    let httpsUrl = url;
    if (/^http:\/\//i.test(httpsUrl)) {
      httpsUrl = httpsUrl.replace(/^http:\/\//i, 'https://');
    } else if (/^\/\//.test(httpsUrl)) {
      httpsUrl = 'https:' + httpsUrl;
    }
    const sized = `${httpsUrl}?param=${this.gridSize}y${this.gridSize}`;

    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      if (this.isDisposed || this._coverUrl !== url) return;
      this._coverImg = img;
      this._sampleCoverToParticles();
    };
    img.onerror = () => {
      // 加载失败时静默保留上一张封面
    };
    img.src = sized;
  }

  /** 把当前封面图绘制到离屏 canvas 并把像素颜色写入粒子属性 */
  _sampleCoverToParticles() {
    if (!this._coverImg || !this._geometry) return;
    const n = this.gridSize;
    const ctx = this._sampleCtx;
    ctx.clearRect(0, 0, n, n);
    try {
      ctx.drawImage(this._coverImg, 0, 0, n, n);
    } catch (e) {
      return;
    }

    let pixels;
    try {
      pixels = ctx.getImageData(0, 0, n, n).data;
    } catch (e) {
      // 跨域污染导致无法读取像素，放弃着色
      console.warn('[CoverParticleScene] getImageData failed (CORS):', e);
      return;
    }

    // 36100 颗粒子的重采样若一次性同步执行，低端机切歌瞬间可能掉帧。
    // 改为分帧（按列分块）在 rIC/timeout 空闲时段处理；递增 token 作废上一次
    // 未完成的重建，避免快速切歌时两次重建竞态写花同一缓冲。
    const token = ++this._rebuildToken;
    this._rebuildChunk(pixels, n, 0, token);
  }

  // requestIdleCallback 优先，无该 API 的环境用 setTimeout 兜底。
  _requestIdle(cb) {
    if (typeof window.requestIdleCallback === 'function') {
      return window.requestIdleCallback(cb, { timeout: 100 });
    }
    return setTimeout(cb, 16);
  }

  _cancelIdle(handle) {
    if (handle == null) return;
    if (typeof window.cancelIdleCallback === 'function') {
      window.cancelIdleCallback(handle);
    }
    clearTimeout(handle);
  }

  // 分帧重建：每次处理 chunkCols 列粒子（i = gx*n + gy）。
  // 屏幕右 = +X、屏幕上 = +Y；图像行 0 在顶部，故图像行 = (n-1-gy)，使封面正立。
  _rebuildChunk(pixels, n, startGx, token) {
    // 已销毁或被更新的封面作废 → 立即停止，丢弃这次过时的重建
    if (this.isDisposed || token !== this._rebuildToken || !this._geometry) {
      this._rebuildHandle = null;
      return;
    }

    const colorAttr = this._geometry.getAttribute('aColor');
    const brightAttr = this._geometry.getAttribute('aBrightness');
    const chunkCols = 32;
    const endGx = Math.min(startGx + chunkCols, n);

    for (let gx = startGx; gx < endGx; gx++) {
      for (let gy = 0; gy < n; gy++) {
        const i = gx * n + gy;
        const px = gx;
        const py = n - 1 - gy;
        const p = (py * n + px) * 4;
        const r = pixels[p] / 255;
        const g = pixels[p + 1] / 255;
        const b = pixels[p + 2] / 255;
        colorAttr.array[i * 3] = r;
        colorAttr.array[i * 3 + 1] = g;
        colorAttr.array[i * 3 + 2] = b;
        brightAttr.array[i] = (r + g + b) / 3;
      }
    }
    colorAttr.needsUpdate = true;
    brightAttr.needsUpdate = true;

    if (endGx < n) {
      this._rebuildHandle = this._requestIdle(() =>
        this._rebuildChunk(pixels, n, endGx, token)
      );
    } else {
      this._rebuildHandle = null;
    }
  }

  updateAudioData(audioData) {
    if (!this._uniforms) return;
    // 辉光层与主层共享同名频段 uniform 对象（仅 uDotScale 各自独立），写一次即可
    const u = this._uniforms;
    u.uSubBass.value = audioData.subBass;
    u.uBass.value = audioData.bass;
    u.uLowMid.value = audioData.lowMid;
    u.uMid.value = audioData.mid;
    u.uHighMid.value = audioData.highMid;
    u.uPresence.value = audioData.presence;
    u.uAir.value = audioData.air;
    u.uEnergy.value = audioData.energy;

    // 鼓点上升沿检测：低频突破阈值且与上次间隔足够时，在随机位置触发一道新涟漪，
    // 环形复用槽位 → 可同时存在多道扩散中的涟漪（多点开花）
    const bass = audioData.subBass + audioData.bass;
    const now = this.clock.getElapsedTime();
    if (bass > 0.38 && this._prevBass <= 0.38 && now - this._lastBeat > 0.1) {
      const slot = this._rippleSlot;
      this._rippleStarts[slot] = now;
      // 随机爆点中心：偏画面内（±0.55），让环能扫过更大面积、更接近进入时那道大涟漪
      this._uniforms.uRippleCenter.value[slot].set(
        (Math.random() * 2 - 1) * this.gridHalf * 0.55,
        (Math.random() * 2 - 1) * this.gridHalf * 0.55
      );
      // 鼓点峰值越高涟漪越强；超过高阈值视为强鼓点 → 周边粒子大幅逃逸
      this._ripplePeak[slot] = THREE.MathUtils.clamp(
        (bass - 0.38) / 1.2,
        0.65,
        1.0
      );
      this._uniforms.uRippleBlast.value[slot] = THREE.MathUtils.clamp(
        (bass - 1.0) / 0.8,
        0.0,
        1.0
      );
      this._rippleSlot = (slot + 1) % this._rippleCount;
      this._lastBeat = now;
    }
    this._prevBass = bass;
  }

  /** 通过 view offset 把渲染内容整体右移，给左侧歌词让出空间 */
  _applyViewOffset() {
    const shiftX = -this.width * 0.18;
    this.camera.setViewOffset(
      this.width,
      this.height,
      shiftX,
      0,
      this.width,
      this.height
    );
  }

  resize() {
    if (this.isDisposed) return;
    this.width = this.container.clientWidth;
    this.height = this.container.clientHeight;
    this.camera.aspect = this.width / this.height;
    this.renderer.setSize(this.width, this.height);
    const focal = this._computeFocal();
    if (this._uniforms) this._uniforms.uFocal.value = focal;
    if (this._bloomUniforms) this._bloomUniforms.uFocal.value = focal;
    this._applyViewOffset();
  }

  _animate() {
    if (this.isDisposed) return;
    this.animationId = requestAnimationFrame(this._animate);

    // 帧率限流：未到目标帧间隔则跳过本次渲染
    const nowMs = performance.now();
    if (nowMs - this._lastFrameTime < this._frameInterval) return;
    this._lastFrameTime = nowMs;

    const t = this.clock.getElapsedTime();
    // uTime 为主/辉光共享对象，写一次即可
    this._uniforms.uTime.value = t;

    // 涟漪推进：每个槽位按自身鼓点时刻计算扩散秒数，强度 = 鼓点峰值 × 0.55s 线性衰减
    const tArr = this._uniforms.uRippleTime.value;
    const sArr = this._uniforms.uRippleStrength.value;
    for (let k = 0; k < this._rippleCount; k++) {
      const age = t - this._rippleStarts[k];
      tArr[k] = age;
      sArr[k] = this._ripplePeak[k] * Math.max(0, 1 - age / 0.55);
    }

    // 正面小幅摇晃：绕 X/Y 轻微摆动、保持封面正对相机，非整圈旋转
    if (this.spinGroup) {
      this.spinGroup.rotation.x = Math.sin(t * 0.5) * 0.06;
      this.spinGroup.rotation.y = Math.cos(t * 0.4) * 0.07;
      this.spinGroup.rotation.z = Math.sin(t * 0.3) * 0.02;
    }
    this.renderer.render(this.scene, this.camera);
  }

  dispose() {
    this.isDisposed = true;
    if (this.animationId) cancelAnimationFrame(this.animationId);
    this._cancelIdle(this._rebuildHandle);
    this._rebuildHandle = null;
    if (this._geometry) this._geometry.dispose();
    if (this.material) this.material.dispose();
    if (this.bloomMaterial) this.bloomMaterial.dispose();
    if (this.renderer) {
      this.renderer.dispose();
      if (this.renderer.domElement.parentNode) {
        this.renderer.domElement.parentNode.removeChild(
          this.renderer.domElement
        );
      }
    }
    this.scene = null;
    this.camera = null;
    this.renderer = null;
    this.points = null;
    this.bloomPoints = null;
    this.spinGroup = null;
    this.tiltGroup = null;
    this.material = null;
    this.bloomMaterial = null;
    this._geometry = null;
    this._coverImg = null;
    this._uniforms = null;
    this._bloomUniforms = null;
  }
}

export default CoverParticleScene;
