/**
 * Work assistant store over the workspace's Markdown archive (workos/v2).
 *
 * The model is not a task list: a project is a goal, an item is a unit of work
 * with people, dependencies and an event/solution log, and a person carries the
 * accumulated 打交道经验. Everything the assistant needs to answer "what should
 * I do about this?" is assembled from these files, and everything it decides is
 * written back here.
 */

import { readdir, mkdir, rename, rm } from 'node:fs/promises'
import { join, relative, sep, dirname, basename, resolve } from 'node:path'
import * as md from './md.js'
import {
  buildReportData,
  listReports as listReportFiles,
  saveReport as saveReportFile,
  updateReport as updateReportFile,
} from './reports.js'

export class StoreError extends Error {}

const CONTACT_HEADERS = ['id', '姓名', '公司', '部门', '职位', '电话', '负责事项', '打交道经验', '备注']
const PROGRESS_HEADERS = ['日期', '进展', '备注']
const LOG_HEADERS = ['时间', '事件', '解决方案']
const ITEM_HEADERS = ['事项', '状态', '负责人', '到期', '文件']

/**
 * Archive layout:
 *
 *   work/{dept}/{year}/项目/{project}/README.md      project base file
 *   work/{dept}/{year}/项目/{project}/事项/w1 名称.md  one file per item, logs inside
 *
 * A single `{project}.md` file is the legacy layout; it is read as-is and split
 * into the folder layout on the next write or on an explicit migration.
 */
const ITEM_DIR = '事项'
const PROJECT_README = 'README.md'
/** Ad-hoc work that belongs to no project: one item file per piece of work. */
const DAILY_DIR = '日常工作'

export const ITEM_STATUSES = ['未开始', '进行中', '等待反馈', '已完成', '已关闭', '暂停']
// New items start in progress: most work is not finished in one conversation.
// 已完成 is only written when the user says so or marks it in the UI.
export const DEFAULT_ITEM_STATUS = '进行中'
const ACTIVE_ITEM_STATUSES = ['未开始', '进行中', '等待反馈', '暂停']
const DONE_ITEM_STATUSES = ['已完成', '已关闭']

const HEADER_STATUS_LABELS = {
  doing: '进行中',
  done: '已完成',
  closed: '已关闭',
  paused: '暂停',
}

const DEFAULT_META = {
  schema: 'workos/v2',
  next_uid: 1001,
  types: ['展会', '活动', '公众号', 'PPT', '设计', '采购', '沟通', '临时事项', '自定义'],
  sources: ['领导安排', '会议产生', '自主规划', '客户需求', '临时事项'],
}

export function pad2(value) {
  return String(value).padStart(2, '0')
}

