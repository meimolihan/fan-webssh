#!/usr/bin/env bash
#
# fan-webssh - 多功能Linux服务器终端面板(webSSH&webSFTP) 安装脚本
# 将源码构建产物（server + web 前端）安装为 systemd 服务。
# 可重复执行，升级等同于重新安装（覆盖程序并重启服务，数据目录保留）。
#
# Usage:
#   交互式安装（将提示端口与数据目录）:
#     bash scripts/install.sh
#   参数静默安装（-p 端口 / -d 数据目录 / -s 源码目录）:
#     bash scripts/install.sh -p 8082 -d /var/lib/fan-webssh /data/fan-webssh.repo
#     bash scripts/install.sh -p 8082 -d /var/lib/fan-webssh -s /tmp/fan-webssh
#   国内网络可用镜像仓库:
#     FAN_WEBSSH_REPO=https://ghfast.top/https://github.com/meimolihan/fan-webssh.git bash scripts/install.sh -y

set -euo pipefail

# ================== terminal colors ==================
list_color_init() {
    export gl_hui=$'\033[38;5;59m'
    export gl_hong=$'\033[38;5;9m'
    export gl_lv=$'\033[38;5;10m'
    export gl_huang=$'\033[38;5;11m'
    export gl_lan=$'\033[38;5;32m'
    export gl_bai=$'\033[38;5;15m'
    export gl_zi=$'\033[38;5;13m'
    export gl_bufan=$'\033[38;5;14m'
    export reset=$'\033[0m'
}
list_color_init

sep_line() {
  printf '%s' "$gl_bufan"
  printf '—%.0s' {1..32}
  printf '%s\n' "$reset"
}

section() {
  printf "  %s %s\n" "${gl_zi}▶${reset}" "$1"
}

ok() {
  printf "  %s %s\n" "${gl_lv}>>>${reset}" "$1"
}

skip() {
  printf "  %s %s\n" "${gl_hui}--${reset}" "$1"
}

print_banner() {
  local z="$gl_zi" r="$reset" b="$gl_bai" l="$gl_lan"
  printf '%s\n' \
    "" \
    "  ${z}┌─────────────────────────────────────────┐${r}" \
    "  ${z}│${r}   ${b}fan-webssh${r}  ${l}服务器终端面板 · 安装${r}     ${z}│${r}" \
    "  ${z}└─────────────────────────────────────────┘${r}" \
    ""
}

error() { printf "  %s %s\n" "${gl_hong}[错误]${reset}" "$1" >&2; exit 1; }

# ================== customize me ==================
APP_NAME="fan-webssh"
DEFAULT_PORT=8082
APP_DIR="/opt/${APP_NAME}"
DEFAULT_DATA_DIR="/var/lib/${APP_NAME}"
CONFIG_FILE="/etc/${APP_NAME}.conf"
SERVICE_FILE="/etc/systemd/system/${APP_NAME}.service"
CLI_BIN="/usr/local/bin/${APP_NAME}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-}")" && pwd)"
DEFAULT_SRC_DIR="${SCRIPT_DIR}/.."
MIN_NODE_MAJOR=18
GITHUB_REPO="https://github.com/meimolihan/fan-webssh.git"

# 经 curl|bash 远程执行时，SCRIPT_DIR 指向 bash 抽取的临时目录，本地源码仓库
# 需按常见目录回退探测（当前目录 / 上一级目录 / 上级的上级），否则会误判"无本地源码"。
resolve_local_src() {
  local candidates=(
    "${SCRIPT_DIR:-}/.."
    "$(pwd)"
    "$(pwd)/.."
    "$(dirname "$(pwd)")"
    "$(dirname "$(dirname "$(pwd)")")"
  )
  for c in "${candidates[@]}"; do
    if [ -f "${c}/server/package.json" ] && [ -f "${c}/web/package.json" ]; then
      printf '%s' "${c}"
      return 0
    fi
  done
  return 1
}

is_valid_src() {
  [ -f "$1/server/package.json" ] && [ -f "$1/web/package.json" ]
}
# ==================================================

PORT=""
DATA_DIR=""
SRC_DIR=""
SRC_DIR_EXPLICIT=0
INSTALL_YES=0

# ---- bootstrap: support `bash -c "$(curl ...)" -p ... -d ...` ----
# In `bash -c "script" args` the first arg becomes $0, so a flag passed right
# after the script string would be invisible to the normal $1.. parsing below.
case "$0" in
  -*) set -- "$0" "$@" ;;
