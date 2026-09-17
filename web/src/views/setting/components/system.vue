<template>
  <div class="system-container">
    <el-row :gutter="20">
      <el-col :span="14">
        <el-card
          shadow="never"
          class="info-card"
        >
          <template #header>
            <div class="card-header">
              <span>服务信息</span>
              <el-button
                link
                type="primary"
                :icon="Refresh"
                @click="loadInfo"
              >
                刷新
              </el-button>
            </div>
          </template>
          <el-descriptions
            :column="2"
            border
          >
            <el-descriptions-item label="运行模式">
              <el-tag
                :type="runModeTagType"
                size="small"
              >
                {{ runModeText }}
              </el-tag>
            </el-descriptions-item>
            <el-descriptions-item label="服务状态">
              <el-tag
                :type="statusTagType"
                size="small"
              >
                {{ statusText }}
              </el-tag>
            </el-descriptions-item>
            <el-descriptions-item label="程序目录">{{ info.appDir }}</el-descriptions-item>
            <el-descriptions-item label="数据目录">{{ info.dataDir }}</el-descriptions-item>
            <el-descriptions-item label="备份目录">{{ info.backupDir }}</el-descriptions-item>
            <el-descriptions-item label="配置文件">{{ info.configFile }}</el-descriptions-item>
          </el-descriptions>

          <div class="control-bar">
            <el-button
              type="warning"
              :loading="operating === 'start'"
              :disabled="!canControl"
              @click="handleService('start')"
            >
              启动服务
            </el-button>
            <el-button
              type="danger"
              :loading="operating === 'stop'"
              :disabled="!canControl"
              @click="handleService('stop')"
            >
              停止服务
            </el-button>
            <el-button
              type="primary"
              :loading="operating === 'restart'"
              :disabled="!canControl"
              @click="handleService('restart')"
            >
              重启服务
            </el-button>
          </div>
          <el-alert
            v-if="!info.inDocker && !info.scriptsAvailable"
            type="warning"
            :closable="false"
            show-icon
            title="未检测到运维脚本"
            description="备份/还原功能依赖 install.sh 部署的运维脚本，请确认已通过官方安装脚本部署。"
          />
          <el-alert
            v-if="info.inDocker"
            type="info"
            :closable="false"
            show-icon
            title="Docker 模式下服务与备份/还原操作不可用"
            description="请直接使用宿主机挂载的 scripts 目录中的脚本进行备份/还原与 systemctl 管理。"
          />
        </el-card>

        <el-card
          shadow="never"
          class="job-card"
        >
          <template #header>
            <div class="card-header">
              <span>执行日志</span>
              <el-button
                v-if="job.running"
                link
                size="small"
                type="primary"
                @click="stopPolling"
              >
                停止跟踪
              </el-button>
            </div>
          </template>
          <el-timeline
            v-if="job.log"
            style="margin-top: 8px"
          >
            <el-timeline-item
              v-for="(line, index) in jobLogLines"
              :key="index"
              :color="lineColor(line)"
              :timestamp="String(index + 1)"
            >
              {{ line }}
            </el-timeline-item>
          </el-timeline>
          <el-alert
            v-else
            type="info"
            :closable="false"
            title="暂无执行日志"
          />
        </el-card>
      </el-col>

      <el-col :span="10">
        <el-card shadow="never">
          <template #header>
            <div class="card-header">
              <span>备份与还原</span>
              <div>
                <el-button
                  type="success"
                  size="small"
                  :icon="Van"
                  :loading="backupLoading"
                  :disabled="!canBackup"
                  @click="handleBackup"
                >
                  立即备份
                </el-button>
                <el-button
                  size="small"
                  :icon="FolderOpened"
                  :disabled="!info.scriptsAvailable"
                  @click="loadInfo"
                >
                  刷新列表
                </el-button>
              </div>
            </div>
          </template>

          <el-table
            v-loading="infoLoading"
            :data="info.backups"
            height="300"
            stripe
            empty-text="暂无备份文件"
          >
            <el-table-column
              prop="name"
              label="文件名"
              min-width="180"
              show-overflow-tooltip
            />
            <el-table-column
              label="大小"
              width="90"
            >
              <template #default="{ row }">
                {{ formatSize(row.size) }}
              </template>
            </el-table-column>
            <el-table-column
              label="时间"
              width="150"
            >
              <template #default="{ row }">
                {{ formatTime(row.mtime) }}
              </template>
            </el-table-column>
            <el-table-column
              label="操作"
              width="80"
              fixed="right"
            >
              <template #default="{ row }">
                <el-button
                  type="danger"
                  size="small"
                  :disabled="!canBackup"
                  @click="handleRecover(row)"
                >
                  还原
                </el-button>
              </template>
            </el-table-column>
          </el-table>
        </el-card>
      </el-col>
    </el-row>
  </div>
</template>

<script setup>
import { ref, reactive, computed, onMounted, onBeforeUnmount, getCurrentInstance } from 'vue'
import { Refresh, Van, FolderOpened } from '@element-plus/icons-vue'
import dayjs from 'dayjs'

const { proxy: { $api, $message, $messageBox } } = getCurrentInstance()

const infoLoading = ref(false)
const backupLoading = ref(false)
const operating = ref('')

const info = reactive({
  runMode: 'unknown',
  service: '',
  serviceStatus: 'unknown',
  active: false,
  enabled: false,
  hasUnit: false,
  appDir: '',
  dataDir: '',
  backupDir: '',
  configFile: '',
  scriptsAvailable: false,
  backups: [],
  inDocker: false
})