export function localDate(date = new Date()) {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`
}

export function localStamp(date = new Date()) {
  return `${localDate(date)} ${pad2(date.getHours())}:${pad2(date.getMinutes())}`
}

/** Date + hours:minutes:seconds, used as the prefix of a 日常工作 item file. */
export function localStampSeconds(date = new Date()) {
  return `${localDate(date)} ${pad2(date.getHours())}:${pad2(date.getMinutes())}:${pad2(date.getSeconds())}`
}

/** File-name-safe second-precision stamp (`2026-11-20 10-02-27`). */
export function fileStamp(date = new Date()) {
  return localStampSeconds(date).replaceAll(':', '-')
}

export function parseDateTime(value) {
  if (!value) return null
  const match = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T](\d{1,2}):(\d{2}))?/.exec(String(value).trim())
  if (!match) return null
  const date = new Date(
    Number(match[1]), Number(match[2]) - 1, Number(match[3]),
    match[4] === undefined ? 23 : Number(match[4]),
    match[5] === undefined ? 59 : Number(match[5]), 0, 0,
  )
  return Number.isNaN(date.getTime()) ? null : date
}

export function fmtRemaining(hours) {
  if (hours === null || hours === undefined) return '未设截止'
  if (hours < 0) {
    const days = Math.floor(-hours / 24)
    if (days >= 1) return `超期 ${days} 天`
    return `超期 ${Math.max(1, Math.ceil(-hours))} 小时`
  }
  if (hours < 1) return `剩 ${Math.max(1, Math.round(hours * 60))} 分钟`
  if (hours < 24) return `剩 ${Math.round(hours)} 小时`
  return `剩 ${Math.ceil(hours / 24)} 天`
}

export function dueInfo(value) {
  const due = parseDateTime(value)
  if (!due) return { hoursLeft: null, remainingText: '未设截止', urgency: 'normal', overdue: false }
  const hours = (due.getTime() - Date.now()) / 3600000
  let urgency = 'normal'
  if (hours < 0) urgency = 'danger'
  else if (hours <= 24) urgency = 'warn'
  else if (hours <= 72) urgency = 'soon'
  return { hoursLeft: hours, remainingText: fmtRemaining(hours), urgency, overdue: hours < 0 }
}

function splitNames(value) {
  return String(value || '')
    .split(/[、,，;；\/]/)
    .map(name => name.trim())
    .filter(Boolean)
}

function itemNumber(itemId) {
  const match = /^[wd](\d+)$/i.exec(String(itemId || '').trim())
  return match ? Number(match[1]) : 0
}

function statusCn(value, fallback = '未开始') {
  return ITEM_STATUSES.includes(String(value || '').trim()) ? String(value).trim() : fallback
}

async function safeEntries(dir) {
  try {
    return await readdir(dir, { withFileTypes: true })
  } catch (error) {
    if (error && (error.code === 'ENOENT' || error.code === 'ENOTDIR')) return []
    throw error
  }
}

async function isDir(path) {
  try {
    await readdir(path)
    return true
  } catch {
    return false
  }
}

/* ----------------------------------------------------------- item parsing */

function parseItemBlock(text, fallbackId) {
  const lines = String(text || '').split(/\r?\n/)
  const heading = /^###\s+(w\d+)\s*[·:：-]?\s*(.*)$/i.exec(lines[0] || '')
  if (!heading) return null
  const item = {
    itemId: heading[1].toLowerCase(),
    title: heading[2].trim() || fallbackId || '',
    status: '未开始',
    owner: '',
    participants: [],
    due: '',
    deps: [],
    detail: '',
    logs: [],
  }
  let inLogs = false
  let detailBuffer = []
  let currentField = ''
  const flushDetail = () => {
    if (detailBuffer.length) item.detail = (item.detail ? `${item.detail}\n` : '') + detailBuffer.join(' ').trim()
    detailBuffer = []
  }
  for (let index = 1; index < lines.length; index += 1) {
    const line = lines[index]
    if (/^####\s+日志/.test(line.trim())) {
      flushDetail()
      currentField = ''
      inLogs = true
      continue
    }
    if (inLogs) continue
    const field = /^[-*]\s+\*\*(.+?)\*\*\s*[:：]\s*(.*)$/.exec(line.trim())
    if (field) {
      flushDetail()
      currentField = field[1].trim()
      const value = field[2].trim()
      if (currentField === '状态') item.status = statusCn(value)
      else if (currentField === '负责人') item.owner = value
      else if (currentField === '涉及人员') item.participants = splitNames(value)
      else if (currentField === '到期') item.due = value
      else if (currentField === '依赖') item.deps = splitNames(value).map(dep => dep.toLowerCase())
      else if (currentField === '详情') detailBuffer.push(value)
      continue
    }
    if (currentField === '详情' && line.trim() && !/^#{2,4}\s/.test(line.trim())) {
      detailBuffer.push(line.trim())
    }
  }
  flushDetail()
  const logSection = /####\s+日志([\s\S]*)$/.exec(String(text || ''))
  if (logSection) {
    const table = md.parseTableLines(logSection[1].split(/\r?\n/))
    item.logs = table.rows
      .map(row => ({
        time: String(row['时间'] || '').trim(),
        event: String(row['事件'] || '').trim(),
        solution: String(row['解决方案'] || '').trim(),
      }))
      .filter(log => log.time || log.event || log.solution)
  }
  return item
}

function parseItemsFromBlocks(content) {
  const lines = String(content || '').split(/\r?\n/)
  const blocks = []
  let current = null
  for (const line of lines) {
    if (/^###\s+w\d+/i.test(line.trim())) {
      if (current) blocks.push(current)
      current = [line]
      continue
    }
    if (current) current.push(line)
  }
  if (current) blocks.push(current)
  return blocks
    .map(block => parseItemBlock(block.join('\n')))
    .filter(Boolean)
}

function parseLegacyItems(body) {
  const table = md.sectionTable(body, '工作事项')
  return table.rows
    .map(row => {
      const itemId = String(row.id || '').trim().toLowerCase()
      if (itemNumber(itemId) <= 0) return null
      return {
        itemId,
        title: String(row['事项'] || '').trim(),
        status: statusCn(row['状态']),
        owner: String(row['负责人'] || '').trim(),
        participants: splitNames(row['相关人员']),
        due: String(row['截止'] || '').trim(),
        deps: [],
        detail: String(row['备注'] || '').trim(),
        logs: [],
      }
    })
    .filter(Boolean)
}

export function parseItems(body) {
  const content = md.sectionContent(body, '工作事项')
  const blocks = parseItemsFromBlocks(content)
  if (blocks.length) return blocks
  return parseLegacyItems(body)
}

/** File-name-safe text for `w3 事项名.md` (keeps the name readable). */
export function safeFilePart(name) {
  return String(name || '')
    .replace(/[\\/:*?"<>|#%]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80) || '未命名'
}

/** Relative path of an item file inside its project folder. */
export function itemRelPathOf(item) {
  return `${ITEM_DIR}/${item.itemId} ${safeFilePart(item.title)}.md`
}

/** `2026-11-20 10-02-27 名称.md` → `2026-11-20 10:02:27`. */
function stampFromFileName(name) {
  const match = /^(\d{4}-\d{2}-\d{2})[ _T](\d{2})[-:](\d{2})[-:](\d{2})/.exec(String(name || ''))
  return match ? `${match[1]} ${match[2]}:${match[3]}:${match[4]}` : ''
}

function listOf(value) {
  if (Array.isArray(value)) return value.map(entry => String(entry || '').trim()).filter(Boolean)
  return splitNames(value)
}

function itemSnapshot(item) {
  return JSON.stringify({
    title: item.title,
    status: item.status,
    owner: item.owner,
    participants: item.participants,
    due: item.due,
    deps: item.deps,
    detail: item.detail,
    logs: item.logs,
  })
}

/** Parse one standalone item file: frontmatter fields + `## 详情` + `## 日志`. */
function parseItemFile(text, absPath, relPath = '') {
  const { meta, body } = md.splitFrontmatter(text)
  const fallback = /^(w\d+)/i.exec(basename(absPath || relPath))
  const itemId = String(meta.item_id || meta.itemId || (fallback ? fallback[1] : '')).trim().toLowerCase()
  if (itemNumber(itemId) <= 0) return null
  const heading = md.firstH1(body)
  const logs = []
  const logSection = md.findSection(body, '日志')
  if (logSection) {
    for (const row of md.parseTableLines(logSection.content.split(/\r?\n/)).rows) {
      const log = {
        time: String(row['时间'] || '').trim(),
        event: String(row['事件'] || '').trim(),
        solution: String(row['解决方案'] || '').trim(),
      }
      if (log.time || log.event || log.solution) logs.push(log)
    }
  }
  return {
    itemId,
    title: String(meta.title || heading.replace(/^w\d+\s*[·:：-]?\s*/i, '')).trim() || itemId,
    status: statusCn(meta.status),
    owner: String(meta.owner || '').trim(),
    participants: listOf(meta.participants),
    due: String(meta.due || '').trim().slice(0, 10),
    deps: listOf(meta.deps).map(dep => dep.toLowerCase()),
    detail: md.sectionContent(body, '详情').trim(),
    created: String(meta.created || '').trim(),
    updated: String(meta.updated || '').trim(),
    logs,
    path: absPath,
    relPath,
  }
}

/** Render one item file; `updated` is stamped because the caller is writing. */
function renderItemDoc(projectMeta, item) {
  const header = {
    schema: 'workos/v2',
    kind: 'item',
    ...(item.scope ? { scope: item.scope } : {}),
    uid: String(projectMeta.uid ?? ''),
    item_id: item.itemId,
    title: item.title,
    status: item.status,
    owner: item.owner || '',
    participants: item.participants || [],
    due: item.due || '',
    deps: item.deps || [],
    created: item.created || localDate(),
    updated: localStamp(),
  }
  const body = [
    `# ${item.itemId} ${item.title}`,
    '',
    '## 详情',
    '',
    String(item.detail || '').trim() || '（待补）',
    '',
    '## 日志',
    '',
    md.renderTable(LOG_HEADERS, (item.logs || []).map(log => [log.time || '', log.event || '', log.solution || ''])),
    '',
  ].join('\n')
  return md.joinFrontmatter(header, body)
}

/** The `## 工作事项` section of README is only an index pointing at item files. */
export function renderItemIndex(items) {
  if (!items.length) return '（暂无事项）'
  return md.renderTable(ITEM_HEADERS, items.map(item => [
    `${item.itemId} ${item.title}`,
    item.status,
    item.owner || '',
    item.due || '',
    itemRelPathOf(item),
  ]))
}

function parseProgress(body) {
  const title = md.findSection(body, '项目进展') ? '项目进展' : '进展记录'
  return md.sectionTable(body, title).rows
    .map(row => ({
      date: String(row['日期'] || '').trim(),
      text: String(row['进展'] || '').trim(),
      note: String(row['备注'] || '').trim(),
    }))
    .filter(row => row.text)
}

/* ------------------------------------------------------------------ store */

export class Store {
  constructor({ root, workspace, config = {} } = {}) {
    this.root = root ? resolve(root) : ''
    // The workspace the assistant runs in (the archive lives under it). Used to
    // show short relative paths in 【工作上下文】 tags.
    this.workspace = workspace ? resolve(workspace) : this.root ? dirname(this.root) : ''
    this.config = config
    this.dataDir = join(this.root, 'data')
    this.workosDir = join(this.dataDir, 'workos')
    this.workDir = join(this.root, 'work')
  }

  get configured() {
    return Boolean(this.root)
  }

  async exists() {
    return Boolean(this.root) && isDir(this.root)
  }

  /* ------------------------------------------------------------ contacts */

  async loadMeta() {
    const text = await md.readText(join(this.workosDir, 'meta.yaml'))
    return text ? md.parseYaml(md.splitFrontmatter(text).body) : { ...DEFAULT_META }
  }

  async saveMeta(meta) {
    await md.writeText(join(this.workosDir, 'meta.yaml'), `${md.dumpYaml({ ...DEFAULT_META, ...meta })}\n`)
  }

  async loadContacts() {
    const path = join(this.workosDir, 'contacts.md')
    const text = await md.readText(path)
    const { body } = text ? md.splitFrontmatter(text) : { body: '' }
    const table = md.bodyTable(body)
    return table.rows
      .filter(row => String(row.id || '').trim())
      .map(row => ({
        id: String(row.id).trim(),
        name: String(row['姓名'] || '').trim(),
        company: String(row['公司'] || '').trim(),
        dept: String(row['部门'] || '').trim(),
        role: String(row['职位'] || '').trim(),
        phone: String(row['电话'] || '').trim(),
        duty: String(row['负责事项'] || '').trim(),
        experience: String(row['打交道经验'] || '').trim(),
        note: String(row['备注'] || '').trim(),
      }))
  }

  async saveContacts(rows) {
    const path = join(this.workosDir, 'contacts.md')
    const current = await md.readText(path)
    const { meta, body } = current
      ? md.splitFrontmatter(current)
      : { meta: { schema: 'workos/v2', kind: 'contacts' }, body: '# 联系人\n' }
    meta.schema = 'workos/v2'
    meta.kind = 'contacts'
    const tableRows = rows.map(row => [
      row.id, row.name, row.company || '', row.dept || '', row.role || '',
      row.phone || '', row.duty || '', row.experience || '', row.note || '',
    ])
    await md.writeText(path, md.joinFrontmatter(meta, md.replaceBodyTable(body, CONTACT_HEADERS, tableRows)))
  }

  async ensureContacts(names) {
    const wanted = [...new Set((names || []).map(name => String(name || '').trim()).filter(Boolean))]
    if (!wanted.length) return
    const rows = await this.loadContacts()
    const known = new Set(rows.map(row => row.name))
    let maxId = rows.reduce((max, row) => Math.max(max, Number(String(row.id).replace(/^\D+/, '')) || 0), 0)
    let changed = false
    for (const name of wanted) {
      if (known.has(name)) continue
      maxId += 1
      rows.push({ id: `c${maxId}`, name, company: '', dept: '', role: '', phone: '', duty: '', experience: '', note: '' })
      changed = true
    }
    if (changed) await this.saveContacts(rows)
  }

  /* ------------------------------------------------------------ projects */

  async projectFiles() {
    const out = []
    for (const dept of (await safeEntries(this.workDir)).filter(entry => entry.isDirectory())) {
      const deptDir = join(this.workDir, dept.name)
      for (const year of (await safeEntries(deptDir)).filter(entry => entry.isDirectory())) {
        const projectDir = join(deptDir, year.name, '项目')
        for (const entry of await safeEntries(projectDir)) {
          const base = { dept: dept.name, year: Number(year.name) }
          if (entry.isFile() && entry.name.endsWith('.md')) {
            // legacy: one Markdown file per project
            out.push({ ...base, path: join(projectDir, entry.name), dir: projectDir, kind: 'file' })
            continue
          }
          if (!entry.isDirectory()) continue
          const folder = join(projectDir, entry.name)
          const inner = await safeEntries(folder)
          const readme = inner.find(child => child.isFile() && child.name === PROJECT_README)
          if (readme) {
            out.push({ ...base, path: join(folder, PROJECT_README), dir: folder, kind: 'folder' })
            continue
          }
          const preferred = ['项目概况.md', `${entry.name}.md`]
          const hit = inner.find(child => child.isFile() && preferred.includes(child.name))
            || inner.find(child => child.isFile() && child.name.endsWith('.md') && !child.name.startsWith('_'))
          if (hit) out.push({ ...base, path: join(folder, hit.name), dir: folder, kind: 'folder-legacy' })
        }
      }
    }
    return out
  }

  /** Read every item of a project: one file each under `事项/`, legacy blocks fallback. */
  async itemsOf(entry, body) {
    if (entry.kind === 'file') return parseItems(body)
    const dir = join(entry.dir, ITEM_DIR)
    const byId = new Map()
    for (const child of await safeEntries(dir)) {
      if (!child.isFile() || !child.name.endsWith('.md') || child.name.startsWith('_')) continue
      const abs = join(dir, child.name)
      const text = await md.readText(abs)
      const item = parseItemFile(text, abs, relative(this.root, abs).split(sep).join('/'))
      if (!item) continue
      const previous = byId.get(item.itemId)
      // A renamed file can leave a stale duplicate behind; prefer the file whose
      // name matches the current title, then the most recently updated one.
      if (!previous) {
        byId.set(item.itemId, item)
        continue
      }
      const expected = `${item.itemId} ${safeFilePart(item.title)}.md`
      const previousExpected = `${previous.itemId} ${safeFilePart(previous.title)}.md`
      const currentPreferred = child.name === expected
      const previousPreferred = basename(previous.path) === previousExpected
      if (currentPreferred && !previousPreferred) byId.set(item.itemId, item)
      else if (currentPreferred === previousPreferred && String(item.updated || '') > String(previous.updated || '')) {
        byId.set(item.itemId, item)
      }
    }
    const items = [...byId.values()]
    if (items.length) return items.sort((left, right) => itemNumber(left.itemId) - itemNumber(right.itemId))
    return parseItems(body)
  }

  async loadProjectFile(entry) {
    const text = await md.readText(entry.path)
    if (!text) return null
    const { meta, body } = md.splitFrontmatter(text)
    const uid = Number(meta.uid)
    if (!uid) return null
    const items = await this.itemsOf(entry, body)
    const byId = new Map(items.map(item => [item.itemId, item]))
    for (const item of items) {
      const blockers = (item.deps || []).map(dep => byId.get(dep)).filter(Boolean)
        .filter(dep => !DONE_ITEM_STATUSES.includes(dep.status))
      item.blocked = blockers.length > 0
      item.blockedBy = blockers.map(dep => ({ itemId: dep.itemId, title: dep.title, status: dep.status }))
      item.absFile = item.path || entry.path
      item.file = relative(entry.dir, item.absFile).split(sep).join('/')
      item.created = item.created || ''
    }
    const progress = parseProgress(body)
    const lastProgress = progress
      .map(row => parseDateTime(row.date))
      .filter(Boolean)
      .sort((left, right) => right - left)[0]
    const name = md.firstH1(body) || basename(entry.path).replace(/\.md$/, '')
    const goalSection = md.sectionContent(body, '目标与背景').trim()
    const goal = String(meta.goal || goalSection.split(/\r?\n/).find(line => line.trim() && !line.startsWith('#')) || '').trim()
    // `## 目标与背景` opens with the goal line and continues with the longer
    // background. Keep the two apart: the edit form re-saves the background,
    // and feeding the goal back into it would duplicate it on every save.
    let overview = goalSection
    if (goal && overview.startsWith(goal)) overview = overview.slice(goal.length).trim()
    return {
      uid,
      path: entry.path,
      relPath: relative(this.root, entry.path).split(sep).join('/'),
      absPath: entry.path,
      absDir: entry.dir,
      relDir: relative(this.root, entry.dir).split(sep).join('/'),
      folder: entry.kind !== 'file',
      name,
      dept: String(meta.dept || entry.dept),
      year: Number(meta.year || entry.year),
      status: String(meta.status || 'doing'),
      statusLabel: HEADER_STATUS_LABELS[String(meta.status || 'doing')] || String(meta.status || ''),
      projectType: String(meta.project_type || '其他'),
      priority: String(meta.priority || '中'),
      start: String(meta.start || ''),
      end: String(meta.end || ''),
      owner: String(meta.owner || ''),
      participants: listOf(meta.participants),
      goal,
      overview: overview.slice(0, 1200),
      meta,
      body,
      text,
      items,
      progress,
      review: md.sectionContent(body, '复盘').trim(),
      lastProgress: lastProgress ? localDate(lastProgress) : '',
      legacy: entry.kind !== 'folder' || (!items.some(item => item.path) && items.length > 0),
    }
  }

  async allProjects() {
    const out = []
    for (const entry of await this.projectFiles()) {
      try {
        const project = await this.loadProjectFile(entry)
        if (project) out.push(project)
      } catch {
        // one malformed file must not blank the workbench
      }
    }
    return out.sort((left, right) => right.uid - left.uid)
  }

  summarizeItem(project, item) {
    const due = dueInfo(item.due)
    return {
      uid: project.uid,
      projectName: project.name,
      itemId: item.itemId,
      title: item.title,
      status: item.status,
      owner: item.owner,
      participants: item.participants,
      due: item.due,
      deps: item.deps,
      detail: item.detail,
      logs: item.logs,
      logCount: item.logs.length,
      blocked: Boolean(item.blocked),
      blockedBy: item.blockedBy || [],
      file: item.file || itemRelPathOf(item),
      absFile: item.absFile || '',
      projectPath: project.relPath,
      projectAbsPath: project.absPath,
      ...due,
    }
  }

  summarize(project) {
    const active = project.items.filter(item => ACTIVE_ITEM_STATUSES.includes(item.status))
    const done = project.items.filter(item => DONE_ITEM_STATUSES.includes(item.status))
    const enriched = active.map(item => this.summarizeItem(project, item)).sort((left, right) => {
      if (left.due === '' && right.due !== '') return 1
      if (left.due !== '' && right.due === '') return -1
      return (left.hoursLeft ?? 1e9) - (right.hoursLeft ?? 1e9)
    })
    const last = parseDateTime(project.lastProgress)
    return {
      uid: project.uid,
      name: project.name,
      dept: project.dept,
      year: project.year,
      status: project.status,
      statusLabel: project.statusLabel,
      projectType: project.projectType,
      priority: project.priority,
      start: project.start,
      end: project.end,
      owner: project.owner,
      participants: project.participants || [],
      goal: project.goal,
      relPath: project.relPath,
      absPath: project.absPath,
      relDir: project.relDir,
      absDir: project.absDir,
      folder: project.folder,
      progress: project.items.length ? Math.round((done.length / project.items.length) * 100) : 0,
      total: project.items.length,
      doneCount: done.length,
      openCount: active.length,
      overdueCount: enriched.filter(item => item.overdue).length,
      blockedCount: enriched.filter(item => item.blocked).length,
      logCount: project.items.reduce((sum, item) => sum + item.logs.length, 0),
      next: enriched[0] || null,
      activeItems: enriched,
      items: project.items.map(item => ({
        itemId: item.itemId, title: item.title, status: item.status,
        owner: item.owner, participants: item.participants || [], due: item.due, deps: item.deps,
      })),
      stallDays: last ? Math.max(0, Math.floor((Date.now() - last.getTime()) / 86400000)) : null,
      lastProgress: project.lastProgress,
    }
  }

  async findProject(uid) {
    const wanted = Number(uid)
    for (const entry of await this.projectFiles()) {
      const text = await md.readText(entry.path)
      const { meta } = md.splitFrontmatter(text)
      if (Number(meta.uid) === wanted) return { entry, text }
    }
    throw new StoreError(`找不到 uid=${uid} 的项目`)
  }

  /**
   * Persist a project: one README plus one file per item.
   *
   * Only items whose fields/logs changed are rewritten, so browsing one item
   * never touches the timestamps of another. A changed title renames its file.
   */
  async writeProject(entry, state, before = new Map()) {
    const itemDir = join(entry.dir, ITEM_DIR)
    await mkdir(itemDir, { recursive: true })
    const kept = new Set()
    for (const item of state.items) {
      const target = join(itemDir, `${item.itemId} ${safeFilePart(item.title)}.md`)
      kept.add(basename(target))
      const changed = !before.has(item.itemId) || before.get(item.itemId) !== itemSnapshot(item)
      const moved = Boolean(item.path) && resolve(item.path) !== resolve(target)
      if (changed || moved) {
        await md.writeText(target, renderItemDoc(state.meta, item))
        if (moved && item.path.startsWith(`${itemDir}${sep}`)) await rm(item.path, { force: true })
        item.path = target
      }
      item.absFile = item.path
      item.file = relative(entry.dir, item.path).split(sep).join('/')
    }
    for (const child of await safeEntries(itemDir)) {
      if (!child.isFile() || kept.has(child.name) || !/^w\d+/i.test(child.name) || !child.name.endsWith('.md')) continue
      const childPath = join(itemDir, child.name)
      // Only files this store recognizes as an item are cleaned up: a removed
      // item, or a stale copy left by a rename. Unknown files stay untouched.
      const parsed = parseItemFile(await md.readText(childPath), childPath)
      if (parsed) await rm(childPath, { force: true })
    }
    state.body = md.replaceSection(state.body, '工作事项', renderItemIndex(state.items))
    await md.writeText(entry.path, md.joinFrontmatter(state.meta, state.body))
    entry.kind = 'folder'
    entry.dir = dirname(entry.path)
  }

  async editProject(uid, mutate) {
    let { entry } = await this.findProject(uid)
    if (entry.kind !== 'folder') {
      await this.migrateProject(entry)
      entry = (await this.findProject(uid)).entry
    }
    const text = await md.readText(entry.path)
    const { meta, body } = md.splitFrontmatter(text)
    const items = await this.itemsOf(entry, body)
    const before = new Map(items.map(item => [item.itemId, itemSnapshot(item)]))
    const state = { meta: { ...meta }, body, items, progress: parseProgress(body) }
    await mutate(state)
    state.meta.schema = 'workos/v2'
    await this.writeProject(entry, state, before)
    return this.loadProjectFile(entry)
  }

  /**
   * Turn a legacy single-file project into a folder: README + one file per item.
   * Also normalizes a folder whose base file has another name (项目概况.md).
   * @returns whether any file was created or renamed.
   */
  async migrateProject(entry) {
    const text = await md.readText(entry.path)
    if (!text.trim()) return false
    const { meta, body } = md.splitFrontmatter(text)
    const uid = Number(meta.uid)
    if (!uid) return false
    const name = md.firstH1(body) || basename(entry.path, '.md')
    const alreadySplit = entry.kind === 'folder' && basename(entry.path) === PROJECT_README
    const folder = entry.kind === 'file' ? join(dirname(entry.path), safeFilePart(name)) : entry.dir
    const readme = join(folder, PROJECT_README)
    const itemDir = join(folder, ITEM_DIR)
    await mkdir(itemDir, { recursive: true })
    if (alreadySplit) {
      // Just make sure the index points at the item files again.
      const items = await this.itemsOf(entry, body)
      const next = md.replaceSection(body, '工作事项', renderItemIndex(items))
      if (next !== body) await md.writeText(readme, md.joinFrontmatter(meta, next))
      await this.fixOverviewLink({ dept: entry.dept, year: entry.year, name, absDir: folder })
      return false
    }
    const items = await this.itemsOf(entry, body)
    const itemById = items.map(item => ({ ...item, created: item.created || String(meta.start || localDate()).trim() || localDate() }))
    const nextBody = md.replaceSection(body, '工作事项', renderItemIndex(itemById))
    await md.writeText(readme, md.joinFrontmatter(meta, nextBody))
    for (const item of itemById) {
      const target = join(itemDir, `${item.itemId} ${safeFilePart(item.title)}.md`)
      await md.writeText(target, renderItemDoc(meta, item))
    }
    if (resolve(readme) !== resolve(entry.path)) await rm(entry.path, { force: true })
    entry.kind = 'folder'
    entry.dir = folder
    entry.path = readme
    await this.fixOverviewLink({ dept: entry.dept, year: entry.year, name, absDir: folder })
    return true
  }

  /* -------------------------------------------------------------- daily work */

  /**
   * Folder for work that belongs to no project:
   * `work/{dept}/{year}/日常工作/`, one Markdown file per item, file name
   * prefixed with the creation date-time to the second.
   */
  dailyLocation() {
    const year = new Date().getFullYear()
    const dept = String(this.config.defaultDept || '').trim() || '我的工作'
    const dir = join(this.workDir, dept, String(year), DAILY_DIR)
    return { dir, dept, year, relDir: relative(this.root, dir).split(sep).join('/') }
  }

  /** Every standalone item, newest first. */
  async dailyItems() {
    const { dir, relDir } = this.dailyLocation()
    const out = []
    for (const child of await safeEntries(dir)) {
      if (!child.isFile() || !child.name.endsWith('.md') || child.name.startsWith('_')) continue
      const abs = join(dir, child.name)
      const item = parseItemFile(await md.readText(abs), abs, relative(this.root, abs).split(sep).join('/'))
      if (!item) continue
      item.scope = 'daily'
      item.stamp = stampFromFileName(child.name) || item.created
      item.dir = relDir
      item.file = child.name
      item.absFile = abs
      out.push(item)
    }
    return out.sort((left, right) =>
      String(right.stamp).localeCompare(String(left.stamp)) || itemNumber(right.itemId) - itemNumber(left.itemId))
  }

  summarizeDaily(item) {
    const due = dueInfo(item.due)
    return {
      ...item,
      uid: 0,
      projectName: DAILY_DIR,
      logCount: item.logs.length,
      blocked: false,
      blockedBy: [],
      ...due,
    }
  }

  async dailyState() {
    const location = this.dailyLocation()
    const items = (await this.dailyItems()).map(item => this.summarizeDaily(item))
    return { dept: location.dept, year: location.year, relDir: location.relDir, absDir: location.dir, items }
  }

  async findDailyItem(itemId) {
    const wanted = String(itemId || '').trim().toLowerCase()
    const item = (await this.dailyItems()).find(entry => entry.itemId === wanted)
    if (!item) throw new StoreError(`找不到日常工作事项 ${itemId}`)
    return item
  }

  /** Write one standalone item; a changed title renames its file, keeping the time prefix. */
  async writeDailyItem(item) {
    const { dir } = this.dailyLocation()
    await mkdir(dir, { recursive: true })
    const stamp = item.stamp || fileStamp()
    const previous = item.absFile ? resolve(item.absFile) : ''
    let target = join(dir, `${stamp} ${safeFilePart(item.title)}.md`)
    for (let index = 2; index < 100; index += 1) {
      if (resolve(target) === previous || !(await md.readText(target)).trim()) break
      target = join(dir, `${stamp} ${safeFilePart(item.title)} (${index}).md`)
    }
    item.updated = localStamp()
    await md.writeText(target, renderItemDoc({ uid: 0 }, item))
    if (previous && previous !== resolve(target)) await rm(item.absFile, { force: true })
    item.absFile = target
    item.file = basename(target)
    item.stamp = stamp
    return item
  }

  async addDailyItem(input) {
    const title = String(input.title || '').trim()
    if (!title) throw new StoreError('事项名称不能为空')
    const owner = String(input.owner || this.config.defaultOwner || '我').trim() || '我'
    const participants = [...new Set((input.participants || []).map(name => String(name).trim()).filter(Boolean))]
    await this.ensureContacts([owner, ...participants])
    const items = await this.dailyItems()
    const next = items.reduce((max, item) => Math.max(max, itemNumber(item.itemId)), 0) + 1
    const item = {
      itemId: `d${next}`,
      title,
      scope: 'daily',
      status: statusCn(input.status, DEFAULT_ITEM_STATUS),
      owner,
      participants,
      due: String(input.due || '').slice(0, 10),
      deps: [],
      detail: String(input.detail || '').trim(),
      created: localDate(),
      logs: [],
      stamp: fileStamp(),
    }
    await this.writeDailyItem(item)
    return {
      ok: true,
      scope: 'daily',
      uid: 0,
      itemId: item.itemId,
      file: relative(this.root, item.absFile).split(sep).join('/'),
      absFile: item.absFile,
      item: this.summarizeDaily(item),
    }
  }

  async updateDailyItem(itemId, patch = {}) {
    const item = await this.findDailyItem(itemId)
    const owner = patch.owner !== undefined ? String(patch.owner || '').trim() : undefined
    const participants = patch.participants !== undefined
      ? [...new Set((patch.participants || []).map(name => String(name).trim()).filter(Boolean))]
      : undefined
    await this.ensureContacts([owner || '', ...(participants || [])])
    if (patch.title !== undefined) item.title = String(patch.title).trim() || item.title
    if (patch.status !== undefined) item.status = statusCn(patch.status, item.status)
    if (owner !== undefined) item.owner = owner
    if (participants !== undefined) item.participants = participants
    if (patch.due !== undefined) item.due = String(patch.due || '').slice(0, 10)
    if (patch.detail !== undefined) item.detail = String(patch.detail || '').trim()
    await this.writeDailyItem(item)
    return { ok: true, scope: 'daily', uid: 0, item: this.summarizeDaily(item) }
  }

  async deleteDailyItem(itemId) {
    const item = await this.findDailyItem(itemId)
    await rm(item.absFile, { force: true })
    return { ok: true, scope: 'daily', removed: { itemId: item.itemId, title: item.title } }
  }

  async addDailyLog(itemId, input = {}) {
    const event = String(input.event || '').trim()
    if (!event) throw new StoreError('日志事件不能为空')
    const item = await this.findDailyItem(itemId)
    item.logs.unshift({
      time: String(input.time || localStamp()).trim(),
      event,
      solution: String(input.solution || '').trim(),
    })
    await this.writeDailyItem(item)
    return { ok: true, scope: 'daily', uid: 0, item: this.summarizeDaily(item) }
  }

  async updateDailyLog(itemId, input = {}) {
    const index = Number(input.logIndex)
    if (!Number.isInteger(index) || index < 0) throw new StoreError('需要日志序号 logIndex（从 0 开始，0 为最新）')
    const item = await this.findDailyItem(itemId)
    const log = item.logs[index]
    if (!log) throw new StoreError(`事项 ${itemId} 没有第 ${index} 条日志`)
    const event = String(input.event ?? log.event).trim()
    if (!event) throw new StoreError('日志事件不能为空')
    item.logs[index] = {
      time: String(input.time || log.time || localStamp()).trim(),
      event,
      solution: String(input.solution ?? log.solution).trim(),
    }
    await this.writeDailyItem(item)
    return { ok: true, scope: 'daily', uid: 0, item: this.summarizeDaily(item) }
  }

  /* --------------------------------------------------------- context bundle */

  /** People plus the other active items they own or join (max 5 each). */
  async peopleWithItems(names, contacts) {
    const byName = new Map((contacts || []).map(contact => [contact.name, contact]))
    const allProjects = await this.allProjects()
    const out = []
    for (const name of names) {
      const contact = byName.get(name)
      const otherItems = []
      for (const other of allProjects) {
        for (const otherItem of other.items) {
          if (!ACTIVE_ITEM_STATUSES.includes(otherItem.status)) continue
          if (otherItem.owner !== name && !otherItem.participants.includes(name)) continue
          otherItems.push({
            uid: other.uid, project: other.name, itemId: otherItem.itemId,
            title: otherItem.title, status: otherItem.status, due: otherItem.due,
            role: otherItem.owner === name ? '负责' : '参与',
          })
          if (otherItems.length >= 5) break
        }
        if (otherItems.length >= 5) break
      }
      out.push({
        name,
        company: contact?.company || '',
        dept: contact?.dept || '',
        role: contact?.role || '',
        phone: contact?.phone || '',
        duty: contact?.duty || '',
        experience: contact?.experience || '',
        otherItems,
      })
    }
    return out
  }

  async context({ uid, itemId, logIndex, person }) {
    const contacts = await this.loadContacts()
    if (uid === undefined || uid === null || uid === '') {
      const name = String(person || '').trim()
      if (!name) throw new StoreError('需要 uid 或 person')
      const contact = contacts.find(entry => entry.name === name || entry.id === name)
      const all = await this.allProjects()
      const otherItems = []
      for (const other of all) {
        for (const otherItem of other.items) {
          if (!ACTIVE_ITEM_STATUSES.includes(otherItem.status)) continue
          if (otherItem.owner !== name && !otherItem.participants.includes(name)) continue
          otherItems.push({
            uid: other.uid, project: other.name, itemId: otherItem.itemId,
            title: otherItem.title, status: otherItem.status, due: otherItem.due,
            role: otherItem.owner === name ? '负责' : '参与',
          })
        }
      }
      return {
        project: null,
        item: null,
        dependencies: [],
        logs: [],
        people: [{
          name,
          company: contact?.company || '',
          dept: contact?.dept || '',
          role: contact?.role || '',
          phone: contact?.phone || '',
          duty: contact?.duty || '',
          experience: contact?.experience || '',
          otherItems: otherItems.slice(0, 10),
        }],
        siblings: [],
      }
    }
    if (Number(uid) === 0) {
      const wanted = String(itemId || '').trim().toLowerCase()
      const all = await this.dailyItems()
      const item = wanted ? all.find(entry => entry.itemId === wanted) : null
      if (wanted && !item) throw new StoreError(`找不到日常工作事项 ${itemId}`)
      const location = this.dailyLocation()
      const peopleNames = new Set()
      if (item) {
        if (item.owner) peopleNames.add(item.owner)
        for (const name of item.participants) peopleNames.add(name)
      }
      if (person) peopleNames.add(String(person))
      const logs = item
        ? (logIndex !== undefined && logIndex !== null && item.logs[Number(logIndex)]
          ? [{ index: Number(logIndex), ...item.logs[Number(logIndex)] }]
          : item.logs.map((log, index) => ({ index, ...log })))
        : []
      return {
        project: {
          uid: 0, name: DAILY_DIR, dept: location.dept, year: location.year,
          status: '进行中', statusCode: 'doing', projectType: '日常工作', priority: '中',
          start: '', end: '', owner: '', participants: [],
          goal: '不属于任何项目的临时工作，每个事项一个文件。', overview: '', progress: [], review: '',
          relPath: location.relDir, absPath: location.dir, relDir: location.relDir, absDir: location.dir,
        },
        item: item ? {
          itemId: item.itemId, title: item.title, status: item.status, owner: item.owner,
          participants: item.participants, due: item.due, deps: [], detail: item.detail,
          blocked: false, blockedBy: [], logs: item.logs,
          file: item.file, absFile: item.absFile, stamp: item.stamp,
        } : null,
        dependencies: [],
        logs,
        people: await this.peopleWithItems(peopleNames, contacts),
        siblings: all
          .filter(entry => entry.itemId !== (item?.itemId || ''))
          .slice(0, 8)
          .map(entry => ({
            itemId: entry.itemId, title: entry.title, status: entry.status,
            due: entry.due, owner: entry.owner, file: entry.file, absFile: entry.absFile,
          })),
      }
    }
    const { entry } = await this.findProject(uid)
    const project = await this.loadProjectFile(entry)
    if (!project) throw new StoreError('项目读取失败')
    const item = itemId ? project.items.find(entryItem => entryItem.itemId === String(itemId).toLowerCase()) : null
    const peopleNames = new Set()
    if (item) {
      if (item.owner) peopleNames.add(item.owner)
      for (const name of item.participants) peopleNames.add(name)
    }
    if (person) peopleNames.add(String(person))
    const people = await this.peopleWithItems(peopleNames, contacts)
    const logs = item
      ? (logIndex !== undefined && logIndex !== null && item.logs[Number(logIndex)]
        ? [{ index: Number(logIndex), ...item.logs[Number(logIndex)] }]
        : item.logs.map((log, index) => ({ index, ...log })))
      : []
    return {
      project: {
        uid: project.uid, name: project.name, dept: project.dept, year: project.year,
        status: project.statusLabel, statusCode: project.status, projectType: project.projectType,
        priority: project.priority, start: project.start, end: project.end, owner: project.owner,
        participants: project.participants || [],
        goal: project.goal, overview: md.sectionContent(project.body, '目标与背景').trim().slice(0, 800),
        progress: project.progress.slice(0, 5), review: project.review.slice(0, 800),
        relPath: project.relPath, absPath: project.absPath, relDir: project.relDir, absDir: project.absDir,
      },
      item: item ? {
        itemId: item.itemId, title: item.title, status: item.status, owner: item.owner,
        participants: item.participants, due: item.due, deps: item.deps, detail: item.detail,
        blocked: Boolean(item.blocked), blockedBy: item.blockedBy || [],
        logs: item.logs,
        file: relative(this.root, item.absFile).split(sep).join('/'),
        absFile: item.absFile,
      } : null,
      dependencies: item
        ? item.deps.map(depId => project.items.find(entryItem => entryItem.itemId === depId)).filter(Boolean).map(dep => ({
          itemId: dep.itemId, title: dep.title, status: dep.status, due: dep.due, owner: dep.owner,
          done: DONE_ITEM_STATUSES.includes(dep.status),
          file: dep.file, absFile: dep.absFile,
        }))
        : [],
      logs,
      people,
      siblings: project.items
        .filter(entryItem => entryItem.itemId !== (item?.itemId || ''))
        .slice(0, 8)
        .map(entryItem => ({
          itemId: entryItem.itemId, title: entryItem.title, status: entryItem.status,
          due: entryItem.due, owner: entryItem.owner, file: entryItem.file, absFile: entryItem.absFile,
        })),
    }
  }

  /* ------------------------------------------------------------- reports */

  async listReports() {
    return listReportFiles(this.root, await this.allProjects())
  }

  /**
   * Save one report. `uid` targets a project (`项目/{名}/汇报/日报|周报`),
   * omission writes a personal report (`data/日报|周报`).
   */
  async saveReport(input = {}) {
    return saveReportFile(this.root, { ...input, project: await this.reportProject(input.uid) })
  }

  async reportProject(uid) {
    const wanted = Number(uid) || 0
    if (!wanted) return null
    const { entry, text } = await this.findProject(wanted)
    if (entry.kind === 'file') {
      throw new StoreError('该项目还是旧版单文件档案，先在驾驶舱点「迁移旧档案」再生成项目汇报')
    }
    const { body } = md.splitFrontmatter(text)
    return { uid: wanted, name: md.firstH1(body) || String(wanted), absDir: entry.dir }
  }

  async updateReport(relPath, patch = {}) {
    return updateReportFile(this.root, relPath, patch)
  }

  async reportData(input = {}) {
    const location = this.dailyLocation()
    // Present 日常工作 as one extra, project-less bucket so personal reports
    // include ad-hoc work; a project report (uid) filters it out.
    const dailyProject = {
      uid: 0,
      name: DAILY_DIR,
      dept: location.dept,
      year: location.year,
      status: 'doing',
      statusLabel: '进行中',
      goal: '不属于任何项目的临时工作',
      items: (await this.dailyItems()).map(item => ({ ...item, blocked: false, blockedBy: [] })),
      progress: [],
      relPath: location.relDir,
    }
    return buildReportData([...(await this.allProjects()), dailyProject], input)
  }

  /* -------------------------------------------------------------- state */

  async state() {
    const projects = await this.allProjects()
    const summaries = projects.map(project => this.summarize(project))
    const contacts = await this.loadContacts()
    const daily = await this.dailyState()
    const dailyActive = daily.items.filter(item => ACTIVE_ITEM_STATUSES.includes(item.status))
    const focus = []
    for (const project of projects) {
      if (project.status === 'done' || project.status === 'closed') continue
      for (const item of project.items) {
        if (!ACTIVE_ITEM_STATUSES.includes(item.status)) continue
        focus.push(this.summarizeItem(project, item))
      }
    }
    focus.sort((left, right) => {
      if (!left.due && right.due) return 1
      if (left.due && !right.due) return -1
      return (left.hoursLeft ?? 1e9) - (right.hoursLeft ?? 1e9)
    })
    const recentLogs = []
    for (const project of projects) {
      for (const item of project.items) {
        for (const [index, log] of item.logs.entries()) {
          recentLogs.push({
            ...log,
            index,
            uid: project.uid,
            projectName: project.name,
            itemId: item.itemId,
            itemTitle: item.title,
            file: item.file,
            absFile: item.absFile,
            projectPath: project.relPath,
            projectAbsPath: project.absPath,
          })
        }
      }
    }
    recentLogs.sort((left, right) => String(right.time).localeCompare(String(left.time)))
    return {
      ok: true,
      root: this.root,
      workspace: this.workspace,
      today: localDate(),
      projects: summaries,
      daily,
      contacts,
      contactsPath: relative(this.root, join(this.workosDir, 'contacts.md')).split(sep).join('/'),
      contactsAbsPath: join(this.workosDir, 'contacts.md'),
      workbench: {
        focus: focus.slice(0, 12),
        recentLogs: recentLogs.slice(0, 10),
      },
      stats: {
        projects: summaries.filter(project => project.status === 'doing').length,
        items: focus.length + dailyActive.length,
        overdue: focus.filter(item => item.overdue).length + dailyActive.filter(item => item.overdue).length,
        blocked: focus.filter(item => item.blocked).length,
        people: contacts.length,
      },
    }
  }

  /* ---------------------------------------------------------- mutations */

  async nextUid() {
    const meta = await this.loadMeta()
    const projects = await this.allProjects()
    const max = projects.reduce((top, project) => Math.max(top, project.uid), 0)
    return { next: Math.max(Number(meta.next_uid) || 0, max + 1, 1001), meta }
  }

  async touchOverview(dept, year, name, statusCnValue) {
    const path = join(this.workDir, dept, String(year), '_年度概述.md')
    const text = await md.readText(path)
    if (!text || text.includes(name)) return
    const section = md.findSection(text, '项目')
    if (!section) return
    const lines = text.split(/\r?\n/)
    let last = -1
    for (let index = section.start + 1; index < section.end; index += 1) {
      if (/^\s*\|/.test(lines[index])) last = index
    }
    if (last < 0) return
    lines.splice(last + 1, 0, `| [${name}](./项目/${safeFilePart(name)}/README.md) | ${statusCnValue} | — | — |`)
    await md.writeText(path, lines.join('\n'))
  }

  /**
   * Point a project's row in `_年度概述.md` at its README, repairing the legacy
   * `./项目/{name}.md` link after migration. Adds the row when missing.
   */
  async fixOverviewLink(project) {
    const path = join(this.workDir, project.dept, String(project.year), '_年度概述.md')
    const text = await md.readText(path)
    if (!text) return
    const folder = basename(project.absDir)
    const target = `./项目/${folder}/README.md`
    const lines = text.split(/\r?\n/)
    let changed = false
    if (lines.some(line => line.includes(`](${target})`))) return
    const legacy = `](./项目/${project.name}.md)`
    const index = lines.findIndex(line => line.includes(legacy))
    if (index >= 0) {
      lines[index] = lines[index].replace(/\]\(\.\/项目\/[^)]*\)/, `](${target})`)
      await md.writeText(path, lines.join('\n'))
      return
    }
    const section = md.findSection(text, '项目')
    if (!section) return
    let last = -1
    for (let line = section.start + 1; line < section.end; line += 1) {
      if (/^\s*\|/.test(lines[line])) last = line
    }
    if (last < 0) return
    lines.splice(last + 1, 0, `| [${project.name}](${target}) | 进行中 | — | — |`)
    await md.writeText(path, lines.join('\n'))
  }

  async createProject(input) {
    const name = md.slugName(input.name)
    if (!name) throw new StoreError('项目名不能为空')
    const year = Number(input.year) || new Date().getFullYear()
    const { next, meta } = await this.nextUid()
    const projects = await this.allProjects()
    const dept = input.dept || this.config.defaultDept || projects[0]?.dept || '我的工作'
    const owner = input.owner || this.config.defaultOwner || '我'
    const participants = [...new Set((input.participants || []).map(name => String(name || '').trim()).filter(Boolean))]
    await this.ensureContacts([owner, ...participants])
    const start = String(input.start || localDate()).slice(0, 10)
    const end = String(input.end || '').slice(0, 10)
    const goal = String(input.goal || '').trim()
    const overview = String(input.overview || '').trim()
    const body = [
      `# ${name}`,
      '',
      '## 目标与背景',
      '',
      goal || overview || '（目标待补）',
      overview && overview !== goal ? `\n${overview}` : '',
      '',
      '## 工作事项',
      '',
      '（暂无事项）',
      '',
      '## 项目进展',
      '',
      md.renderTable(PROGRESS_HEADERS, [[localDate(), '立项', '—']]),
      '',
      '## 复盘',
      '',
      '- **好的地方**:',
      '- **问题**:',
      '- **下次改进**:',
      '',
    ].filter(line => line !== undefined).join('\n')
    const header = {
      schema: 'workos/v2',
      kind: 'project',
      uid: String(next),
      dept,
      year: String(year),
      status: 'doing',
      project_type: input.projectType || '其他',
      priority: input.priority || '中',
      start,
      end,
      owner,
      participants,
      goal,
    }
    const dir = join(this.workDir, dept, String(year), '项目', safeFilePart(name))
    const path = join(dir, PROJECT_README)
    await mkdir(join(dir, ITEM_DIR), { recursive: true })
    await md.writeText(path, md.joinFrontmatter(header, body))
    await this.saveMeta({ ...meta, schema: 'workos/v2', next_uid: next + 1 })
    await this.touchOverview(dept, year, name, '进行中')
    return { ok: true, uid: next, path, relPath: relative(this.root, path).split(sep).join('/'), dir: relative(this.root, dir).split(sep).join('/') }
  }

  /**
   * Patch a project. Everything the create form collects can be changed again,
   * including the name: a renamed project moves its folder and rewrites its row
   * in `_年度概述.md`, so the archive keeps one name per project.
   */
  async updateProject(uid, patch = {}) {
    const { entry } = await this.findProject(uid)
    const before = await this.loadProjectFile(entry)
    if (!before) throw new StoreError('项目读取失败')
    const nextName = patch.name !== undefined ? md.slugName(patch.name) : ''
    const renaming = Boolean(nextName && nextName !== before.name)
    const owner = patch.owner !== undefined ? String(patch.owner || '').trim() : undefined
    const participants = patch.participants !== undefined
      ? [...new Set((patch.participants || []).map(name => String(name || '').trim()).filter(Boolean))]
      : undefined
    await this.ensureContacts([owner || '', ...(participants || [])])
    const folder = renaming ? safeFilePart(nextName) : basename(entry.dir)
    const targetDir = renaming ? join(dirname(entry.dir), folder) : entry.dir
    if (renaming && resolve(targetDir) !== resolve(entry.dir)) {
      const siblings = await safeEntries(dirname(entry.dir))
      if (siblings.some(child => child.isDirectory() && child.name === folder)) {
        throw new StoreError(`项目文件夹「${folder}」已存在，换个名字`)
      }
    }
    const project = await this.editProject(uid, state => {
      const map = { status: 'status', projectType: 'project_type', priority: 'priority', start: 'start', end: 'end', owner: 'owner', goal: 'goal' }
      for (const [key, value] of Object.entries(patch)) {
        if (!map[key]) continue
        state.meta[map[key]] = String(value ?? '')
      }
      if (participants !== undefined) state.meta.participants = participants
      if (patch.overview !== undefined) {
        const goal = String(state.meta.goal || '').trim()
        const overview = String(patch.overview || '').trim()
        state.body = md.replaceSection(state.body, '目标与背景', [goal, overview].filter(Boolean).join('\n\n'))
        if (!goal && overview) state.meta.goal = overview.split(/\r?\n/)[0].slice(0, 120)
      }
      if (renaming) state.body = state.body.replace(/^#\s+.*$/m, `# ${nextName}`)
    })
    if (!renaming || resolve(targetDir) === resolve(entry.dir)) {
      return { ok: true, project: this.summarize(project) }
    }
    await rename(entry.dir, targetDir)
    await this.renameOverviewRow(before.dept, before.year, basename(entry.dir), folder, before.name, nextName)
    const moved = await this.loadProjectFile({ ...entry, path: join(targetDir, PROJECT_README), dir: targetDir })
    return { ok: true, project: this.summarize(moved || project), renamed: folder }
  }

  /**
   * Point a project's row in `_年度概述.md` at its folder after a rename.
   * Accepts the current folder link or a legacy single-file link.
   */
  async renameOverviewRow(dept, year, oldFolder, newFolder, oldName, newName) {
    const path = join(this.workDir, dept, String(year), '_年度概述.md')
    const text = await md.readText(path)
    if (!text) return
    const lines = text.split(/\r?\n/)
    const targets = [`](./项目/${oldFolder}/README.md)`, `](./项目/${oldName}.md)`]
    const index = lines.findIndex(line => targets.some(target => line.includes(target)))
    if (index < 0) return
    lines[index] = lines[index]
      .replace(/\[[^\]]*\]\(/, `[${newName}](`)
      .replace(/\]\(\.\/项目\/[^)]*\)/, `](./项目/${newFolder}/README.md)`)
    await md.writeText(path, lines.join('\n'))
  }

  validateDeps(items, itemId, deps) {
    const known = new Set(items.map(item => item.itemId))
    for (const dep of deps) {
      if (dep === itemId) throw new StoreError('事项不能依赖自己')
      if (!known.has(dep)) throw new StoreError(`依赖事项 ${dep} 不在当前项目中`)
    }
  }

  async addItem(uid, input) {
    // No project (uid 0 / omitted): the item belongs to 日常工作.
    if (!Number(uid)) return this.addDailyItem(input)
    const title = String(input.title || '').trim()
    if (!title) throw new StoreError('事项名称不能为空')
    const owner = String(input.owner || this.config.defaultOwner || '我').trim() || '我'
    const participants = [...new Set((input.participants || []).map(name => String(name).trim()).filter(Boolean))]
    await this.ensureContacts([owner, ...participants])
    let created = null
    const project = await this.editProject(uid, state => {
      const next = state.items.reduce((max, item) => Math.max(max, itemNumber(item.itemId)), 0) + 1
      created = `w${next}`
      const deps = [...new Set((input.deps || []).map(dep => String(dep).toLowerCase()))]
      this.validateDeps(state.items, created, deps)
      state.items.push({
        itemId: created,
        title,
        status: statusCn(input.status, DEFAULT_ITEM_STATUS),
        owner,
        participants,
        due: String(input.due || '').slice(0, 10),
        deps,
        detail: String(input.detail || '').trim(),
        created: localDate(),
        logs: [],
      })
    })
    const item = project.items.find(entry => entry.itemId === created)
    return {
      ok: true,
      itemId: created,
      file: item?.file || itemRelPathOf({ itemId: created, title }),
      absFile: item?.absFile || '',
      project: this.summarize(project),
    }
  }

  async updateItem(uid, itemId, patch) {
    if (!Number(uid)) return this.updateDailyItem(itemId, patch || {})
    const owner = patch?.owner !== undefined ? String(patch.owner).trim() : undefined
    const participants = patch?.participants !== undefined
      ? [...new Set(patch.participants.map(name => String(name).trim()).filter(Boolean))]
      : undefined
    await this.ensureContacts([owner || '', ...(participants || [])])
    const project = await this.editProject(uid, state => {
      const item = state.items.find(entry => entry.itemId === String(itemId).toLowerCase())
      if (!item) throw new StoreError(`项目 ${uid} 中找不到事项 ${itemId}`)
      if (patch?.deps !== undefined) {
        item.deps = [...new Set(patch.deps.map(dep => String(dep).toLowerCase()))]
        this.validateDeps(state.items, item.itemId, item.deps)
      }
      if (patch?.title !== undefined) item.title = String(patch.title).trim() || item.title
      if (patch?.status !== undefined) item.status = statusCn(patch.status, item.status)
      if (owner !== undefined) item.owner = owner
      if (participants !== undefined) item.participants = participants
      if (patch?.due !== undefined) item.due = String(patch.due || '').slice(0, 10)
      if (patch?.detail !== undefined) item.detail = String(patch.detail || '').trim()
    })
    return { ok: true, project: this.summarize(project) }
  }

  async removeOverviewRow(dept, year, name) {
    const path = join(this.workDir, dept, String(year), '_年度概述.md')
    const text = await md.readText(path)
    if (!text) return
    const lines = text.split(/\r?\n/)
    const next = lines.filter(line => !line.includes(`](./项目/${safeFilePart(name)}/README.md)`) && !line.includes(`](./项目/${name}.md)`))
    if (next.length !== lines.length) await md.writeText(path, next.join('\n'))
  }

  async deleteProject(uid) {
    const { entry } = await this.findProject(uid)
    const project = await this.loadProjectFile(entry)
    if (!project) throw new StoreError(`项目 ${uid} 读取失败`)
    const folder = entry.kind !== 'file'
    if (folder) await rm(entry.dir, { recursive: true, force: true })
    else await rm(entry.path, { force: true })
    await this.removeOverviewRow(project.dept, project.year, project.name)
    return { ok: true, uid: Number(uid), name: project.name, folder, removed: folder ? entry.dir : entry.path }
  }

  async deleteItem(uid, itemId) {
    if (!Number(uid)) return this.deleteDailyItem(itemId)
    const wanted = String(itemId).toLowerCase()
    let removed = null
    const project = await this.editProject(uid, state => {
      const dependents = state.items.filter(item => (item.deps || []).includes(wanted))
      if (dependents.length) {
        throw new StoreError(`事项 ${wanted} 被 ${dependents.map(item => `${item.itemId} ${item.title}`).join('、')} 依赖，不能删除`)
      }
      const index = state.items.findIndex(item => item.itemId === wanted)
      if (index < 0) throw new StoreError(`项目 ${uid} 中找不到事项 ${itemId}`)
      removed = state.items[index]
      state.items.splice(index, 1)
    })
    return { ok: true, removed: { itemId: wanted, title: removed?.title || '' }, project: this.summarize(project) }
  }

  async addLog(uid, itemId, input) {
    if (!Number(uid)) return this.addDailyLog(itemId, input)
    const event = String(input.event || '').trim()
    if (!event) throw new StoreError('日志事件不能为空')
    const project = await this.editProject(uid, state => {
      const item = state.items.find(entry => entry.itemId === String(itemId).toLowerCase())
      if (!item) throw new StoreError(`项目 ${uid} 中找不到事项 ${itemId}`)
      item.logs.unshift({
        time: String(input.time || localStamp()).trim(),
        event,
        solution: String(input.solution || '').trim(),
      })
    })
    return { ok: true, project: this.summarize(project) }
  }

  /**
   * Revise one existing log entry in place, so a later detail in the same change
   * refines the original entry instead of appending a duplicate.
   * @param uid - project uid.
   * @param itemId - item id inside the project.
   * @param input - logIndex (0 is newest) plus optional time / event / solution.
   */
  async updateLog(uid, itemId, input) {
    if (!Number(uid)) return this.updateDailyLog(itemId, input)
    const index = Number(input.logIndex)
    if (!Number.isInteger(index) || index < 0) throw new StoreError('需要日志序号 logIndex（从 0 开始，0 为最新）')
    const project = await this.editProject(uid, state => {
      const item = state.items.find(entry => entry.itemId === String(itemId).toLowerCase())
      if (!item) throw new StoreError(`项目 ${uid} 中找不到事项 ${itemId}`)
      const log = item.logs[index]
      if (!log) throw new StoreError(`事项 ${itemId} 没有第 ${index} 条日志`)
      const event = String(input.event ?? log.event).trim()
      if (!event) throw new StoreError('日志事件不能为空')
      item.logs[index] = {
        time: String(input.time || log.time || localStamp()).trim(),
        event,
        solution: String(input.solution ?? log.solution).trim(),
      }
    })
    return { ok: true, project: this.summarize(project) }
  }

  async addProgress(uid, input) {
    const text = String(input.text || '').trim()
    if (!text) throw new StoreError('进展内容不能为空')
    const project = await this.editProject(uid, state => {
      state.progress.unshift({
        date: String(input.date || localDate()).slice(0, 10),
        text,
        note: String(input.note || '—').trim(),
      })
      state.body = md.replaceSection(state.body, '项目进展', md.renderTable(PROGRESS_HEADERS, state.progress.map(row => [row.date, row.text, row.note])))
      state.meta.last_progress = String(input.date || localDate()).slice(0, 10)
    })
    return { ok: true, project: this.summarize(project) }
  }

  async createContact(input) {
    const name = String(input.name || '').trim()
    if (!name) throw new StoreError('联系人姓名不能为空')
    const rows = await this.loadContacts()
    if (rows.some(row => row.name === name)) throw new StoreError(`联系人 ${name} 已存在`)
    const maxId = rows.reduce((max, row) => Math.max(max, Number(String(row.id).replace(/^\D+/, '')) || 0), 0)
    const id = `c${maxId + 1}`
    rows.push({
      id, name,
      company: String(input.company || '').trim(),
      dept: String(input.dept || '').trim(),
      role: String(input.role || '').trim(),
      phone: String(input.phone || '').trim(),
      duty: String(input.duty || '').trim(),
      experience: String(input.experience || '').trim(),
      note: String(input.note || '').trim(),
    })
    await this.saveContacts(rows)
    return { ok: true, id }
  }

  async updateContact(idOrName, patch) {
    const rows = await this.loadContacts()
    const target = rows.find(row => row.id === String(idOrName) || row.name === String(idOrName))
    if (!target) throw new StoreError(`找不到联系人 ${idOrName}`)
    const map = { name: 'name', company: 'company', dept: 'dept', role: 'role', phone: 'phone', duty: 'duty', experience: 'experience', note: 'note' }
    for (const [key, value] of Object.entries(patch || {})) {
      if (map[key]) target[map[key]] = String(value ?? '').trim()
    }
    await this.saveContacts(rows)
    return { ok: true, id: target.id }
  }

  async appendExperience(idOrName, text) {
    const rows = await this.loadContacts()
    const target = rows.find(row => row.id === String(idOrName) || row.name === String(idOrName))
    if (!target) throw new StoreError(`找不到联系人 ${idOrName}`)
    const entry = String(text || '').trim()
    if (!entry) throw new StoreError('经验内容不能为空')
    target.experience = target.experience ? `${target.experience.replace(/[；;]\s*$/, '')}；${entry}` : entry
    await this.saveContacts(rows)
    return { ok: true, id: target.id, experience: target.experience }
  }

  async removeContact(idOrName) {
    const rows = await this.loadContacts()
    const target = rows.find(row => row.id === String(idOrName) || row.name === String(idOrName))
    if (!target) throw new StoreError(`找不到联系人 ${idOrName}`)
    // 「我」是新事项的默认负责人，删掉后下一次写事项会被自动补建成空档，等于悄悄丢资料。
    if (target.name === '我') throw new StoreError('「我」是本人档案，不能删除；要改资料请直接编辑')
    await this.saveContacts(rows.filter(row => row.id !== target.id))
    return { ok: true, removed: { id: target.id, name: target.name } }
  }

  /* ------------------------------------------------------------- documents */

  resolveDoc(relPath) {
    const target = resolve(this.root, String(relPath || ''))
    if (!target.startsWith(this.root + sep) || !target.endsWith('.md')) {
      throw new StoreError('只能读取工作档案目录内的 Markdown 文件')
    }
    return target
  }

  async docList() {
    const out = []
    const walk = async (dir, depth) => {
      if (depth > 6) return
      for (const entry of await safeEntries(dir)) {
        if (entry.name.startsWith('.')) continue
        const path = join(dir, entry.name)
        if (entry.isDirectory()) {
          if (entry.name === 'node_modules') continue
          await walk(path, depth + 1)
          continue
        }
        if (!entry.name.endsWith('.md')) continue
        const text = await md.readText(path)
        const { meta, body } = md.splitFrontmatter(text)
        out.push({
          relPath: relative(this.root, path).split(sep).join('/'),
          title: md.firstH1(body) || basename(entry.name, '.md'),
          kind: String(meta.kind || (path.startsWith(this.workDir) ? 'work' : 'archive')),
          uid: meta.uid ? Number(meta.uid) : null,
          schema: meta.schema || '',
          text,
        })
      }
    }
    for (const root of [this.dataDir, this.workDir]) await walk(root, 0)
    return out
  }

  async readDoc(relPath) {
    const path = this.resolveDoc(relPath)
    const text = await md.readText(path)
    if (!text) throw new StoreError(`文件不存在：${relPath}`)
    return { ok: true, path: relPath, text }
  }

  /** Read one item's own file (frontmatter fields + detail + logs). */
  async readItem(uid, itemId) {
    if (!Number(uid)) {
      const item = await this.findDailyItem(itemId)
      return {
        ok: true,
        uid: 0,
        project: DAILY_DIR,
        scope: 'daily',
        itemId: item.itemId,
        title: item.title,
        stamp: item.stamp,
        file: relative(this.root, item.absFile).split(sep).join('/'),
        absFile: item.absFile,
        text: await md.readText(item.absFile),
      }
    }
    const { entry } = await this.findProject(uid)
    const project = await this.loadProjectFile(entry)
    if (!project) throw new StoreError(`项目 ${uid} 读取失败`)
    const item = project.items.find(entryItem => entryItem.itemId === String(itemId).toLowerCase())
    if (!item) throw new StoreError(`项目 ${uid} 中找不到事项 ${itemId}`)
    const text = await md.readText(item.absFile)
    return {
      ok: true,
      uid: project.uid,
      project: project.name,
      itemId: item.itemId,
      title: item.title,
      file: relative(this.root, item.absFile).split(sep).join('/'),
      absFile: item.absFile,
      text,
    }
  }

  /** Item index the project README should carry; used by migration and tools. */
  async projectIndex(uid) {
    const { entry } = await this.findProject(uid)
    const project = await this.loadProjectFile(entry)
    if (!project) throw new StoreError(`项目 ${uid} 读取失败`)
    return {
      ok: true,
      uid: project.uid,
      name: project.name,
      readmePath: project.relPath,
      absReadmePath: project.absPath,
      dir: project.relDir,
      absDir: project.absDir,
      items: project.items.map(item => ({
        itemId: item.itemId, title: item.title, status: item.status,
        owner: item.owner, due: item.due, file: item.file, absFile: item.absFile,
      })),
    }
  }

  async appendDoc(relPath, section, text) {
    const path = this.resolveDoc(relPath)
    const source = await md.readText(path)
    if (!source) throw new StoreError(`文件不存在：${relPath}`)
    const { meta, body } = md.splitFrontmatter(source)
    const bullet = String(text || '').trim()
    if (!bullet) throw new StoreError('内容不能为空')
    const sectionTitle = String(section || '').trim()
    if (!sectionTitle) {
      await md.writeText(path, `${source.replace(/\s+$/, '')}\n\n- ${bullet}\n`)
      return { ok: true, path: relPath }
    }
    const found = md.findSection(body, sectionTitle)
    if (!found) {
      const next = `${body.replace(/\s+$/, '')}\n\n## ${sectionTitle}\n\n- ${bullet}\n`
      await md.writeText(path, md.joinFrontmatter(meta, next))
      return { ok: true, path: relPath }
    }
    const lines = body.split(/\r?\n/)
    let insertAt = found.end
    for (let index = found.end - 1; index > found.start; index -= 1) {
      if (lines[index].trim() !== '') { insertAt = index + 1; break }
    }
    lines.splice(insertAt, 0, `- ${bullet}`)
    await md.writeText(path, md.joinFrontmatter(meta, lines.join('\n')))
    return { ok: true, path: relPath }
  }

  /**
   * Split every legacy single-file project into the folder layout and refresh
   * each README's item index. Idempotent: an already-split project is only
   * rewritten when its index is out of date.
   */
  async migrateAll() {
    let projects = 0
    let items = 0
    for (const entry of await this.projectFiles()) {
      try {
        const before = await this.loadProjectFile(entry)
        if (!before) continue
        const moved = await this.migrateProject(entry)
        items += before.items.length
        if (moved) projects += 1
      } catch {
        // a malformed project must not stop the migration of the others
      }
    }
    const contacts = await this.loadContacts()
    await this.saveContacts(contacts)
    return { ok: true, projects, items, contacts: contacts.length }
  }

  /* ------------------------------------------------------------- dispatch */

  async apply(action, payload = {}) {
    switch (action) {
      case 'project.create': return this.createProject(payload)
      case 'project.update': return this.updateProject(payload.uid, payload.patch || payload)
      case 'project.delete': return this.deleteProject(payload.uid)
      case 'project.progress.add': return this.addProgress(payload.uid, payload)
      case 'item.add': return this.addItem(payload.uid, payload)
      case 'item.update': return this.updateItem(payload.uid, payload.itemId, payload.patch || payload)
      case 'item.delete': return this.deleteItem(payload.uid, payload.itemId)
      case 'item.log.add': return this.addLog(payload.uid, payload.itemId, payload)
      case 'item.log.update': return this.updateLog(payload.uid, payload.itemId, payload)
      case 'contact.add': return this.createContact(payload)
      case 'contact.update': return this.updateContact(payload.id || payload.name, payload.patch || payload)
      case 'contact.appendExperience': return this.appendExperience(payload.id || payload.name, payload.text)
      case 'contact.remove': return this.removeContact(payload.id || payload.name)
      case 'doc.append': return this.appendDoc(payload.path, payload.section, payload.text)
      case 'report.save': return this.saveReport(payload)
      case 'report.update': return this.updateReport(payload.path, payload)
      case 'migrate': return this.migrateAll()
      default: throw new StoreError(`未知操作：${action}`)
    }
  }
}
