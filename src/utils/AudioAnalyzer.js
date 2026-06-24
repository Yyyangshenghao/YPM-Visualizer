// src/utils/AudioAnalyzer.js
// 参照 sonic-topography AudioEngine：createMediaElementSource + GainNode 中间层
// GainNode → destination 永久连接，切歌时只换上游 source，音频通路永不中断

export class AudioAnalyzer {
  constructor() {
    /** @type {AudioContext|null} */
    this.audioCtx = null;
    /** @type {GainNode|null} */
    this.gainNode = null;
    /** @type {AnalyserNode|null} */
    this.analyser = null;
    /** @type {MediaElementAudioSourceNode|null} */
    this.source = null;
    /** @type {Uint8Array} */
    this.dataArray = new Uint8Array(0);

    this.isPlaying = false;
    this._initializing = false;

    // 平滑后的输出数据
    this.smoothedData = {
      subBass: 0,
      bass: 0,
      lowMid: 0,
      mid: 0,
      highMid: 0,
      presence: 0,
      brilliance: 0,
      air: 0,
      warmth: 0,
      brightness: 0,
      sharpness: 0,
      smoothness: 0,
      density: 0,
      spectralCentroid: 0,
      energy: 0,
    };

    this.prevData = new Array(512).fill(0);
    this.prevBrightness = 0;
  }

  /**
   * 初始化 AudioContext + GainNode + Analyser（仅首次调用）。
   * GainNode → destination 是永久连接，绝不中断。
   */
  _ensureGraph() {
    if (this.audioCtx) return;

    // 复用 switchToVisualizer 在点击事件中创建的 AudioContext
    // （在用户手势中创建才能避免浏览器自动暂停）
    if (window.yesplaymusic?._sharedAudioCtx) {
      this.audioCtx = window.yesplaymusic._sharedAudioCtx;
    } else {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      this.audioCtx = new AudioContext();
      window.yesplaymusic = window.yesplaymusic || {};
      window.yesplaymusic._sharedAudioCtx = this.audioCtx;
    }

    this.gainNode = this.audioCtx.createGain();
    this.gainNode.gain.value = 1.0;

    this.analyser = this.audioCtx.createAnalyser();
    this.analyser.fftSize = 1024;
    this.analyser.smoothingTimeConstant = 0.8;
    this.dataArray = new Uint8Array(this.analyser.frequencyBinCount);

    // 核心：gainNode → destination + analyser（永久连接，绝不中断）
    this.gainNode.connect(this.audioCtx.destination);
    this.gainNode.connect(this.analyser);
  }

  /**
   * 连接指定音频元素。每次音源切换（切歌）时调用。
   * @param {HTMLAudioElement} audioElement
   */
  async init(audioElement) {
    if (!audioElement) return;
    if (this._initializing) return;
    this._initializing = true;

    try {
      this._ensureGraph();

      if (this.audioCtx.state === 'suspended') {
        await this.audioCtx.resume();
      }

      // 防御：如果 resume 后仍然 suspended（例如浏览器 autoplay 策略限制），
      // 不要调用 createMediaElementSource，否则会切断 HTMLAudioElement 的直连音频输出
      // 导致用户完全听不到声音
      if (this.audioCtx.state !== 'running') {
        console.warn(
          '[AudioAnalyzer] AudioContext not running after resume, state:',
          this.audioCtx.state,
          '— skipping connection to avoid muting audio'
        );
        return;
      }

      // 切歌时换新的 source（旧 source 连的是已销毁的音频元素）
      const needNewSource =
        !this.source || window.yesplaymusic._lastAudioElement !== audioElement;

      if (needNewSource) {
        if (this.source) {
          this.source.disconnect();
          this.source = null;
        }

        try {
          this.source = this.audioCtx.createMediaElementSource(audioElement);
        } catch (e) {
          console.warn('[AudioAnalyzer] createMediaElementSource failed:', e);
          // 复用上次的 shared source
          if (window.yesplaymusic?._sharedSource) {
            this.source = window.yesplaymusic._sharedSource;
          } else {
            return;
          }
        }

        window.yesplaymusic._sharedSource = this.source;
        window.yesplaymusic._lastAudioElement = audioElement;
      }

      // 连接 source → gainNode（gainNode → destination 已永久连接）
      this.source.disconnect();
      this.source.connect(this.gainNode);
    } finally {
      this._initializing = false;
    }
  }

  async play() {
    this.isPlaying = true;
    if (this.audioCtx?.state === 'suspended') {
      await this.audioCtx.resume();
    }
  }

  pause() {
    this.isPlaying = false;
  }

  getAudioData() {
    if (!this.analyser) {
      return { ...this.smoothedData };
    }

    const binCount = this.dataArray.length;
    let energySum = 0;
    let centroidNum = 0;
    let centroidDen = 0;
    let subBassSum = 0,
      bassSum = 0,
      lowMidSum = 0,
      midSum = 0;
    let highMidSum = 0,
      presenceSum = 0,
      brillianceSum = 0,
      airSum = 0;
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

    const warmth =
      energySum > 0
        ? (subBassSum + bassSum + lowMidSum + midSum) / energySum
        : 0;
    const brightness =
      energySum > 0 ? (presenceSum + brillianceSum + airSum) / energySum : 0;
    const sharpness = Math.max(0, brightness - this.prevBrightness) * 10;
    this.prevBrightness = brightness;
    const smoothnessVal = Math.max(
      0,
      1.0 - (jumpVolatilitySum / binCount) * 2.0
    );

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
   * 释放资源。gainNode → destination 保持连接，音频继续播放。
   */
  dispose() {
    // source → destination 直连，绕过 gainNode，保证切回经典模式后音频继续播放
    if (this.source && this.audioCtx) {
      this.source.disconnect();
      this.source.connect(this.audioCtx.destination);
    }
    if (this.gainNode) {
      this.gainNode.disconnect();
    }
    if (this.analyser) {
      this.analyser.disconnect();
      this.analyser = null;
    }
    this.source = null;
    this.gainNode = null;
    this.audioCtx = null;
  }
}

export default AudioAnalyzer;
