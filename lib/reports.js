/**
 * Daily / weekly work reports (workos/v2 additive model).
 *
 * Two scopes share one format:
 * - personal (个人汇报): `data/日报/YYYY-MM-DD.md`, `data/周报/YYYY-MM-DD_YYYY-MM-DD.md`
 * - project (项目汇报): `work/{dept}/{year}/项目/{name}/汇报/日报/...`, `.../汇报/周报/...`
 *
 * The frontmatter carries the scope, the covered range and the generation
 * time; the body carries 生成时间 / 汇报时段 / 简介 / 详细内容 so both humans
 * and the assistant can read it without this module.
 *
 * The assistant never invents the range: `resolveReportRange` turns a single
 * date, a start/end pair, or a relative period (today / this_week / last_week)
 * into one explicit inclusive range that both report_data and report_save use.
 */

import { readdir } from 'node:fs/promises'
import { basename, join, relative, resolve, sep } from 'node:path'
import * as md from './md.js'

const DAILY_DIR = 'data/日报'
const WEEKLY_DIR = 'data/周报'
/** Inside a project folder; `汇报/日报` and `汇报/周报` sit next to `事项/`. */
const PROJECT_REPORT_DIR = '汇报'
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const PERSONAL_REPORT_PATH_RE = /^data\/(?:日报|周报)\/[^/]+\.md$/
const PROJECT_REPORT_PATH_RE = /\/汇报\/(?:日报|周报)\/[^/]+\.md$/
const ACTIVE_ITEM_STATUSES = ['未开始', '进行中', '等待反馈', '暂停']

function pad2(value) {
  return String(value).padStart(2, '0')
}