esac

# ---- parse command-line args (silent install) ----
while [ "$#" -gt 0 ]; do
  case "$1" in
    -p|--port)
      shift
      [ -n "${1:-}" ] || error "缺少 -p/--port 的值"
      PORT="$1"
      ;;
    -d|--data)
      shift
      [ -n "${1:-}" ] || error "缺少 -d/--data 的值"
      DATA_DIR="$1"
      ;;
    -s|--src)
      shift
      [ -n "${1:-}" ] || error "缺少 -s/--src 的值"
      SRC_DIR="$1"
      SRC_DIR_EXPLICIT=1
      ;;
    -y|--yes)
      INSTALL_YES=1
      ;;
    -h|--help)
      printf "%s\n" "${gl_lan}fan-webssh${reset} - ${gl_bai}多功能Linux服务器终端面板(webSSH&webSFTP) 安装脚本${reset}"
      printf "  %-13s %s\n" "${gl_bai}用法:${reset}" "bash scripts/install.sh [-p PORT] [-d DATA_DIR] [-s SRC] [-y]"
      printf "  %-13s %s\n" "${gl_bai}-p, --port${reset}" "监听端口（默认 ${gl_lan}${DEFAULT_PORT}${reset}）"
      printf "  %-13s %s\n" "${gl_bai}-d, --data${reset}" "数据目录（默认 ${gl_lan}${DEFAULT_DATA_DIR}${reset}）"
      printf "  %-13s %s\n" "${gl_bai}-s, --src${reset}" "源码仓库路径（默认 ${gl_lan}${DEFAULT_SRC_DIR}${reset}）"
      printf "  %-13s %s\n" "${gl_bai}-y, --yes${reset}" "免交互，未指定项全部使用默认值"
      printf "  %-13s %s\n" "${gl_bai}-h, --help${reset}" "显示本帮助"
      printf "%s\n" "${gl_hui}指定任意参数即进入静默安装；不带参数则为交互式安装。${reset}"
      printf "%s\n" "${gl_hui}未指定 -s 且本地无源码仓库时，自动从 GitHub 克隆/下载最新源码进行编译安装。${reset}"
      printf "%s\n" "${gl_hui}国内网络可设 FAN_WEBSSH_REPO 自定义仓库或镜像地址，如 FAN_WEBSSH_REPO=https://ghfast.top/https://github.com/meimolihan/fan-webssh.git${reset}"
      printf "%s\n" "${gl_hui}首次运行的用户名/密码为随机生成，请查看服务日志：journalctl -u fan-webssh -n 50${reset}"
      exit 0
      ;;
    *)
      error "未知参数: $1（使用 -h 查看帮助）"
      ;;
  esac
  shift
done

# ---- firewall: automatically open the listen port ----
FW_OPENED="n"
open_firewall_port() {
  local PORT="$1"
  if command -v firewall-cmd >/dev/null 2>&1 && firewall-cmd --state >/dev/null 2>&1; then
    if ! firewall-cmd --query-port="${PORT}/tcp" >/dev/null 2>&1; then
      firewall-cmd --permanent --add-port="${PORT}/tcp" >/dev/null 2>&1 || true
      firewall-cmd --reload >/dev/null 2>&1 || true
    fi
    ok "已通过 ${gl_bai}firewalld${reset} 开放端口 ${gl_lan}${PORT}/tcp${reset}"
    FW_OPENED="y"
    return 0
  fi

  if command -v ufw >/dev/null 2>&1 && ufw status 2>/dev/null | grep -q "Status: active"; then
    if ! ufw status 2>/dev/null | grep -q "${PORT}/tcp"; then
      ufw allow "${PORT}/tcp" >/dev/null 2>&1 || true
    fi
    ok "已通过 ${gl_bai}ufw${reset} 开放端口 ${gl_lan}${PORT}/tcp${reset}"
    FW_OPENED="y"
    return 0
  fi

  if command -v iptables >/dev/null 2>&1; then
    if iptables -C INPUT -p tcp --dport "${PORT}" -j ACCEPT >/dev/null 2>&1; then
      ok "端口 ${gl_lan}${PORT}/tcp${reset} 已在 iptables 中放行"
      FW_OPENED="y"
      return 0
    fi
    if iptables -L INPUT -n 2>/dev/null | grep -qE 'policy (DROP|REJECT)|REJECT|DROP'; then
      if iptables -I INPUT -p tcp --dport "${PORT}" -j ACCEPT >/dev/null 2>&1; then
        ok "已通过 ${gl_bai}iptables${reset} 开放端口 ${gl_lan}${PORT}/tcp${reset}"
        FW_OPENED="y"
        return 0
      fi
    fi
  fi
  printf "  %s %s\n" "${gl_huang}[提示]${reset}" "未检测到活跃的防火墙（firewalld/ufw/iptables），跳过端口开放。"
}

