/**
 * Work OS cockpit for DeepSeek Harness.
 *
 * One right-sidebar tab type per workspace: the cockpit reads and writes
 * `<workspace>/workos`, initializes it on first open, and exposes the same
 * archive to the agent through seven tools and two skills.
 */

import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Store } from './lib/store.js'
import { WorkIndex } from './lib/index-db.js'
import { initializeWorkspace, ensureSelfContact } from './lib/init.js'
import { createApi } from './lib/api.js'
import { registerTools } from './lib/tools.js'
import { registerSkills } from './lib/skills.js'

/** Cordis plugin name. */
export const name = 'workos'

/** Host services this plugin contributes to. */
export const inject = ['tools', 'skills', 'webServer']

/**
 * Resolve one scope per workspace root, initialize its archive lazily, and
 * keep one SQLite index per root for the process lifetime.
 */
function createResolver({ resolveService, subdir }) {
  const scopes = new Map()

  /**
   * Resolve the session's workspace directory and the archive root inside it
   * (`<workspace>/<subdir>`).
   */
  const dirsFor = async sessionId => {
    if (!sessionId) throw new Error('缺少会话信息：请在当前会话的右侧边栏打开工作驾驶舱')
    // Host services publish asynchronously, so resolve them per call instead of
    // capturing them at apply time.
    const agents = resolveService('agents')
    const workingDirectory = resolveService('workingDirectory')
    const agent = agents?.get(sessionId)
    if (!agent) throw new Error('当前会话尚未就绪：请稍后重试，或在该会话中重新打开工作驾驶舱')
    if (!workingDirectory) throw new Error('当前运行环境不提供工作目录服务')
    const directory = await workingDirectory.ensure(agent)
    if (!directory) throw new Error('当前会话没有绑定工作区目录')
    const workspace = resolve(directory)
    return { workspace, root: resolve(join(workspace, subdir)) }
  }

  const scope = async (sessionId, { reinitialize = false } = {}) => {
    const { workspace, root } = await dirsFor(sessionId)
    let entry = scopes.get(root)
    if (!entry) {
      entry = { root, workspace, store: null, index: null, ready: false, created: [], sessionId: null }
      scopes.set(root, entry)
    }
    if (sessionId) entry.sessionId = sessionId
    if (!entry.ready || reinitialize) {
      const initialized = await initializeWorkspace(root)
      entry.created = initialized.created
      entry.ready = true
      entry.store = new Store({
        root,
        workspace,
        config: {
          defaultDept: initialized.dept,
          defaultOwner: '我',
        },
      })
      if (entry.index) entry.index.close()
      entry.index = new WorkIndex(entry.store)
      await ensureSelfContact(entry.store)
    }
    if (!entry.index) entry.index = new WorkIndex(entry.store)
    return entry
  }

  const closeAll = () => {
    for (const entry of scopes.values()) entry.index?.close()
  }

  return { dirsFor, scope, closeAll }
}

export function apply(ctx, config = {}) {
  const subdir = String(config.subdir || 'workos')
  // Optional host services: read them with ctx.get (which needs no inject).
  // A plain property read throws in Cordis without inject, so never fall back
  // to Reflect.get — that is what failed activation before.
  const resolveService = name => {
    try {
      return ctx.get(name)
    } catch {
      return undefined
    }
  }
  const resolver = createResolver({ resolveService, subdir })

  registerTools(ctx, resolver)
  registerSkills(ctx, join(import.meta.dirname || dirname(fileURLToPath(import.meta.url)), 'assets'))

  const systemPrompt = resolveService('systemPrompt')
  if (systemPrompt?.section) {
    ctx.effect(() => systemPrompt.section({
      name: 'workos',
      order: 60,
      text: '工作助手（仅当前工作区存在 workos/ 工作档案时生效）：回答与我的工作有关的问题前，先查档案（workos_overview / workos_context / workos_search / workos_read），只依据档案事实，不编造；回答完把新事实写回（workos_update），不等用户提醒。工作舱地图、认路顺序、五步写回与边界见工作区 AGENTS.md 的 workos-agent 段，以及 workos-persona / workos-maintain 两个技能。',
    }))
  }

  const handler = createApi({
    resolver,
    subdir,
    // The connection service is published after this plugin loads, so ask for
    // it per request rather than at apply time.
    authorize: request => {
      const connection = resolveService('connection')
      if (!connection?.requestRejection) return undefined
      try {
        return connection.requestRejection({ headers: request.headers })
      } catch {
        return 403
      }
    },
  })
  for (const sub of ['/health', '/state', '/project', '/act', '/init', '/index', '/reports']) {
    ctx.effect(() => ctx.webServer.register({ kind: 'exact', path: `/workos-api${sub}`, handler }))
  }

  ctx.effect(() => () => resolver.closeAll())
}
