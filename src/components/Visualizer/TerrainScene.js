// src/components/Visualizer/TerrainScene.js
// 移植自 sonic-topography /src/components/AudioVisualizer/MapScene.tsx

import * as THREE from 'three';
import { vertexShader, fragmentShader } from './shaders';

const THEME = {
  baseColor1: new THREE.Color(0.01, 0.02, 0.04),
  baseColor2: new THREE.Color(0.03, 0.05, 0.09),
  coolCore: new THREE.Color(0.0, 0.3, 1.0),
  coolEdge: new THREE.Color(0.6, 0.2, 1.0),
  warmCore: new THREE.Color(1.0, 0.2, 0.1),
  warmEdge: new THREE.Color(1.0, 0.6, 0.0),
  rippleColor: new THREE.Color(0.2, 0.9, 1.0),
  glowIntensity: 1.0,
};

export class TerrainScene {
  constructor(container) {
    this.container = container;
    this.width = container.clientWidth;
    this.height = container.clientHeight;

    this.scene = null;
    this.camera = null;
    this.renderer = null;
    this.mesh = null;
    this.material = null;

    this.clock = new THREE.Clock();
    this.animationId = null;
    this.isDisposed = false;

    // 网格参数
    this.gridSize = 100;
    this.spacing = 1.2;
    this.count = this.gridSize * this.gridSize;

    // 自适应帧率
    this.lastEnergy = 0;
    this.lastBeatEnergy = 0;
    this.frameSkip = 0;

    // 波纹系统（ring buffer 8 个）
    this.ripples = new Array(8).fill(null).map(() => ({
      pos: new THREE.Vector2(),
      time: -100,
      strength: 0,
      isActive: 0,
      rippleType: 0,
    }));
    this.rippleIndex = 0;
  }

  /** 添加波纹 */
  addRipple(x, z, strength, isWhite = false) {
    const idx = this.rippleIndex;
    this.ripples[idx] = {
      pos: new THREE.Vector2(x, z),
      time: this.clock.getElapsedTime(),
      strength,
      isActive: 1,
      rippleType: isWhite ? 1 : 0,
    };
    this.rippleIndex = (idx + 1) % 8;
  }

  init() {
    // 场景
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x050510);
    this.scene.fog = new THREE.Fog(0x050510, 40, 100);

    // 摄像机
    this.camera = new THREE.PerspectiveCamera(
      45,
      this.width / this.height,
      1,
      200
    );
    this.camera.position.set(35, 28, 40);
    this.camera.lookAt(0, 0, 0);

    // 渲染器
    this.renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
    this.renderer.setSize(this.width, this.height);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    this.container.appendChild(this.renderer.domElement);

    // 光照
    this.scene.add(new THREE.AmbientLight(0x222244, 0.5));
    const dirLight = new THREE.DirectionalLight(0xffffff, 1.0);
    dirLight.position.set(10, 20, 10);
    this.scene.add(dirLight);

    // 创建地形 InstancedMesh
    const geometry = new THREE.BoxGeometry(0.9, 1, 0.9);
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
        uRipples: { value: this.ripples },
        uBaseColor1: { value: THEME.baseColor1 },
        uBaseColor2: { value: THEME.baseColor2 },
        uCoolCore: { value: THEME.coolCore },
        uCoolEdge: { value: THEME.coolEdge },
        uWarmCore: { value: THEME.warmCore },
        uWarmEdge: { value: THEME.warmEdge },
        uRippleColor: { value: THEME.rippleColor },
        uGlowIntensity: { value: THEME.glowIntensity },
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

    // 启动渲染循环
    this._animate = this._animate.bind(this);
    this._animate();
  }

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

    // 节拍检测：能量突增时触发波纹
    const energyDelta = audioData.energy - this.lastBeatEnergy;
    if (energyDelta > 0.15 && audioData.energy > 0.2) {
      const angle = Math.random() * Math.PI * 2;
      const dist = Math.random() * 30;
      this.addRipple(
        Math.cos(angle) * dist,
        Math.sin(angle) * dist,
        Math.min(energyDelta * 5, 3.0)
      );
    }
    this.lastBeatEnergy = audioData.energy;
  }

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

    // 简单自动旋转（无需 OrbitControls）
    const camAngle = elapsed * 0.15;
    const camRadius = 55;
    const camHeight = 32;
    this.camera.position.x = Math.sin(camAngle) * camRadius;
    this.camera.position.z = Math.cos(camAngle) * camRadius;
    this.camera.position.y = camHeight;
    this.camera.lookAt(0, 0, 0);

    this.renderer.render(this.scene, this.camera);
  }

  dispose() {
    this.isDisposed = true;
    if (this.animationId) {
      cancelAnimationFrame(this.animationId);
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
        this.renderer.domElement.parentNode.removeChild(
          this.renderer.domElement
        );
      }
    }
    this.scene = null;
    this.camera = null;
    this.renderer = null;
    this.mesh = null;
    this.material = null;
  }
}

export default TerrainScene;