export function localDate(date = new Date()) {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`
}

export function localStamp(date = new Date()) {
  return `${localDate(date)} ${pad2(date.getHours())}:${pad2(date.getMinutes())}`
}

function validDate(value) {
  if (!DATE_RE.test(value)) return false
  const [year, month, day] = value.split('-').map(Number)
  const date = new Date(year, month - 1, day)
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day
}

function datePart(value) {
  const match = /^(\d{4}-\d{2}-\d{2})/.exec(String(value || '').trim())
  return match ? match[1] : ''
}

function addDays(iso, days) {
  const date = new Date(`${iso}T00:00:00`)
  date.setDate(date.getDate() + days)
  return localDate(date)
}

/** Monday of the week containing `iso` (ISO weeks start on Monday). */
export function mondayOf(iso) {
  const date = new Date(`${iso}T00:00:00`)
  const offset = (date.getDay() + 6) % 7
  return addDays(iso, -offset)
}

function rangeLabelOf(start, end) {
  return start === end ? start : `${start} ~ ${end}`
}

function titleOf(type, start, end) {
  const label = type === 'daily' ? '日报' : '周报'
  return start === end ? `${start} ${label}` : `${start} ~ ${end} ${label}`
}

/**
 * Resolve one explicit inclusive report range.
 *
 * Input order of precedence: `period` (today / this_week / last_week), then
 * `start`+`end`, then `date`, then today. `type` is inferred from the range
 * when omitted; a daily report must cover exactly one day.
 *
 * @param input - type / period / date / start / end.
 * @returns normalized { type, start, end, date, rangeLabel, title }.
 */
export function resolveReportRange(input = {}) {
  const today = localDate()
  const period = String(input.period || '').trim()
  const requestedType = String(input.type || '').trim()
  let type = requestedType === 'daily' || requestedType === 'weekly' ? requestedType : ''
  let start = String(input.start || '').trim().slice(0, 10)
  let end = String(input.end || '').trim().slice(0, 10)
  let date = String(input.date || '').trim().slice(0, 10)

  if (period) {
    if (period === 'today') {
      date = today
      start = today
      end = today
    } else if (period === 'this_week') {
      date = ''
      start = mondayOf(today)
      end = today
    } else if (period === 'last_week') {
      date = ''
      const monday = addDays(mondayOf(today), -7)
      start = monday
      end = addDays(monday, 6)
    } else {
      throw new Error(`不支持的汇报时段：${period}`)
    }
    if (!type) type = period === 'today' ? 'daily' : 'weekly'
  }

  if (!start && !end && date) {
    if (type === 'weekly') {
      start = mondayOf(date)
      end = addDays(start, 6)
    } else {
      start = date
      end = date
    }
  }
  if (!start && !end) {
    start = today
    end = today
  }
  if (!start) start = end
  if (!end) end = start
  if (!start || !end) throw new Error('缺少汇报日期')
  if (!validDate(start) || !validDate(end)) throw new Error('汇报日期格式应为 YYYY-MM-DD')
  if (start > end) {
    const swap = start
    start = end
    end = swap
  }
  if (!type) type = start === end ? 'daily' : 'weekly'
  if (type === 'daily' && start !== end) throw new Error('日报只能选一天；跨天请用周报')
  return { type, start, end, date: start, rangeLabel: rangeLabelOf(start, end), title: titleOf(type, start, end) }
}

function kindDirOf(type) {
  return type === 'daily' ? '日报' : '周报'
}

/**
 * Directory a report lives in.
 *
 * @param root - archive root (`.../workos`).
 * @param type - daily / weekly.
 * @param project - `{ absDir }` for a project report; omit for a personal report.
 */
function reportDirOf(root, type, project = null) {
  if (project?.absDir) return join(project.absDir, PROJECT_REPORT_DIR, kindDirOf(type))
  return join(root, type === 'daily' ? DAILY_DIR : WEEKLY_DIR)
}

function reportPathOf(root, range, project = null) {
  const file = range.type === 'daily' ? `${range.start}.md` : `${range.start}_${range.end}.md`
  return join(reportDirOf(root, range.type, project), file)
}

function reportRelPathOf(root, path) {
  return relative(root, path).split(sep).join('/')
}

function isReportRelPath(rel) {
  if (PERSONAL_REPORT_PATH_RE.test(rel)) return true
  return rel.includes('/项目/') && PROJECT_REPORT_PATH_RE.test(rel)
}

function scopeOfRelPath(rel) {
  return PROJECT_REPORT_PATH_RE.test(String(rel || '')) && String(rel).includes('/项目/') ? 'project' : 'personal'
}

/** Restrict edits to personal report dirs or a project's 汇报/ dirs. */
function resolveReportPath(root, relPath) {
  const target = resolve(root, String(relPath || ''))
  if (!target.endsWith('.md') || !isReportRelPath(reportRelPathOf(root, target))) {
    throw new Error('只能编辑 data/日报、data/周报 或项目文件夹 汇报/ 下的汇报文件')
  }
  return target
}

function renderReport({ type, start, end, summary, detail, source, generatedAt, updatedAt, project = null }) {
  const rangeLabel = rangeLabelOf(start, end)
  const title = titleOf(type, start, end)
  const sourceLabel = source === 'auto' ? '自动生成' : '手动生成'
  const meta = {
    schema: 'workos/v2',
    kind: 'report',
    scope: project ? 'project' : 'personal',
    ...(project?.name ? { project: project.name } : {}),
    ...(project?.uid ? { uid: Number(project.uid) } : {}),
    report_type: type,
    start,
    end,
    generated_at: generatedAt,
    updated_at: updatedAt || generatedAt,
    source,
    title,
  }
  const body = [
    `# ${title}`,
    '',
    `- **生成时间**: ${generatedAt}`,
    `- **汇报时段**: ${rangeLabel}`,
    `- **来源**: ${sourceLabel}`,
    ...(updatedAt && updatedAt !== generatedAt ? [`- **更新时间**: ${updatedAt}`] : []),
    '',
    '## 简介',
    '',
    summary || '（暂无简介）',
    '',
    '## 详细内容',
    '',
    detail || '（暂无详细内容）',
    '',
  ].join('\n')
  return md.joinFrontmatter(meta, body)
}

function rangeFromFileName(file) {
  const name = basename(file, '.md')
  const match = /^(\d{4}-\d{2}-\d{2})(?:_(\d{4}-\d{2}-\d{2}))?$/.exec(name)
  if (!match) return null
  return { start: match[1], end: match[2] || match[1] }
}

function reportSections(body) {
  const text = String(body || '')
  const summaryHeading = /^##\s+简介\s*$/m.exec(text)
  const detailHeading = /^##\s+详细内容\s*$/m.exec(text)
  if (!summaryHeading && !detailHeading) {
    return {
      summary: md.sectionContent(text, '简介').trim(),
      detail: md.sectionContent(text, '详细内容').trim(),
    }
  }
  return {
    summary: summaryHeading
      ? text.slice(summaryHeading.index + summaryHeading[0].length, detailHeading ? detailHeading.index : text.length).trim()
      : '',
    // 详细内容 is the last block, so it may contain its own ## subheadings; keep them.
    detail: detailHeading ? text.slice(detailHeading.index + detailHeading[0].length).trim() : '',
  }
}

