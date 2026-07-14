const { ScriptGroupDB } = require('../utils/db-class')
const scriptGroupDB = new ScriptGroupDB().getInstance()

async function getScriptGroupList({ res }) {
  let data = await scriptGroupDB.findAsync({})
  data = data.map(item => ({ ...item, id: item._id }))
  data?.sort((a, b) => Number(b.index || 0) - Number(a.index || 0))
  res.success({ data })
}

const addScriptGroup = async ({ res, request }) => {
  const { name, index } = request.body
  if (!name) return res.fail({ data: false, msg: '参数错误' })
  const result = await scriptGroupDB.insertAsync({ name, index: index || 0 })
  res.success({ data: { ...result, id: result._id } })
}

const updateScriptGroup = async ({ res, request }) => {
  let { params: { id }, body } = request
  if (!id) return res.fail({ data: false, msg: '参数错误' })
  await scriptGroupDB.updateAsync({ _id: id }, { $set: body })
  res.success({ data: true })
}

const removeScriptGroup = async ({ res, request }) => {
  let { params: { id } } = request
  if (!id) return res.fail({ data: false, msg: '参数错误' })
  await scriptGroupDB.removeAsync({ _id: id })
  res.success({ data: true })
}

module.exports = {
  addScriptGroup,
  getScriptGroupList,
  updateScriptGroup,
  removeScriptGroup
}