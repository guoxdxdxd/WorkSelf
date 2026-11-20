/**
 * workos/v1 Markdown primitives: frontmatter, fenced sections and pipe tables.
 *
 * The Markdown files stay the single source of truth. Everything here is a
 * lossless-enough reader/writer: prose is preserved byte for byte, and only the
 * table of a section this module rewrites is regenerated.
 */

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

/* ------------------------------------------------------------------ files */

export async function readText(path) {
  try {
    return await readFile(path, 'utf8')
  } catch (error) {
    if (error && error.code === 'ENOENT') return ''
    throw error
  }
}

export async function writeText(path, text) {
  await mkdir(dirname(path), { recursive: true })
  const tmp = `${path}.tmp-${process.pid}-${Date.now()}`
  await writeFile(tmp, text, 'utf8')
  await rename(tmp, path)
}

/* --------------------------------------------------------------- yaml lite */

function unquote(raw) {
  const value = raw.trim()
  if (value.length >= 2) {
    const first = value[0]
    const last = value[value.length - 1]
    if (first === '"' && last === '"') {
      try {
        return JSON.parse(value)
      } catch {
        return value.slice(1, -1)
      }
    }
    if (first === "'" && last === "'") return value.slice(1, -1).replaceAll("''", "'")
  }
  if (value === 'null' || value === '~') return ''
  return value
}

