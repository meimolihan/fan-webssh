// AES-256-CBC 需要恰好 32 字节的 key，直接用 Buffer 而非 hex 字符串
global.rpdEncryptionKey = require('crypto').randomBytes(32)
require('dotenv').config()
require('./app/main.js')