function parseReportText(text, relPath, project = null) {
  const { meta, body } = md.splitFrontmatter(String(text || ''))
  if (meta.kind !== 'report' && !meta.report_type) return null
  const fallback = rangeFromFileName(relPath) || {}
  const type = String(meta.report_type || '').trim() === 'weekly' ? 'weekly' : 'daily'
  const start = String(meta.start || fallback.start || '').trim().slice(0, 10)
  const end = String(meta.end || fallback.end || start).trim().slice(0, 10)
  const generatedAt = String(meta.generated_at || '').trim()
  const updatedAt = String(meta.updated_at || generatedAt).trim()
  const source = String(meta.source || '').trim() === 'auto' ? 'auto' : 'manual'
  const title = String(meta.title || md.firstH1(body) || titleOf(type, start, end)).trim()
  const isProject = Boolean(project) || String(meta.scope || '').trim() === 'project' || scopeOfRelPath(relPath) === 'project'
  const scope = isProject ? 'project' : 'personal'
  return {
    relPath,
    scope,
    uid: project ? project.uid : Number(meta.uid) || 0,
    projectName: project ? project.name : String(meta.project || '').trim(),
    type,
    title,
    start,
    end,
    rangeLabel: rangeLabelOf(start, end),
    generatedAt,
    updatedAt,
    source,
    ...reportSections(body),
  }
}

async function safeEntries(dir) {
  try {
    return await readdir(dir, { withFileTypes: true })
  } catch (error) {
    if (error && (error.code === 'ENOENT' || error.code === 'ENOTDIR')) return []
    throw error
  }
}

async function collectReports(root, dir, project = null) {
  const out = []
  for (const entry of await safeEntries(dir)) {
    if (!entry.isFile() || !entry.name.endsWith('.md') || entry.name.startsWith('_')) continue
    const path = join(dir, entry.name)
    const text = await md.readText(path)
    const report = parseReportText(text, reportRelPathOf(root, path), project)
    if (report) out.push(report)
  }
  return out
}

/**
 * List every saved report, newest generated first.
 *
 * @param root - archive root.
 * @param projects - rows from `Store.allProjects()`; each `汇报/` folder is scanned too.
 */
export async function listReports(root, projects = []) {
  const out = [
    ...(await collectReports(root, join(root, DAILY_DIR))),
    ...(await collectReports(root, join(root, WEEKLY_DIR))),
  ]
  for (const project of projects || []) {
    // Legacy single-file projects share their parent directory (`项目/`), so
    // scanning it would attribute one project's reports to its siblings.
    if (!project?.absDir || project.folder === false) continue
    const owner = { uid: Number(project.uid) || 0, name: project.name || '' }
    for (const type of ['daily', 'weekly']) {
      out.push(...await collectReports(root, reportDirOf(root, type, project), owner))
    }
  }
  return out.sort((left, right) => {
    const byGenerated = String(right.generatedAt).localeCompare(String(left.generatedAt))
    if (byGenerated !== 0) return byGenerated
    return String(right.start).localeCompare(String(left.start))
  })
}

/** Read one report by relative path. */
export async function readReport(root, relPath) {
  const path = resolveReportPath(root, relPath)
  const text = await md.readText(path)
  if (!text.trim()) throw new Error(`汇报不存在：${relPath}`)
  const report = parseReportText(text, reportRelPathOf(root, path))
  if (!report) throw new Error(`不是有效的汇报文件：${relPath}`)
  return { ok: true, report }
}

/**
 * Create or replace one report file. The model supplies facts from
 * `report_data`; generated_at/updated_at are stamped here.
 */
export async function saveReport(root, input = {}) {
  const range = resolveReportRange(input)
  const summary = String(input.summary || '').trim()
  const detail = String(input.detail || '').trim()
  if (!summary && !detail) throw new Error('汇报简介和详细内容都不能都为空')
  const source = String(input.source || '') === 'auto' ? 'auto' : 'manual'
  const generatedAt = String(input.generated_at || '').trim() || localStamp()
  const project = input.project?.absDir ? input.project : null
  const path = reportPathOf(root, range, project)
  const relPath = reportRelPathOf(root, path)
  const previous = await md.readText(path)
  const text = renderReport({
    type: range.type, start: range.start, end: range.end,
    summary, detail, source, generatedAt, updatedAt: generatedAt, project,
  })
  await md.writeText(path, text)
  return {
    ok: true,
    path: relPath,
    created: !previous.trim(),
    scope: project ? 'project' : 'personal',
    report: parseReportText(text, relPath, project),
  }
}

