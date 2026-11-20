/**
 * Disposable SQLite read model over the Markdown archive.
 *
 * Markdown remains the only truth: this database is rebuilt on demand and may
 * be deleted at any time. It exists so the assistant can answer "who / what /
 * blocked by whom / what happened last time" without reading every file.
 */

import { DatabaseSync } from 'node:sqlite'
import { createHash } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import * as md from './md.js'

const SCHEMA = `
PRAGMA journal_mode = WAL;
CREATE TABLE IF NOT EXISTS doc(
  path TEXT PRIMARY KEY,
  kind TEXT,
  title TEXT,
  uid INTEGER,
  schema TEXT,
  hash TEXT,
  body TEXT
);
CREATE VIRTUAL TABLE IF NOT EXISTS doc_fts USING fts5(
  search,
  path UNINDEXED,
  title,
  tokenize = 'unicode61'
);
CREATE TABLE IF NOT EXISTS project(
  uid INTEGER PRIMARY KEY,
  path TEXT,
  name TEXT,
  dept TEXT,
  year INTEGER,
  status TEXT,
  project_type TEXT,
  priority TEXT,
  start TEXT,
  end TEXT,
  owner TEXT,
  goal TEXT,
  progress INTEGER,
  items_total INTEGER,
  items_done INTEGER,
  blocked_count INTEGER,
  last_progress TEXT
);
CREATE TABLE IF NOT EXISTS work_item(
  uid INTEGER,
  item_id TEXT,
  title TEXT,
  status TEXT,
  due TEXT,
  owner TEXT,
  participants TEXT,
  deps TEXT,
  detail TEXT,
  logs_count INTEGER,
  PRIMARY KEY(uid, item_id)
);
CREATE TABLE IF NOT EXISTS item_log(
  uid INTEGER,
  project TEXT,
  item_id TEXT,
  item_title TEXT,
  idx INTEGER,
  time TEXT,
  event TEXT,
  solution TEXT
);
CREATE TABLE IF NOT EXISTS contact(
  id TEXT PRIMARY KEY,
  name TEXT,
  company TEXT,
  dept TEXT,
  role TEXT,
  phone TEXT,
  duty TEXT,
  experience TEXT,
  note TEXT
);
CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY, value TEXT);
`

const CJK = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/

/** Overlapping CJK bigrams plus ASCII words: the tokens the FTS index stores. */
export function searchTokens(text) {
  const out = []
  const runs = String(text || '').match(/[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]+/g) || []
  for (const run of runs) {
    if (run.length === 1) out.push(run)
    else for (let index = 0; index < run.length - 1; index += 1) out.push(run.slice(index, index + 2))
  }
  const words = String(text || '').match(/[A-Za-z][A-Za-z0-9_\-]{1,}/g) || []
  out.push(...words)
  return out
}

function queryTokens(query) {
  const text = String(query || '').trim()
  if (!text) return []
  if (CJK.test(text)) return searchTokens(text)
  return text.split(/\s+/).filter(Boolean)
}

function excerptOf(body, query, limit = 180) {
  const flat = String(body || '').replace(/\s+/g, ' ').trim()
  const needle = String(query || '').trim()
  if (needle) {
    const index = flat.indexOf(needle)
    if (index >= 0) {
      const start = Math.max(0, index - 60)
      return `${start > 0 ? '…' : ''}${flat.slice(start, start + limit)}${start + limit < flat.length ? '…' : ''}`
    }
  }
  return flat.length > limit ? `${flat.slice(0, limit)}…` : flat
}

export class WorkIndex {
  constructor(store) {
    this.store = store
    this.dir = join(store.workosDir, '.index')
    this.dbPath = join(this.dir, 'workos.sqlite3')
    this.db = null
    this.lastSync = 0
    this.lastStats = null
  }

  async open() {
    if (this.db) return this.db
    await mkdir(this.dir, { recursive: true })
    this.db = new DatabaseSync(this.dbPath)
    const version = Number(this.db.prepare('PRAGMA user_version').get().user_version) || 0
    if (version < 2) {
      this.db.exec(`
        DROP TABLE IF EXISTS doc; DROP TABLE IF EXISTS doc_fts;
        DROP TABLE IF EXISTS project; DROP TABLE IF EXISTS work_item;
        DROP TABLE IF EXISTS item_log; DROP TABLE IF EXISTS contact;
        DROP TABLE IF EXISTS waiting; DROP TABLE IF EXISTS plan; DROP TABLE IF EXISTS inbox;
        DROP TABLE IF EXISTS meta;
      `)
      this.db.exec('PRAGMA user_version = 2')
    }
    this.db.exec(SCHEMA)
    return this.db
  }

  close() {
    try {
      this.db?.close()
    } catch {
      // already closed
    }
    this.db = null
  }

