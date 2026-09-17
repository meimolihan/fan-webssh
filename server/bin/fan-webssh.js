#!/usr/bin/env node
'use strict'

/**
 * fan-webssh 内置 CLI 管理命令
 *
 *   fan-webssh status
 *   fan-webssh uninstall [-y|--yes] [--purge|--keep-data]
 *   fan-webssh start | stop | restart
 *   fan-webssh version | -version | --version | -v
 *   fan-webssh help | -h | --help
 *
 * 纯 Node.js 实现，无第三方依赖。安装约定与 scripts/install.sh、scripts/uninstall.sh 保持一致。
 */

const fs = require('fs')
const path = require('path')
const readline = require('readline')
const { execFileSync } = require('child_process')

const APP_NAME = 'fan-webssh'
const SERVICE_NAME = 'fan-webssh'
const SERVICE_FILE = `/etc/systemd/system/${ SERVICE_NAME }.service`
const RECORD_FILE = `/etc/${ APP_NAME }.conf`
const BIN_NAME = APP_NAME
const WRAPPER_FILE = `/usr/local/bin/${ BIN_NAME }`
// 默认程序目录：取 CLI 自身的上一级目录（systemd 安装为 /opt/fan-webssh，容器内为 /fan-webssh）
const DEFAULT_APP_DIR = path.resolve(__dirname, '..')
const DEFAULT_DATA_DIR = `/var/lib/${ APP_NAME }`
const DEFAULT_BACKUP_DIR = '/vol2/1000/file/backup/fan-webssh-backup'
const DEFAULT_PORT = 8082

let VERSION = 'unknown'
try {
  VERSION = require(path.join(__dirname, '..', 'package.json')).version || 'unknown'
} catch {
  VERSION = 'unknown'
}

// ================== 终端配色（与 install.sh / uninstall.sh 对齐） ==================
const C = {
  grey: '\x1b[38;5;59m',
  red: '\x1b[38;5;9m',
  green: '\x1b[38;5;10m',
  yellow: '\x1b[38;5;11m',
  blue: '\x1b[38;5;32m',
  white: '\x1b[38;5;15m',
  purple: '\x1b[38;5;13m',
  cyan: '\x1b[38;5;14m',
  reset: '\x1b[0m'
}
const paint = (s, color) => `${ color }${ s }${ C.reset }`
const err = (...a) => console.log(`  ${ paint('[错误]', C.red) } ${ a.join(' ') }`)
const warn = (...a) => console.log(`  ${ paint('[警告]', C.yellow) } ${ a.join(' ') }`)
const done = (...a) => console.log(`  ${ paint('✔', C.green) } ${ a.join(' ') }`)
const section = title => console.log(`  ${ paint('▶', C.purple) } ${ title }`)
const sep = () => console.log(paint('———————————————————', C.cyan))
const kv = (k, v) => console.log(`  ${ paint(k.padEnd(14), C.blue) } ${ paint(String(v), C.white) }`)

function banner(title) {
  console.log(paint(`
   ███████╗ █████╗ ███╗   ██╗    ██╗    ██╗███████╗██████╗ ███████╗███████╗██╗  ██╗
   ██╔════╝██╔══██╗████╗  ██║    ██║    ██║██╔════╝██╔══██╗██╔════╝██╔════╝██║  ██║
   █████╗  ███████║██╔██╗ ██║    ██║ █╗ ██║█████╗  ██████╔╝███████╗███████╗███████║
   ██╔══╝  ██╔══██║██║╚██╗██║    ██║███╗██║██╔══╝  ██╔══██╗╚════██║╚════██║██╔══██║
   ██║     ██║  ██║██║ ╚████║    ╚███╔███╔╝███████╗██████╔╝███████║███████║██║  ██║
   ╚═╝     ╚═╝  ╚═╝╚═╝  ╚═══╝     ╚══╝╚══╝ ╚══════╝╚═════╝ ╚══════╝╚══════╝╚═╝  ╚═╝`, C.purple))
  console.log(`${ paint(BIN_NAME, C.white) } — ${ paint(title, C.cyan) }\n`)
}

