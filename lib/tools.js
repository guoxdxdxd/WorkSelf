/**
 * Agent tools for the work assistant.
 *
 * `workos_context` is the center: the cockpit's "加入对话" writes a small tag
 * into the message, the assistant expands it here into the project, the item,
 * its dependencies, the people and their 打交道经验, then answers.
 */

const UPDATE_ACTIONS = [
  'project.create', 'project.update', 'project.delete', 'project.progress.add',
  'item.add', 'item.update', 'item.delete', 'item.log.add', 'item.log.update',
  'contact.add', 'contact.update', 'contact.appendExperience', 'contact.remove',
  'doc.append', 'migrate', 'index.rebuild',
]

function text(value) {
  return [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value, null, 1) }]
}

function truncate(value, limit = 16000) {
  const body = String(value || '')
  return body.length > limit ? `${body.slice(0, limit)}\n…（已截断，共 ${body.length} 字）` : body
}

function output() {
  return {
    schema: { type: 'object', additionalProperties: true },
    render: (_args, value) => text(value),
    presentationMeta: () => ({ card: 'generic', title: '工作驾驶舱' }),
  }
}

export function registerTools(ctx, resolver) {
  const scopeOf = exec => resolver.scope(exec?.agent?.id)

  ctx.tools.register({
    name: 'workos_overview',
    description:
      '当前工作区的工作助手总览：在办事项（含项目与日常工作）、最近事项日志、项目进度、联系人数量。给用户做判断前先调用一次了解全局。',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
    output: output(),
    isConcurrencySafe: () => true,
    async execute(_args, exec) {
      const scope = await scopeOf(exec)
      const state = await scope.store.state()
      return {
        ok: true,
        root: state.root,
        stats: state.stats,
        projects: state.projects.map(project => ({
          uid: project.uid, name: project.name, status: project.statusLabel, goal: project.goal,
          progress: project.progress, openCount: project.openCount, overdueCount: project.overdueCount,
          blockedCount: project.blockedCount, end: project.end, stallDays: project.stallDays,
        })),
        daily: (state.daily?.items || []).slice(0, 10).map(item => ({
          uid: 0, project: '日常工作', itemId: item.itemId, title: item.title,
          status: item.status, owner: item.owner, due: item.due, stamp: item.stamp,
          remainingText: item.remainingText, logCount: item.logCount,
        })),
        focus: state.workbench.focus.slice(0, 10).map(item => ({
          uid: item.uid, project: item.projectName, itemId: item.itemId, title: item.title,
          status: item.status, owner: item.owner, due: item.due, remainingText: item.remainingText,
          blocked: item.blocked, blockedBy: item.blockedBy.map(dep => dep.itemId),
        })),
        recentLogs: state.workbench.recentLogs.slice(0, 6),
      }
    },
  })

  ctx.tools.register({
    name: 'workos_context',
    description:
      '展开一条「工作上下文」：项目目标与进展、指定事项的全部字段与日志、依赖事项状态、负责人与涉及人员的资料和「打交道经验」、这些人手上的其他事项。uid=0 表示日常工作（不属于任何项目）；返回值带项目 README 与事项文件的完整路径。用户消息里出现【工作上下文】时，先调用它拿到最新数据再回答，不要凭消息里的摘要回答。',
    parameters: {
      type: 'object',
      properties: {
        uid: { type: 'number', description: '项目 uid；日常工作传 0；只问某个人时可省略。' },
        itemId: { type: 'string', description: '事项 id，如 w3（项目）或 d1（日常工作）；只问项目时省略。' },
        logIndex: { type: 'number', description: '只聚焦某一条日志时的序号（从 0 开始，0 为最新）。' },
        person: { type: 'string', description: '只问某个人时的姓名。' },
      },
      additionalProperties: false,
    },
    output: output(),
    isConcurrencySafe: () => true,
    async execute(args, exec) {
      const scope = await scopeOf(exec)
      if (args?.uid === undefined && !args?.person) throw new Error('需要 uid 或 person')
      return scope.store.context({
        uid: args?.uid === undefined ? undefined : Number(args.uid),
        itemId: args?.itemId ? String(args.itemId) : undefined,
        logIndex: args?.logIndex === undefined ? undefined : Number(args.logIndex),
        person: args?.person ? String(args.person) : undefined,
      })
    },
  })

  ctx.tools.register({
    name: 'workos_query',
    description: '结构化查询当前工作区的派生索引：projects / items / logs / contacts。需要精确筛选（状态、项目、年份、关键词）时用它，不要拿全文检索代替结构查询。',
    parameters: {
      type: 'object',
      properties: {
        kind: { type: 'string', enum: ['projects', 'items', 'logs', 'contacts'], description: '查询对象。' },
        uid: { type: 'number', description: '项目 uid（items/logs 用）。' },
        itemId: { type: 'string', description: '事项 id（logs 用）。' },
        status: { type: 'string', description: '状态过滤。' },
        projectType: { type: 'string', description: '项目类型（projects 用）。' },
        year: { type: 'number', description: '年份（projects 用）。' },
        from: { type: 'string', description: '日志起始日 YYYY-MM-DD（logs 用）。' },
        to: { type: 'string', description: '日志结束日 YYYY-MM-DD（logs 用）。' },
        keyword: { type: 'string', description: '姓名/公司/负责事项/经验关键词（contacts 用）。' },
        limit: { type: 'number', description: '返回条数，默认 50。' },
      },
      required: ['kind'],
      additionalProperties: false,
    },
    output: output(),
    isConcurrencySafe: () => true,
    async execute(args, exec) {
      const scope = await scopeOf(exec)
      const result = await scope.index.query(String(args?.kind || ''), args || {})
      if (!result.ok) throw new Error(result.error || '查询失败')
      return result
    },
  })

  ctx.tools.register({
    name: 'workos_search',
    description:
      '全文检索当前工作区的整个工作档案（项目、事项、日志、联系人经验、通用经验）。中文支持两字词。',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: '关键词，如「杨总」「展位 物流」「报销 流程」。' },
        limit: { type: 'number', description: '返回条数，默认 12。' },
        kind: { type: 'string', description: '可选：project、archive、contacts 等。' },
      },
      required: ['query'],
      additionalProperties: false,
    },
    output: output(),
    isConcurrencySafe: () => true,
    async execute(args, exec) {
      const scope = await scopeOf(exec)
      return scope.index.search(String(args?.query || ''), { limit: Number(args?.limit) || 12, kind: String(args?.kind || '') })
    },
  })

  ctx.tools.register({
    name: 'workos_read',
    description:
      '读取当前工作区的一份 Markdown 原文：给 uid 读项目 README（并返回事项文件清单），给 uid + itemId 读某个事项自己的文件（字段 + 详情 + 日志），给 itemId（d 开头）读日常工作事项，给 path 读任意档案（data/经验.md 等）。',
    parameters: {
      type: 'object',
      properties: {
        uid: { type: 'number', description: '项目 uid；日常工作传 0；只给 path / itemId 时可省略。' },
        itemId: { type: 'string', description: '事项 id，如 w3（项目）或 d1（日常工作）；给了就返回该事项文件的原文。' },
        path: { type: 'string', description: '相对工作档案根目录的路径，如 data/经验.md。' },
      },
      additionalProperties: false,
    },
    output: output(),
    isConcurrencySafe: () => true,
    async execute(args, exec) {
      const scope = await scopeOf(exec)
      if (args?.uid !== undefined || (args?.itemId && !args?.path)) {
        const uid = Number(args.uid) || 0
        if (args?.itemId) {
          const item = await scope.store.readItem(uid, String(args.itemId))
          const { text, ...rest } = item
          return { ...rest, content: truncate(text) }
        }
        const { entry } = await scope.store.findProject(uid)
        const project = await scope.store.loadProjectFile(entry)
        if (!project) throw new Error(`项目 ${uid} 读取失败`)
        return {
          ok: true,
          uid: project.uid,
          name: project.name,
          relPath: project.relPath,
          absPath: project.absPath,
          relDir: project.relDir,
          items: project.items.map(item => ({
            itemId: item.itemId, title: item.title, status: item.status,
            owner: item.owner, due: item.due, file: item.file, absFile: item.absFile,
          })),
          content: truncate(project.text),
        }
      }
      if (!args?.path) throw new Error('需要 uid、uid + itemId 或 path')
      const doc = await scope.store.readDoc(String(args.path))
      return { ok: true, path: doc.path, content: truncate(doc.text) }
    },
  })

  ctx.tools.register({
    name: 'workos_report_data',
    description:
      '读取某时段的工作事实，专供生成日报/周报：指定时段内的事项日志、项目进展、有活动的项目和在办事项。生成汇报前先调用它取数，再调用 workos_report_save 写回。period 支持 today / this_week / last_week；也可以直接给 date（单日）或 start + end（区间）。不传 uid 汇总全部项目与 日常工作（个人汇报）；传 uid 只取该项目（项目汇报）。',
    parameters: {
      type: 'object',
      properties: {
        uid: { type: 'number', description: '只汇总某个项目时传项目 uid（项目汇报）；省略则汇总全部项目（个人汇报）。' },
        type: { type: 'string', enum: ['daily', 'weekly'], description: '日报或周报；省略时按日期范围推断。' },
        period: { type: 'string', enum: ['today', 'this_week', 'last_week'], description: '相对时段；与 date / start / end 二选一。' },
        date: { type: 'string', description: '单日 YYYY-MM-DD。' },
        start: { type: 'string', description: '起始日 YYYY-MM-DD（含）。' },
        end: { type: 'string', description: '结束日 YYYY-MM-DD（含）。' },
      },
      additionalProperties: false,
    },
    output: output(),
    isConcurrencySafe: () => true,
    async execute(args, exec) {
      const scope = await scopeOf(exec)
      return scope.store.reportData(args || {})
    },
  })

  ctx.tools.register({
    name: 'workos_report_save',
    description:
      '把一份日报/周报写回工作档案。个人汇报（不传 uid）写 data/日报/YYYY-MM-DD.md 或 data/周报/起始_结束.md；项目汇报（传 uid）写项目文件夹下的 汇报/日报 或 汇报/周报。生成时间由工具自动记录，正文含汇报时段、简介、详细内容。必须基于 workos_report_data 返回的事实写，不要编造；只写汇报，不改工作事项。',
    parameters: {
      type: 'object',
      properties: {
        uid: { type: 'number', description: '项目汇报传该项目 uid，文件写进该项目文件夹的 汇报/ 下；省略则写个人汇报到 data/日报|周报。' },
        type: { type: 'string', enum: ['daily', 'weekly'], description: '日报或周报；省略时按日期范围推断。' },
        period: { type: 'string', enum: ['today', 'this_week', 'last_week'], description: '相对时段；与 date / start / end 二选一。' },
        date: { type: 'string', description: '单日 YYYY-MM-DD。' },
        start: { type: 'string', description: '起始日 YYYY-MM-DD（含）。' },
        end: { type: 'string', description: '结束日 YYYY-MM-DD（含）。' },
        summary: { type: 'string', description: '简介：2-3 句，概括最重要的进展、卡点和下一步。' },
        detail: { type: 'string', description: '详细内容：按项目/事项写清做了什么、结果、卡点、下一步。' },
        source: { type: 'string', enum: ['manual', 'auto'], description: '手动生成或自动生成，默认 manual。' },
      },
      required: ['summary', 'detail'],
      additionalProperties: false,
    },
    output: output(),
    isConcurrencySafe: () => false,
    async execute(args, exec) {
      const scope = await scopeOf(exec)
      const result = await scope.store.saveReport(args || {})
      await scope.index.sync({ force: true })
      return {
        ...result,
        note: `已写回 ${result.path}；汇报卡片刷新即可看到，也可以在对话里继续让用户补充。`,
      }
    },
  })

  ctx.tools.register({
    name: 'workos_update',
    description:
      '写回当前工作区的工作档案（不手工新建或改名文件；汇报另用 workos_report_save）。项目事项传 uid；日常工作事项不传 uid（或 uid=0），写到 日常工作/。item.add 建事项文件并更新 README 索引，item.update 改字段，item.log.add 记日志，item.log.update 改原日志，contact.add / contact.update / contact.appendExperience 补联系人，contact.remove 删除联系人（先说明影响并征得同意），project.progress.add 记阶段进展，doc.append 追加档案段落。归属判断、日志写法、状态默认「进行中」等归档规则见工作区 AGENTS.md 与 workos-maintain 技能；删除项目 / 事项 / 联系人前必须让用户明确确认。',
    parameters: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: UPDATE_ACTIONS, description: '动作。删除项目/事项/联系人前必须让用户明确确认。' },
        uid: { type: 'number', description: '项目 uid；日常工作事项传 0 或省略（仅 item.add / item.update / item.log.add / item.log.update / item.delete）。' },
        name: { type: 'string', description: '项目名 / 联系人姓名。' },
        itemId: { type: 'string', description: '事项 id，如 w3（项目）或 d1（日常工作）。' },
        id: { type: 'string', description: '联系人 id，如 c1。' },
        title: { type: 'string', description: '事项名称。' },
        detail: { type: 'string', description: '事项详情。' },
        status: { type: 'string', description: '事项状态：未开始/进行中/等待反馈/已完成/已关闭/暂停；新建事项默认「进行中」，只有用户明确说已完成或已在界面点成「已完成」才写「已完成」；项目用 doing/done/closed/paused。' },
        due: { type: 'string', description: '到期日 YYYY-MM-DD。' },
        owner: { type: 'string', description: '负责人姓名（需在联系人中，或会被自动创建）。' },
        participants: { type: 'array', items: { type: 'string' }, description: '涉及人员姓名数组（项目、事项都可以用）。' },
        deps: { type: 'array', items: { type: 'string' }, description: '依赖的事项 id 数组（必须属于同一项目）。' },
        event: { type: 'string', description: '日志事件：谁/什么时候/发生了什么。写前先读该事项已有日志，承接前因、点名关联，不写流水账。' },
        solution: { type: 'string', description: '日志解决方案：怎么处理、结果如何、下一步与检查点，以及牵动的人/依赖/项目。' },
        logIndex: { type: 'number', description: '要修改的日志序号（workos_context 返回的 index，0 为最新）；item.log.update 用。' },
        time: { type: 'string', description: '日志时间 YYYY-MM-DD HH:mm，默认现在。' },
        text: { type: 'string', description: '经验/进展/追加段落的内容。' },
        experience: { type: 'string', description: '联系人的打交道经验（contact.update 用）。' },
        path: { type: 'string', description: 'doc.append 的目标文件。' },
        section: { type: 'string', description: 'doc.append 的段落。' },
        start: { type: 'string' }, end: { type: 'string' },
        goal: { type: 'string', description: '项目目标（一句话 + 硬节点）。' },
        overview: { type: 'string', description: '项目背景。' },
        projectType: { type: 'string' }, priority: { type: 'string' },
        patch: { type: 'object', additionalProperties: true, description: '项目/事项/联系人字段补丁。' },
      },
      required: ['action'],
      additionalProperties: false,
    },
    output: output(),
    isConcurrencySafe: () => false,
    async execute(args, exec) {
      const scope = await scopeOf(exec)
      const action = String(args?.action || '')
      if (!UPDATE_ACTIONS.includes(action)) throw new Error(`不支持的动作：${action}`)
      if (action === 'index.rebuild') return { ok: true, stats: await scope.index.sync({ force: true }) }
      const payload = { ...args }
      delete payload.action
      const result = await scope.store.apply(action, payload)
      await scope.index.sync({ force: true })
      return { ...result, note: '已写回 Markdown，驾驶舱页面刷新即可看到' }
    },
  })
}