  async sync({ force = false, maxAgeMs = 2500 } = {}) {
    const db = await this.open()
    if (!force && this.lastSync && Date.now() - this.lastSync < maxAgeMs) return this.lastStats
    const docs = await this.store.docList()
    const known = new Map()
    for (const row of db.prepare('SELECT path, hash FROM doc').all()) known.set(row.path, row.hash)
    let indexed = 0
    const deleteDoc = db.prepare('DELETE FROM doc WHERE path = ?')
    const deleteFts = db.prepare('DELETE FROM doc_fts WHERE path = ?')
    const insertDoc = db.prepare('INSERT OR REPLACE INTO doc(path, kind, title, uid, schema, hash, body) VALUES (?,?,?,?,?,?,?)')
    const insertFts = db.prepare('INSERT INTO doc_fts(search, path, title) VALUES (?,?,?)')
    for (const doc of docs) {
      const hash = createHash('sha1').update(doc.text).digest('hex')
      if (known.get(doc.relPath) === hash) continue
      const { meta, body } = md.splitFrontmatter(doc.text)
      deleteFts.run(doc.relPath)
      insertDoc.run(doc.relPath, doc.kind, doc.title, doc.uid ?? null, String(meta.schema || ''), hash, body)
      insertFts.run(searchTokens(`${doc.title}\n${body}`).join(' '), doc.relPath, doc.title)
      indexed += 1
    }
    const present = new Set(docs.map(doc => doc.relPath))
    for (const path of known.keys()) {
      if (present.has(path)) continue
      deleteDoc.run(path)
      deleteFts.run(path)
    }

    const projects = await this.store.allProjects()
    const summaries = projects.map(project => this.store.summarize(project))
    db.exec('DELETE FROM project; DELETE FROM work_item; DELETE FROM item_log;')
    const insertProject = db.prepare(`INSERT INTO project(uid, path, name, dept, year, status, project_type, priority, start, end, owner, goal, progress, items_total, items_done, blocked_count, last_progress)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    const insertItem = db.prepare('INSERT INTO work_item(uid, item_id, title, status, due, owner, participants, deps, detail, logs_count) VALUES (?,?,?,?,?,?,?,?,?,?)')
    const insertLog = db.prepare('INSERT INTO item_log(uid, project, item_id, item_title, idx, time, event, solution) VALUES (?,?,?,?,?,?,?,?)')
    for (const summary of summaries) {
      insertProject.run(
        summary.uid, summary.relPath, summary.name, summary.dept, summary.year, summary.status,
        summary.projectType, summary.priority, summary.start, summary.end, summary.owner, summary.goal,
        summary.progress, summary.total, summary.doneCount, summary.blockedCount, summary.lastProgress,
      )
      const project = projects.find(item => item.uid === summary.uid)
      for (const item of project?.items || []) {
        insertItem.run(summary.uid, item.itemId, item.title, item.status, item.due, item.owner,
          item.participants.join('、'), (item.deps || []).join('、'), item.detail, item.logs.length)
        item.logs.forEach((log, index) => {
          insertLog.run(summary.uid, summary.name, item.itemId, item.title, index, log.time, log.event, log.solution)
        })
      }
    }

    const contacts = await this.store.loadContacts()
    const daily = await this.store.dailyState()
    for (const item of daily.items) {
      insertItem.run(0, item.itemId, item.title, item.status, item.due, item.owner,
        item.participants.join('、'), '', item.detail, item.logs.length)
      item.logs.forEach((log, index) => {
        insertLog.run(0, '日常工作', item.itemId, item.title, index, log.time, log.event, log.solution)
      })
    }
    db.exec('DELETE FROM contact;')
    const insertContact = db.prepare('INSERT INTO contact(id, name, company, dept, role, phone, duty, experience, note) VALUES (?,?,?,?,?,?,?,?,?)')
    for (const row of contacts) insertContact.run(row.id, row.name, row.company, row.dept, row.role, row.phone, row.duty, row.experience, row.note)

    const stats = {
      syncedAt: new Date().toISOString(),
      docs: docs.length,
      indexed,
      projects: summaries.length,
      items: summaries.reduce((sum, project) => sum + project.total, 0) + daily.items.length,
      logs: summaries.reduce((sum, project) => sum + project.logCount, 0) + daily.items.reduce((sum, item) => sum + item.logs.length, 0),
      contacts: contacts.length,
      dbPath: this.dbPath,
    }
    const setMeta = db.prepare('INSERT OR REPLACE INTO meta(key, value) VALUES (?,?)')
    for (const [key, value] of Object.entries(stats)) setMeta.run(key, String(value))
    await writeFile(join(this.dir, 'index.json'), `${JSON.stringify(stats, null, 2)}\n`, 'utf8')
    this.lastSync = Date.now()
    this.lastStats = stats
    return stats
  }

  async search(query, { limit = 12, kind = '' } = {}) {
    const db = await this.open()
    await this.sync()
    const tokens = queryTokens(query)
    const result = []
    if (tokens.length) {
      const match = tokens.map(token => `"${token.replaceAll('"', '')}"`).join(' AND ')
      try {
        const rows = db.prepare(`
          SELECT d.path, d.kind, d.title, d.body, bm25(doc_fts) AS score
          FROM doc_fts JOIN doc d ON d.path = doc_fts.path
          WHERE doc_fts MATCH ? ${kind ? 'AND d.kind = ?' : ''}
          ORDER BY score LIMIT ?
        `).all(...(kind ? [match, kind, limit] : [match, limit]))
        for (const row of rows) {
          result.push({ path: row.path, kind: row.kind, title: row.title, excerpt: excerptOf(row.body, query), score: Number(row.score?.toFixed?.(3) ?? row.score) })
        }
      } catch {
        // LIKE fallback below
      }
    }
    if (!result.length) {
      const like = `%${String(query).trim()}%`
      const rows = db.prepare(`
        SELECT path, kind, title, body FROM doc
        WHERE (body LIKE ? OR title LIKE ?) ${kind ? 'AND kind = ?' : ''}
        LIMIT ?
      `).all(...(kind ? [like, like, kind, limit] : [like, like, limit]))
      for (const row of rows) {
        result.push({ path: row.path, kind: row.kind, title: row.title, excerpt: excerptOf(row.body, query), score: null })
      }
    }
    return { ok: true, query, count: result.length, results: result }
  }