[ "$(id -u)" != "0" ] && error "请以 root 身份运行（例如 sudo bash scripts/install.sh）"

print_banner
sep_line
section "安装信息"
printf "  %-14s %s\n" "${gl_lan}系统${reset}" "$(uname -s) $(uname -m)"
printf "  %-14s %s\n" "${gl_lan}程序${reset}" "${gl_bai}${APP_NAME}${reset}"
sep_line

# ---- 运行时依赖检查 ----
if ! command -v node >/dev/null 2>&1; then
  error "未检测到 Node.js，请先安装（要求 >= v${MIN_NODE_MAJOR}），例如：apt install nodejs npm / 或使用 nvm/官方安装包"
fi
NODE_MAJOR="$(node -e 'console.log(process.versions.node.split(".")[0])' 2>/dev/null || echo 0)"
if [ "${NODE_MAJOR}" -lt "${MIN_NODE_MAJOR}" ]; then
  error "Node.js 版本过低（当前 $(node -v)），要求 >= v${MIN_NODE_MAJOR}"
fi
NPM_CMD="$(command -v npm || true)"
if [ -z "${NPM_CMD}" ]; then
  error "未检测到 npm，Node.js 安装异常，请检查安装。"
fi
INSTALL_TOOL="npm"
if command -v yarn >/dev/null 2>&1; then
  INSTALL_TOOL="yarn"
fi
ok "Node.js $(node -v) / 包管理器 ${gl_bai}${INSTALL_TOOL}${reset}"

# ---- silent install detection ----
SILENT="n"
if [ -n "${PORT}" ]; then
  case "${PORT}" in
    ''|*[!0-9]*) error "PORT 无效（需为 1‑65535 的数字）: ${PORT}" ;;
    *) [ "${PORT}" -ge 1 ] && [ "${PORT}" -le 65535 ] || error "PORT 超出范围（1‑65535）: ${PORT}" ;;
  esac
  SILENT="y"
fi
if [ -n "${DATA_DIR}" ]; then
  SILENT="y"
fi
if [ -n "${SRC_DIR}" ]; then
  SILENT="y"
fi
if [ ! -t 0 ]; then
  SILENT="y"
fi

section "配置参数"
# port prompt
if [ -z "${PORT}" ]; then
  if [ "$INSTALL_YES" = "1" ] || [ ! -t 0 ]; then
    PORT="${DEFAULT_PORT}"
  else
    while :; do
      read -r -p "${gl_bai}请输入监听端口${reset} ${gl_hui}[默认: ${DEFAULT_PORT}]${reset}: " PORT
      PORT="${PORT:-$DEFAULT_PORT}"
      case "$PORT" in
        ''|*[!0-9]*) printf "  %s\n" "${gl_huang}端口无效，请重新输入。${reset}" ;;
        *)
          if [ "$PORT" -ge 1 ] && [ "$PORT" -le 65535 ]; then break; fi
          printf "  %s\n" "${gl_huang}端口超出范围（1‑65535），请重新输入。${reset}"
          ;;
      esac
    done
  fi
else
  printf "  %-14s %s\n" "${gl_lan}监听端口${reset}" "${gl_bai}${PORT}${reset}（参数指定）"
fi
PORT="${PORT:-$DEFAULT_PORT}"

# data dir prompt
if [ -z "${DATA_DIR}" ]; then
  if [ "$INSTALL_YES" = "1" ] || [ ! -t 0 ]; then
    DATA_DIR="${DEFAULT_DATA_DIR}"
  else
    read -r -p "${gl_bai}请输入数据目录${reset} ${gl_hui}[默认: ${DEFAULT_DATA_DIR}]${reset}: " DATA_DIR
    DATA_DIR="${DATA_DIR:-$DEFAULT_DATA_DIR}"
  fi
else
  printf "  %-14s %s\n" "${gl_lan}数据目录${reset}" "${gl_bai}${DATA_DIR}${reset}（参数指定）"
fi
DATA_DIR="${DATA_DIR:-$DEFAULT_DATA_DIR}"

