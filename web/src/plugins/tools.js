import ping from '../utils/ping'

export default {
  toFixed(value, count = 1) {
    value = Number(value)
    return isNaN(value) ? '--' : value.toFixed(count)
  },
  formatTime(second = 0, target = 'day') {
    let day = Math.floor(second / 60 / 60 / 24)
    let hour = Math.floor(second / 60 / 60 % 24)
    let minute = Math.floor(second / 60 % 60)
    if (target === 'day') {
      return `${ day }天`
    } else if (target === 'hour') {
      return `${ day }天${ hour }时`
    } else if (target === 'minute') {
      return `${ day }天${ hour }时${ minute }分`
    }
    return `${ day }天${ hour }时${ minute }分${ second }秒`
  },
  formatNetSpeed(netSpeedMB) {
    netSpeedMB = Number(netSpeedMB) || 0
    if (netSpeedMB >= 1) return `${ netSpeedMB.toFixed(2) } MB/s`
    return `${ (netSpeedMB * 1024).toFixed(1) } KB/s`
  },
  // 内存/交换空间用量展示：低于1G时用MB整数展示（更直观，避免出现 0.2G 这种不精确的显示），否则用G保留1位小数
  formatMemPair(usedMb, totalMb) {
    usedMb = Number(usedMb) || 0
    totalMb = Number(totalMb) || 0
    if (totalMb > 0 && totalMb < 1024) {
      return `${ Math.round(usedMb) }/${ Math.round(totalMb) }MB`
    }
    const usedG = (usedMb / 1024).toFixed(1)
    const totalG = (totalMb / 1024).toFixed(1)
    return `${ usedG }/${ totalG }G`
  },
  // format: time OR date
  formatTimestamp: (timestamp, format = 'time', afterSeparator = ':') => {
    if (typeof(timestamp) !== 'number') return '--'
    let date = new Date(timestamp)
    let padZero = (num) => String(num).padStart(2, '0')
    let year = date.getFullYear()
    let mounth = padZero(date.getMonth() + 1)
    let day = padZero(date.getDate())
    let hours = padZero(date.getHours())
    let minute = padZero(date.getMinutes())
    let second = padZero(date.getSeconds())
    switch (format) {
      case 'date':
        return `${ year }-${ mounth }-${ day }`
      case 'time':
        return `${ year }-${ mounth }-${ day } ${ hours }${ afterSeparator }${ minute }${ afterSeparator }${ second }`
      default:
        return `${ year }-${ mounth }-${ day } ${ hours }${ afterSeparator }${ minute }${ afterSeparator }${ second }`
    }
  },
  ping
}
