const fs = require('fs')
const path = require('path')
const { execFile, spawn } = require('child_process')

const SERVICE_NAME = 'fan-webssh'
const CONFIG_FILE = '/etc/fan-webssh.conf'
const DEFAULT_APP_DIR = '/var/lib/fan-webssh'
const DEFAULT_DATA_DIR = '/var/lib/fan-webssh/app/db'
const DEFAULT_BACKUP_DIR = '' // 空表示缺省取 `${appDir}/backup`
const SCRIPTS_REL_DIR = 'scripts'
const JOBS_REL_DIR = '.jobs'
const MAX_OUTPUT_LINES = 200

// 备份/还原脚本会停止并重启 fan-webssh 服务，本进程会被短暂杀死，
// 内存中的任务状态会丢失，故任务输出写入备份目录下的日志文件，由客户端轮询。
const runningJobs = new Map() // jobId -> child process（进程存活期间有效）
let jobIdSeed = 0

const readSystemConfig = () => {
  const cfg = {
    appDir: DEFAULT_APP_DIR,
    dataDir: DEFAULT_DATA_DIR,
    backupDir: DEFAULT_BACKUP_DIR,
    configFile: CONFIG_FILE
  }
  try {
    const raw = fs.readFileSync(CONFIG_FILE, 'utf8')
    for (const line of raw.split('\n')) {
      const match = line.match(/^([A-Z_]+)=(.*)$/)
      if (!match) continue
      const key = match[1]
      const value = match[2].replace(/\r$/, '')
      if (key === 'APP_DIR' && value) cfg.appDir = value
      if (key === 'DATA_DIR' && value) cfg.dataDir = value
      if (key === 'BACKUP_DIR' && value) cfg.backupDir = value
    }
  } catch {
    // 配置不存在时使用默认值
  }
  // 备份目录缺省取 `安装目录/backup`，避免硬编码路径
  cfg.backupDir = cfg.backupDir || path.join(cfg.appDir, 'backup')
  return cfg
}

const isDocker = () => fs.existsSync('/.dockerenv') || fs.existsSync('/run/.containerenv')

const isSystemdAvailable = () => fs.existsSync('/run/systemd/system') && fs.existsSync('/run/initctl') === false

const execFileAsync = (cmd, args, opts = {}) =>
  new Promise((resolve, reject) => {
    execFile(cmd, args, { timeout: 10000, ...opts }, (err, stdout, stderr) => {
      if (err) reject(Object.assign(err, { stdout, stderr }))
      else resolve({ stdout, stderr })
    })
  })

// 去除终端 ANSI 转义序列（颜色/样式码），脚本在真实终端保留颜色，
// 面板"执行日志"为纯文本展示，需剥离后渲染，避免出现 \x1b[38;5;xxm 乱码。
const stripAnsi = (str = '') =>
  str
    .replace(/\x1b\[[0-9;]*[A-Za-z]/g, '')
    .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, '')
    .replace(/\x1b[()][0-9A-Za-z]/g, '')

const readTail = (file, lines = MAX_OUTPUT_LINES) => {
  try {
    const content = fs.readFileSync(file, 'utf8')
    const arr = stripAnsi(content).split('\n').filter(line => line.trim() !== '')
    return arr.slice(-lines).join('\n')
  } catch {
    return ''
  }
}

const listBackupFiles = (backupDir) => {
  try {
    if (!fs.existsSync(backupDir)) return []
    return fs
      .readdirSync(backupDir, { withFileTypes: true })
      .filter(f => f.isFile() && /^FanWebSSH-.*\.tar\.gz$/.test(f.name))
      .map(f => ({
        name: f.name,
        size: fs.statSync(path.join(backupDir, f.name)).size,
        mtime: fs.statSync(path.join(backupDir, f.name)).mtimeMs
      }))
      .sort((a, b) => b.mtime - a.mtime)
  } catch (error) {
    logger.error('Failed to list backup files:', error.message)
    return []
  }
}

const getServiceStatus = async () => {
  const docker = isDocker()
  if (docker) return { runMode: 'docker', active: true, enabled: true, status: 'docker' }
  if (!isSystemdAvailable()) return { runMode: 'standalone', active: null, enabled: null, status: 'unknown' }
  const isActive = await execFileAsync('systemctl', ['is-active', SERVICE_NAME]).then(r => r.stdout.trim()).catch(() => 'unknown')
  const isEnabled = await execFileAsync('systemctl', ['is-enabled', SERVICE_NAME]).then(r => r.stdout.trim()).catch(() => 'unknown')
  const hasUnit = fs.existsSync(`/etc/systemd/system/${ SERVICE_NAME }.service`)
  return { runMode: 'systemd', hasUnit, active: isActive, enabled: isEnabled, status: isActive }
}

