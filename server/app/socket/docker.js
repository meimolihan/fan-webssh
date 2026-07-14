const { Client: SSHClient } = require('ssh2')
const { createTerminal } = require('./terminal')
const { createSecureWs } = require('../utils/ws-tool')

// Basic Docker container management

function translateUptime(uptimeStr) {
  if (!uptimeStr) return '--'
  let result = uptimeStr
    .replace(/second(s)?/gi, '秒')
    .replace(/minute(s)?/gi, '分钟')
    .replace(/hour(s)?/gi, '小时')
    .replace(/day(s)?/gi, '天')
    .replace(/week(s)?/gi, '周')
    .replace(/month(s)?/gi, '个月')
    .replace(/year(s)?/gi, '年')
    .replace(/About a/gi, '约 1')
    .replace(/Less than a/gi, '不到 1')
    .replace(/About an/gi, '约 1')
    .replace(/Less than an/gi, '不到 1')
  result = result.replace(/\(Healthy\)/gi, '(健康)')
    .replace(/\(Unhealthy\)/gi, '(不健康)')
    .replace(/\(Starting\)/gi, '(启动中)')
  return result
}

async function getDockerContainers(sshClient) {
  return new Promise((resolve, reject) => {
    sshClient.exec('docker ps -a --format "{{.ID}}\\t{{.Names}}\\t{{.Image}}\\t{{.Status}}\\t{{.Ports}}\\t{{.CreatedAt}}"', (err, stream) => {
      if (err) return reject(err)
      let output = ''
      stream.on('data', (data) => { output += data })
      stream.stderr.on('data', (data) => { output += data })
      stream.on('close', () => {
        const containers = output.trim().split('\n').filter(Boolean).map(line => {
          const [id, name, image, status, ports, createdAt] = line.split('\t')
          // Parse status to get uptime and translate to Chinese
          const uptimeMatch = status?.match(/Up\s+(.+)/i)
          let uptime
          if (uptimeMatch) {
            uptime = translateUptime(uptimeMatch[1])
          } else if (status?.includes('Exited')) {
            uptime = '已停止'
          } else if (status?.includes('Created')) {
            uptime = '已创建'
          } else {
            uptime = status || '--'
          }
          let parsedStatus = status?.split(' ')[0]?.toLowerCase() || 'unknown'
          if (parsedStatus === 'up') parsedStatus = 'running'
          return {
            id,
            name,
            image,
            status: parsedStatus,
            ports: ports ? ports.split(',').map(p => p.trim()) : [],
            uptime,
            createdAt: createdAt || ''
          }
        })
        resolve(containers)
      })
    })
  })
}

function executeCommand(sshClient, command) {
  return new Promise((resolve, reject) => {
    sshClient.exec(command, (err, stream) => {
      if (err) return reject(err)
      let output = ''
      stream.on('data', (data) => { output += data })
      stream.stderr.on('data', (data) => { output += data })
      stream.on('close', () => resolve(output))
    })
  })
}

// 专门用于获取Docker日志的函数，Docker logs 输出通常在 stderr 中
function executeDockerLogsCommand(targetSSHClient, command) {
  return new Promise((resolve, reject) => {
    targetSSHClient.exec(command, (err, stream) => {
      if (err) {
        logger.error('执行Docker logs命令失败:', err)
        return reject(err)
      }

      let stdoutData = ''
      let stderrData = ''

      stream.on('close', () => { // code
        // Docker logs 的输出主要在 stderr，合并所有输出
        const allData = stdoutData + stderrData
        // logger.info(`Docker logs 命令完成, 退出码: ${ code }, 输出长度: ${ allData.length }`)

        if (allData.trim()) {
          resolve(allData)
        } else {
          logger.warn('Docker logs 无输出:', command)
          resolve('')
        }
      })

      stream.on('data', (data) => {
        stdoutData += data.toString('utf8')
      })

      stream.stderr.on('data', (data) => {
        stderrData += data.toString('utf8')
      })

      stream.on('error', (err) => {
        logger.error('Docker logs stream 错误:', err)
        reject(err)
      })
    })
  })
}

const VALID_CONTAINER_ID = /^[a-zA-Z0-9][a-zA-Z0-9_.\-]{0,127}$/

function validateContainerId(containerId) {
  if (typeof containerId !== 'string' || !VALID_CONTAINER_ID.test(containerId)) {
    throw new Error('invalid container id')
  }
}

function sanitizeTail(tail) {
  return Math.min(Math.max(parseInt(tail, 10) || 3000, 1), 100000)
}