  async query(kind, options = {}) {
    const db = await this.open()
    await this.sync()
    const limit = Math.min(Math.max(Number(options.limit) || 50, 1), 200)
    switch (kind) {
      case 'projects': {
        return {
          ok: true,
          kind,
          rows: db.prepare(`
            SELECT uid, name, dept, year, status, project_type, priority, start, end, owner, goal, progress, items_total, items_done, blocked_count, last_progress
            FROM project
            WHERE (? = '' OR status = ?) AND (? = '' OR project_type = ?) AND (? = 0 OR year = ?)
            ORDER BY uid DESC LIMIT ?
          `).all(
            options.status || '', options.status || '',
            options.projectType || '', options.projectType || '',
            Number(options.year) || 0, Number(options.year) || 0,
            limit,
          ),
        }
      }
      case 'items': {
        return {
          ok: true,
          kind,
          rows: db.prepare(`
            SELECT w.uid, COALESCE(p.name, CASE WHEN w.uid = 0 THEN '日常工作' ELSE '' END) AS project,
              w.item_id, w.title, w.status, w.due, w.owner, w.participants, w.deps, w.detail, w.logs_count
            FROM work_item w LEFT JOIN project p ON p.uid = w.uid
            WHERE (? = 0 OR w.uid = ?) AND (? = '' OR w.status = ?)
            ORDER BY (w.due = '') ASC, w.due ASC LIMIT ?
          `).all(Number(options.uid) || 0, Number(options.uid) || 0, options.status || '', options.status || '', limit),
        }
      }
      case 'logs': {
        return {
          ok: true,
          kind,
          rows: db.prepare(`
            SELECT uid, project, item_id, item_title, idx AS logIndex, time, event, solution FROM item_log
            WHERE (? = 0 OR uid = ?) AND (? = '' OR item_id = ?)
              AND (? = '' OR substr(time, 1, 10) >= ?)
              AND (? = '' OR substr(time, 1, 10) <= ?)
            ORDER BY time DESC LIMIT ?
          `).all(
            Number(options.uid) || 0, Number(options.uid) || 0,
            options.itemId || '', options.itemId || '',
            options.from || '', options.from || '',
            options.to || '', options.to || '',
            limit,
          ),
        }
      }
      case 'contacts': {
        return {
          ok: true,
          kind,
          rows: db.prepare('SELECT * FROM contact WHERE (? = \'\' OR name LIKE ? OR company LIKE ? OR duty LIKE ? OR experience LIKE ?) LIMIT ?')
            .all(options.keyword || '', `%${options.keyword || ''}%`, `%${options.keyword || ''}%`, `%${options.keyword || ''}%`, `%${options.keyword || ''}%`, limit),
        }
      }
      default:
        return { ok: false, error: `不支持的查询类型：${kind}` }
    }
  }

  async status() {
    const db = await this.open()
    const counts = {}
    for (const table of ['doc', 'project', 'work_item', 'item_log', 'contact']) {
      counts[table] = Number(db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n)
    }
    return { ok: true, ...counts, lastSync: this.lastStats?.syncedAt ?? null }
  }
}
