#!/bin/bash
set -e

# ============================================================
# YesPlayMusic macOS DMG 构建脚本
# 不依赖 Python，纯用 macOS 原生 hdiutil
# ============================================================

PROJECT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$PROJECT_DIR"

APP_NAME="YesPlayMusic"
VERSION=$(node -p "require('./package.json').version" 2>/dev/null || echo "0.4.10")
BUILD_DIR="dist_electron"
DMG_DIR="$BUILD_DIR/dmg"
OUTPUT_DMG="$BUILD_DIR/${APP_NAME}-${VERSION}-arm64.dmg"

# 源 app（Apple Silicon）
SRC_APP="$BUILD_DIR/mac-arm64/${APP_NAME}.app"
# 如果 arm64 不存在，用 universal
if [ ! -d "$SRC_APP" ]; then
  SRC_APP="$BUILD_DIR/mac-universal/${APP_NAME}.app"
fi

echo "=== 第一步：构建前端 ==="
NODE_OPTIONS=--openssl-legacy-provider npx vue-cli-service build --mode production

echo ""
echo "=== 第二步：打包 Electron（跳过 DMG，只需 .app）==="
NODE_OPTIONS=--openssl-legacy-provider npx vue-cli-service electron:build -p never -m || true

# 检查 .app 是否存在
if [ ! -d "$SRC_APP" ]; then
  echo "❌ 找不到 $SRC_APP"
  echo "可用 app:"
  find "$BUILD_DIR" -name "*.app" -maxdepth 3
  exit 1
fi

echo ""
echo "=== 第三步：用 hdiutil 创建 DMG ==="

# 清理旧文件
rm -rf "$DMG_DIR" "$OUTPUT_DMG"
mkdir -p "$DMG_DIR"

# 复制 app
cp -R "$SRC_APP" "$DMG_DIR/"

# 创建 Applications 快捷方式
ln -s /Applications "$DMG_DIR/Applications"

# 创建 DMG
echo "正在创建 $OUTPUT_DMG ..."
hdiutil create \
  -volname "${APP_NAME} ${VERSION}" \
  -srcfolder "$DMG_DIR" \
  -ov \
  -format UDZO \
  "$OUTPUT_DMG"

# 清理
rm -rf "$DMG_DIR"

echo ""
echo "✅ DMG 已生成: $OUTPUT_DMG"
ls -lh "$OUTPUT_DMG"
echo ""
echo "你可以双击打开它，把 ${APP_NAME}.app 拖到 Applications 文件夹即可安装。"
