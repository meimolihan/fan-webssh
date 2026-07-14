require('./logs')
const { createServer } = require('./server')
const initDB = require('./db')
const scheduleJob = require('./schedule')

async function main() {
  await initDB()
  createServer()
  scheduleJob()
}

main()
