'use strict'
const fs = require('fs')
const path = require('path')

// 单文件发行版入口：带子命令走 CLI，无参数启动 Web 面板
const [, , sub] = process.argv
if (sub) {
  require('./bin/fan-webssh.js')
} else {
  // 首次启动把内置 web /static 释放到工作目录（不覆盖已有文件）
  const src = path.join(__dirname, 'app', 'static')
  const dst = path.join(process.cwd(), 'app', 'static')
  try {
    if (fs.existsSync(src) && !fs.existsSync(dst)) {
      fs.mkdirSync(path.dirname(dst), { recursive: true })
      fs.cpSync(src, dst, { recursive: true })
    }
  } catch (e) {
    console.error('[fan-webssh] 释放前端静态资源失败:', e.message)
  }
  require('./index.js')
}