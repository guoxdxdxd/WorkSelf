/**
 * First-run initialization of a workspace archive (workos/v2).
 *
 * Creates `<workspace>/workos/` with a person ledger, project skeleton and the
 * narrative archives the assistant reads. Idempotent: existing files are never
 * touched, so opening the assistant again only fills gaps.
 */

import { mkdir, readFile } from 'node:fs/promises'
import { dirname, join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import * as md from './md.js'

/** The helper charter, kept as one editable Markdown asset (not a JS string). */
const AGENT_FILE = join(dirname(fileURLToPath(import.meta.url)), '..', 'assets', 'workos-agent.md')

const META = `schema: workos/v2
next_uid: 1001
types:
  - 展会
  - 活动
  - 公众号
  - PPT
  - 设计
  - 采购
  - 沟通
  - 临时事项
  - 自定义
`

const CONTACT_HEADERS = ['id', '姓名', '公司', '部门', '职位', '电话', '负责事项', '打交道经验', '备注']

const SELF_CONTACT = {
  id: 'c1',
  name: '我',
  company: '',
  dept: '',
  role: '本人',
  phone: '',
  duty: '',
  experience: '',
  note: '系统用户本人',
}

const ARCHIVES = {
  '经验.md': `# 经验

> 一两句话能直接指导下次行动；不写“这次很顺利”这类空话。

## 沟通协作

## 项目管理

## 对外与材料

## 避坑
`,
}

function contactsDoc() {
  const row = [SELF_CONTACT.id, SELF_CONTACT.name, '', '', SELF_CONTACT.role, '', '', SELF_CONTACT.experience, SELF_CONTACT.note]
  return md.joinFrontmatter(
    { schema: 'workos/v2', kind: 'contacts' },
    `# 联系人\n\n${md.renderTable(CONTACT_HEADERS, [row])}\n`,
  )
}

/**
 * Append the work-assistant charter to the workspace AGENTS.md, preserving any
 * instructions already there. DSH loads that file automatically for sessions in
 * this workspace, so every new session starts as the user's assistant.
 *
 * The charter lives in `assets/workos-agent.md` and ships with the plugin, so it
 * is edited as one Markdown document instead of a string buried in this file.
 * When the block is already present it is refreshed in place, so an upgrade of
 * the assistant's rules reaches workspaces initialized by an older version.
 * @param workspace - absolute workspace root.
 * @returns the path when the file was created or changed.
 */
export async function ensureWorkspaceAgent(workspace) {
  const path = join(workspace, 'AGENTS.md')
  const start = '<!-- workos-agent:start -->'
  const end = '<!-- workos-agent:end -->'
  const block = (await readFile(AGENT_FILE, 'utf8')).trim()
  if (!block.startsWith(start) || !block.endsWith(end)) {
    throw new Error('assets/workos-agent.md 必须用 workos-agent 起止标记包住')
  }
  const current = await md.readText(path)
  if (current.includes(start) && current.includes(end)) {
    const pattern = new RegExp(`${start}[\\s\\S]*?${end}`)
    if (!pattern.test(current)) return null
    const next = current.replace(pattern, () => block)
    if (next === current) return null
    // Refresh in place: this is not a newly created file, so don't report one.
    await md.writeText(path, next)
    return null
  }
  const next = current.trim() ? `${current.replace(/\s+$/, '')}\n\n${block}\n` : `${block}\n`
  await md.writeText(path, next)
  return path
}

/**
 * Ensure the default self contact exists, for archives initialized before it.
 * @param store - a Store-like reader/writer of contacts.
 * @returns whether a row was added.
 */
export async function ensureSelfContact(store) {
  const rows = await store.loadContacts()
  if (rows.some(row => row.name === '我')) return false
  const maxId = rows.reduce((max, row) => Math.max(max, Number(String(row.id).replace(/^\D+/, '')) || 0), 0)
  rows.unshift({ ...SELF_CONTACT, id: `c${maxId + 1}` })
  await store.saveContacts(rows)
  return true
}

function overviewDoc(year) {
  return `# ${year} 年度概述

## 项目

| 项目 | 状态 | 关键节点 | 备注 |
| ---- | ---- | -------- | ---- |
`
}

/**
 * Ensure the archive skeleton exists under `root`.
 * @param root - absolute `<workspace>/workos` directory.
 * @returns created or repaired file paths, relative to the workspace.
 */
export async function initializeWorkspace(root) {
  const created = []
  const workspace = dirname(root)
  for (const path of [root, join(root, 'data'), join(root, 'data', 'workos'), join(root, 'data', '日报'), join(root, 'data', '周报'), join(root, 'work')]) {
    await mkdir(path, { recursive: true })
  }

  const year = new Date().getFullYear()
  const dept = '我的工作'
  const yearDir = join(root, 'work', dept, String(year))
  for (const path of [yearDir, join(yearDir, '项目'), join(yearDir, '日常工作')]) {
    await mkdir(path, { recursive: true })
  }

  const writeIfMissing = async (path, content) => {
    const current = await md.readText(path)
    if (current.trim()) return
    await md.writeText(path, content)
    created.push(relative(workspace, path).split(sep).join('/'))
  }

  await writeIfMissing(join(root, 'README.md'), `# 工作档案（Work OS）

这个目录属于当前工作区，由 DSH 的「工作驾驶舱」维护，是 AI 工作助手的长期记忆。

- \`data/workos/contacts.md\`：联系人，以及每个人的「打交道经验」
- \`data/workos/meta.yaml\`：项目 uid 与类型词典
- \`data/日报/YYYY-MM-DD.md\`、\`data/周报/起始_结束.md\`：个人汇报（汇总全部项目，生成时间、汇报时段、简介、详细内容）
- \`data/经验.md\`：跨场景可复用的方法（doc.append 写入）
- \`work/{部门}/{年份}/项目/{项目名}/README.md\`：项目主档（目标与背景、事项索引、进展、复盘）
- \`work/{部门}/{年份}/项目/{项目名}/事项/w{编号} {事项名}.md\`：一个事项一个文件，字段、详情与日志都在里面
- \`work/{部门}/{年份}/项目/{项目名}/汇报/日报|周报/\`：项目汇报（只汇总该项目），和 事项/ 平级
- \`work/{部门}/{年份}/日常工作/YYYY-MM-DD HH-MM-SS {名称}.md\`：不属于任何项目的临时事项，一个事项一个文件（字段、详情与日志和项目事项一致）

一个项目一个文件夹：项目再大也只在文件夹里生长，事项各自成文件，日志写在所属事项文件里，不单独建文件。不属于项目的事项放 \`日常工作/\`，不硬塞进项目，也不为它造项目。项目太多时直接按文件夹浏览，不必翻一个巨大的 md。
给 AI 提问时，在项目、事项或日志上点「加入对话」，它会带上 uid / item / log 和文件在工作区内的相对路径进聊天，AI 再按编号读取这里的最新内容。
`)

  await writeIfMissing(join(root, 'data', 'workos', 'meta.yaml'), META)
  await writeIfMissing(join(root, 'data', 'workos', 'contacts.md'), contactsDoc())
  for (const [file, content] of Object.entries(ARCHIVES)) {
    await writeIfMissing(join(root, 'data', file), content)
  }
  await writeIfMissing(join(root, 'work', dept, String(year), '_年度概述.md'), overviewDoc(year))

  const agentPath = await ensureWorkspaceAgent(workspace)
  if (agentPath) created.push(relative(workspace, agentPath).split(sep).join('/'))

  return { created, root, year, dept, agentPath }
}
