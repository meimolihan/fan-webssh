const { spawn } = require('child_process')
const treeKill = require('tree-kill')

const serverRoot = __dirname
const nodemonBin = require.resolve('nodemon/bin/nodemon.js')
const child = spawn(process.execPath, [nodemonBin, 'index.js'], {
  cwd: serverRoot,
  env: process.env,
  stdio: 'inherit'
})

let isShuttingDown = false

function shutdown(signal) {
  if (isShuttingDown) return
  isShuttingDown = true

  const exitCode = signal === 'SIGINT' ? 130 : 143
  treeKill(child.pid, 'SIGKILL', () => process.exit(exitCode))
  setTimeout(() => process.exit(exitCode), 3000).unref()
}

child.on('exit', (code, signal) => {
  if (isShuttingDown) return
  if (typeof code === 'number') process.exit(code)
  process.exit(signal === 'SIGINT' ? 130 : 1)
})

process.once('SIGINT', () => shutdown('SIGINT'))
process.once('SIGTERM', () => shutdown('SIGTERM'))
