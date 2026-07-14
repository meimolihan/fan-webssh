class RuntimeState {
  constructor() {
    if (!RuntimeState.instance) {
      this.sessionId = null
      RuntimeState.instance = this
    }
    return RuntimeState.instance
  }

  getInstance() {
    return RuntimeState.instance
  }

  // sessionId: 进程级在线会话标识，每次进程启动新生成，仅存内存，进程退出即销毁，绝不落盘
  setSessionId(id) {
    this.sessionId = id || null
  }

  getSessionId() {
    return this.sessionId
  }

  clearSessionId() {
    this.sessionId = null
  }
}

module.exports = { RuntimeState }