// ================== 通用工具 ==================
function readRecord(key) {
  try {
    const content = fs.readFileSync(RECORD_FILE, 'utf8')
    for (const line of content.split('\n')) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('#')) continue
      const idx = trimmed.indexOf('=')
      if (idx === -1) continue
      if (trimmed.slice(0, idx).trim() === key) {
        return trimmed.slice(idx + 1).trim() || null
      }
    }
  } catch {
    // 无安装记录
  }
  return null
}

function resolvePaths() {
  return {
    appDir: readRecord('APP_DIR') || DEFAULT_APP_DIR,
    dataDir: readRecord('DATA_DIR') || DEFAULT_DATA_DIR,
    backupDir: readRecord('BACKUP_DIR') || DEFAULT_BACKUP_DIR,
    port: readRecord('PORT') || String(DEFAULT_PORT),
    nodeBin: readRecord('NODE_BIN') || process.execPath
  }
}

function hasCmd(name) {
  try {
    execFileSync('sh', ['-c', `command -v ${ name }`], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

function run(name, args) {
  if (!hasCmd(name)) return false
  try {
    execFileSync(name, args, { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

function readProcField(pid, field) {
  try {
    const data = fs.readFileSync(`/proc/${ pid }/status`, 'utf8')
    for (const line of data.split('\n')) {
      if (line.startsWith(`${ field }:`)) return line.slice(field.length + 1).trim()
    }
  } catch {
    // ignore
  }
  return ''
}

function procUptimeSec(pid) {
  try {
    const stat = fs.readFileSync(`/proc/${ pid }/stat`, 'utf8')
    const closeIdx = stat.lastIndexOf(')')
    if (closeIdx < 0) return 0
    const fields = stat.slice(closeIdx + 2).trim().split(/\s+/)
    const startTicks = Number(fields[19])
    if (!Number.isFinite(startTicks)) return 0
    const clk = 100
    const startSec = startTicks / clk
    const upSec = Number(fs.readFileSync('/proc/uptime', 'utf8').trim().split(/\s+/)[0])
    const elapsed = Math.floor(upSec) - startSec
    return elapsed > 0 ? Math.floor(elapsed) : 0
  } catch {
    return 0
  }
}

function formatUptime(sec) {
  if (!sec || sec <= 0) return '未知'
  return `${ Math.floor(sec / 3600) }小时 ${ Math.floor((sec % 3600) / 60) }分钟 ${ sec % 60 }秒`
}

function formatMem(raw) {
  if (!raw) return '未知'
  const parts = raw.split(/\s+/)
  const kb = Number(parts[0])
  if (!Number.isFinite(kb)) return raw
  const mb = kb / 1024
  if (mb >= 1024) return `${ raw }（${ (mb / 1024).toFixed(2) } GB）`
  return `${ raw }（${ mb.toFixed(2) } MB）`
}

function humanSize(bytes) {
  if (bytes < 1024) return `${ bytes } B`
  const units = 'KMGTPE'
  let div = 1024
  let exp = 0
  for (let n = bytes / 1024; n >= 1024 && exp < units.length - 1; n /= 1024) {
    div *= 1024
    exp++
  }
  return `${ (bytes / div).toFixed(1) } ${ units[exp] }B`
}

function isNum(s) {
  return /^[0-9]+$/.test(s)
}

function cmdlineOf(pid) {
  try {
    return fs.readFileSync(`/proc/${ pid }/cmdline`, 'utf8').replace(/\0/g, ' ').trim()
  } catch {
    return ''
  }
}

// 匹配运行中的 fan-webssh Node 进程：命令行包含 <appDir>/index.js
function matchFanWebsshProcs(appDir) {
  const marker = path.join(appDir, 'index.js')
  const pids = []
  let entries
  try {
    entries = fs.readdirSync('/proc')
  } catch {
    return pids
  }
  for (const name of entries) {
    if (!isNum(name)) continue
    const pid = Number(name)
    if (pid <= 0 || pid === process.pid) continue
    const cmdline = cmdlineOf(pid)
    if (cmdline.includes(marker)) {
      pids.push(pid)
      continue
    }
    // 兼容相对启动方式（如 `node ./index.js`，Docker 内 npm start）：匹配工作目录 + node index.js
    if (!/\bnode\b/.test(cmdline) || !/\bindex\.js\b/.test(cmdline)) continue
    try {
      if (fs.readlinkSync(`/proc/${ pid }/cwd`) === appDir) pids.push(pid)
    } catch {
      // ignore
    }
  }
  return pids.sort((a, b) => a - b)
}

function findProcess(appDir, preferPort) {
  // 1) systemd
  let out = ''
  try {
    out = execFileSync('systemctl', ['show', '-p', 'MainPID', '--value', SERVICE_NAME], { encoding: 'utf8' }).trim()
  } catch {
    out = ''
  }
  if (isNum(out) && Number(out) > 0 && fs.existsSync(`/proc/${ out }`)) {
    return { type: `systemd（${ SERVICE_NAME }.service）`, pid: Number(out) }
  }
  // 2) docker
  if (hasCmd('docker')) {
    try {
      const names = execFileSync('docker', ['ps', '--filter', `name=${ BIN_NAME }`, '--format', '{{.Names}}'], { encoding: 'utf8' })
        .split('\n').map(s => s.trim()).filter(Boolean)
      for (const n of names) {
        const pid = execFileSync('docker', ['inspect', '-f', '{{.State.Pid}}', n], { encoding: 'utf8' }).trim()
        if (isNum(pid) && Number(pid) > 0) return { type: `docker（容器 ${ n }）`, pid: Number(pid) }
      }
    } catch {
      // ignore
    }
  }
  // 3) /proc 扫描（优先选择真正监听端口的进程，兼容 npm/cluster 包装进程）
  const pids = matchFanWebsshProcs(appDir)
  for (const p of pids) {
    if (listenPort(p, preferPort)) return { type: '直接运行（/proc）', pid: p }
  }
  if (pids.length) return { type: '直接运行（/proc）', pid: pids[0] }
  return { type: '', pid: 0 }
}

function socketInodes(pid) {
  const set = new Set()
  let entries
  try {
    entries = fs.readdirSync(`/proc/${ pid }/fd`)
  } catch {
    return set
  }
  for (const name of entries) {
    try {
      const target = fs.readlinkSync(`/proc/${ pid }/fd/${ name }`)
      const m = target.match(/^socket:\[(\d+)\]$/)
      if (m) set.add(m[1])
    } catch {
      // ignore
    }
  }
  return set
}

function listenPorts(pid) {
  const inodes = socketInodes(pid)
  const ports = []
  for (const proto of ['tcp', 'tcp6']) {
    let data
    try {
      data = fs.readFileSync(`/proc/${ pid }/net/${ proto }`, 'utf8')
    } catch {
      continue
    }
    const lines = data.split('\n').slice(1)
    for (const line of lines) {
      const fields = line.trim().split(/\s+/)
      if (fields.length < 10 || fields[3] !== '0A') continue
      if (!inodes.has(fields[9])) continue
      const local = fields[1].split(':')
      const port = parseInt(local[1], 16)
      if (Number.isFinite(port) && port > 0 && !ports.includes(port)) ports.push(port)
    }
  }
  return ports
}

// listenPort 返回进程监听端口；prefer 为期望的 Web 端口（安装记录/default），命中则优先返回。
function listenPort(pid, prefer) {
  const ports = listenPorts(pid)
  const want = Number(prefer)
  if (Number.isFinite(want) && ports.includes(want)) return String(want)
  return ports.length ? String(ports[0]) : ''
}

function dirSize(dir) {
  let total = 0
  const walk = p => {
    let info
    try {
      info = fs.statSync(p)
    } catch {
      return
    }
    if (info.isDirectory()) {
      for (const e of fs.readdirSync(p)) walk(path.join(p, e))
    } else {
      total += info.size
    }
  }
  walk(dir)
  return total
}

function confirm(question, defYes) {
  return new Promise(resolve => {
    if (!process.stdin.isTTY) return resolve(defYes)
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
    const tip = defYes ? '[Y/n]' : '[y/N]'
    rl.question(`  ${ question } ${ paint(tip, C.yellow) }: `, ans => {
      rl.close()
      const a = ans.trim().toLowerCase()
      if (a === '') return resolve(defYes)
      resolve(a === 'y' || a === 'yes')
    })
  })
}

function closeFirewallPort(port) {
  const p = String(port)
  if (hasCmd('firewall-cmd')) {
    try {
      const state = execFileSync('firewall-cmd', ['--state'], { encoding: 'utf8' }).trim()
      if (state === 'running') {
        run('firewall-cmd', ['--permanent', `--remove-port=${ p }/tcp`])
        run('firewall-cmd', ['--reload'])
        done(`已通过 firewalld 关闭端口 ${ p }/tcp`)
        return
      }
    } catch {
      // ignore
    }
  }
  if (hasCmd('ufw')) {
    try {
      const state = execFileSync('ufw', ['status'], { encoding: 'utf8' })
      if (state.includes('active')) {
        run('ufw', ['delete', 'allow', `${ p }/tcp`])
        done(`已通过 ufw 关闭端口 ${ p }/tcp`)
        return
      }
    } catch {
      // ignore
    }
  }
  if (hasCmd('iptables')) {
    if (run('iptables', ['-D', 'INPUT', '-p', 'tcp', '--dport', p, '-j', 'ACCEPT'])) {
      done(`已通过 iptables 关闭端口 ${ p }/tcp`)
    }
  }
}

// ================== status ==================
function cmdStatus() {
  const { appDir, dataDir, backupDir, port } = resolvePaths()
  banner('服务状态')
  sep()

  const recordPort = readRecord('PORT')
  if (recordPort) kv('install 记录端口', recordPort)
  const recordData = readRecord('DATA_DIR')
  if (recordData) kv('install 记录数据目录', recordData)

  const { type, pid } = findProcess(appDir, port)
  if (!type || !pid) {
    err(`${ APP_NAME } 服务未运行`)
    sep()
    return 1
  }

  section('服务方式')
  kv('运行方式', type)
  kv('服务状态', hasCmd('systemctl') && run('systemctl', ['is-active', '--quiet', SERVICE_NAME]) ? '运行中' : '运行中（非 systemd）')

  section('进程信息')
  kv('进程 PID', pid)
  kv('线程数量', readProcField(pid, 'Threads') || '未知')

  section('网络')
  const lp = listenPort(pid, port)
  kv('监听端口', lp || '未找到')

  section('运行时间')
  kv('已运行', formatUptime(procUptimeSec(pid)))

  section('内存')
  kv('虚拟内存', formatMem(readProcField(pid, 'VmSize')))
  kv('物理内存', formatMem(readProcField(pid, 'VmRSS')))
  try {
    kv('打开文件', String(fs.readdirSync(`/proc/${ pid }/fd`).length))
  } catch {
    // ignore
  }

  section('路径')
  kv('程序目录', appDir)
  kv('数据目录', dataDir)
  kv('备份目录', backupDir)
  kv('安装记录', RECORD_FILE)
  kv('Node 版本', process.version)

  sep()
  return 0
}

// ================== uninstall ==================
function uninstallUsage() {
  for (const line of [
    `用法: ${ BIN_NAME } uninstall [选项]`,
    '',
    '选项:',
    '    -y, --yes        免确认，静默卸载（默认保留数据目录）',
    '    --purge          卸载时同时删除数据目录',
    '    --keep-data      卸载时保留数据目录',
    '    -h, --help       显示帮助',
    '',
    '示例:',
    `    sudo ${ BIN_NAME } uninstall -y           免确认卸载，保留数据目录`,
    `    sudo ${ BIN_NAME } uninstall -y --purge   免确认卸载，并删除数据目录`
  ]) console.log(paint(line, C.white))
}

async function cmdUninstall(args) {
  let yes = false
  let purge = false
  let keep = false
  for (const a of args) {
    switch (a) {
      case '-y':
      case '--yes':
        yes = true
        break
      case '--purge':
      case '--delete-data':
        purge = true
        break
      case '--keep-data':
        keep = true
        break
      case '-h':
      case '--help':
        uninstallUsage()
        return 0
      default:
        err(`未知参数: ${ a }，使用 -h 查看帮助`)
        return 1
    }
  }
  if (typeof process.getuid === 'function' && process.getuid() !== 0) {
    err(`请以 root 身份运行：sudo ${ BIN_NAME } uninstall`)
    return 1
  }
  if (purge && keep) {
    err('--purge 与 --keep-data 不能同时使用')
    return 1
  }

  const { appDir, dataDir, port } = resolvePaths()
  banner('卸载')
  sep()

  if (!yes && !(await confirm(`卸载将停止并移除 ${ APP_NAME } 服务与程序，是否继续`, false))) {
    console.log(paint('已取消卸载。', C.yellow))
    return 0
  }

  closeFirewallPort(port || DEFAULT_PORT)

  if (fs.existsSync(SERVICE_FILE)) {
    done(`正在停止并移除 systemd 服务 ${ APP_NAME } ...`)
    run('systemctl', ['stop', SERVICE_NAME])
    run('systemctl', ['disable', SERVICE_NAME])
    try {
      fs.unlinkSync(SERVICE_FILE)
    } catch {
      // ignore
    }
    run('systemctl', ['daemon-reload'])
    run('systemctl', ['reset-failed'])
  }

  if (hasCmd('docker')) {
    try {
      const names = execFileSync('docker', ['ps', '-a', '--filter', `name=${ BIN_NAME }`, '--format', '{{.Names}}'], { encoding: 'utf8' })
        .split('\n').map(s => s.trim()).filter(Boolean)
      for (const n of names) {
        if (n === BIN_NAME) {
          done(`正在移除容器 ${ n } ...`)
          run('docker', ['rm', '-f', n])
        }
      }
    } catch {
      // ignore
    }
  }

  const pids = matchFanWebsshProcs(appDir)
  if (pids.length) {
    done(`正在停止 ${ APP_NAME } 进程: ${ pids.join(' ') } ...`)
    for (const pid of pids) {
      try { process.kill(pid, 'SIGTERM') } catch { /* ignore */ }
    }
    await new Promise(r => setTimeout(r, 1000))
    for (const pid of pids) {
      if (fs.existsSync(`/proc/${ pid }`)) {
        try { process.kill(pid, 'SIGKILL') } catch { /* ignore */ }
      }
    }
  }

  // 移除程序目录（含 bin/fan-webssh.js 与 node_modules）
  if (fs.existsSync(appDir)) {
    try {
      fs.rmSync(appDir, { recursive: true, force: true })
      done(`已删除程序目录 ${ appDir }`)
    } catch (e) {
      warn(`删除程序目录 ${ appDir } 失败: ${ e.message }`)
    }
  } else {
    done(`未找到程序目录 ${ appDir }，跳过。`)
  }

  // 移除 CLI 软链接/包装脚本
  try {
    if (fs.existsSync(WRAPPER_FILE)) {
      fs.unlinkSync(WRAPPER_FILE)
      done(`已删除命令 ${ WRAPPER_FILE }`)
    }
  } catch {
    // ignore
  }

  // 数据目录
  let info = null
  try {
    info = fs.statSync(dataDir)
  } catch {
    info = null
  }
  if (!info || !info.isDirectory()) {
    done(`未检测到数据目录 ${ dataDir }，跳过删除。`)
  } else {
    done(`检测到数据目录: ${ dataDir }（约 ${ humanSize(dirSize(dataDir)) }）`)
    let remove = false
    if (purge) remove = true
    else if (keep) remove = false
    else if (yes) remove = false
    else remove = await confirm(`是否删除数据目录 ${ dataDir }（完全卸载）`, true)

    if (remove) {
      try {
        fs.rmSync(dataDir, { recursive: true, force: true })
        done(`已删除数据目录 ${ dataDir }`)
      } catch (e) {
        warn(`删除数据目录失败: ${ e.message }`)
      }
    } else {
      done(`已保留数据目录 ${ dataDir }`)
    }
  }

  try {
    fs.unlinkSync(RECORD_FILE)
    done(`已删除安装记录 ${ RECORD_FILE }`)
  } catch {
    // ignore
  }

  done(`${ APP_NAME } 卸载完成`)
  console.log(paint('如需重新安装，请重新运行 scripts/install.sh。', C.grey))
  return 0
}

// ================== start / stop / restart ==================
function cmdService(action) {
  if (!hasCmd('systemctl')) {
    err('当前环境没有 systemd，无法执行该操作，请手动管理进程。')
    return 1
  }
  if (!fs.existsSync(SERVICE_FILE)) {
    err(`未找到 systemd 服务 ${ SERVICE_FILE }，请先运行 scripts/install.sh 安装。`)
    return 1
  }
  banner(`${ action === 'start' ? '启动' : action === 'stop' ? '停止' : '重启' }服务`)
  const ok = run('systemctl', [action, SERVICE_NAME])
  if (!ok) {
    err(`systemctl ${ action } ${ SERVICE_NAME } 执行失败`)
    sep()
    return 1
  }
  done(`systemctl ${ action } ${ SERVICE_NAME } 完成`)
  return 0
}

// ================== help / version ==================
function cmdHelp() {
  banner('管理命令')
  const rows = [
    ['status', '显示运行方式（systemd / Docker / 直接运行）、PID、端口、运行时长、内存、路径'],
    ['start | stop | restart', '启动 / 停止 / 重启 systemd 服务'],
    ['uninstall [-y] [--purge|--keep-data]', '停止并移除服务/容器/进程，删除程序与安装记录；可选删除数据目录'],
    ['version, -version, --version, -v', '显示版本号'],
    ['help, -h, --help', '显示本帮助']
  ]
  for (const [cmd, desc] of rows) {
    console.log(`  ${ paint(cmd.padEnd(38), C.white) } ${ paint(desc, C.grey) }`)
  }
  console.log('')
  for (const line of [
    `  ${ paint('使用示例：', C.cyan) }`,
    `    ${ paint(`${ BIN_NAME } status`, C.green) }`,
    `    ${ paint(`sudo ${ BIN_NAME } uninstall -y            # 免确认卸载，保留数据目录`, C.green) }`,
    `    ${ paint(`sudo ${ BIN_NAME } uninstall -y --purge    # 免确认卸载，并删除数据目录`, C.green) }`
  ]) console.log(line)
  return 0
}

function cmdVersion() {
  console.log(`${ BIN_NAME } ${ VERSION }`)
  return 0
}

// ================== 入口 ==================
async function main() {
  const [, , sub, ...rest] = process.argv
  if (!sub) {
    cmdHelp()
    return 0
  }
  switch (sub) {
    case 'status':
      return cmdStatus()
    case 'uninstall':
      return cmdUninstall(rest)
    case 'start':
    case 'stop':
    case 'restart':
      return cmdService(sub)
    case 'version':
    case '-version':
    case '--version':
    case '-v':
      return cmdVersion()
    case 'help':
    case '-h':
    case '--help':
      cmdHelp()
      return 0
    default:
      err(`未知命令: ${ sub }`)
      console.log('')
      cmdHelp()
      return 1
  }
}

main()
  .then(code => process.exit(code || 0))
  .catch(e => {
    err(e && e.message ? e.message : String(e))
    process.exit(1)
  })