/** Edit a report's summary and detail while keeping its range and generation time. */
export async function updateReport(root, relPath, patch = {}) {
  const path = resolveReportPath(root, relPath)
  const text = await md.readText(path)
  if (!text.trim()) throw new Error(`汇报不存在：${relPath}`)
  const report = parseReportText(text, reportRelPathOf(root, path))
  if (!report) throw new Error(`不是有效的汇报文件：${relPath}`)
  const summary = patch.summary !== undefined ? String(patch.summary).trim() : report.summary
  const detail = patch.detail !== undefined ? String(patch.detail).trim() : report.detail
  const updatedAt = String(patch.updated_at || '').trim() || localStamp()
  const project = report.scope === 'project' ? { name: report.projectName, uid: report.uid } : null
  const next = renderReport({
    type: report.type, start: report.start, end: report.end,
    summary, detail, source: report.source, generatedAt: report.generatedAt, updatedAt, project,
  })
  await md.writeText(path, next)
  return { ok: true, path: relPath, report: parseReportText(next, relPath) }
}

/**
 * Assemble the facts a report should be written from.
 *
 * @param projects - raw projects from Store.allProjects().
 * @param input - the same range selectors as resolveReportRange.
 * @returns range, logs, project progress rows, active projects and open items.
 */
export function buildReportData(projects, input = {}) {
  const range = resolveReportRange(input)
  const wantedUid = Number(input.uid) || 0
  const scoped = (projects || []).filter(project => !wantedUid || Number(project.uid) === wantedUid)
  if (wantedUid && scoped.length === 0) throw new Error(`找不到 uid=${wantedUid} 的项目`)
  const target = wantedUid ? scoped[0] : null
  const logs = []
  const progress = []
  const activity = new Map()
  const openItems = []
  const inRange = value => {
    const day = datePart(value)
    return Boolean(day) && day >= range.start && day <= range.end
  }

  for (const project of scoped) {
    const projectName = project.name
    const projectLogs = []
    for (const item of project.items || []) {
      for (const log of item.logs || []) {
        if (!inRange(log.time)) continue
        const entry = {
          uid: project.uid,
          project: projectName,
          itemId: item.itemId,
          itemTitle: item.title,
          status: item.status,
          owner: item.owner || '',
          participants: item.participants || [],
          time: String(log.time || '').trim(),
          event: String(log.event || '').trim(),
          solution: String(log.solution || '').trim(),
        }
        logs.push(entry)
        projectLogs.push(entry)
      }
      if (ACTIVE_ITEM_STATUSES.includes(item.status)) {
        openItems.push({
          uid: project.uid,
          project: projectName,
          itemId: item.itemId,
          title: item.title,
          status: item.status,
          due: item.due || '',
          owner: item.owner || '',
          blocked: Boolean(item.blocked),
          blockedBy: (item.blockedBy || []).map(dep => `${dep.itemId} ${dep.title}（${dep.status}）`),
        })
      }
    }
    for (const row of project.progress || []) {
      if (!inRange(row.date)) continue
      progress.push({
        uid: project.uid,
        project: projectName,
        date: String(row.date || '').trim(),
        text: String(row.text || '').trim(),
        note: String(row.note || '').trim(),
      })
    }
    const counts = { logs: projectLogs.length, progress: progress.filter(row => row.uid === project.uid).length }
    if (counts.logs > 0 || counts.progress > 0) {
      activity.set(project.uid, {
        uid: project.uid,
        name: projectName,
        status: project.statusLabel || project.status || '',
        goal: project.goal || '',
        logs: counts.logs,
        progress: counts.progress,
      })
    }
  }

  logs.sort((left, right) => String(left.time).localeCompare(String(right.time)))
  progress.sort((left, right) => String(left.date).localeCompare(String(right.date)))
  openItems.sort((left, right) => {
    if (!left.due && right.due) return 1
    if (left.due && !right.due) return -1
    return String(left.due).localeCompare(String(right.due))
  })

  return {
    ok: true,
    scope: target ? 'project' : 'personal',
    uid: target ? Number(target.uid) : 0,
    project: target ? target.name : '',
    type: range.type,
    start: range.start,
    end: range.end,
    rangeLabel: range.rangeLabel,
    title: range.title,
    generatedAt: localStamp(),
    logs,
    progress,
    projects: [...activity.values()],
    openItems: openItems.slice(0, 50),
    counts: {
      logs: logs.length,
      progress: progress.length,
      projects: activity.size,
      openItems: openItems.length,
    },
    note: logs.length || progress.length
      ? ''
      : target
        ? `「${target.name}」在该时段没有事项日志或项目进展记录；如实写「本时段没有日志记录」，不要编造。`
        : '该时段没有事项日志或项目进展记录；如实写「本时段没有日志记录」，不要编造。',
  }
}

export { DAILY_DIR, WEEKLY_DIR, PROJECT_REPORT_DIR, addDays, datePart, rangeLabelOf }
