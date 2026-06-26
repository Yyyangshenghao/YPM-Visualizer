<template>
  <div
    class="visualizer-lyrics"
    :class="{ 'controls-hidden': !controlsVisible }"
    @click.self="exit"
    @wheel.prevent="onWheel"
  >
    <!-- Three.js 画布容器 -->
    <div ref="canvasContainer" class="canvas-container"></div>

    <!-- 左侧毛玻璃背景，向右渐隐，让歌词更清晰 -->
    <div class="lyrics-glass"></div>

    <!-- 歌词文字层（参照 sonic-topography LyricsDisplay） -->
    <div ref="lyricsLayer" class="lyrics-layer">
      <div class="lyrics-perspective">
        <div
          ref="lyricsSceneWrapper"
          class="lyrics-scene-wrapper"
          :class="{ wheeling: wheeling, snapping: snapping }"
          :style="{ transform: 'translateY(' + scrollOffset + 'px)' }"
        >
          <div ref="lyricsScene" class="lyrics-scene">
            <!-- 时间线 -->
            <div class="timeline"></div>
            <div
              v-for="(line, index) in lyrics"
              :key="index"
              class="lyric-line"
              :class="{
                active: index === activeIndex,
                past: index < activeIndex,
              }"
              @click="seekTo(line.time)"
            >
              <div class="timeline-dot">
                <div v-if="index === activeIndex" class="dot-active"></div>
                <div
                  v-else
                  class="dot-inactive"
                  :class="{ past: index < activeIndex }"
                ></div>
              </div>
              <span class="lyric-text">{{ line.content }}</span>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- 底部控制栏：鼠标移动时显示，静止数秒后自动隐藏（类似视频播放器） -->
    <transition name="controls-fade">
      <div
        v-show="controlsVisible"
        class="visualizer-controls"
        @click.stop
        @mouseenter="keepControls"
        @mouseleave="scheduleHideControls"
      >
        <!-- 音量控制 -->
        <div class="volume-control">
          <button-icon :title="$t('player.mute')" @click.native="mute">
            <svg-icon v-show="volume > 0.5" icon-class="volume" />
            <svg-icon v-show="volume === 0" icon-class="volume-mute" />
            <svg-icon
              v-show="volume <= 0.5 && volume !== 0"
              icon-class="volume-half"
            />
          </button-icon>
          <div class="volume-bar">
            <vue-slider
              v-model="volume"
              :min="0"
              :max="1"
              :interval="0.01"
              :drag-on-click="true"
              :duration="0"
              tooltip="none"
              :dot-size="12"
            ></vue-slider>
          </div>
        </div>

        <div class="divider"></div>

        <!-- 播放控制 -->
        <div class="media-controls">
          <button-icon
            :title="$t('player.previous')"
            @click.native="playPrevTrack"
          >
            <svg-icon icon-class="previous" />
          </button-icon>
          <button-icon
            id="play"
            :title="$t(player.playing ? 'player.pause' : 'player.play')"
            @click.native="playOrPause"
          >
            <svg-icon :icon-class="player.playing ? 'pause' : 'play'" />
          </button-icon>
          <button-icon :title="$t('player.next')" @click.native="playNextTrack">
            <svg-icon icon-class="next" />
          </button-icon>
        </div>

        <div class="divider"></div>

        <!-- 全屏 -->
        <button-icon
          :title="isFullscreen ? '退出全屏' : '全屏'"
          @click.native="toggleFullscreen"
        >
          <svg-icon
            :icon-class="isFullscreen ? 'fullscreen-exit' : 'fullscreen'"
          />
        </button-icon>

        <!-- 切换回经典模式 -->
        <div class="mode-switch" title="经典歌词" @click="switchToClassic">
          <span>经典</span>
        </div>

        <!-- 退出 3D 歌词 -->
        <button-icon title="退出 3D 歌词" @click.native="exit">
          <svg-icon icon-class="arrow-down" />
        </button-icon>
      </div>
    </transition>
  </div>