async function getDockerLogs(targetSSHClient, containerId, tail = 3000) {
  try {
    validateContainerId(containerId)
    tail = sanitizeTail(tail)
    // 使用专门的日志获取函数，确保能获取到所有日志
    const logsData = await executeDockerLogsCommand(
      targetSSHClient,
      `docker logs --tail ${ tail } -t ${ containerId }`
    )

    // 如果日志为空，返回提示信息
    if (!logsData || logsData.trim() === '') {
      return '该容器暂无日志输出'
    }

    return logsData
  } catch (error) {
    console.error('获取Docker日志失败:', error)
    return `获取Docker日志失败: ${ error.message || '未知错误' }`
  }
}

async function startDockerContainer(targetSSHClient, containerId) {
  try {
    validateContainerId(containerId)
    await executeCommand(targetSSHClient, `docker start ${ containerId }`)
    return { success: true, message: '容器启动成功' }
  } catch (error) {
    console.error('启动Docker容器失败:', error)
    return { success: false, message: error.message || '启动容器失败' }
  }
}

async function stopDockerContainer(targetSSHClient, containerId) {
  try {
    validateContainerId(containerId)
    await executeCommand(targetSSHClient, `docker stop ${ containerId }`)
    return { success: true, message: '容器停止成功' }
  } catch (error) {
    console.error('停止Docker容器失败:', error)
    return { success: false, message: error.message || '停止容器失败' }
  }
}

async function restartDockerContainer(targetSSHClient, containerId) {
  try {
    validateContainerId(containerId)
    await executeCommand(targetSSHClient, `docker restart ${ containerId }`)
    return { success: true, message: '容器重启成功' }
  } catch (error) {
    console.error('重启Docker容器失败:', error)
    return { success: false, message: error.message || '重启容器失败' }
  }
}

async function deleteDockerContainer(targetSSHClient, containerId) {
  try {
    validateContainerId(containerId)
    await executeCommand(targetSSHClient, `docker rm -f ${ containerId }`)
    return { success: true, message: '容器删除成功' }
  } catch (error) {
    console.error('删除Docker容器失败:', error)
    return { success: false, message: error.message || '删除容器失败' }
  }
}

module.exports = (httpServer) => {
  const serverIo = createSecureWs(httpServer, '/docker')

  let connectionCount = 0

  serverIo.on('connection', async (socket) => {
    connectionCount++
    logger.info(`docker websocket 已连接 - 当前连接数: ${ connectionCount }`)

    let targetSSHClient = null
    let jumpSshClients = []
    let listenersRegistered = false

    socket.on('ws_docker', async ({ hostId }) => {
      targetSSHClient = new SSHClient()
      let { jumpSshClients: dockerJumpSshClients } = await createTerminal(hostId, socket, targetSSHClient, false)
      jumpSshClients.push(...dockerJumpSshClients)
      let containersData = await getDockerContainers(targetSSHClient)
      if (!containersData) {
        socket.emit('docker_connect_fail')
        socket.disconnect()
        return
      }
      socket.emit('docker_containers_data', containersData)

      if (!listenersRegistered) {
        listenersRegistered = true
        socket.on('docker_get_containers_data', async () => {
          socket.emit('docker_containers_data', await getDockerContainers(targetSSHClient))
        })

        socket.on('docker_get_containers_logs', async ({ containerId, tail = 3000 }) => {
          socket.emit('docker_containers_logs', await getDockerLogs(targetSSHClient, containerId, tail))
        })

        socket.on('docker_start_container', async ({ containerId }) => {
          const result = await startDockerContainer(targetSSHClient, containerId)
          socket.emit('docker_operation_result', result)
        })

        socket.on('docker_stop_container', async ({ containerId }) => {
          const result = await stopDockerContainer(targetSSHClient, containerId)
          socket.emit('docker_operation_result', result)
        })

        socket.on('docker_restart_container', async ({ containerId }) => {
          const result = await restartDockerContainer(targetSSHClient, containerId)
          socket.emit('docker_operation_result', result)
        })

        socket.on('docker_delete_container', async ({ containerId }) => {
          const result = await deleteDockerContainer(targetSSHClient, containerId)
          socket.emit('docker_operation_result', result)
        })
      }
    })

    socket.on('disconnect', (reason) => {
      connectionCount--
      targetSSHClient && targetSSHClient.end()
      jumpSshClients?.forEach(sshClient => sshClient && sshClient.end())
      targetSSHClient = null
      jumpSshClients = null
      logger.info(`docker websocket 连接断开: ${ reason } - 当前连接数: ${ connectionCount }`)
    })
  })
}