const job = reactive({
  jobId: '',
  logPath: '',
  running: false,
  log: ''
})

const jobLogLines = computed(() => (job.log ? job.log.split('\n').filter(line => line.trim() !== '') : []))

let pollTimer = null

const canControl = computed(() => info.runMode === 'systemd' && !info.inDocker)
const canBackup = computed(() => !info.inDocker && info.scriptsAvailable)

const runModeText = computed(() => {
  if (info.runMode === 'systemd') return 'systemd 服务'
  if (info.runMode === 'docker') return 'Docker 容器'
  return '未知'
})

const runModeTagType = computed(() => {
  if (info.runMode === 'systemd') return 'success'
  if (info.runMode === 'docker') return 'warning'
  return 'info'
})

const statusText = computed(() => {
  if (info.runMode === 'docker') return '容器运行中'
  switch (info.serviceStatus) {
    case 'active': return '运行中'
    case 'inactive': return '已停止'
    case 'failed': return '启动失败'
    default: return '未知'
  }
})

const statusTagType = computed(() => {
  switch (info.serviceStatus) {
    case 'active': return 'success'
    case 'inactive': return 'info'
    case 'failed': return 'danger'
    default: return 'warning'
  }
})

const formatSize = (size) => {
  if (!size && size !== 0) return '--'
  if (size < 1024) return `${ size } B`
  if (size < 1024 * 1024) return `${ (size / 1024).toFixed(1) } KB`
  if (size < 1024 * 1024 * 1024) return `${ (size / 1024 / 1024).toFixed(1) } MB`
  return `${ (size / 1024 / 1024 / 1024).toFixed(2) } GB`
}

const formatTime = (ms) => dayjs(ms).format('YYYY-MM-DD HH:mm:ss')

const lineColor = (line) => {
  if (/❌|ERROR|fail/i.test(line)) return '#f56c6c'
  if (/✅|完成|启动成功|running|success/i.test(line)) return '#67c23a'
  if (/>>>|恢复|备份|停止|启动/i.test(line)) return '#909399'
  return '#409eff'
}

const loadInfo = async () => {
  infoLoading.value = true
  try {
    const { data } = await $api.getSystemInfo()
    Object.assign(info, data)
  } catch (error) {
    console.error('获取服务信息失败:', error)
  } finally {
    infoLoading.value = false
  }
}

const handleService = async (action) => {
  try {
    await $messageBox.confirm(`确定要${ action === 'start' ? '启动' : action === 'stop' ? '停止' : '重启' } fan-webssh 服务吗？`, '服务操作确认', {
      confirmButtonText: '确定',
      cancelButtonText: '取消',
      type: 'warning'
    })
  } catch {
    return
  }

  operating.value = action
  try {
    const api = action === 'start' ? $api.systemStart : action === 'stop' ? $api.systemStop : $api.systemRestart
    const { msg } = await api()
    $message.success(msg || '操作已提交')
  } catch {
    // 停止/重启时连接可能被中断，属正常现象
  } finally {
    setTimeout(() => {
      operating.value = ''
      loadInfo()
    }, 1500)
  }
}

const stopPolling = () => {
  if (pollTimer) {
    clearInterval(pollTimer)
    pollTimer = null
  }
  job.running = false
}

const pollJob = () => {
  stopPolling()
  job.running = true
  pollTimer = setInterval(async () => {
    try {
      const { data } = await $api.getSystemJob({ jobId: job.jobId, logPath: job.logPath })
      job.log = data.log || ''
      job.running = data.running
      if (data.finished) {
        stopPolling()
        $message[data.failed ? 'error' : 'success'](data.failed ? '任务执行失败，请查看日志' : '任务执行完成')
      }
    } catch {
      // 服务重启期间可能出现请求中断，静默重试
    }
  }, 2000)
}

const handleBackup = async () => {
  backupLoading.value = true
  try {
    const { data } = await $api.systemBackup()
    job.jobId = data.jobId
    job.logPath = data.logPath
    job.log = ''
    pollJob()
    $message.success('备份任务已启动')
  } catch (error) {
    console.error('启动备份失败:', error)
    $message.error('启动备份失败')
  } finally {
    backupLoading.value = false
  }
}

const handleRecover = async (row) => {
  try {
    await $messageBox.confirm(
      `确定要使用备份 ${ row.name } 还原吗？还原过程会停止服务，期间面板将暂时不可访问。`,
      '还原确认',
      {
        confirmButtonText: '确定',
        cancelButtonText: '取消',
        type: 'warning'
      }
    )
  } catch {
    return
  }

  try {
    const { data } = await $api.systemRecover({ fileName: row.name })
    job.jobId = data.jobId
    job.logPath = data.logPath
    job.log = ''
    pollJob()
    $message.success('还原任务已启动')
  } catch (error) {
    console.error('启动还原失败:', error)
    $message.error('启动还原失败')
  }
}

onMounted(loadInfo)
onBeforeUnmount(stopPolling)
</script>

<style lang="scss" scoped>
.system-container {
  .card-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }

  .info-card {
    margin-bottom: 20px;
  }

  .control-bar {
    margin-top: 16px;
    display: flex;
    gap: 12px;
  }

  .job-card {
    .el-timeline {
      padding-left: 4px;

      :deep(.el-timeline-item__content) {
        font-family: 'JetBrains Mono', Consolas, Menlo, monospace;
        font-size: 12px;
        word-break: break-all;
      }
    }
  }

  .el-alert {
    margin-top: 12px;
  }
}
</style>