# source repo
SRC_DIR="${SRC_DIR:-$DEFAULT_SRC_DIR}"
if ! is_valid_src "${SRC_DIR}"; then
  if [ "${SRC_DIR_EXPLICIT}" != "1" ]; then
    DISCOVERED_SRC="$(resolve_local_src)" || true
    if [ -n "${DISCOVERED_SRC:-}" ]; then
      ok "已从仓库目录发现本地源码 ${gl_bai}${DISCOVERED_SRC}${reset}"
      SRC_DIR="${DISCOVERED_SRC}"
    fi
  fi
fi
if ! is_valid_src "${SRC_DIR}"; then
  if [ "${SRC_DIR_EXPLICIT}" = "1" ]; then
    error "未找到源码仓库 ${SRC_DIR}（-s 显式指定，需包含 server/ 与 web/ 目录）"
  fi
  ok "本地无源码仓库，尝试获取源码（可用环境变量 FAN_WEBSSH_REPO 自定义仓库地址）"
  TMP_ROOT="$(mktemp -d)"
  TMP_SRC="${TMP_ROOT}/fan-webssh"

  # 候选仓库源：自定义 > GitHub 加速代理 > GitHub 主站（国内直连 GitHub 常超时）
  REPO_CANDIDATES=(
    "${FAN_WEBSSH_REPO:-}"
    "https://git.221022.xyz/${GITHUB_REPO}"
    "https://ghfast.top/${GITHUB_REPO}"
    "${GITHUB_REPO}"
  )

  FETCHED="n"
  if command -v timeout >/dev/null 2>&1; then CLONE_TIMEOUT="timeout 90"; else CLONE_TIMEOUT=""; fi

  if command -v git >/dev/null 2>&1; then
    for repo in "${REPO_CANDIDATES[@]}"; do
      [ -n "${repo}" ] || continue
      skip "尝试 git clone ${gl_bai}${repo}${reset}"
      if ${CLONE_TIMEOUT} git clone --depth=1 "${repo}" "${TMP_SRC}" 2>"${TMP_ROOT}/clone.err"; then
        FETCHED="y"
        break
      fi
      printf "  %s %s\n" "${gl_huang}[警告]${reset}" "克隆失败：$(tail -n 1 "${TMP_ROOT}/clone.err" 2>/dev/null)"
      rm -rf "${TMP_SRC}"
    done
  else
    printf "  %s %s\n" "${gl_huang}[警告]${reset}" "未检测到 git，跳过 git clone，改用源码压缩包"
  fi

  # 回退：下载源码压缩包并解压（无需 git，走与脚本下载一致的加速线路）
  if [ "${FETCHED}" != "y" ]; then
    ARCHIVE_URLS=(
      "https://git.221022.xyz/https://github.com/meimolihan/fan-webssh/archive/refs/heads/main.tar.gz"
      "https://ghfast.top/https://github.com/meimolihan/fan-webssh/archive/refs/heads/main.tar.gz"
      "https://github.com/meimolihan/fan-webssh/archive/refs/heads/main.tar.gz"
      "https://codeload.github.com/meimolihan/fan-webssh/tar.gz/refs/heads/main"
    )
    if command -v curl >/dev/null 2>&1; then
      DL_CMD="curl -fsSL"
    elif command -v wget >/dev/null 2>&1; then
      DL_CMD="wget -qO-"
    else
      DL_CMD=""
    fi
    for url in "${ARCHIVE_URLS[@]}"; do
      [ -n "${url}" ] || continue
      [ -n "${DL_CMD}" ] || break
      skip "尝试下载源码包 ${gl_bai}${url}${reset}"
      TMP_TGZ="${TMP_ROOT}/src.tar.gz"
      if ${DL_CMD} "${url}" > "${TMP_TGZ}" 2>/dev/null \
        && tar -xzf "${TMP_TGZ}" -C "${TMP_ROOT}" 2>/dev/null; then
        EXTRACTED="$(find "${TMP_ROOT}" -maxdepth 1 -type d -name 'fan-webssh-*' -print -quit 2>/dev/null)"
        if [ -n "${EXTRACTED}" ]; then
          mv "${EXTRACTED}" "${TMP_SRC}"
          FETCHED="y"
          break
        fi
      fi
      printf "  %s %s\n" "${gl_huang}[警告]${reset}" "下载失败：${url}"
      rm -f "${TMP_TGZ}"
    done
  fi

  [ "${FETCHED}" = "y" ] || error "获取源码仓库失败，请检查服务器网络，或使用 -s 指定本地源码目录"
  SRC_DIR="${TMP_SRC}"
  ok "已获取源码仓库"
