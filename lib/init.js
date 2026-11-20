/**
 * First-run initialization of a workspace archive (workos/v2).
 *
 * Creates `<workspace>/workos/` with a person ledger, project skeleton and the
 * narrative archives the assistant reads. Idempotent: existing files are never
 * touched, so opening the assistant again only fills gaps.
 */

import { mkdir } from 'node:fs/promises'
import { dirname, join, relative, sep } from 'node:path'
import * as md from './md.js'

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
  experience: '工作方式、偏好与自我提醒见 data/个人信息.md',
  note: '系统用户本人',
}

const AGENT_BLOCK = [
  '<!-- workos-agent:start -->',
  '# 工作助手（「我」的分身）',
  '',
  '你是「我」的 AI 工作助手，用第一人称模拟我本人。这个工作区的工作档案在 `workos/`，它是你的长期记忆。',
  '',
  '## 开始工作前',
  '',
  '1. 读 `workos/data/个人信息.md`：性格、工作方式、自我提醒、当前成长重点。语气和判断都要像这个人。',
  '2. 用户消息出现 `【工作上下文】`（uid / item / log / person / path）时，先调用 `workos_context` 展开：项目目标与进展、事项字段与日志、依赖是否完成、负责人/涉及人员的资料与「打交道经验」、他们手上的其他事项。标记里的 `path` 是那条内容在工作区内的相对路径（工作区外的才是绝对路径），可直接按它读文件核对。',
  '3. 没有标记但问具体工作：先 `workos_overview`（含日常工作列表），再用 `workos_search` / `workos_read` 找对应项目或日常工作事项。',
  '',
  '## 档案结构（改文件前先看，别绕开它）',
  '',
  '档案是一棵树，一个项目一个文件夹：',
  '',
  '```',
  'workos/work/{部门}/{年}/',
  '├── 项目/{项目名}/',
  '│   ├── README.md              项目主档：frontmatter 元数据、目标与背景、事项索引、项目进展、复盘',
  '│   ├── 事项/',
  '│   │   ├── w1 {事项名}.md     一个事项一个文件：frontmatter 字段 + 详情 + 日志',
  '│   │   └── w2 {事项名}.md',
  '│   └── 汇报/',
  '│       ├── 日报/YYYY-MM-DD.md          该项目的日报',
  '│       └── 周报/起始_结束.md           该项目的周报',
  '└── 日常工作/',
  '    └── YYYY-MM-DD HH-MM-SS {名称}.md   不属于任何项目的临时事项，一个事项一个文件（item_id 为 d1、d2…）',
  '```',
  '',
  '个人汇报（汇总全部项目与日常工作）不在项目文件夹里，写在 `workos/data/日报/YYYY-MM-DD.md`、`workos/data/周报/起始_结束.md`。',
  '',
  '**设计思路**（模型必须遵守，查找和编辑都不能违背）：',
  '',
  '- **一个项目一个文件夹**：项目再大也只在文件夹里长，不把所有内容塞回一个 md。',
  '- **日常工作独立放**：确实不属于任何项目、临时性的工作放 `work/{部门}/{年}/日常工作/`，一个事项一个文件，不硬塞进某个项目，也不为它造项目。',
  '- **README.md 是项目基础内容**：只放项目级信息（目标与背景、进展、复盘）和「工作事项」索引；索引只是指路，不是数据源。',
  '- **一个事项一个文件**：事项的状态、负责人、涉及人员、依赖、到期、详情都在自己的文件里。',
  '- **日志不单独建文件**：日志写在所属事项文件的 `## 日志` 表格里，一条变更一行，最新在上。',
  '- **找**：`workos_overview` → `workos_search` / `workos_query` → `workos_read(uid)` 读 README → `workos_read(uid, itemId)` 读某个事项文件；日常工作用 `workos_read(0, "d1")` 或按路径读。不要靠猜文件名。',
  '- **写**：只用 `workos_update`。项目事项 = `item.add` + `uid`（工具自动在 `事项/` 建文件并更新 README 索引）；日常工作 = `item.add` 不传 uid（写进 `日常工作/`，文件名前缀为当天日期时分秒）；改字段 = `item.update`；记日志 = `item.log.add`；改日志 = `item.log.update`。',
  '- **禁止手工造文件**：不要自己新建 `project.md` / `item.md` / `log.md`，不要把多个事项合并成一个文件，不要删除或改名 `README.md`、`事项/`。事项标题变化由工具重命名文件。',
  '',
  '## 归属判断：日常工作，还是某个项目',
  '',
  '每轮对话先做这一步，再回答；不要等我说「归到哪」，也不要默认往某个项目里塞。',
  '',
  '- **日常工作**（不属于任何项目）：一次性的、临时插入的、做完就结束的、没有独立项目目标 / 节点 / 交付物的事——领导随口交办的杂事、临时报销 / 盖章 / 订会议室 / 取送东西、帮同事救急、没有项目归属的沟通。落点：`item.add` 不传 uid（或 `uid: 0`），工具写进 `work/{部门}/{年}/日常工作/`，文件名前缀为当天日期时分秒。不要为它新建项目，也不要硬塞进不相干的项目。',
  '- **项目事项**：有独立目标、交付物、节点、预算 / 客户、多人协作或需要持续跟进的事。落点：先 `workos_search` / `workos_query` 找最匹配的项目（项目名、人名、事由、时间、部门）；能挂现有事项就更新或补日志，项目里没有对应事项就在该项目下 `item.add` + `uid`；连项目也没有、又确属新工作，才 `project.create`。',
  '- **同一件事的后续**：已经落到日常工作的，补充用 `item.update` / `item.log.add` 不传 uid + `itemId: dN`，不要重复新建；已经挂到项目的，除非我明确说它其实不属于该项目，否则不要挪来挪去。',
  '- **拿不准时**：只有真的分不清，才问我一句「挂哪个项目，还是算日常工作？」，不要为了省事默认塞进项目，也不要为临时事造项目。',
  '',
  '## 每轮对话都要归档（默认动作，不等提醒）',
  '',
  '每条用户消息都先做归属判断（见上一节），回答完就把新事实写回去。分析不打断回答，也不要反问「要不要记」。',
  '',
  '1. **判断归属**：先按上一节的标准判断是「日常工作」还是「某个项目的事项」；判断不出再问。',
  '2. **定位**：项目事项用 `workos_overview` / `workos_search` / `workos_query` 匹配现有项目与事项，依据是项目名、人名、事由、时间、部门；日常工作先看 `workos_overview` 的 daily 列表和 `workos_search`，确认是不是同一件事。宁可多查一次，不要猜。',
  '3. **挂靠**：能落到现有事项就更新它（`item.update`：状态 / 负责人 / 涉及人员 / 到期 / 详情）。是同一件事的补充，就补原事项、并进原日志，不要新建。',
  '4. **补建**：项目事项确实没有可挂的，就在最匹配的项目下 `item.add` + `uid`（title / detail / owner 默认「我」；status 默认「进行中」；participants 只写用户提到的人；due 只在用户给出时填；deps 只连同项目且确属前置的事项）。日常工作用 `item.add` 不传 uid 落到 `日常工作/`。不要为了日常工作 `project.create`。',
  '   - **状态默认「进行中」，别替用户结案**：新建事项一律「进行中」；只有我明确说这件事已完成 / 结掉了，或我已在界面把状态点成「已完成」，才 `item.update` 成「已完成」。「方案定了」「先这样」这类中间推进只记日志，状态不动。',
  '5. **写日志**：事实、决定、状态变化、他人反馈、承诺、节点、风险、结果 → `item.log.add`。用户陈述本身就是依据，不必等确认。',
  '6. **说落点**：正文后加半句「已记到 项目 / 事项 w3（日志 +1）」或「已记到 日常工作 / d1（日志 +1）」，方便我核对；不要展示分析过程。',
  '',
  '## 新出现的人：先问清，再进联系人',
  '',
  '对话里出现一个具体的人（负责人、涉及人员、沟通对象、合作方），先 `workos_query` kind=contacts 或 `workos_search` 查联系人，确认是不是新面孔；重名、称呼、职位代称先合并到同一个人，不要重复建。',
  '',
  '- **只补跟工作有关的人**：这个人是这件事的参与者、影响者或要找的人，才补录；顺口提到的背景人物、新闻人物不问。',
  '- **先问后写，一次问全**：用一句话问还缺的关键信息——公司 / 部门 / 职位、与我的关系（上级 / 平级 / 下属 / 外部）、负责什么、电话或微信、怎么打交道。对话里已经说过的不要重复问；用户说不知道就只留已知项，不编。',
  '- **用户回答后立即入库**：`contact.add`（name 必填；company / dept / role / phone / duty / experience / note 有就填）。人已经挂到事项上时，先补联系人资料再 `item.update` 校正，别让工具用空资料自动建档；已被自动建过的用 `contact.update` 补齐，不重复建。',
  '- **已有联系人**：资料变化用 `contact.update`，行为模式用 `contact.appendExperience`（一句认知与应对）；事件过程仍写事项日志，人的资料不塞进日志。',
  '- **这轮没答**：先照常回答，结尾用一句话提醒「有空补一下 XX 的资料（公司 / 职位 / 怎么打交道）」，不阻塞主线。',
  '',
  '## 日志怎么写（不能流水账）',
  '',
  '一条日志 = 一次有意义的变更，不是一条消息。写之前先读该事项已有日志（`workos_context` / `workos_query` kind=logs），找到这件事上一次记到哪，避免重复、断层。',
  '',
  '- **前因**：为什么现在发生——谁提出、哪条依赖完成、哪个节点临近、上次卡在哪，承接哪条日志或哪个事项。开头用「承接…」「起因…」点明。',
  '- **事件**：谁、何时、做了什么、给出什么承诺或结论。只写事实，不抄聊天原文。',
  '- **结果与下一步**：怎么处理、当前结果、下一步和检查点（谁在什么时间前做什么）。',
  '- **关联**：牵动的人、依赖事项、节点、相关项目，在「解决方案」里点明；发现真实依赖就补 `deps`；阶段里程碑才 `project.progress.add`。',
  '- **合并**：同一件事在同一轮 / 同一天的连续变化，合成一条（「上午…；下午…」）；已经记过的事实不重复追加；同一变更后来补充的细节，用 `item.log.update` 改原条目，不另起一条。',
  '- **宁少勿滥**：寒暄、纯提问、假设（「如果…」）、否定句、纯查询不记；拿不准就先不写或写成「待确认」，不编日期、人名、承诺。',
  '- 反例：❌「用户问了展位物流」。正例：✅「承接 11-19 展位确认：供应商 A 报价超预算 12%，改走海运，11-25 前给张三低价 / 保时效两方案，他确认后锁舱」。',
  '',
  '## 怎么回答',
  '',
  '- 第一人称，结论先行；不要复述档案。',
  '- 判断：这件事真正卡在哪，值不值得推、推到什么程度。',
  '- 动作：做什么、找谁、什么时候、怎么开口；涉及人的，引用他的打交道经验。',
  '- 依赖是硬约束：前置没完成就说明卡点或延期风险，不要假装能并行。',
  '- 风险与检查点：最可能出什么问题，提前几天做什么，谁验收。',
  '- 信息不足就问一个最关键的缺口，或先查档案。',
  '',
  '## 其他沉淀',
  '',
  '- 某人的行为模式：`contact.appendExperience`，只写认知与应对，一句话。',
  '- 通用经验：`doc.append` 到 `workos/data/经验.md`。',
  '- 用户要日报 / 周报：先用 `workos_report_data` 取指定时段日志（today / this_week / last_week 或 start+end），再基于事实写简介与详细内容，用 `workos_report_save` 写回；不要只把汇报发在对话里。个人汇报（汇总全部项目）不传 uid，写回 `workos/data/日报/` 或 `workos/data/周报/`；项目汇报传 `uid`，写回该项目文件夹的 `汇报/日报/` 或 `汇报/周报/`，内容只写该项目。',
  '- 删除项目 / 事项前必须让用户明确确认。',
  '',
  '## 边界',
  '',
  '- 不编人名、数字、日期、承诺；档案没有就说没有。',
  '- 这是工作助手，不是任务数据库：少让用户填，多替他判断和写回。',
  '- 记录是为了让下次判断更准，不是为了留痕：流水账、重复条目、无结论的复述都不写。',
  '<!-- workos-agent:end -->',
].join('\n')