function yamlValue(value) {
  const text = value === undefined || value === null ? '' : String(value)
  if (text === '') return ''
  if (/^[A-Za-z0-9_\-./\u4e00-\u9fff()（）#★]+$/.test(text) && !/^\s|\s$/.test(text)) return text
  return JSON.stringify(text)
}

/** Parse the small YAML subset used by `workos/v1` headings (scalars + string lists). */
export function parseYaml(text) {
  const meta = {}
  let listKey = null
  for (const rawLine of String(text || '').split('\n')) {
    const line = rawLine.replace(/\r$/, '')
    if (!line.trim() || line.trimStart().startsWith('#')) continue
    if (/^\s*-\s+/.test(line) && listKey) {
      if (!Array.isArray(meta[listKey])) meta[listKey] = []
      meta[listKey].push(unquote(line.replace(/^\s*-\s+/, '')))
      continue
    }
    const match = /^([A-Za-z0-9_\-\u4e00-\u9fff]+)\s*:\s*(.*)$/.exec(line)
    if (!match) continue
    const key = match[1]
    const rest = match[2]
    listKey = null
    if (rest.trim() === '') {
      meta[key] = ''
      listKey = key
      continue
    }
    meta[key] = unquote(rest)
  }
  return meta
}

export function dumpYaml(meta) {
  const lines = []
  for (const [key, value] of Object.entries(meta)) {
    if (Array.isArray(value)) {
      lines.push(`${key}:`)
      for (const item of value) lines.push(`  - ${yamlValue(item)}`)
    } else if (value === undefined || value === null) {
      lines.push(`${key}:`)
    } else {
      lines.push(`${key}: ${yamlValue(value)}`)
    }
  }
  return lines.join('\n')
}

/** Split a document into frontmatter metadata and body. */
export function splitFrontmatter(text) {
  const src = String(text || '')
  if (!src.startsWith('---')) return { meta: {}, body: src, hasFrontmatter: false }
  const end = src.indexOf('\n---', 3)
  if (end < 0) return { meta: {}, body: src, hasFrontmatter: false }
  const head = src.slice(3, end)
  const bodyStart = src.indexOf('\n', end + 4)
  const body = bodyStart < 0 ? '' : src.slice(bodyStart + 1)
  return { meta: parseYaml(head), body, hasFrontmatter: true }
}

export function joinFrontmatter(meta, body) {
  return `---\n${dumpYaml(meta)}\n---\n\n${String(body || '').replace(/^\n+/, '')}`
}

/* ---------------------------------------------------------------- sections */

/** Index `## ` sections by title, preserving offsets. */
export function sectionsOf(body) {
  const lines = String(body || '').split(/\r?\n/)
  const out = []
  let current = null
  lines.forEach((line, index) => {
    const match = /^##\s+(.+?)\s*$/.exec(line)
    if (match && !/^###/.test(line)) {
      if (current) current.end = index
      current = { title: match[1].trim(), start: index, end: lines.length, headingLine: index }
      out.push(current)
    }
  })
  return { lines, sections: out }
}

export function findSection(body, title) {
  const { lines, sections } = sectionsOf(body)
  const wanted = title.trim()
  const section =
    sections.find(item => item.title === wanted) ||
    sections.find(item => item.title.replace(/\s/g, '') === wanted.replace(/\s/g, '')) ||
    sections.find(item => item.title.startsWith(wanted))
  if (!section) return null
  const contentLines = lines.slice(section.start + 1, section.end)
  return { ...section, lines, content: contentLines.join('\n') }
}

export function firstH1(body) {
  const match = /^#\s+(.+?)\s*$/m.exec(String(body || ''))
  return match ? match[1].trim() : ''
}

/* ------------------------------------------------------------------ tables */

const SEPARATOR = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/

export function splitRow(line) {
  let text = String(line).trim()
  if (text.startsWith('|')) text = text.slice(1)
  if (text.endsWith('|')) text = text.slice(0, -1)
  return text.split('|').map(cell => cell.trim())
}

export function isTableLine(line) {
  return /^\s*\|/.test(String(line))
}

export function parseTableLines(lines) {
  const headers = []
  const rows = []
  let headerSeen = false
  for (const line of lines) {
    if (!isTableLine(line)) continue
    if (SEPARATOR.test(line)) continue
    const cells = splitRow(line)
    if (!headerSeen) {
      headerSeen = true
      headers.push(...cells)
      continue
    }
    const row = {}
    headers.forEach((header, index) => { row[header] = cells[index] ?? '' })
    if (cells.every(cell => cell === '' || cell === '—' || cell === '-')) continue
    rows.push(row)
  }
  return { headers, rows }
}

/** Read the pipe table living under one `## ` section. */
export function sectionTable(body, title) {
  const section = findSection(body, title)
  if (!section) return { headers: [], rows: [], start: -1, end: -1, section: null }
  const start = section.start + 1
  const blockLines = section.lines.slice(start, section.end)
  const table = parseTableLines(blockLines)
  return { ...table, start, end: section.end, section }
}

export function renderTable(headers, rows) {
  const widths = headers.map((header, index) => {
    const cells = rows.map(row => String(Array.isArray(row) ? row[index] ?? '' : row[header] ?? ''))
    return Math.max(header.length, ...cells.map(cell => cell.length), 2)
  })
  const line = cells =>
    `| ${cells.map((cell, index) => String(cell ?? '').padEnd(widths[index])).join(' | ')} |`
  const out = [line(headers), `| ${widths.map(width => '-'.repeat(width)).join(' | ')} |`]
  for (const row of rows) {
    const cells = Array.isArray(row) ? row : headers.map(header => row[header] ?? '')
    out.push(line(cells))
  }
  return out.join('\n')
}

/**
 * Replace the table under a section, keeping every other line untouched.
 * A missing section is appended at the end of the body.
 */
export function replaceSectionTable(body, title, headers, rows) {
  const src = String(body || '')
  const { lines } = sectionsOf(src)
  const section = findSection(src, title)
  const table = renderTable(headers, rows)
  if (!section) {
    const prefix = src.replace(/\s+$/, '')
    return `${prefix}\n\n## ${title}\n\n${table}\n`
  }
  const blockStart = section.start + 1
  let firstTable = -1
  let lastTable = -1
  for (let index = blockStart; index < section.end; index += 1) {
    if (isTableLine(lines[index])) {
      if (firstTable < 0) firstTable = index
      lastTable = index
    } else if (firstTable >= 0 && !isTableLine(lines[index]) && lines[index].trim() !== '') {
      break
    }
  }
  const head = lines.slice(0, blockStart)
  const tail = lines.slice(section.end)
  return [...head, '', table, '', ...tail].join('\n')
}

/* ------------------------------------------------------- whole-body tables */


/** Replace one `## ` section's content, keeping its heading; append the section when absent. */
export function replaceSection(body, title, content) {
  const src = String(body || '')
  const section = findSection(src, title)
  const block = String(content || '').replace(/^\n+/, '').replace(/\s+$/, '')
  if (!section) {
    const prefix = src.replace(/\s+$/, '')
    return `${prefix}\n\n## ${title}\n\n${block}\n`
  }
  const lines = src.split(/\r?\n/)
  const next = lines.slice(section.end)
  return [...lines.slice(0, section.start + 1), '', block, '', ...next].join('\n')
}

/** Read one section's raw content (without its heading). */
export function sectionContent(body, title) {
  return findSection(body, title)?.content || ''
}

/** The first pipe table anywhere in a body (ledger files keep it under the H1). */
export function bodyTable(body) {
  const lines = String(body || '').split(/\r?\n/)
  let first = -1
  let last = -1
  for (let index = 0; index < lines.length; index += 1) {
    if (isTableLine(lines[index])) {
      if (first < 0) first = index
      last = index
    } else if (first >= 0 && lines[index].trim() !== '') {
      break
    }
  }
  if (first < 0) return { headers: [], rows: [], first: -1, last: -1 }
  const table = parseTableLines(lines.slice(first, last + 1))
  return { ...table, first, last }
}

/** Replace the first pipe table of a body, appending it after the H1 when absent. */
export function replaceBodyTable(body, headers, rows) {
  const src = String(body || '')
  const { first, last } = bodyTable(src)
  const table = renderTable(headers, rows)
  if (first < 0) {
    const lines = src.split(/\r?\n/)
    const h1 = lines.findIndex(line => /^#\s+/.test(line))
    if (h1 >= 0) return [...lines.slice(0, h1 + 1), '', table, '', ...lines.slice(h1 + 1)].join('\n')
    return `${src.replace(/\s+$/, '')}\n\n${table}\n`
  }
  const lines = src.split(/\r?\n/)
  return [...lines.slice(0, first), table, ...lines.slice(last + 1)].join('\n')
}

/** Key/value bullets such as `- **我的职责**: …`. */export function keyValueBullets(content) {
  const out = {}
  for (const line of String(content || '').split(/\r?\n/)) {
    const match = /^-\s+\*\*(.+?)\*\*\s*[:：]\s*(.*)$/.exec(line.trim())
    if (match) out[match[1]] = match[2].trim()
  }
  return out
}

export function excerpt(text, limit = 160) {
  const flat = String(text || '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/[#>*_`|-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return flat.length > limit ? `${flat.slice(0, limit)}…` : flat
}

export function slugName(name) {
  return String(name || '')
    .replace(/[\\/:*?"<>|]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80)
}
