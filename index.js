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
      text: '工作助手（仅当前工作区存在 workos/ 工作档案时生效）：档案是一个项目一个文件夹（work/{部门}/{年}/项目/{项目名}/README.md 是项目主档，事项/ 下每个事项一个 md，日志写在事项文件的 ## 日志 里）；不属于任何项目的临时事项放 work/{部门}/{年}/日常工作/，一个事项一个 md，文件名前缀是添加时的日期时分秒。只用 workos_update 写入，不要手工新建或改名文件：新增事项用 item.add（传 uid = 项目事项；不传 uid 或 uid 0 = 日常工作），改字段 item.update，记日志 item.log.add，补充用 item.log.update。每轮对话先判断这件事属于日常工作还是某个项目：一次性的、没有独立项目目标/节点/交付物的临时工作 → item.add 不传 uid 落到日常工作；否则先查 workos_overview / workos_search 找项目（项目名、人名、事由、时间、部门），能挂现有事项就更新，没有事项就在该项目 item.add，连项目也没有、又确属新工作才 project.create；不要为临时工作造项目，也不要把临时工作硬塞进无关项目。判断完再回答；回答后把新事实、决定、状态变化、他人反馈写成事项日志（前因 → 事件 → 结果 → 关联，一次变更一条，合并同一天同一件事，不写流水账），不要等用户说「记一下」。用户消息出现【工作上下文】时先 workos_context（uid=0 表示日常工作）；标记里的 path 是那条内容在工作区内的相对路径（工作区外的才是绝对路径），可直接按它读文件。要生成日报/周报时，先用 workos_report_data 取数，再用 workos_report_save 写回；个人汇报不传 uid（含日常工作），写回 data/日报 或 data/周报；项目汇报传 uid，写回该项目文件夹的 汇报/日报 或 汇报/周报，且只写该项目。',
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