const scriptsDirOf = cfg => path.join(cfg.appDir, SCRIPTS_REL_DIR)

// 校验服务端脚本是否存在并给出可执行提示
const checkScripts = (cfg, name) => {
  const scriptPath = path.join(scriptsDirOf(cfg), name)
  if (!fs.existsSync(scriptPath)) {
    throw new Error(`未找到脚本 ${ scriptPath }，请使用官方 install.sh 部署后再使用本功能`)
  }
  return scriptPath
}

// 后台执行脚本并写入日志，返回 { jobId, logPath }
const startJob = (cfg, scriptName, args) => {
  const scriptPath = checkScripts(cfg, scriptName)
  const jobId = `${ Date.now() }-${ jobIdSeed++ }`
  const jobsDir = path.join(cfg.backupDir, JOBS_REL_DIR)
  fs.mkdirSync(jobsDir, { recursive: true })
  const logPath = path.join(jobsDir, `${ jobId }.log`)

  logger.info(`Starting ${ scriptName } job ${ jobId }:`, [scriptPath].concat(args).join(' '))
  const spawnDetached = (bin, argv) =>
    spawn(bin, argv, {
      stdio: ['ignore', fs.openSync(logPath, 'a'), fs.openSync(logPath, 'a')],
      detached: true
    })

  // 备份/还原脚本会执行 systemctl stop 本服务；若脚本由面板进程直接 spawn，
  // 它会落在本服务同一个 cgroup 内，stop 会把脚本自身一并终止（任务中途夭折）。
  // 因此优先以 systemd-run 创建独立 transient service（system.slice 顶层 cgroup），
  // 完全脱离本服务的 cgroup，systemctl stop 不会波及脚本。
  const bin = '/usr/bin/bash'
  const useScope = isSystemdAvailable() && fs.existsSync('/usr/bin/systemd-run')
  let child
  let scoped = null
  if (useScope) {
    scoped = spawnDetached('systemd-run', ['--quiet', '--unit', `fan-webssh-job-${ jobId }`, '--', bin, scriptPath, ...args])
    child = scoped
    scoped.on('error', () => {
      // systemd-run 不可用/受限时回退为直接执行
      const fallback = spawnDetached(bin, [scriptPath, ...args])
      fallback.unref()
      runningJobs.set(jobId, fallback)
      fallback.on('exit', () => runningJobs.delete(jobId))
      fallback.on('error', () => runningJobs.delete(jobId))
    })
  } else {
    child = spawnDetached(bin, [scriptPath, ...args])
  }
  child.unref()
  runningJobs.set(jobId, child)
  child.on('exit', () => runningJobs.delete(jobId))
  child.on('error', () => runningJobs.delete(jobId))
  return { jobId, logPath }
}

// isActive 可能为正在启动/停止等过程态，合并输出判断任务是否收尾
const jobFinishedByLog = (log) => {
  if (!log) return false
  return /备份完成|✅ 服务状态|❌/.test(log)
}

const jobFailedByLog = log => /❌/.test(log)

const getSystemInfo = async ({ res }) => {
  const cfg = readSystemConfig()
  const service = await getServiceStatus()
  const scriptsDir = scriptsDirOf(cfg)
  const data = {
    runMode: service.runMode,
    service: SERVICE_NAME,
    serviceStatus: service.status,
    active: service.active,
    enabled: service.enabled,
    hasUnit: service.hasUnit,
    appDir: cfg.appDir,
    dataDir: cfg.dataDir,
    backupDir: cfg.backupDir,
    configFile: cfg.configFile,
    scriptsAvailable: fs.existsSync(path.join(scriptsDir, 'fan-webssh_backup.sh')) && fs.existsSync(path.join(scriptsDir, 'fan-webssh_recover.sh')),
    backups: listBackupFiles(cfg.backupDir),
    language: global.__LOCALE__ === 'zh' ? 'zh' : 'en',
    inDocker: isDocker()
  }
  res.success({ data, msg: 'success' })
}

const systemStart = async ({ res }) => {
  const { runMode } = await getServiceStatus()
  if (runMode !== 'systemd') return res.fail({ msg: '当前为非 systemd 运行模式，无需此操作' })
  res.success({ data: { runMode }, msg: '任务已提交' })
  await execFileAsync('systemctl', ['start', SERVICE_NAME]).catch(() => {})
  logger.info('System service started')
}

