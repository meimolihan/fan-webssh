const { AIConfigDB, ChatHistoryDB } = require('../utils/db-class')

const aiConfigDB = new AIConfigDB().getInstance()
const chatHistoryDB = new ChatHistoryDB().getInstance()

async function getAIConfig({ res }) {
  try {
    const config = await aiConfigDB.findOneAsync({})
    if (!config) {
      return res.success({ data: {} })
    }
    res.success({ data: config })
  } catch (error) {
    res.fail({ msg: '获取配置失败' })
  }
}

async function getAIModels({ res, request }) {
  const { apiKey, apiBaseUrl, model } = request.body
  if (!apiKey || !apiBaseUrl) {
    return res.fail({ data: false, msg: '参数错误' })
  }
  try {
    const response = await fetch(`${apiBaseUrl}/v1/models`, {
      headers: { 'Authorization': `Bearer ${apiKey}` }
    })
    if (!response.ok) {
      return res.fail({ msg: '获取模型列表失败' })
    }
    const data = await response.json()
    const models = data?.data?.map(m => m.id) || []
    res.success({ data: models })
  } catch (error) {
    res.fail({ msg: error.message || '获取模型列表失败' })
  }
}

async function saveAIConfig({ res, request }) {
  const config = request.body
  if (!config) return res.fail({ data: false, msg: '参数错误' })
  const existingConfig = await aiConfigDB.findOneAsync({})
  if (existingConfig) {
    await aiConfigDB.updateAsync({ _id: existingConfig._id }, { $set: config })
  } else {
    await aiConfigDB.insertAsync(config)
  }
  res.success({ data: true })
}

async function getChatHistory({ res }) {
  const chatHistory = await chatHistoryDB.findAsync({})
  const newChatHistory = chatHistory.map(item => {
    item.id = item._id
    delete item._id
    return item
  }).sort((a, b) => b.createdAt - a.createdAt)
  res.success({ data: newChatHistory || [] })
}

async function saveChatHistory({ res, request }) {
  const chatRecord = request.body
  const { id = '', chatList } = chatRecord
  if (!chatList) return res.fail({ data: false, msg: '参数错误' })
  let updateChat = chatRecord
  if (id) {
    chatRecord.updatedAt = Date.now()
    await chatHistoryDB.updateAsync({ _id: id }, chatRecord)
  } else {
    chatRecord.createdAt = Date.now()
    delete chatRecord.id
    const result = await chatHistoryDB.insertAsync(chatRecord)
    updateChat = result
    updateChat.id = result._id
    delete updateChat._id
  }
  res.success({ data: { updateChat } })
}

async function removeChatHistory({ res, request }) {
  let { params: { id } } = request
  if (!id) return res.fail({ data: false, msg: '参数错误' })
  await chatHistoryDB.removeAsync({ _id: id })
  res.success({ data: true })
}

module.exports = {
  getAIConfig,
  saveAIConfig,
  getAIModels,
  getChatHistory,
  saveChatHistory,
  removeChatHistory
}
