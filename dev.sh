#!/bin/bash
set -e

# ============================================================
# YesPlayMusic 交互式开发/打包脚本
# ============================================================

PROJECT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$PROJECT_DIR"

# ─── 颜色（使用 $'...' 确保转义符被解析）───
RED=$'\033[0;31m'
GREEN=$'\033[0;32m'
YELLOW=$'\033[1;33m'
BLUE=$'\033[0;34m'
CYAN=$'\033[0;36m'
NC=$'\033[0m'

API_PID=""

# ─── 清理后台 API 进程 ───
cleanup() {
  echo ""
  if [ -n "$API_PID" ] && kill -0 "$API_PID" 2>/dev/null; then
    echo "${YELLOW}正在停止 API 服务 (PID: $API_PID)...${NC}"
    kill "$API_PID" 2>/dev/null
    wait "$API_PID" 2>/dev/null
    echo "${GREEN}API 服务已停止${NC}"
  fi
}
trap cleanup EXIT INT TERM

# ─── 检查依赖 ───
check_deps() {
  if [ ! -d "node_modules" ]; then
    echo "${YELLOW}node_modules 不存在，正在安装依赖...${NC}"
    npm install
  fi
}

# ─── 横幅 ───
banner() {
  clear
  printf "%s\n" "${CYAN}  ╔══════════════════════════════════════╗"
  printf "%s\n" "  ║        YesPlayMusic 开发工具         ║"
  printf "%s\n" "  ╚══════════════════════════════════════╝${NC}"
}

# ─── 菜单 ───
menu() {
  echo ""
  echo "${BLUE}请选择运行模式:${NC}"
  echo ""
  echo "  ${GREEN}1${NC})  本地 Web 开发         (npm run serve)"
  echo "  ${GREEN}2${NC})  本地 Web + API 服务    (前端 + 网易云 API)"
  echo "  ${GREEN}3${NC})  Electron 开发模式     (npm run electron:serve)"
  echo "  ${GREEN}4${NC})  ${YELLOW}打包 macOS${NC}           (npm run electron:build-mac)"
  echo "  ${GREEN}5${NC})  ${YELLOW}打包 Windows${NC}         (npm run electron:build-win)"
  echo "  ${GREEN}6${NC})  ${YELLOW}打包 Linux${NC}           (npm run electron:build-linux)"
  echo "  ${GREEN}7${NC})  ${YELLOW}打包全平台${NC}           (npm run electron:build-all)"
  echo "  ${RED}0${NC})  退出"
  echo ""
}

# ─── 主循环 ───
main() {
  while true; do
    banner
    menu
    read -r -p "输入数字 [0-7]: " choice

    case $choice in
      1)
        check_deps
        echo "${GREEN}启动本地 Web 开发服务器...${NC}"
        npm run serve
        ;;
      2)
        check_deps
        echo "${GREEN}启动网易云 API (后台) + 前端开发服务器...${NC}"
        echo "${YELLOW}按 Ctrl+C 退出时会自动停止 API 服务${NC}"
        npm run netease_api:run &
        API_PID=$!
        sleep 2
        echo "${GREEN}API 已启动 (PID: $API_PID)，启动前端...${NC}"
        npm run serve
        ;;
      3)
        check_deps
        echo "${GREEN}启动 Electron 开发模式...${NC}"
        npm run electron:serve
        ;;
      4)
        check_deps
        echo "${YELLOW}打包 macOS...${NC}"
        npm run electron:build-mac
        echo "${GREEN}macOS 打包完成!${NC}"
        ;;
      5)
        check_deps
        echo "${YELLOW}打包 Windows...${NC}"
        npm run electron:build-win
        echo "${GREEN}Windows 打包完成!${NC}"
        ;;
      6)
        check_deps
        echo "${YELLOW}打包 Linux...${NC}"
        npm run electron:build-linux
        echo "${GREEN}Linux 打包完成!${NC}"
        ;;
      7)
        check_deps
        echo "${YELLOW}打包全平台 (macOS + Windows + Linux)...${NC}"
        npm run electron:build-all
        echo "${GREEN}全平台打包完成!${NC}"
        ;;
      0)
        echo "${CYAN}再见!${NC}"
        exit 0
        ;;
      *)
        echo "${RED}无效选项，请重新输入${NC}"
        sleep 1
        ;;
    esac
  done
}

main
