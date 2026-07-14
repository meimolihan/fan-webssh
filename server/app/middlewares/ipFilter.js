// 白名单IP
const fs = require('fs')
const path = require('path')
const { isAllowedIp, getClientIP } = require('../utils/tools')

const htmlPath = path.join(__dirname, '../template/ipForbidden.html')
const ipForbiddenHtml = fs.readFileSync(htmlPath, 'utf8')

const ipFilter = async (ctx, next) => {
  const requestIP = getClientIP(ctx.socket.remoteAddress, ctx.get('x-forwarded-for'))
  if (isAllowedIp(requestIP)) return await next()
  ctx.status = 403
  ctx.body = ipForbiddenHtml
}

module.exports = ipFilter