fi

if command -v systemctl >/dev/null 2>&1; then
  USE_SYSTEMD="y"
else
  USE_SYSTEMD="n"
  printf "  %s\n" "${gl_huang}[警告]${reset} 未检测到 systemd（容器或受限环境）。"
  printf "  %s\n" "${gl_hui}    已回退为后台运行模式，重启或崩溃后服务不会自动恢复。${reset}"
fi

sep_line
section "安装程序"
ok "正在安装 ${gl_bai}${APP_NAME}${reset} 程序 ${gl_hong}.${gl_huang}.${gl_lv}.${gl_bai}"

# 1) 拷贝 server 源码到安装目录
mkdir -p "${APP_DIR}"
cp -rf "${SRC_DIR}/server/." "${APP_DIR}/"
rm -f "${APP_DIR}/.env"
ok "已拷贝服务端源码至 ${gl_bai}${APP_DIR}${reset}"

# 1.1) 拷贝运维脚本（备份/还原脚本供面板"服务管理"调用，也便于手动执行）
if [ -d "${SRC_DIR}/scripts" ]; then
  mkdir -p "${APP_DIR}/scripts"
  cp -rf "${SRC_DIR}/scripts/." "${APP_DIR}/scripts/"
  chmod +x "${APP_DIR}"/scripts/*.sh 2>/dev/null || true
  ok "已部署运维脚本至 ${gl_bai}${APP_DIR}/scripts${reset}"
fi

# 2) 安装服务端生产依赖
ok "正在安装服务端依赖（${INSTALL_TOOL}） ${gl_hong}.${gl_huang}.${gl_lv}.${gl_bai}"
if [ "${INSTALL_TOOL}" = "yarn" ]; then
  ( cd "${APP_DIR}" && yarn install --production --non-interactive >/dev/null )
else
  ( cd "${APP_DIR}" && npm install --omit=dev --no-audit --no-fund >/dev/null )
fi
ok "服务端依赖安装完成"

# 3) 构建 web 前端
ok "正在构建 web 前端 ${gl_hong}.${gl_huang}.${gl_lv}.${gl_bai}"
if [ "${INSTALL_TOOL}" = "yarn" ]; then
  ( cd "${SRC_DIR}/web" && yarn install --non-interactive >/dev/null && yarn build >/dev/null )
else
  ( cd "${SRC_DIR}/web" && npm install --no-audit --no-fund >/dev/null && npm run build >/dev/null )
fi
mkdir -p "${APP_DIR}/app/static"
cp -rf "${SRC_DIR}/web/dist/." "${APP_DIR}/app/static/"
ok "前端构建完成，已部署至 ${gl_bai}${APP_DIR}/app/static${reset}"

# 4) 数据目录 & 软链接（数据与程序分离，便于备份/还原）
rm -rf "${APP_DIR}/app/db"
mkdir -p "${DATA_DIR}"
ln -s "${DATA_DIR}" "${APP_DIR}/app/db"
chmod 700 "${DATA_DIR}"
ok "数据目录 ${gl_lan}${DATA_DIR}${reset} 已就绪（app/db 软链至数据目录）"

# 5) 安装记录
mkdir -p "$(dirname "${CONFIG_FILE}")"
cat > "${CONFIG_FILE}" <<EOF
# ${APP_NAME} 安装记录（由 install.sh 生成，请勿手动修改）
APP_DIR=${APP_DIR}
PORT=${PORT}
DATA_DIR=${DATA_DIR}
NODE_BIN=$(command -v node)
EOF
chmod 0644 "${CONFIG_FILE}"
ok "已写入安装记录 ${gl_bai}${CONFIG_FILE}${reset}"

# 6) 安装内置 CLI 命令
mkdir -p "$(dirname "${CLI_BIN}")"
cat > "${CLI_BIN}" <<CLI
#!/bin/sh
exec "$(command -v node)" "${APP_DIR}/bin/fan-webssh.js" "\$@"
CLI
chmod +x "${CLI_BIN}"
ok "已安装命令 ${gl_bai}${CLI_BIN}${reset}（运行 ${gl_bai}${APP_NAME} help${reset} 查看用法）"

sep_line
section "启动服务"
if [ "${USE_SYSTEMD}" = "y" ]; then
  cat > "${SERVICE_FILE}" <<UNIT
[Unit]
Description=${APP_NAME} - 多功能Linux服务器终端面板(webSSH&webSFTP)
After=network-online.target local-fs.target
Wants=network-online.target

[Service]
Type=simple
ExecStart=$(command -v node) ${APP_DIR}/index.js
WorkingDirectory=${APP_DIR}
Environment=HTTP_PORT=${PORT}
Environment=DEBUG=true
Environment=GUACD_HOST=127.0.0.1
Environment=GUACD_PORT=4822
Environment=TZ=Asia/Shanghai
Restart=on-failure
RestartSec=3

[Install]
WantedBy=multi-user.target
UNIT

  systemctl daemon-reload
  systemctl enable "${APP_NAME}" >/dev/null 2>&1 || true
  systemctl restart "${APP_NAME}"
  sleep 3
  if systemctl is-active "${APP_NAME}" >/dev/null 2>&1; then
    ok "${gl_bai}${APP_NAME}${reset} 服务已启动。"
    systemctl status "${APP_NAME}" --no-pager || true
  else
    printf "  %s\n" "${gl_hong}[错误]${reset} 服务启动失败，请检查：${gl_bai}journalctl -u ${APP_NAME} -n 50${reset}" >&2
    exit 1
  fi
else
  if command -v pgrep >/dev/null 2>&1 && pgrep -f "${APP_DIR}/index.js" >/dev/null 2>&1; then
    printf "  %s\n" "${gl_huang}[警告]${reset} 检测到 ${APP_NAME} 进程可能已在运行"
  else
    env HTTP_PORT="${PORT}" \
        DEBUG=true \
        GUACD_HOST=127.0.0.1 \
        GUACD_PORT=4822 \
        nohup node "${APP_DIR}/index.js" >> "${DATA_DIR}/${APP_NAME}.log" 2>&1 &
    ok "${APP_NAME} 已在后台启动，pid: ${gl_bai}$!${reset}"
  fi
fi

# 取第一个IPv4
IP=$(hostname -I 2>/dev/null | awk '{print $1}')
[ -z "${IP}" ] && IP="<服务器IP>"

open_firewall_port "${PORT}"

if [ "${FW_OPENED}" = "y" ]; then
  FW_STATUS="${gl_lv}已开放 ${PORT}/tcp${reset}"
else
  FW_STATUS="${gl_huang}未检测到活跃防火墙，已跳过${reset}"
fi

sep_line
if [ "${USE_SYSTEMD}" = "y" ]; then
  printf "  %s\n" "${gl_lv}✔ ${APP_NAME} 安装成功！${reset}"
  printf "  %-14s %s\n" "${gl_lan}访问地址${reset}" "${gl_bai}http://${IP}:${PORT}${reset}"
  printf "  %-14s %s\n" "${gl_lan}数据目录${reset}" "${gl_bai}${DATA_DIR}${reset}"
  printf "  %-14s %s\n" "${gl_lan}程序目录${reset}" "${gl_bai}${APP_DIR}${reset}"
  printf "  %-14s %s\n" "${gl_lan}防火墙状态${reset}" "$FW_STATUS"
  printf "  %-14s %s\n" "${gl_lan}运行模式${reset}" "${gl_bai}systemd 服务${reset}"
  printf "  %-14s %s\n" "${gl_lan}服务命令${reset}" "${gl_hui}systemctl status ${APP_NAME}${reset}"
  printf "  %-14s %s\n" "${gl_lan}升级方式${reset}" "${gl_hui}重新执行 scripts/install.sh（数据自动保留）${reset}"
else
  printf "  %s\n" "${gl_lv}✔ ${APP_NAME} 安装成功！${reset} ${gl_huang}（后台运行模式）${reset}"
  printf "  %-14s %s\n" "${gl_lan}访问地址${reset}" "${gl_bai}http://${IP}:${PORT}${reset}"
  printf "  %-14s %s\n" "${gl_lan}数据目录${reset}" "${gl_bai}${DATA_DIR}${reset}"
  printf "  %-14s %s\n" "${gl_lan}程序目录${reset}" "${gl_bai}${APP_DIR}${reset}"
  printf "  %s\n" "  ${gl_huang}注意：${reset}后台运行模式在系统重启后不会自动恢复。"
fi
printf "%s\n" "  ${gl_huang}注意：${reset}首次运行的用户名/密码为随机生成，请查看日志：${gl_bai}journalctl -u fan-webssh -n 50${reset}"
sep_line