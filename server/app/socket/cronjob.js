const { Client: SSHClient } = require('ssh2')
const { createTerminal } = require('./terminal')
const { createSecureWs } = require('../utils/ws-tool')
const crypto = require('crypto')

const LOG_DIR = '/tmp/.easynode_cronjob_logs'

function generateJobId() {
  return crypto.randomBytes(4).toString('hex')
}

function executeCommand(sshClient, command) {
  return new Promise((resolve, reject) => {
    sshClient.exec(command, (err, stream) => {
      if (err) return reject(err)
      let stdout = ''
      let stderr = ''
      stream.on('data', (data) => { stdout += data })
      stream.stderr.on('data', (data) => { stderr += data })
      stream.on('close', (code) => {
        if (code !== 0 && stderr) {
          reject(new Error(stderr.trim()))
        } else {
          resolve(stdout)
        }
      })
    })
  })
}

async function getCrontab(sshClient) {
  try {
    return await executeCommand(sshClient, 'crontab -l 2>/dev/null || true')
  } catch (e) {
    return ''
  }
}

function parseCrontab(crontabText) {
  const jobs = []
  const lines = crontabText.split('\n')
  let i = 0

  while (i < lines.length) {
    const line = lines[i]
    const trimmed = line.trim()

    // 检测 easynode 管理的 job 注释标记
    const jobMatch = trimmed.match(/^# easynode:cronjob:([^:]+):(.*)$/)
    if (jobMatch) {
      const jobId = jobMatch[1]
      const jobName = jobMatch[2]
      i++
      if (i < lines.length) {
        const cronLine = lines[i].trim()
        // 检查是否被禁用（cron 行以 # 开头）
        const isDisabled = cronLine.startsWith('# easynode:disable:')
        const actualLine = isDisabled ? cronLine.replace(/^#\s*easynode:disable:/, '') : cronLine

        if (actualLine && !actualLine.startsWith('# easynode:')) {
          const parts = actualLine.split(/\s+/)
          if (parts.length >= 6) {
            jobs.push({
              id: jobId,
              name: jobName,
              schedule: parts.slice(0, 5).join(' '),
              command: parts.slice(5).join(' '),
              enabled: !isDisabled,
              raw: actualLine
            })
          }
        }
      }
    } else if (trimmed && !trimmed.startsWith('#') && trimmed.length > 0) {
      // 普通的非 easynode 管理的 cron 任务
      const parts = trimmed.split(/\s+/)
      if (parts.length >= 6) {
        jobs.push({
          id: generateJobId(),
          name: parts.slice(5).join(' ').substring(0, 50) || '系统任务',
          schedule: parts.slice(0, 5).join(' '),
          command: parts.slice(5).join(' '),
          enabled: true,
          raw: trimmed,
          system: true
        })
      }
    }
    i++
  }

  return jobs
}

function buildCrontab(jobs) {
  const lines = []
  for (const job of jobs) {
    if (job.deleted) continue
    lines.push(`# easynode:cronjob:${ job.id }:${ job.name }`)
    if (job.enabled) {
      lines.push(`${ job.schedule } ${ job.command }`)
    } else {
      // 禁用的任务：用注释标记包裹 cron 行
      lines.push(`# easynode:disable:${ job.schedule } ${ job.command }`)
    }
  }
  return lines.join('\n') + '\n'
}

async function setCrontab(sshClient, crontabContent) {
  // 先确保日志目录存在
  await executeCommand(sshClient, `mkdir -p ${ LOG_DIR }`).catch(() => {})

  // 使用 base64 编码写入 crontab，避免所有转义问题
  const b64 = Buffer.from(crontabContent).toString('base64')
  const cmd = `echo '${ b64 }' | base64 -d | crontab -`
  await executeCommand(sshClient, cmd)
}

async function ensureLogDir(sshClient) {
  await executeCommand(sshClient, `mkdir -p ${ LOG_DIR }`).catch(() => {})
}

async function saveExecutionLog(sshClient, jobId, jobName, command, success, output) {
  await ensureLogDir(sshClient)
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
  const logFile = `${ LOG_DIR }/${ jobId }_${ timestamp }.log`
  const status = success ? 'SUCCESS' : 'FAILED'
  const header = `任务: ${ jobName }\n命令: ${ command }\n状态: ${ status }\n时间: ${ new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' }) }\n${ '='.repeat(60) }\n\n`
  const content = (header + (output || '无输出')).replace(/'/g, "'\\''")
  await executeCommand(sshClient, `echo '${ content }' > "${ logFile }"`).catch(() => {})
  return logFile
}

async function getExecutionLogs(sshClient, jobId) {
  await ensureLogDir(sshClient)
  try {
    const output = await executeCommand(sshClient, `ls -t ${ LOG_DIR }/${ jobId }_*.log 2>/dev/null | head -20`)
    const files = output.trim().split('\n').filter(Boolean)
    const logs = []
    for (const file of files) {
      try {
        const content = await executeCommand(sshClient, `cat "${ file }"`)
        // 从文件名解析时间
        const nameMatch = file.match(/_(\d{4}-\d{2}-\d{2}T[\d-]+)\.log$/)
        const time = nameMatch ? nameMatch[1].replace(/-(?=\d{2}-\d{2}-\d{2}$)/, ' ').replace(/-/g, (m, i) => i > 9 ? ':' : m) : ''
        const firstLine = content.split('\n')[0] || ''
        const statusMatch = content.match(/状态: (SUCCESS|FAILED)/)
        logs.push({
          file,
          time,
          status: statusMatch ? statusMatch[1] : 'UNKNOWN',
          summary: firstLine.replace('任务: ', ''),
          content
        })
      } catch (e) {
        // 跳过无法读取的文件
      }
    }
    return logs
  } catch (e) {
    return []
  }
}

async function cleanExecutionLogs(sshClient, jobId) {
  await ensureLogDir(sshClient)
  await executeCommand(sshClient, `rm -f ${ LOG_DIR }/${ jobId }_*.log 2>/dev/null`).catch(() => {})
}

async function runJobManually(sshClient, command) {
  const wrappedCmd = `{ ${ command }; } 2>&1 | head -500`
  try {
    const output = await executeCommand(sshClient, wrappedCmd)
    return { success: true, output: output || '命令已执行，无输出' }
  } catch (e) {
    return { success: false, output: e.message || '执行失败' }
  }
}

const VALID_CRON_FIELD = /^[\d\*\/\-\,\s\/]+$/

function validateCronSchedule(schedule) {
  if (typeof schedule !== 'string') return false
  const parts = schedule.trim().split(/\s+/)
  if (parts.length !== 5) return false
  return parts.every(p => VALID_CRON_FIELD.test(p))
}

function validateCommand(cmd) {
  if (typeof cmd !== 'string' || !cmd.trim()) return false
  if (cmd.length > 4096) return false
  return true
}

module.exports = (httpServer) => {
  const serverIo = createSecureWs(httpServer, '/cronjob')

  let connectionCount = 0

  serverIo.on('connection', async (socket) => {
    connectionCount++
    logger.info(`cronjob websocket 已连接 - 当前连接数: ${ connectionCount }`)

    let targetSSHClient = null
    let jumpSshClients = []
    let listenersRegistered = false

    socket.on('ws_cronjob', async ({ hostId }) => {
      targetSSHClient = new SSHClient()
      try {
        let { jumpSshClients: cronjobJumpSshClients } = await createTerminal(hostId, socket, targetSSHClient, false)
        jumpSshClients.push(...cronjobJumpSshClients)
      } catch (e) {
        socket.emit('cronjob_connect_fail')
        socket.disconnect()
        return
      }

      const crontabText = await getCrontab(targetSSHClient)
      const jobs = parseCrontab(crontabText)
      socket.emit('cronjob_list_data', jobs)

      if (!listenersRegistered) {
        listenersRegistered = true

        socket.on('cronjob_get_list', async () => {
          const text = await getCrontab(targetSSHClient)
          const data = parseCrontab(text)
          socket.emit('cronjob_list_data', data)
        })

        socket.on('cronjob_add', async ({ name, schedule, command }) => {
          try {
            if (!name || !name.trim()) {
              return socket.emit('cronjob_operation_result', { success: false, message: '任务名称不能为空' })
            }
            if (!validateCronSchedule(schedule)) {
              return socket.emit('cronjob_operation_result', { success: false, message: 'cron 表达式格式不正确' })
            }
            if (!validateCommand(command)) {
              return socket.emit('cronjob_operation_result', { success: false, message: '命令不能为空且不能超过4096字符' })
            }

            const crontabText = await getCrontab(targetSSHClient)
            const jobs = parseCrontab(crontabText)

            const newJob = {
              id: generateJobId(),
              name: name.trim(),
              schedule: schedule.trim(),
              command: command.trim(),
              enabled: true
            }
            jobs.push(newJob)

            await setCrontab(targetSSHClient, buildCrontab(jobs))
            socket.emit('cronjob_operation_result', { success: true, message: '计划任务添加成功' })

            const updatedText = await getCrontab(targetSSHClient)
            socket.emit('cronjob_list_data', parseCrontab(updatedText))
          } catch (e) {
            logger.error('添加计划任务失败:', e)
            socket.emit('cronjob_operation_result', { success: false, message: e.message || '添加失败' })
          }
        })

        socket.on('cronjob_update', async ({ id, name, schedule, command }) => {
          try {
            if (!validateCronSchedule(schedule)) {
              return socket.emit('cronjob_operation_result', { success: false, message: 'cron 表达式格式不正确' })
            }
            if (!validateCommand(command)) {
              return socket.emit('cronjob_operation_result', { success: false, message: '命令不能为空' })
            }

            const crontabText = await getCrontab(targetSSHClient)
            const jobs = parseCrontab(crontabText)
            const idx = jobs.findIndex(j => j.id === id)
            if (idx === -1) {
              return socket.emit('cronjob_operation_result', { success: false, message: '未找到该任务' })
            }

            jobs[idx].name = name?.trim() || jobs[idx].name
            jobs[idx].schedule = schedule.trim()
            jobs[idx].command = command.trim()

            await setCrontab(targetSSHClient, buildCrontab(jobs))
            socket.emit('cronjob_operation_result', { success: true, message: '计划任务更新成功' })

            const updatedText = await getCrontab(targetSSHClient)
            socket.emit('cronjob_list_data', parseCrontab(updatedText))
          } catch (e) {
            logger.error('更新计划任务失败:', e)
            socket.emit('cronjob_operation_result', { success: false, message: e.message || '更新失败' })
          }
        })

        socket.on('cronjob_delete', async ({ id }) => {
          try {
            const crontabText = await getCrontab(targetSSHClient)
            const jobs = parseCrontab(crontabText)
            const filtered = jobs.filter(j => j.id !== id)

            if (filtered.length === jobs.length) {
              return socket.emit('cronjob_operation_result', { success: false, message: '未找到该任务' })
            }

            await setCrontab(targetSSHClient, buildCrontab(filtered))
            // 同时清理该任务的执行日志
            await cleanExecutionLogs(targetSSHClient, id)
            socket.emit('cronjob_operation_result', { success: true, message: '计划任务删除成功' })

            const updatedText = await getCrontab(targetSSHClient)
            socket.emit('cronjob_list_data', parseCrontab(updatedText))
          } catch (e) {
            logger.error('删除计划任务失败:', e)
            socket.emit('cronjob_operation_result', { success: false, message: e.message || '删除失败' })
          }
        })

        socket.on('cronjob_toggle', async ({ id, enabled }) => {
          try {
            const crontabText = await getCrontab(targetSSHClient)
            const jobs = parseCrontab(crontabText)
            const idx = jobs.findIndex(j => j.id === id)
            if (idx === -1) {
              return socket.emit('cronjob_operation_result', { success: false, message: '未找到该任务' })
            }

            jobs[idx].enabled = enabled

            await setCrontab(targetSSHClient, buildCrontab(jobs))
            socket.emit('cronjob_operation_result', { success: true, message: enabled ? '计划任务已启用' : '计划任务已禁用' })

            const updatedText = await getCrontab(targetSSHClient)
            socket.emit('cronjob_list_data', parseCrontab(updatedText))
          } catch (e) {
            logger.error('切换计划任务状态失败:', e)
            socket.emit('cronjob_operation_result', { success: false, message: e.message || '操作失败' })
          }
        })

        socket.on('cronjob_run_once', async ({ id }) => {
          try {
            const crontabText = await getCrontab(targetSSHClient)
            const jobs = parseCrontab(crontabText)
            const job = jobs.find(j => j.id === id)
            if (!job) {
              return socket.emit('cronjob_operation_result', { success: false, message: '未找到该任务' })
            }

            const result = await runJobManually(targetSSHClient, job.command)
            // 保存执行记录
            const logFile = await saveExecutionLog(targetSSHClient, job.id, job.name, job.command, result.success, result.output)
            socket.emit('cronjob_run_result', {
              success: result.success,
              message: result.success ? '手动执行完成' : '执行失败',
              output: result.output,
              jobName: job.name,
              logFile
            })
          } catch (e) {
            logger.error('手动执行计划任务失败:', e)
            socket.emit('cronjob_operation_result', { success: false, message: e.message || '执行失败' })
          }
        })

        socket.on('cronjob_get_logs', async ({ id }) => {
          try {
            const logs = await getExecutionLogs(targetSSHClient, id)
            socket.emit('cronjob_logs_data', { id, logs })
          } catch (e) {
            logger.error('获取执行日志失败:', e)
            socket.emit('cronjob_logs_data', { id, logs: [] })
          }
        })

        socket.on('cronjob_clean_logs', async ({ id }) => {
          try {
            await cleanExecutionLogs(targetSSHClient, id)
            socket.emit('cronjob_operation_result', { success: true, message: '执行日志已清空' })
          } catch (e) {
            socket.emit('cronjob_operation_result', { success: false, message: '清空日志失败' })
          }
        })

        socket.on('cronjob_batch_delete', async ({ ids }) => {
          try {
            const crontabText = await getCrontab(targetSSHClient)
            let jobs = parseCrontab(crontabText)
            const idSet = new Set(ids)
            jobs = jobs.filter(j => !idSet.has(j.id))

            await setCrontab(targetSSHClient, buildCrontab(jobs))
            // 清理日志
            for (const id of ids) {
              await cleanExecutionLogs(targetSSHClient, id)
            }

            socket.emit('cronjob_operation_result', { success: true, message: `已删除 ${ ids.length } 个计划任务` })
            const updatedText = await getCrontab(targetSSHClient)
            socket.emit('cronjob_list_data', parseCrontab(updatedText))
          } catch (e) {
            logger.error('批量删除计划任务失败:', e)
            socket.emit('cronjob_operation_result', { success: false, message: e.message || '批量删除失败' })
          }
        })
      }
    })

    socket.on('disconnect', (reason) => {
      connectionCount--
      targetSSHClient && targetSSHClient.end()
      jumpSshClients?.forEach(sshClient => sshClient && sshClient.end())
      targetSSHClient = null
      jumpSshClients = null
      logger.info(`cronjob websocket 连接断开: ${ reason } - 当前连接数: ${ connectionCount }`)
    })
  })
}