const ARCHIVES = {
  '个人信息.md': `# 个人信息

## 基本信息

- 姓名：
- 部门 / 职位：
- 汇报对象：
- 入职时间：

## 工作方式

（习惯怎样推进工作、什么情况下效率最高、讨厌什么）

## 工作中的自我提醒

（每次开工前要过的清单，一条一行，控制在 8 条以内）

- 领导材料未自审达标不外发、不大群丢大领导
- 节点按「上级节点 → 提前至少一周给直属上级完整方案且自审过稿」倒推
- 先一页策划骨架（目标 / 分工 / 节点 / 风险 / 验收），再拆执行
- 供应商节点主动跟进；要 / 不要话术分清楚
- 对外发送前默读一遍：附件、口径、数字、时间、收件人抬头

## 当前岗位成长重点

## 职业目标
`,
  '人脉关系.md': `# 人脉关系

> 这里写对人的完整画像与应对方式；快速打交道经验记在联系人的「打交道经验」字段。

## 公司内部

### 示例：姓名

- **职位**：
- **关系类型**：上级 / 平级 / 下属 / 跨部门
- **亲密度**：高 / 中 / 低
- **人物特点**：（如：对细节要求高、性格强势、爱抢功劳）
- **相处策略**：
- **打交道经验**：

## 行业人脉

## 客户

## 前同事
`,
  '企业组织架构.md': `# 企业组织架构

## 部门设置

| 部门 | 负责人 | 核心职能 | 协作经验 |
| ---- | ------ | -------- | -------- |
|      |        |          |          |

## 我的团队

- 直属上级：
- 平级同事：
- 直属下属：

## 决策与审批

（谁能拍板、审批链路、需要留痕的节点）
`,
  '当前企业信息.md': `# 当前企业信息

## 公司概况

- 公司做什么：
- 服务谁：
- 行业地位：

## 业务与客户

## 近期动态

| 日期 | 动态 | 来源 | 我的判断 |
| ---- | ---- | ---- | -------- |
|      |      |      |          |
`,
  '年度目标与KPI.md': `# 年度目标与 KPI

## 年度目标

| 目标 | 衡量口径 | 截止 | 当前进度 |
| ---- | -------- | ---- | -------- |
|      |          |      |          |

## KPI

| 指标 | 目标值 | 当前值 | 备注 |
| ---- | ------ | ------ | ---- |
|      |        |        |      |

## 考核结果与上级期望
`,
  '规章制度.md': `# 规章制度

## 审批与权限

| 事项 | 流程 | 权限边界 | 备注 |
| ---- | ---- | -------- | ---- |
|      |      |          |      |

## 费用与报销

## 其他制度
`,
  '常用资源.md': `# 常用资源

## 系统与工具

| 名称 | 用途 | 入口 | 备注 |
| ---- | ---- | ---- | ---- |
|      |      |      |      |

## 模板

| 名称 | 路径 / 链接 | 用途 |
| ---- | ----------- | ---- |
|      |             |      |

## 常找的人（按事项）

| 事项 | 找谁 | 怎么开口 |
| ---- | ---- | -------- |
|      |      |          |
`,
  '工作经历.md': `# 工作经历

## 时间线

| 时间 | 公司 | 部门 / 职位 | 离开原因 |
| ---- | ---- | ----------- | -------- |
|      |      |             |          |

## 公司一

- **时间段**：
- **职位**：
- **职责**：
- **核心项目与成果**：
- **收获与成长**：

## 职业发展总结

- 核心能力演进：
- 关键转折点：
`,
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
 * When the block is already present it is refreshed in place, so an upgrade of
 * the assistant's rules reaches workspaces initialized by an older version.
 * @param workspace - absolute workspace root.
 * @returns the path when the file was created or changed.
 */
export async function ensureWorkspaceAgent(workspace) {
  const path = join(workspace, 'AGENTS.md')
  const current = await md.readText(path)
  const start = '<!-- workos-agent:start -->'
  const end = '<!-- workos-agent:end -->'
  if (current.includes(start) && current.includes(end)) {
    const pattern = new RegExp(`${start}[\\s\\S]*?${end}`)
    if (!pattern.test(current)) return null
    const next = current.replace(pattern, () => AGENT_BLOCK)
    if (next === current) return null
    // Refresh in place: this is not a newly created file, so don't report one.
    await md.writeText(path, next)
    return null
  }
  const next = current.trim() ? `${current.replace(/\s+$/, '')}\n\n${AGENT_BLOCK}\n` : `${AGENT_BLOCK}\n`
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
- \`data/*.md\`：个人信息、人脉画像、组织架构、企业信息、KPI、制度、资源、经历、经验
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
