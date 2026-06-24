<template>
  <div class="visualizer-lyrics" @click.self="exit">
    <!-- Three.js 画布容器 -->
    <div ref="canvasContainer" class="canvas-container"></div>

    <!-- 歌词文字层（参照 sonic-topography LyricsDisplay） -->
    <div ref="lyricsLayer" class="lyrics-layer">
      <div class="lyrics-perspective">
        <div
          ref="lyricsSceneWrapper"
          class="lyrics-scene-wrapper"
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

    <!-- 退出提示 -->
    <div class="hint">按 Esc 退出</div>

    <!-- 切换回经典模式 -->
    <div class="mode-switch" @click="switchToClassic">
      <span>经典</span>
    </div>
  </div>
</template>

<script>
import { mapState } from 'vuex';
import { TerrainScene } from '@/components/Visualizer/TerrainScene';
import { AudioAnalyzer } from '@/utils/AudioAnalyzer';
import { lyricParser } from '@/utils/lyrics';
import { getLyric, getCloudLyric } from '@/api/track';

export default {
  name: 'VisualizerLyrics',

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
  },

  watch: {
    'currentTrack.id': {
      immediate: false,
      handler(newId) {
        if (newId) {
          this.loadLyrics(newId);
          // 不在这里 connectAudio —— 由 onAudioSourceChanged 回调 + interval 处理，
          // 避免用旧音频元素初始化导致的竞态问题
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

      this.terrainScene = new TerrainScene(container);
      this.terrainScene.init();

      this.audioAnalyzer = new AudioAnalyzer();
      await this.connectAudio();
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
        let idx = 0;
        for (let i = this.lyrics.length - 1; i >= 0; i--) {
          if (progress >= this.lyrics[i].time) {
            idx = i;
            break;
          }
        }
        const prevIdx = this.activeIndex;
        this.activeIndex = idx;
        if (prevIdx !== idx) {
          this._updateScrollOffset();
        }
      }, 100);
    },

    _updateScrollOffset() {
      this.$nextTick(() => {
        const layer = this.$refs.lyricsLayer;
        const activeEl =
          this.$refs.lyricsScene?.querySelector('.lyric-line.active');
        if (!layer || !activeEl) return;

        // 用 getBoundingClientRect 获取屏幕真实位置（含 3D transform 后的视觉位置）
        const layerRect = layer.getBoundingClientRect();
        const activeRect = activeEl.getBoundingClientRect();

        const activeCenter = activeRect.top + activeRect.height / 2;

        // 中间偏上（屏幕上方 40% 处，视觉上更舒适）
        const targetY = layerRect.top + layerRect.height * 0.4;

        this.scrollOffset += targetY - activeCenter;
      });
    },

    startAudioUpdate() {
      let silentStart = 0;
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
      }, 16);
    },

    seekTo(time) {
      this.player.seek(time);
    },

    exit() {
      this.$store.commit('toggleLyrics');
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
  justify-content: center;
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
  perspective-origin: center center;
  width: 100%;
  max-width: 800px;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
}

.lyrics-scene-wrapper {
  position: relative;
  width: 100%;
  transition: transform 800ms cubic-bezier(0.2, 0.8, 0.2, 1);
  will-change: transform;
  transform-style: preserve-3d;
}

.lyrics-scene {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  padding-left: 50px;
  transform: rotateY(20deg) rotateX(5deg);
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
  color: rgba(255, 255, 255, 0.2);
  font-size: 16px;
  opacity: 0.35;
}

// ─── 底部提示和按钮 ───

.hint {
  position: absolute;
  bottom: 32px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 4;
  color: rgba(255, 255, 255, 0.35);
  font-size: 13px;
  letter-spacing: 1px;
}

.mode-switch {
  position: absolute;
  top: 24px;
  right: 24px;
  z-index: 4;
  cursor: pointer;
  padding: 8px 16px;
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.08);
  color: rgba(255, 255, 255, 0.5);
  font-size: 13px;
  font-weight: 600;
  letter-spacing: 1px;
  transition: all 0.2s;
  border: 1px solid rgba(255, 255, 255, 0.1);

  &:hover {
    background: rgba(255, 255, 255, 0.15);
    color: rgba(255, 255, 255, 0.8);
  }
}
</style>