const systemStop = async ({ res }) => {
  const { runMode } = await getServiceStatus()
  if (runMode !== 'systemd') return res.fail({ msg: '当前为非 systemd 运行模式，无需此操作' })
  res.success({ data: { runMode }, msg: '服务已停止' })
  await execFileAsync('systemctl', ['stop', SERVICE_NAME]).catch(() => {})
  logger.info('System service stopped')
}

const systemRestart = async ({ res }) => {
  const { runMode } = await getServiceStatus()
  if (runMode !== 'systemd') return res.fail({ msg: '当前为非 systemd 运行模式，无需此操作' })
  res.success({ data: { runMode }, msg: '服务正在重启...' })
  await execFileAsync('systemctl', ['restart', SERVICE_NAME]).catch(() => {})
  logger.info('System service restarted')
}

const systemBackup = async ({ res, request }) => {
  const cfg = readSystemConfig()
  const { keepNum = 6, backupDir = cfg.backupDir } = request.body || {}
  try {
    const { jobId, logPath } = startJob(cfg, 'fan-webssh_backup.sh', [String(keepNum), backupDir])
    res.success({ data: { jobId, logPath }, msg: '备份任务已启动' })
  } catch (error) {
    logger.error('Failed to start backup:', error.message)
    res.fail({ msg: error.message })
  }
}

const systemRecover = async ({ res, request }) => {
  const cfg = readSystemConfig()
  const { fileName, backupDir = cfg.backupDir } = request.body || {}
  if (fileName) {
    const target = path.join(backupDir, path.basename(fileName))
    if (!/^FanWebSSH-.*\.tar\.gz$/.test(path.basename(fileName)) || !fs.existsSync(target)) {
      return res.fail({ msg: '指定的备份文件不存在' })
    }
  }
  try {
    const args = [backupDir].concat(fileName ? [path.basename(String(fileName))] : [])
    const { jobId, logPath } = startJob(cfg, 'fan-webssh_recover.sh', args)
    res.success({ data: { jobId, logPath }, msg: '恢复任务已启动' })
  } catch (error) {
    logger.error('Failed to start recover:', error.message)
    res.fail({ msg: error.message })
  }
}

const systemDeleteBackup = async ({ res, request }) => {
  const cfg = readSystemConfig()
  const { fileName } = request.body || {}
  if (!fileName) return res.fail({ msg: '缺少备份文件名' })
  const name = path.basename(String(fileName))
  if (!/^FanWebSSH-.*\.tar\.gz$/.test(name)) return res.fail({ msg: '非法的备份文件名' })
  const target = path.join(cfg.backupDir, name)
  if (!fs.existsSync(target)) return res.fail({ msg: '备份文件不存在' })
  try {
    fs.unlinkSync(target)
    logger.info(`Deleted backup file: ${ target }`)
    res.success({ data: { backups: listBackupFiles(cfg.backupDir) }, msg: '备份已删除' })
  } catch (error) {
    logger.error('Failed to delete backup:', error.message)
    res.fail({ msg: `删除失败：${ error.message }` })
  }
}

const getSystemJob = async ({ res, request }) => {
  const cfg = readSystemConfig()
  const { jobId, logPath } = request.query || {}
  if (!jobId || !logPath) return res.fail({ msg: '缺少任务参数' })
  const jobsDir = path.join(cfg.backupDir, JOBS_REL_DIR)
  const resolvedLogPath = path.resolve(String(logPath))
  if (!String(resolvedLogPath).startsWith(path.resolve(jobsDir))) return res.fail({ msg: '非法日志路径' })
  const log = readTail(resolvedLogPath)
  const service = await getServiceStatus()

  const childAlive = runningJobs.has(jobId)
  const finished = !childAlive && jobFinishedByLog(log)

  // 恢复任务完成后服务会被重启，此时 appDir 不变、备份文件由脚本还原进数据目录
  const data = {
    jobId,
    running: childAlive,
    finished,
    failed: jobFailedByLog(log),
    serviceStatus: service.status,
    runMode: service.runMode,
    log
  }
  res.success({ data, msg: 'success' })
}

module.exports = {
  getSystemInfo,
  systemStart,
  systemStop,
  systemRestart,
  systemBackup,
  systemRecover,
  systemDeleteBackup,
  getSystemJob
}