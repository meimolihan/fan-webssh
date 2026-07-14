<template>
  <div class="cronjob_container">
    <!-- 顶部工具栏 -->
    <div class="top_toolbar">
      <div class="left_tools">
        <el-checkbox
          v-model="checkAll"
          :indeterminate="isIndeterminate"
          class="select_all_checkbox"
          @change="handleSelectAll"
        >
          全选
        </el-checkbox>
        <div v-if="selectedJobs.length > 0" class="batch_info_tag">
          已选中 <span class="count">{{ selectedJobs.length }}</span> 个
        </div>
        <el-button
          v-if="selectedJobs.length > 0"
          type="danger"
          size="small"
          plain
          @click="handleBatchDelete"
        >
          批量删除
        </el-button>
      </div>
      <div class="right_tools">
        <div v-if="serverErr" style="margin-right: 10px;">
          <el-tag type="danger" effect="light" size="small">连接失败</el-tag>
        </div>
        <el-button type="primary" size="small" :loading="loading" :icon="RefreshRight" @click="() => reconnect(true)">
          刷新
        </el-button>
        <el-button type="success" size="small" :icon="Plus" @click="openAddDialog">
          添加任务
        </el-button>
      </div>
    </div>

    <!-- 表格区域 -->
    <div v-loading="loading" class="table_wrapper">
      <el-empty v-if="jobs.length === 0 && !loading" description="暂无计划任务" />

      <el-table
        v-if="jobs.length > 0"
        :data="jobs"
        style="width: 100%"
        size="small"
        :row-class-name="getRowClassName"
        @selection-change="handleSelectionChange"
      >
        <el-table-column type="selection" width="40" />
        <el-table-column label="任务名称" min-width="120" show-overflow-tooltip>
          <template #default="{ row }">
            <span class="job_name">{{ row.name }}</span>
          </template>
        </el-table-column>
        <el-table-column label="调度规则" min-width="130" show-overflow-tooltip>
          <template #default="{ row }">
            <el-tag size="small" effect="plain" class="schedule_tag">{{ row.schedule }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="调度描述" min-width="130" show-overflow-tooltip>
          <template #default="{ row }">
            <span class="schedule_desc">{{ describeCron(row.schedule) }}</span>
          </template>
        </el-table-column>
        <el-table-column label="执行命令" min-width="180" show-overflow-tooltip>
          <template #default="{ row }">
            <code class="command_text">{{ row.command }}</code>
          </template>
        </el-table-column>
        <el-table-column label="状态" width="70" align="center">
          <template #default="{ row }">
            <el-switch
              v-model="row.enabled"
              size="small"
              :loading="row._toggling"
              @change="handleToggle(row)"
            />
          </template>
        </el-table-column>
        <el-table-column label="操作" width="260" fixed="right" align="center">
          <template #default="{ row }">
            <el-button
              type="primary"
              size="small"
              link
              :icon="VideoPlay"
              @click="handleRunOnce(row)"
            >
              执行
            </el-button>
            <el-button
              type="info"
              size="small"
              link
              :icon="Document"
              @click="openLogsDialog(row)"
            >
              记录
            </el-button>
            <el-button type="primary" size="small" link :icon="Edit" @click="openEditDialog(row)">
              编辑
            </el-button>
            <el-button type="danger" size="small" link :icon="Delete" @click="handleDelete(row)">
              删除
            </el-button>
          </template>
        </el-table-column>
      </el-table>
    </div>

    <!-- 添加/编辑对话框 -->
    <el-dialog
      v-model="showFormDialog"
      :title="editingJob ? '编辑计划任务' : '添加计划任务'"
      width="600px"
      :close-on-click-modal="false"
      @closed="resetForm"
    >
      <el-form ref="formRef" :model="form" :rules="formRules" label-width="90px">
        <el-form-item label="任务名称" prop="name">
          <el-input v-model="form.name" placeholder="例如：备份数据库" maxlength="50" />
        </el-form-item>
        <el-form-item label="调度规则" prop="scheduleType">
          <el-radio-group v-model="form.scheduleType" @change="onScheduleTypeChange">
            <el-radio-button value="preset">可视化选择</el-radio-button>
            <el-radio-button value="custom">自定义表达式</el-radio-button>
          </el-radio-group>
        </el-form-item>
        <el-form-item v-if="form.scheduleType === 'preset'" label="调度频率" prop="presetFreq">
          <el-select v-model="form.presetFreq" placeholder="选择频率" @change="onPresetFreqChange">
            <el-option label="每分钟" value="perMinute" />
            <el-option label="每小时" value="perHour" />
            <el-option label="每天" value="perDay" />
            <el-option label="每周" value="perWeek" />
            <el-option label="每月" value="perMonth" />
            <el-option label="每 N 分钟" value="perNMinute" />
            <el-option label="每 N 小时" value="perNHour" />
            <el-option label="每 N 天" value="perNDay" />
          </el-select>
        </el-form-item>
        <el-form-item v-if="form.scheduleType === 'preset' && form.presetFreq === 'perMinute'" label="间隔分钟">
          <el-input-number v-model="form.nMinute" :min="1" :max="59" />
          <span style="margin-left: 8px; color: #909399;">分钟</span>
        </el-form-item>
        <el-form-item v-if="form.scheduleType === 'preset' && form.presetFreq === 'perNHour'" label="间隔小时">
          <el-input-number v-model="form.nHour" :min="1" :max="23" />
          <span style="margin-left: 8px; color: #909399;">小时</span>
        </el-form-item>
        <el-form-item v-if="form.scheduleType === 'preset' && form.presetFreq === 'perNDay'" label="间隔天数">
          <el-input-number v-model="form.nDay" :min="1" :max="30" />
          <span style="margin-left: 8px; color: #909399;">天</span>
        </el-form-item>
        <template v-if="form.scheduleType === 'preset' && ['perDay', 'perWeek', 'perMonth', 'perNDay'].includes(form.presetFreq)">
          <el-form-item label="执行时间">
            <el-time-picker v-model="form.presetTime" format="HH:mm" value-format="HH:mm" placeholder="选择时间" />
          </el-form-item>
        </template>
        <el-form-item v-if="form.scheduleType === 'preset' && form.presetFreq === 'perWeek'" label="星期">
          <el-select v-model="form.presetWeekday" placeholder="选择星期">
            <el-option label="周一" :value="1" />
            <el-option label="周二" :value="2" />
            <el-option label="周三" :value="3" />
            <el-option label="周四" :value="4" />
            <el-option label="周五" :value="5" />
            <el-option label="周六" :value="6" />
            <el-option label="周日" :value="0" />
          </el-select>
        </el-form-item>
        <el-form-item v-if="form.scheduleType === 'preset' && form.presetFreq === 'perMonth'" label="日期">
          <el-input-number v-model="form.presetDay" :min="1" :max="28" />
          <span style="margin-left: 8px; color: #909399;">日</span>
        </el-form-item>
        <el-form-item v-if="form.scheduleType === 'custom'" label="Cron 表达式" prop="schedule">
          <el-input v-model="form.schedule" placeholder="例如: 0 2 * * * (每天凌晨2点)" />
        </el-form-item>
        <el-form-item v-if="form.scheduleType === 'custom'" label=" ">
          <span class="cron_hint">格式: 分 时 日 月 周 (空格分隔)</span>
        </el-form-item>
        <el-form-item label="执行命令" prop="command">
          <el-input
            v-model="form.command"
            type="textarea"
            :rows="3"
            placeholder="例如: /usr/local/bin/backup.sh"
          />
        </el-form-item>
      </el-form>
      <template #footer>
        <span class="dialog-footer">
          <el-button @click="showFormDialog = false">取消</el-button>
          <el-button type="primary" :loading="submitting" @click="handleSubmit">
            {{ editingJob ? '更新' : '添加' }}
          </el-button>
        </span>
      </template>
    </el-dialog>

    <!-- 执行结果对话框 -->
    <el-dialog
      v-model="showRunResult"
      title="执行结果"
      width="700px"
      :close-on-click-modal="false"
    >
      <div class="run_result">
        <el-tag :type="runResult.success ? 'success' : 'danger'" size="default" effect="dark" style="margin-bottom: 12px;">
          {{ runResult.jobName }} - {{ runResult.success ? '执行成功' : '执行失败' }}
        </el-tag>
        <pre class="run_output" v-html="ansiToHtml(runResult.output || '无输出')"></pre>
      </div>
    </el-dialog>

    <!-- 执行记录抽屉 -->
    <el-drawer
      v-model="showLogsDrawer"
      :title="`执行记录 - ${ logsJobName }`"
      size="700px"
      :close-on-click-modal="true"
    >
      <div class="logs_drawer_content">
        <div v-if="logsLoading" v-loading="logsLoading" style="height: 100px;" />
        <template v-else>
          <div v-if="executionLogs.length === 0" style="text-align: center; padding: 40px; color: #909399;">
            暂无执行记录
          </div>
          <div v-else class="logs_list">
            <div class="logs_toolbar">
              <span class="logs_count">共 {{ executionLogs.length }} 条记录</span>
              <el-button type="danger" size="small" link @click="handleCleanLogs">
                清空记录
              </el-button>
            </div>
            <el-collapse v-model="activeLogIndex">
              <el-collapse-item
                v-for="(log, index) in executionLogs"
                :key="index"
                :name="index"
              >
                <template #title>
                  <div class="log_header">
                    <el-tag
                      :type="log.status === 'SUCCESS' ? 'success' : 'danger'"
                      size="small"
                      effect="dark"
                      class="log_status_tag"
                    >
                      {{ log.status === 'SUCCESS' ? '成功' : '失败' }}
                    </el-tag>
                    <span class="log_time">{{ log.time }}</span>
                  </div>
                </template>
                <pre class="log_content" v-html="ansiToHtml(log.content)"></pre>
              </el-collapse-item>
            </el-collapse>
          </div>
        </template>
      </div>
    </el-drawer>
  </div>
</template>

<script setup>
import { ref, onMounted, onUnmounted, computed, watch, getCurrentInstance } from 'vue'
import { RefreshRight, Plus, Edit, Delete, VideoPlay, Document } from '@element-plus/icons-vue'
import { generateSocketInstance } from '@/utils'

const { proxy: { $store, $message, $messageBox } } = getCurrentInstance()

// ==================== ANSI 颜色转 HTML ====================
const ANSI_COLORS_256 = (() => {
  const colors = []
  // 0-7: 标准色
  colors.push('#000000', '#c0392b', '#27ae60', '#f39c12', '#2980b9', '#8e44ad', '#16a085', '#bdc3c7')
  // 8-15: 亮色
  colors.push('#7f8c8d', '#e74c3c', '#2ecc71', '#f1c40f', '#3498db', '#9b59b6', '#1abc9c', '#ecf0f1')
  // 16-231: 6x6x6 色彩立方
  const steps = [0, 95, 135, 175, 215, 255]
  for (let r = 0; r < 6; r++) {
    for (let g = 0; g < 6; g++) {
      for (let b = 0; b < 6; b++) {
        colors.push(`rgb(${ steps[r] },${ steps[g] },${ steps[b] })`)
      }
    }
  }
  // 232-255: 灰度
  for (let i = 0; i < 24; i++) {
    const v = 8 + i * 10
    colors.push(`rgb(${ v },${ v },${ v })`)
  }
  return colors
})()

function escapeHtml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function ansiToHtml(text) {
  if (!text) return ''
  let result = escapeHtml(text)
  // 处理 256 色: \x1b[38;5;Nm (前景) 和 \x1b[48;5;Nm (背景)
  result = result.replace(/\x1b\[38;5;(\d+)m/g, (_, code) => {
    const color = ANSI_COLORS_256[parseInt(code)] || '#ffffff'
    return `<span style="color:${ color }">`
  })
  result = result.replace(/\x1b\[48;5;(\d+)m/g, (_, code) => {
    const color = ANSI_COLORS_256[parseInt(code)] || '#000000'
    return `<span style="background-color:${ color }">`
  })
  // 处理基本前景色: \x1b[30-37m, \x1b[90-97m
  const basicFg = { 30: '#000', 31: '#c0392b', 32: '#27ae60', 33: '#f39c12', 34: '#2980b9', 35: '#8e44ad', 36: '#16a085', 37: '#bdc3c7', 90: '#7f8c8d', 91: '#e74c3c', 92: '#2ecc71', 93: '#f1c40f', 94: '#3498db', 95: '#9b59b6', 96: '#1abc9c', 97: '#ecf0f1' }
  result = result.replace(/\x1b\[(\d+)m/g, (_, code) => {
    const n = parseInt(code)
    if (n === 0) return '</span>'
    if (basicFg[n]) return `<span style="color:${ basicFg[n] }">`
    if (n === 1) return '<span style="font-weight:bold">'
    return ''
  })
  // 兜底：处理可能残留的 \e[...m 序列
  result = result.replace(/\x1b\[[0-9;]*m/g, '')
  return result
}

const props = defineProps({
  hostId: {
    type: String,
    required: true
  },
  visible: {
    type: Boolean,
    required: true
  }
})

const socket = ref(null)
const loading = ref(false)
const jobs = ref([])
const serverErr = ref(false)
const selectedJobs = ref([])
const showFormDialog = ref(false)
const showRunResult = ref(false)
const showLogsDrawer = ref(false)
const editingJob = ref(null)
const submitting = ref(false)
const formRef = ref(null)
const logsJobName = ref('')
const logsLoading = ref(false)
const executionLogs = ref([])
const activeLogIndex = ref([])

const runResult = ref({
  success: false,
  output: '',
  jobName: ''
})

const form = ref({
  name: '',
  scheduleType: 'preset',
  schedule: '',
  command: '',
  presetFreq: 'perDay',
  presetTime: '00:00',
  presetWeekday: 1,
  presetDay: 1,
  nMinute: 5,
  nHour: 1,
  nDay: 1
})

const formRules = {
  name: [{ required: true, message: '请输入任务名称', trigger: 'blur' }],
  command: [{ required: true, message: '请输入执行命令', trigger: 'blur' }],
  schedule: [{ required: true, message: '请输入 cron 表达式', trigger: 'blur' }]
}

const hostId = computed(() => props.hostId)

const checkAll = computed({
  get() {
    return jobs.value.length > 0 && selectedJobs.value.length === jobs.value.length
  },
  set(val) {
    handleSelectAll(val)
  }
})

const isIndeterminate = computed(() => {
  return selectedJobs.value.length > 0 && selectedJobs.value.length < jobs.value.length
})

// ==================== Cron 描述函数 ====================
const describeCron = (schedule) => {
  if (!schedule) return '--'
  const parts = schedule.trim().split(/\s+/)
  if (parts.length !== 5) return schedule

  const [min, hour, dom, month, dow] = parts

  if (min === '*' && hour === '*') return '每分钟'
  if (min.startsWith('*/')) return `每 ${ min.slice(2) } 分钟`
  if (hour.startsWith('*/') && (min === '0' || min === '00')) return `每 ${ hour.slice(2) } 小时`
  if (dom === '*' && month === '*' && dow === '*') {
    if (hour !== '*' && min !== '*') return `每天 ${ hour.padStart(2, '0')}:${ min.padStart(2, '0') }`
    return `每天 ${ min } ${ hour }`
  }
  if (dom === '*' && month === '*' && dow !== '*') {
    const weekdays = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']
    const wd = weekdays[parseInt(dow)] || `周${ dow }`
    if (hour !== '*' && min !== '*') return `每${ wd } ${ hour.padStart(2, '0')}:${ min.padStart(2, '0') }`
    return `每${ wd }`
  }
  if (month !== '*' && dom !== '*') return `每月 ${ month }月${ dom }日 ${ hour }:${ min }`

  return schedule
}

// ==================== 预设调度 ====================
const buildPresetSchedule = () => {
  const time = form.value.presetTime || '00:00'
  const [h, m] = time.split(':')
  const minute = h === '00' && m === '00' ? '0' : m
  const hour = h

  switch (form.value.presetFreq) {
    case 'perMinute':
      return `*/${ form.value.nMinute } * * * *`
    case 'perHour':
      return `${ minute } * * * *`
    case 'perNHour':
      return `${ minute } */${ form.value.nHour } * * *`
    case 'perDay':
      return `${ minute } ${ hour } * * *`
    case 'perNDay':
      return `${ minute } ${ hour } */${ form.value.nDay } * *`
    case 'perWeek':
      return `${ minute } ${ hour } * * ${ form.value.presetWeekday }`
    case 'perMonth':
      return `${ minute } ${ hour } ${ form.value.presetDay } * *`
    default:
      return `${ minute } ${ hour } * * *`
  }
}

const onScheduleTypeChange = () => {
  if (form.value.scheduleType === 'preset') {
    form.value.schedule = buildPresetSchedule()
  }
}

const onPresetFreqChange = () => {
  form.value.schedule = buildPresetSchedule()
}

watch(
  () => [form.value.presetTime, form.value.presetWeekday, form.value.presetDay, form.value.nMinute, form.value.nHour, form.value.nDay],
  () => {
    if (form.value.scheduleType === 'preset') {
      form.value.schedule = buildPresetSchedule()
    }
  }
)

// ==================== WebSocket ====================
const connect = () => {
  socket.value = generateSocketInstance('/cronjob')
  socket.value.on('connect', () => {
    loading.value = true
    socket.value.emit('ws_cronjob', { hostId: hostId.value })

    socket.value.on('cronjob_list_data', (data) => {
      serverErr.value = false
      loading.value = false
      if (!Array.isArray(data)) return
      const currentSelectedIds = new Set(selectedJobs.value.map(j => j.id))
      jobs.value = data.map(j => ({ ...j, _toggling: false }))
      if (selectedJobs.value.length > 0) {
        selectedJobs.value = jobs.value.filter(j => currentSelectedIds.has(j.id))
      }
    })

    socket.value.on('cronjob_operation_result', (result) => {
      if (result.success) {
        $message.success(result.message)
      } else {
        $message.error(result.message)
      }
      loading.value = false
    })

    socket.value.on('cronjob_run_result', (result) => {
      runResult.value = {
        success: result.success,
        output: result.output || '',
        jobName: result.jobName || ''
      }
      showRunResult.value = true
      loading.value = false
    })

    socket.value.on('cronjob_logs_data', ({ id, logs }) => {
      executionLogs.value = logs || []
      logsLoading.value = false
    })

    socket.value.on('cronjob_connect_fail', () => {
      serverErr.value = true
      loading.value = false
    })
  })

  socket.value.on('disconnect', () => {
    loading.value = false
    socket.value = null
  })
}

const refresh = (isLoading = true) => {
  if (!socket.value || !socket.value.connected) return connect()
  loading.value = isLoading
  socket.value.emit('cronjob_get_list')
}

const reconnect = (isLoading = true) => {
  if (socket.value) {
    socket.value.removeAllListeners()
    socket.value.close()
    socket.value = null
  }
  selectedJobs.value = []
  connect()
}

// ==================== 表单操作 ====================
const openAddDialog = () => {
  editingJob.value = null
  form.value.scheduleType = 'preset'
  form.value.presetFreq = 'perDay'
  form.value.presetTime = '00:00'
  form.value.schedule = buildPresetSchedule()
  showFormDialog.value = true
}

const openEditDialog = (row) => {
  editingJob.value = row
  form.value.name = row.name
  form.value.command = row.command
  form.value.schedule = row.schedule
  form.value.scheduleType = 'custom'
  showFormDialog.value = true
}

const resetForm = () => {
  form.value = {
    name: '',
    scheduleType: 'preset',
    schedule: '',
    command: '',
    presetFreq: 'perDay',
    presetTime: '00:00',
    presetWeekday: 1,
    presetDay: 1,
    nMinute: 5,
    nHour: 1,
    nDay: 1
  }
  editingJob.value = null
}

const handleSubmit = async () => {
  if (!formRef.value) return
  await formRef.value.validate()

  const schedule = form.value.scheduleType === 'preset' ? buildPresetSchedule() : form.value.schedule
  const payload = {
    name: form.value.name.trim(),
    schedule: schedule.trim(),
    command: form.value.command.trim()
  }

  if (!socket.value || !socket.value.connected) {
    $message.error('连接已断开')
    return
  }

  submitting.value = true
  if (editingJob.value) {
    socket.value.emit('cronjob_update', { id: editingJob.value.id, ...payload })
  } else {
    socket.value.emit('cronjob_add', payload)
  }
  submitting.value = false
  showFormDialog.value = false
}

// ==================== CRUD 操作 ====================
const handleDelete = (row) => {
  $messageBox.confirm(`确认删除计划任务「${ row.name }」？`, '警告', {
    confirmButtonText: '确定',
    cancelButtonText: '取消',
    type: 'warning'
  }).then(() => {
    socket.value.emit('cronjob_delete', { id: row.id })
  }).catch(() => {})
}

const handleToggle = (row) => {
  if (!socket.value || !socket.value.connected) {
    $message.error('连接已断开')
    row.enabled = !row.enabled
    return
  }
  row._toggling = true
  socket.value.emit('cronjob_toggle', { id: row.id, enabled: row.enabled })
  // 3秒后取消 loading 状态（等待服务端刷新列表）
  setTimeout(() => { row._toggling = false }, 3000)
}

const handleRunOnce = (row) => {
  $messageBox.confirm(`确认立即执行「${ row.name }」？`, '执行确认', {
    confirmButtonText: '确定',
    cancelButtonText: '取消',
    type: 'info'
  }).then(() => {
    loading.value = true
    socket.value.emit('cronjob_run_once', { id: row.id })
  }).catch(() => {})
}

const handleBatchDelete = () => {
  $messageBox.confirm(`确认删除选中的 ${ selectedJobs.value.length } 个计划任务？`, '批量删除', {
    confirmButtonText: '确定删除',
    cancelButtonText: '取消',
    type: 'error'
  }).then(() => {
    const ids = selectedJobs.value.map(j => j.id)
    socket.value.emit('cronjob_batch_delete', { ids })
  }).catch(() => {})
}

// ==================== 执行记录 ====================
const openLogsDialog = (row) => {
  showLogsDrawer.value = true
  logsJobName.value = row.name
  logsLoading.value = true
  executionLogs.value = []
  activeLogIndex.value = []
  socket.value.emit('cronjob_get_logs', { id: row.id })
}

const handleCleanLogs = () => {
  const currentJob = jobs.value.find(j => logsJobName.value && executionLogs.value.length > 0)
  $messageBox.confirm('确认清空该任务的所有执行记录？', '清空记录', {
    confirmButtonText: '确定',
    cancelButtonText: '取消',
    type: 'warning'
  }).then(() => {
    // 找到当前查看的任务 ID
    const job = jobs.value.find(j => j.name === logsJobName.value)
    if (job) {
      socket.value.emit('cronjob_clean_logs', { id: job.id })
      executionLogs.value = []
    }
  }).catch(() => {})
}

// ==================== 选择相关 ====================
const handleSelectionChange = (selection) => {
  selectedJobs.value = selection
}

const handleSelectAll = (val) => {
  if (val) {
    selectedJobs.value = [...jobs.value]
  } else {
    selectedJobs.value = []
  }
}

const getRowClassName = ({ row }) => {
  if (!row.enabled) return 'row_disabled'
  if (row.system) return 'row_system'
  return ''
}

// ==================== 生命周期 ====================
watch(() => props.visible, (newVal) => {
  if (newVal) {
    refresh(false)
  }
})

onMounted(() => {
  connect()
})

onUnmounted(() => {
  if (socket.value) {
    socket.value.removeAllListeners()
    socket.value.close()
    socket.value = null
  }
})
</script>

<style lang="scss" scoped>
.cronjob_container {
  padding: 10px;
  position: relative;
  min-height: 300px;
}

.top_toolbar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
  padding: 0 4px;
  flex-wrap: wrap;
  gap: 10px;

  .left_tools {
    display: flex;
    align-items: center;
    gap: 12px;

    .batch_info_tag {
      font-size: 14px;
      color: var(--el-text-color-regular);
      background: var(--el-fill-color-light);
      padding: 4px 10px;
      border-radius: 4px;

      .count {
        color: var(--el-color-primary);
        font-weight: bold;
        margin: 0 4px;
      }
    }
  }

  .right_tools {
    display: flex;
    align-items: center;
    gap: 10px;
  }
}

.table_wrapper {
  min-height: 200px;
  max-height: 65vh;
  overflow-y: auto;
  overflow-x: hidden;
}

.job_name {
  font-weight: 500;
}

.schedule_tag {
  font-family: monospace;
  font-size: 12px;
}

.schedule_desc {
  color: var(--el-text-color-secondary);
  font-size: 13px;
}

.command_text {
  font-family: monospace;
  font-size: 12px;
  background: var(--el-fill-color-lighter);
  padding: 2px 6px;
  border-radius: 3px;
  color: var(--el-text-color-regular);
}

.cron_hint {
  font-size: 12px;
  color: var(--el-text-color-placeholder);
}

.run_result {
  .run_output {
    background: #1e1e1e;
    color: #d4d4d4;
    padding: 12px;
    border-radius: 6px;
    font-family: 'Courier New', monospace;
    font-size: 12px;
    max-height: 400px;
    overflow: auto;
    white-space: pre-wrap;
    word-break: break-all;
    line-height: 1.5;
  }
}

// 执行记录抽屉样式
.logs_drawer_content {
  padding: 0 4px;
}

.logs_toolbar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
  padding-bottom: 8px;
  border-bottom: 1px solid var(--el-border-color-lighter);

  .logs_count {
    font-size: 13px;
    color: var(--el-text-color-secondary);
  }
}

.logs_list {
  :deep(.el-collapse-item__header) {
    height: 40px;
    line-height: 40px;
    font-size: 13px;
  }

  :deep(.el-collapse-item__content) {
    padding-bottom: 8px;
  }
}

.log_header {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;

  .log_status_tag {
    flex-shrink: 0;
  }

  .log_time {
    color: var(--el-text-color-secondary);
    font-size: 12px;
    font-family: monospace;
  }
}

.log_content {
  background: #1e1e1e;
  color: #d4d4d4;
  padding: 10px;
  border-radius: 4px;
  font-family: 'Courier New', monospace;
  font-size: 11px;
  max-height: 300px;
  overflow: auto;
  white-space: pre-wrap;
  word-break: break-all;
  line-height: 1.4;
  margin: 0;
}

:deep(.el-table) {
  .row_disabled {
    opacity: 0.5;
  }
  .row_system {
    opacity: 0.7;
  }
}
</style>
