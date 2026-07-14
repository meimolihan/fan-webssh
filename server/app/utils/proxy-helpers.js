const net = require('net')
const { Client: SSHClient } = require('ssh2')

/**
 * Create a SOCKS5 proxy connection
 */
async function createSocks5Connection(proxyConfig, targetHost, targetPort) {
  return new Promise((resolve, reject) => {
    const socket = net.connect(proxyConfig.port, proxyConfig.host, () => {
      // SOCKS5 greeting
      socket.write(Buffer.from([0x05, 0x01, 0x00]))
    })

    socket.on('data', (data) => {
      if (data[0] !== 0x05) {
        socket.destroy()
        return reject(new Error('SOCKS5: Invalid response'))
      }

      if (data.length === 2 && data[1] === 0x00) {
        // Connection request
        const hostBuf = Buffer.from(targetHost)
        const portBuf = Buffer.alloc(2)
        portBuf.writeUInt16BE(targetPort)
        const req = Buffer.concat([
          Buffer.from([0x05, 0x01, 0x00, 0x03]),
          Buffer.from([hostBuf.length]),
          hostBuf,
          portBuf
        ])
        socket.write(req)
      } else if (data.length >= 2 && data[1] === 0x00) {
        resolve(socket)
      } else {
        socket.destroy()
        reject(new Error(`SOCKS5: Connection failed with code ${data[1]}`))
      }
    })

    socket.on('error', reject)
    socket.setTimeout(10000, () => {
      socket.destroy()
      reject(new Error('SOCKS5: Connection timeout'))
    })
  })
}

/**
 * Create an HTTP CONNECT proxy connection
 */
async function createHttpConnection(proxyConfig, targetHost, targetPort) {
  return new Promise((resolve, reject) => {
    const socket = net.connect(proxyConfig.port, proxyConfig.host, () => {
      const authHeader = proxyConfig.username
        ? `Proxy-Authorization: Basic ${Buffer.from(`${proxyConfig.username}:${proxyConfig.password || ''}`).toString('base64')}\r\n`
        : ''
      socket.write(
        `CONNECT ${targetHost}:${targetPort} HTTP/1.1\r\n` +
        `Host: ${targetHost}:${targetPort}\r\n` +
        authHeader +
        `\r\n`
      )
    })

    let responseData = ''
    socket.on('data', (data) => {
      responseData += data.toString()
      if (responseData.includes('\r\n\r\n')) {
        if (responseData.includes('200')) {
          resolve(socket)
        } else {
          socket.destroy()
          reject(new Error(`HTTP Proxy: ${responseData.split('\r\n')[0]}`))
        }
      }
    })

    socket.on('error', reject)
    socket.setTimeout(10000, () => {
      socket.destroy()
      reject(new Error('HTTP Proxy: Connection timeout'))
    })
  })
}

/**
 * Connect through jump hosts - returns { sock, sshClients }
 * sock is the final TCP stream to the target host, to be passed to ssh2.connect({ sock })
 */
async function connectByJumpHosts(jumpHosts, targetHost, targetPort, socket) {
  const sshClients = []

  // Build the chain from outermost jump host inward
  // We connect to jumpHosts[0], which forwards to jumpHosts[1], ... -> target
  let currentStream = null

  for (let i = 0; i < jumpHosts.length; i++) {
    const jumpHost = jumpHosts[i]
    const sshClient = new SSHClient()

    await new Promise((resolve, reject) => {
      const onReady = () => {
        const nextHost = (i < jumpHosts.length - 1) ? jumpHosts[i + 1].host : targetHost
        const nextPort = (i < jumpHosts.length - 1) ? (jumpHosts[i + 1].port || 22) : targetPort

        // If we have a stream from a previous forwardOut, use it as sock
        const connectOpts = {
          host: nextHost,
          port: nextPort
        }
        if (currentStream) {
          connectOpts.sock = currentStream
        }

        // Use forwardOut to tunnel through this jump host to the next hop
        sshClient.forwardOut(
          '127.0.0.1', 0,
          nextHost, nextPort,
          (err, stream) => {
            if (err) return reject(err)
            currentStream = stream
            resolve()
          }
        )
      }

      sshClient.on('ready', onReady)
      sshClient.on('error', reject)

      const connectConfig = {
        host: jumpHost.host,
        port: jumpHost.port || 22,
        username: jumpHost.username,
        readyTimeout: 10000
      }

      if (jumpHost.authType === 'password') {
        connectConfig.password = jumpHost.password
      } else if (jumpHost.authType === 'privateKey') {
        connectConfig.privateKey = jumpHost.privateKey
        if (jumpHost.passphrase) connectConfig.passphrase = jumpHost.passphrase
      }

      if (currentStream) {
        connectConfig.sock = currentStream
        connectConfig.host = jumpHost.host
        connectConfig.port = jumpHost.port || 22
      }

      sshClient.connect(connectConfig)
    })

    sshClients.push(sshClient)
  }

  return { sock: currentStream, sshClients }
}

module.exports = {
  createSocks5Connection,
  createHttpConnection,
  connectByJumpHosts
}