</template>

<script>
import { mapState } from 'vuex';
import VueSlider from 'vue-slider-component';
import ButtonIcon from '@/components/ButtonIcon.vue';
import { TerrainScene } from '@/components/Visualizer/TerrainScene';
import { CoverParticleScene } from '@/components/Visualizer/CoverParticleScene';
import { AudioAnalyzer } from '@/utils/AudioAnalyzer';
import { lyricParser } from '@/utils/lyrics';
import { getLyric, getCloudLyric } from '@/api/track';

export default {
  name: 'VisualizerLyrics',

  components: {
    VueSlider,
    ButtonIcon,
  },

  data() {
    return {
      terrainScene: null,
      audioAnalyzer: null,
      lyrics: [],
      activeIndex: 0,
      scrollOffset: 0,
      lyricUpdateTimer: null,
      audioUpdateTimer: null,
      audioElementConnected: false,
      wheeling: false,
      snapping: false,
      controlsVisible: true,
      controlsHideTimer: null,
      isFullscreen: !!document.fullscreenElement,
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
    volume: {
      get() {
        return this.player.volume;
      },
      set(value) {
        this.player.volume = value;
      },
    },
  },

  watch: {
    'currentTrack.id': {
      immediate: false,
      handler(newId) {
        if (newId) {
          this.loadLyrics(newId);
          this.updateCover();
          // 不在这里 connectAudio —— 由 onAudioSourceChanged 回调 + interval 处理，
          // 避免用旧音频元素初始化导致的竞态问题
        }
      },
    },
    'settings.visualizerType'() {
      // 设置里切换背景类型时，重建场景（音频通路不受影响）
      if (this.terrainScene) {
        this.terrainScene.dispose();
        this.terrainScene = null;
      }
      this._buildScene();
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
    window.addEventListener('mousemove', this.handleMouseMove);
    document.addEventListener('fullscreenchange', this.handleFullscreenChange);
    // 进入时先显示控制栏，随后进入自动隐藏计时
    this.scheduleHideControls();

    // 通过 Player.js 的 onAudioSourceChanged 回调可靠检测切歌
    window.yesplaymusic.onAudioSourceChanged = () => {
      this.audioElementConnected = false;
      // 延迟 50ms 等新 Howl 完全就绪后直接重连
      setTimeout(() => {
        this.connectAudio();
      }, 50);
    };
  },

  beforeDestroy() {
    this.cleanup();
  },

  methods: {
    async initTerrain() {
      const container = this.$refs.canvasContainer;
      if (!container) return;

      this._buildScene(container);

      this.audioAnalyzer = new AudioAnalyzer();
      await this.connectAudio();
    },

    // 按设置实例化对应的可视化场景（地形 / 封面粒子）
    _buildScene(container) {
      container = container || this.$refs.canvasContainer;
      if (!container) return;

      const Scene =
        this.settings.visualizerType === 'cover'
          ? CoverParticleScene
          : TerrainScene;
      this.terrainScene = new Scene(container);
      this.terrainScene.init();
      this.updateCover();
    },

    // 把当前封面同步给场景（仅封面粒子场景实现 setCover）
    updateCover() {
      const url = this.currentTrack?.al?.picUrl;
      if (url && this.terrainScene?.setCover) {
        this.terrainScene.setCover(url);
      }
    },

    async connectAudio() {
      if (!this.audioAnalyzer || this.audioAnalyzer._initializing) return;
      const audioEl = this.player.getAudioElement();
      if (audioEl) {
        await this.audioAnalyzer.init(audioEl);
        this.audioElementConnected = true;
        if (this.player.playing) {
          await this.audioAnalyzer.play();
        }
      }
    },

    async loadLyrics(trackId) {
      try {
        const track = this.currentTrack;
        if (
          track?.pc !== null &&
          track?.cd === null &&
          this.$store.state.data.user?.userId
        ) {
          const data = await getCloudLyric(
            trackId,
            this.$store.state.data.user.userId
          );
          if (data?.lrc?.lyric) {
            this.lyrics =
              lyricParser({ lrc: { lyric: data.lrc.lyric } }).lyric || [];
          } else {
            this.lyrics = [];
          }
        } else {
          const rawLyric = await getLyric(trackId);
          const parsed = lyricParser(rawLyric);
          this.lyrics = parsed.lyric || [];
        }
        this.activeIndex = 0;
        // 切歌后强制把歌词瞬间吸附到第一句（前奏期间 activeIndex 不变，不会自动对齐）
        this._snapToActive();
      } catch (e) {
        console.warn('[VisualizerLyrics] Failed to load lyrics:', e);
        this.lyrics = [];
        this.activeIndex = 0;
        this.scrollOffset = 0;
      }
    },

    startLyricUpdate() {
      this.lyricUpdateTimer = setInterval(() => {
        if (this.lyrics.length === 0) return;
        const progress = this.player.seek(null, false);
        let idx = 0;
        for (let i = this.lyrics.length - 1; i >= 0; i--) {
          if (progress >= this.lyrics[i].time) {
            idx = i;
            break;
          }
        }
        const prevIdx = this.activeIndex;
        this.activeIndex = idx;
        // 滚轮浏览期间不让播放进度自动对齐，避免与手动滚动打架
        if (prevIdx !== idx && !this.wheeling) {
          this._updateScrollOffset();
        }
      }, 100);
    },

    // 计算让 active 行对齐到阅读锚点所需的 scrollOffset 增量
    _computeOffsetDelta() {
      const layer = this.$refs.lyricsLayer;
      const activeEl =
        this.$refs.lyricsScene?.querySelector('.lyric-line.active');
      if (!layer || !activeEl) return null;

      // 用 getBoundingClientRect 获取屏幕真实位置（含 3D transform 后的视觉位置）
      const layerRect = layer.getBoundingClientRect();
      const activeRect = activeEl.getBoundingClientRect();
      const activeCenter = activeRect.top + activeRect.height / 2;
      // 中间偏上（屏幕上方 40% 处，视觉上更舒适）
      const targetY = layerRect.top + layerRect.height * 0.4;
      return targetY - activeCenter;
    },

    _updateScrollOffset() {
      this.$nextTick(() => {
        const delta = this._computeOffsetDelta();
        if (delta !== null) this.scrollOffset += delta;
      });
    },

    // 切歌时关闭过渡、瞬间吸附到 active 行，避免被上一首未结束的动画干扰量错位置。
    // 多帧重试以等待字体/3D 布局稳定后再测量，保证一定回到第一句。
    _snapToActive() {
      this.snapping = true;
      this.scrollOffset = 0;

      let tries = 0;
      const snap = () => {
        if (this._isDestroyed || this._isBeingDestroyed) return;
        const delta = this._computeOffsetDelta();
        if (delta === null) {
          // DOM 还没准备好，继续等
          if (tries++ < 10) requestAnimationFrame(snap);
          else this.snapping = false;
          return;
        }
        this.scrollOffset += delta;
        // 已基本对齐则恢复过渡；否则再修正一帧
        if (Math.abs(delta) < 1 || tries++ >= 10) {
          requestAnimationFrame(() => {
            this.snapping = false;
          });
        } else {
          requestAnimationFrame(snap);
        }
      };
      this.$nextTick(snap);
    },

    startAudioUpdate() {
      let silentStart = 0;
      // 采样频率对齐场景帧率（30fps → ~33ms），避免超过渲染帧率的冗余计算
      const interval = this.terrainScene?._frameInterval || 1000 / 30;
      this.audioUpdateTimer = setInterval(() => {
        if (!this.audioAnalyzer || !this.terrainScene) return;
        const data = this.audioAnalyzer.getAudioData();
        this.terrainScene.updateAudioData(data);

        // 健康检查：播放中但持续 2 秒无音频能量 → 强制重连
        if (this.player.playing && data.energy < 0.01) {
          if (!silentStart) silentStart = Date.now();
          else if (Date.now() - silentStart > 2000) {
            this.audioElementConnected = false;
            silentStart = 0;
          }
        } else {
          silentStart = 0;
        }

        if (!this.audioElementConnected && !this.audioAnalyzer._initializing) {
          this.connectAudio();
        }
      }, interval);
    },

    seekTo(time) {
      this.player.seek(time);
    },

    // 计算 scrollOffset 的可滚动范围：
    // 上界 = 首句对齐到锚点（再往下滚没有内容），下界 = 末句对齐到锚点。
    _scrollBounds() {
      const layer = this.$refs.lyricsLayer;
      const lines = this.$refs.lyricsScene?.querySelectorAll('.lyric-line');
      if (!layer || !lines || lines.length === 0) return null;
      const layerRect = layer.getBoundingClientRect();
      const targetY = layerRect.top + layerRect.height * 0.4;
      const firstRect = lines[0].getBoundingClientRect();
      const lastRect = lines[lines.length - 1].getBoundingClientRect();
      const firstCenter = firstRect.top + firstRect.height / 2;
      const lastCenter = lastRect.top + lastRect.height / 2;
      // rect 已含当前 scrollOffset，反推出对齐所需的绝对 offset
      const max = this.scrollOffset + (targetY - firstCenter);
      const min = this.scrollOffset + (targetY - lastCenter);
      return { min, max };
    },

    // 滚轮上下滚动歌词（逻辑同经典歌词：手动浏览，点击某句再跳转）
    onWheel(e) {
      if (this.lyrics.length === 0) return;
      this.wheeling = true;
      // 向下滚 deltaY > 0 → 歌词上移（看后面的词）
      this.scrollOffset -= e.deltaY;
      // 限制在首句/末句之间，拉到底就不再继续滚
      const bounds = this._scrollBounds();
      if (bounds && bounds.min <= bounds.max) {
        this.scrollOffset = Math.min(
          bounds.max,
          Math.max(bounds.min, this.scrollOffset)
        );
      }
      clearTimeout(this._wheelTimer);
      // 停止滚动一段时间后恢复自动跟随
      this._wheelTimer = setTimeout(() => {
        this.wheeling = false;
      }, 3000);
    },

    exit() {
      this.$store.commit('toggleLyrics');
    },

    mute() {
      this.player.mute();
    },

    playOrPause() {
      this.player.playOrPause();
    },

    playPrevTrack() {
      this.player.playPrevTrack();
    },

    playNextTrack() {
      if (this.player.isPersonalFM) {
        this.player.playNextFMTrack();
      } else {
        this.player.playNextTrack();
      }
    },

    toggleFullscreen() {
      if (document.fullscreenElement) {
        document.exitFullscreen();
      } else {
        document.documentElement.requestFullscreen();
      }
    },

    handleFullscreenChange() {
      this.isFullscreen = !!document.fullscreenElement;
    },

    // 鼠标移动时显示控制栏，静止数秒后自动隐藏
    handleMouseMove() {
      this.controlsVisible = true;
      this.scheduleHideControls();
    },

    scheduleHideControls() {
      clearTimeout(this.controlsHideTimer);
      this.controlsHideTimer = setTimeout(() => {
        this.controlsVisible = false;
      }, 3000);
    },

    // 鼠标停留在控制栏上时保持显示
    keepControls() {
      clearTimeout(this.controlsHideTimer);
      this.controlsVisible = true;
    },

    switchToClassic() {
      this.$store.commit('updateSettings', {
        key: 'lyricsMode',
        value: 'classic',
      });
    },

    handleKeydown(e) {
      switch (e.code) {
        case 'Escape':
          // 全屏状态下 Esc 交给浏览器退出全屏，不关闭歌词
          if (!document.fullscreenElement) {
            this.exit();
          }
          break;
        case 'F11':
          e.preventDefault();
          this.toggleFullscreen();
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
      window.removeEventListener('mousemove', this.handleMouseMove);
      document.removeEventListener(
        'fullscreenchange',
        this.handleFullscreenChange
      );
      clearTimeout(this._wheelTimer);
      clearTimeout(this.controlsHideTimer);
      // 退出 3D 歌词时若仍处于浏览器全屏，主动退出，避免残留全屏
      if (document.fullscreenElement) {
        const exit = document.exitFullscreen();
        if (exit && exit.catch) exit.catch(() => {});
      }
      if (window.yesplaymusic) {
        delete window.yesplaymusic.onAudioSourceChanged;
      }

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

// ─── 左侧毛玻璃背景 ───

.lyrics-glass {
  position: absolute;
  top: 0;
  left: 0;
  bottom: 0;
  width: 46%;
  min-width: 520px;
  max-width: 820px;
  z-index: 2;
  pointer-events: none;
  backdrop-filter: blur(28px) saturate(120%);
  -webkit-backdrop-filter: blur(28px) saturate(120%);
  background: linear-gradient(
    to right,
    rgba(5, 5, 16, 0.55) 0%,
    rgba(5, 5, 16, 0.32) 55%,
    rgba(5, 5, 16, 0) 100%
  );
  // 向右渐隐，让毛玻璃与右侧清晰地形平滑过渡
  mask-image: linear-gradient(to right, black 0%, black 55%, transparent 100%);
  -webkit-mask-image: linear-gradient(
    to right,
    black 0%,
    black 55%,
    transparent 100%
  );
}

// ─── 歌词层（参照 sonic-topography LyricsDisplay）───

.lyrics-layer {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 3;
  display: flex;
  align-items: center;
  justify-content: flex-start;
  pointer-events: none;
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

.lyrics-perspective {
  perspective: 1200px;
  perspective-origin: left center;
  width: 100%;
  max-width: 760px;
  padding-left: 140px;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: flex-start;
}

.lyrics-scene-wrapper {
  position: relative;
  width: 100%;
  transition: transform 800ms cubic-bezier(0.2, 0.8, 0.2, 1);
  will-change: transform;
  transform-style: preserve-3d;

  // 滚轮浏览时跟手，无过渡
  &.wheeling {
    transition: none;
  }

  // 切歌瞬间吸附，无过渡
  &.snapping {
    transition: none;
  }
}

.lyrics-scene {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  padding-left: 50px;
  // 仅绕 Y 轴旋转：纯 rotateY 在透视下竖直线保持竖直，左对齐歌词每行屏幕 x 一致。
  // 不要叠加 rotateX —— 否则竖直位移会改变景深，导致越往下的歌词越向右偏移。
  transform: rotateY(12deg);
  transform-origin: left center;
  transform-style: preserve-3d;

  &::before,
  &::after {
    content: '';
    display: block;
    flex-shrink: 0;
    height: 45vh;
  }
}

// ─── 时间线 ───

.timeline {
  position: absolute;
  left: 18px;
  top: 0;
  bottom: 0;
  width: 1px;
  background: rgba(255, 255, 255, 0.08);
  box-shadow: 0 0 8px rgba(255, 255, 255, 0.06);
}

// ─── 歌词行 ───

.lyric-line {
  position: relative;
  display: flex;
  align-items: center;
  width: 100%;
  padding: 14px 0;
  pointer-events: auto;
  cursor: pointer;
  transition: all 700ms ease-out;
}

// ─── 时间线圆点 ───

.timeline-dot {
  position: absolute;
  left: -32px;
  top: 50%;
  transform: translateY(-50%);
  z-index: 5;
  display: flex;
  align-items: center;
  justify-content: center;
}

.dot-active {
  width: 14px;
  height: 14px;
  border-radius: 50%;
  border: 2px solid rgba(0, 206, 209, 0.9);
  background: rgba(0, 0, 0, 0.5);
  box-shadow: 0 0 15px rgba(0, 206, 209, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;

  &::after {
    content: '';
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: rgba(0, 206, 209, 1);
  }
}

.dot-inactive {
  width: 4px;
  height: 4px;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.18);
  transition: all 500ms ease-out;

  &.past {
    background: rgba(0, 206, 209, 0.4);
    box-shadow: 0 0 5px rgba(0, 206, 209, 0.2);
  }
}

// ─── 歌词文字 ───

.lyric-text {
  font-weight: 400;
  font-family: -apple-system, 'PingFang SC', 'Microsoft YaHei', serif;
  letter-spacing: 0.05em;
  white-space: pre-wrap;
  transition: all 700ms ease-out;
  transform-origin: left center;
  color: rgba(255, 255, 255, 0.45);
  font-size: 16px;
  text-shadow: 0 2px 4px rgba(0, 0, 0, 0.8);
}

.lyric-line.active .lyric-text {
  color: #ffffff;
  font-size: 36px;
  font-weight: 700;
  opacity: 1;
  transform: scale(1.08);
  text-shadow: 0 0 24px rgba(0, 206, 209, 0.7), 0 0 60px rgba(0, 206, 209, 0.35),
    0 2px 6px rgba(0, 0, 0, 0.99);
}

.lyric-line.past .lyric-text {
  color: rgba(255, 255, 255, 0.45);
  font-size: 16px;
  opacity: 1;
}

// ─── 底部控制栏（右下角，鼠标静止后自动隐藏）───

.visualizer-controls {
  position: absolute;
  bottom: 28px;
  right: 28px;
  z-index: 5;
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 8px 14px;
  border-radius: 14px;
  background: rgba(10, 10, 24, 0.55);
  backdrop-filter: blur(20px) saturate(140%);
  -webkit-backdrop-filter: blur(20px) saturate(140%);
  border: 1px solid rgba(255, 255, 255, 0.1);
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);

  .divider {
    width: 1px;
    height: 22px;
    margin: 0 6px;
    background: rgba(255, 255, 255, 0.12);
  }

  .volume-control {
    display: flex;
    align-items: center;

    .volume-bar {
      width: 80px;
      margin-left: 4px;
    }
  }

  .media-controls {
    display: flex;
    align-items: center;
  }

  // 按钮图标统一为浅色
  ::v-deep .button-icon {
    margin: 2px;

    .svg-icon {
      color: rgba(255, 255, 255, 0.85);
      height: 18px;
      width: 18px;
    }

    &:hover {
      background: rgba(255, 255, 255, 0.12);
    }
  }

  ::v-deep #play .svg-icon {
    height: 22px;
    width: 22px;
  }

  // 音量滑条配色，匹配地形场景的青色
  .volume-bar ::v-deep {
    .vue-slider-rail {
      background-color: rgba(255, 255, 255, 0.2);
    }

    .vue-slider-process {
      background-color: rgba(0, 206, 209, 0.9);
    }

    .vue-slider-dot-handle {
      background-color: #fff;
      box-shadow: 0 0 4px rgba(0, 0, 0, 0.4);
    }
  }

  .mode-switch {
    cursor: pointer;
    padding: 7px 14px;
    border-radius: 8px;
    background: rgba(255, 255, 255, 0.08);
    color: rgba(255, 255, 255, 0.6);
    font-size: 13px;
    font-weight: 600;
    letter-spacing: 1px;
    transition: all 0.2s;
    border: 1px solid rgba(255, 255, 255, 0.1);

    &:hover {
      background: rgba(255, 255, 255, 0.15);
      color: rgba(255, 255, 255, 0.9);
    }
  }
}

// 控制栏淡入淡出
.controls-fade-enter-active,
.controls-fade-leave-active {
  transition: opacity 0.3s ease, transform 0.3s ease;
}

.controls-fade-enter,
.controls-fade-leave-to {
  opacity: 0;
  transform: translateY(12px);
}

// 控制栏隐藏时一并隐藏光标（类似视频播放器）
.visualizer-lyrics.controls-hidden {
  cursor: none;
}
</style>
