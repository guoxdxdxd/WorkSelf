/**
 * Work assistant — browser half.
 *
 * A right-sidebar tab that models the workspace as a work environment: projects
 * with goals, items with people/dependencies/logs, and contacts with
 * 打交道经验. Every item, log and person can be pushed into the conversation as
 * a 【工作上下文】 tag; the assistant expands it with workos_context and writes
 * decisions back.
 */

window.__ModuleLoader__.load({
  id: 'workself',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const NS = 'workos'
    const TYPE_ID = 'workself'
    const KIND = 'workos'

    const ITEM_STATUSES = ['未开始', '进行中', '等待反馈', '已完成', '已关闭', '暂停']
    const PROJECT_STATUSES = [['doing', '进行中'], ['done', '已完成'], ['closed', '已关闭'], ['paused', '暂停']]
    const PROJECT_TYPES = ['展会', '活动', '公众号', 'PPT', '招投标', '品牌建设', '其他', '自定义']

    const DICTS = {
      zh: {
        nav: '工作驾驶舱',
        guide: '项目、事项、人和经验；把任意一条加入对话，让 AI 结合你的环境给建议',
        tabHome: '工作台',
        tabProjects: '项目',
        tabPeople: '联系人',
        tabSettings: '设置',
        refresh: '刷新',
        empty: '暂无数据',
        loading: '读取工作区…',
      },
      en: {
        nav: 'Work cockpit',
        guide: 'Projects, items, people and experience; push any of them into the chat for advice grounded in your environment',
        tabHome: 'Home',
        tabProjects: 'Projects',
        tabPeople: 'People',
        tabSettings: 'Settings',
        refresh: 'Refresh',
        empty: 'Nothing here',
        loading: 'Reading workspace…',
      },
    }

    const CSS = `
.wo-root{position:relative;display:flex;flex-direction:column;height:100%;min-height:0;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font-size:12px;line-height:1.5;container-type:inline-size;container-name:wo}
.wo-top{display:flex;align-items:center;gap:8px;padding:10px 12px 6px;flex:none}
.wo-brand{font-size:13px;font-weight:600;white-space:nowrap}
.wo-path{flex:1;min-width:0;font-size:11px;color:var(--dsw-alias-label-secondary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.wo-nav{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:4px;padding:2px 10px 8px;flex:none}
.wo-nav button{appearance:none;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-secondary);border-radius:7px;padding:4px 2px;font-size:11px;font-family:inherit;cursor:pointer;white-space:nowrap}
.wo-nav button.on{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-brand-primary);font-weight:600}
.wo-scroll{flex:1;min-height:0;overflow:auto;padding:0 10px 18px}
.wo-stack{display:flex;flex-direction:column;gap:8px}
.wo-card{background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l1);border-radius:10px;overflow:hidden;min-width:0}
.wo-card-head{display:flex;align-items:center;gap:6px;padding:7px 10px;border-bottom:1px solid var(--dsw-alias-border-l1);font-weight:600;font-size:12px}
.wo-caret{border:0;background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer;font-size:11px;padding:0 2px;font-family:inherit;line-height:1}
.wo-card-title{cursor:pointer;user-select:none;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.wo-seg{display:flex;gap:4px;padding:8px 10px 2px}
.wo-seg button{appearance:none;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-secondary);border-radius:6px;padding:2px 8px;font-size:10px;font-family:inherit;cursor:pointer}
.wo-seg button.on{color:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-brand-primary);font-weight:600}
.wo-count{color:var(--dsw-alias-label-secondary);font-weight:400;font-size:11px}
.wo-card-body{padding:2px 0}
.wo-pad{padding:8px 10px}
.wo-row{display:flex;align-items:flex-start;gap:8px;padding:8px 10px;border-bottom:1px solid var(--dsw-alias-border-l1)}
.wo-row:last-child{border-bottom:0}
.wo-row-main{flex:1;min-width:0}
.wo-title{font-weight:500;overflow-wrap:anywhere}
.wo-meta{color:var(--dsw-alias-label-secondary);font-size:11px;display:flex;flex-wrap:wrap;gap:2px 8px;margin-top:2px}
.wo-muted{color:var(--dsw-alias-label-secondary)}
.wo-link{color:var(--dsw-alias-brand-primary);cursor:pointer}
.wo-empty{padding:14px 10px;color:var(--dsw-alias-label-secondary);font-size:11px;text-align:center}
.wo-tiles{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:6px}
.wo-tile{background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l1);border-radius:9px;padding:7px 8px;min-width:0}
.wo-tile-label{font-size:10px;color:var(--dsw-alias-label-secondary);display:flex;align-items:center;gap:4px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.wo-dot{width:6px;height:6px;border-radius:50%;flex:none}
.wo-metric{font-size:20px;font-weight:600;line-height:1.25;margin-top:2px;font-variant-numeric:tabular-nums}
.wo-btn{appearance:none;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);border-radius:7px;padding:4px 9px;font-size:11px;font-family:inherit;cursor:pointer;white-space:nowrap}
.wo-btn:hover{border-color:var(--dsw-alias-border-l2)}
.wo-btn:disabled{opacity:.5;cursor:default}
.wo-btn.primary{background:var(--dsw-alias-brand-primary);border-color:transparent;color:#fff}
.wo-btn.ghost{background:transparent}
.wo-btn.danger{color:var(--dsw-alias-state-error-primary)}
.wo-btn.sm{padding:2px 6px;font-size:10px;border-radius:6px}
.wo-btn.block{width:100%;padding:6px}
.wo-actions{display:flex;gap:4px;flex-wrap:wrap;margin-top:5px}
.wo-input,.wo-select,.wo-textarea{background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l1);border-radius:7px;color:var(--dsw-alias-label-primary);padding:4px 7px;font-size:11px;font-family:inherit;min-width:0;width:100%}
.wo-input:focus,.wo-select:focus,.wo-textarea:focus{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:-1px}
.wo-input.sm,.wo-select.sm{width:auto;padding:2px 5px;font-size:10px;border-radius:5px}
.wo-textarea{resize:vertical;min-height:56px}
.wo-form{display:flex;flex-direction:column;gap:6px;padding:8px 10px;border-bottom:1px solid var(--dsw-alias-border-l1)}
.wo-form>.wo-btn{align-self:flex-start}
.wo-bar{display:flex;gap:6px;align-items:center;flex-wrap:wrap}
.wo-bar>.wo-input{flex:1}
.wo-bar>.wo-field{flex:1 1 120px;min-width:0}
.wo-bar>.wo-btn{flex:none}
.wo-chip{display:inline-flex;align-items:center;gap:3px;border:1px solid var(--dsw-alias-border-l1);border-radius:999px;padding:0 6px;font-size:10px;color:var(--dsw-alias-label-secondary);background:var(--dsw-alias-bg-layer-2);white-space:nowrap;line-height:1.6;max-width:100%;overflow:hidden;text-overflow:ellipsis}
.wo-chip.warn{color:var(--dsw-alias-state-warn-primary);border-color:currentColor}
.wo-chip.danger{color:var(--dsw-alias-state-error-primary);border-color:currentColor}
.wo-chip.ok{color:var(--dsw-alias-state-success-primary);border-color:currentColor}
.wo-chip.brand{color:var(--dsw-alias-brand-primary);border-color:currentColor}
.wo-track{height:4px;border-radius:3px;background:var(--dsw-alias-bg-layer-2);overflow:hidden;margin-top:5px}
.wo-track i{display:block;height:100%;background:var(--dsw-alias-brand-primary);border-radius:3px}
.wo-item{padding:8px 10px;border-bottom:1px solid var(--dsw-alias-border-l1);cursor:pointer}
.wo-item:last-child{border-bottom:0}
.wo-item:hover{background:var(--dsw-alias-bg-layer-2)}
.wo-item-top{display:flex;align-items:center;gap:6px;justify-content:space-between}
.wo-item-split{display:flex;align-items:flex-start;gap:8px}
.wo-item-main{flex:1;min-width:0}
.wo-kv{display:grid;grid-template-columns:64px minmax(0,1fr);gap:3px 8px;padding:8px 10px;font-size:11px}
.wo-kv b{font-weight:500;color:var(--dsw-alias-label-secondary);overflow-wrap:anywhere}
.wo-kv span{overflow-wrap:anywhere}
.wo-people{display:flex;flex-wrap:wrap;gap:2px 8px;align-items:baseline}
.wo-person{appearance:none;border:0;background:none;padding:0;font:inherit;color:var(--dsw-alias-brand-primary);cursor:pointer;text-decoration:underline;text-decoration-style:dotted;text-underline-offset:2px;text-align:left}
.wo-person:hover{text-decoration-style:solid}
.wo-person-cell{display:flex;flex-direction:column;gap:1px;min-width:0}
.wo-dep{appearance:none;border:0;background:none;padding:0;font:inherit;cursor:pointer;text-align:left;display:block}
.wo-dep:hover .wo-chip{border-color:var(--dsw-alias-brand-primary);color:var(--dsw-alias-label-primary)}
.wo-pre{margin:0;padding:8px 10px;white-space:pre-wrap;font-family:inherit;font-size:11px;line-height:1.7}
.wo-banner{margin:0 0 8px;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-2);border-radius:8px;padding:6px 9px;font-size:11px;color:var(--dsw-alias-label-secondary);display:flex;gap:6px;align-items:flex-start}
.wo-banner b{color:var(--dsw-alias-label-primary);font-weight:600}
.wo-banner .wo-link{margin-left:auto;flex:none}
.wo-overlay{position:absolute;inset:0;background:rgba(0,0,0,.36);display:flex;align-items:center;justify-content:center;z-index:20;padding:12px}
.wo-modal{background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l2);border-radius:11px;width:100%;max-height:88%;overflow:auto;box-shadow:0 16px 40px rgba(0,0,0,.3)}
.wo-modal-head{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:9px 11px;border-bottom:1px solid var(--dsw-alias-border-l1);font-weight:600}
.wo-modal-body{display:flex;flex-direction:column;gap:8px;padding:10px 11px}
.wo-modal-foot{display:flex;justify-content:flex-end;gap:6px;padding:8px 11px;border-top:1px solid var(--dsw-alias-border-l1)}
.wo-field{display:flex;flex-direction:column;gap:3px;font-size:11px}
.wo-field>span{color:var(--dsw-alias-label-secondary)}
.wo-picker{display:flex;align-items:center;gap:6px;flex-wrap:wrap}
.wo-picked{display:flex;gap:4px;flex-wrap:wrap}
.wo-check{display:flex;gap:7px;align-items:flex-start;padding:5px 2px;font-size:11px;cursor:pointer}
.wo-check input{margin-top:2px}
.wo-check small{display:block;color:var(--dsw-alias-label-secondary)}
.wo-toast{position:absolute;left:50%;bottom:12px;transform:translateX(-50%);background:var(--dsw-alias-bg-overlay);border:1px solid var(--dsw-alias-border-l2);border-radius:8px;padding:6px 12px;font-size:11px;z-index:30;max-width:90%;box-shadow:0 8px 24px rgba(0,0,0,.25)}
.wo-toast.err{color:var(--dsw-alias-state-error-primary)}
.wo-log{padding:7px 10px;border-bottom:1px dashed var(--dsw-alias-border-l1)}
.wo-log:last-child{border-bottom:0}
.wo-log-time{font-size:10px;color:var(--dsw-alias-label-secondary)}
.wo-log-event{font-weight:500;margin-top:1px;overflow-wrap:anywhere}
.wo-log-solution{font-size:11px;margin-top:2px;color:var(--dsw-alias-label-secondary);overflow-wrap:anywhere}
@container wo (min-width: 520px){ .wo-nav{grid-template-columns:repeat(4,minmax(0,1fr))} }
`

    /* ------------------------------------------------------------- helpers */

    function makeRequest(sessionId) {
      const q = `sessionId=${encodeURIComponent(sessionId || '')}`
      return async function request(path, body) {
        const options = body === undefined
          ? { headers: { accept: 'application/json' } }
          : { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json' }, body: JSON.stringify({ sessionId, ...body }) }
        const url = body === undefined ? `/workos-api${path}${path.includes('?') ? '&' : '?'}${q}` : `/workos-api${path}`
        const response = await fetch(url, options)
        let data
        try {
          data = await response.json()
        } catch {
          throw new Error(`接口返回异常（HTTP ${response.status}）`)
        }
        if (!data || data.ok === false) throw new Error(data?.error || `HTTP ${response.status}`)
        return data
      }
    }

    const pad = n => String(n).padStart(2, '0')
    const nowStamp = () => {
      const now = new Date()
      return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}`
    }
    const todayISO = () => {
      const now = new Date()
      return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
    }
    const shortPath = path => String(path || '').split('/').filter(Boolean).slice(-2).join('/')
    const toneOf = item => (item.urgency === 'danger' ? 'danger' : item.urgency === 'warn' ? 'warn' : item.urgency === 'soon' ? 'brand' : '')
    const quote = (text, label, title, detail, body) => ({
      text,
      summary: { label, title, detail: detail || '', body: body || '' },
    })

    /* ---------------------------------------------------------- primitives */

    function Button({ children, onClick, kind, small, disabled, block, title }) {
      const classes = ['wo-btn', kind || '', small ? 'sm' : '', block ? 'block' : ''].filter(Boolean).join(' ')
      return h('button', { type: 'button', className: classes, onClick, disabled, title }, children)
    }

    function Card({ title, count, action, children, defaultOpen = true }) {
      const [open, setOpen] = React.useState(defaultOpen)
      return h('div', { className: 'wo-card' },
        h('div', { className: 'wo-card-head' },
          h('button', {
            type: 'button',
            className: 'wo-caret',
            'aria-expanded': open,
            title: open ? '折叠' : '展开',
            onClick: () => setOpen(value => !value),
          }, open ? '▾' : '▸'),
          h('span', { className: 'wo-card-title', onClick: () => setOpen(value => !value) }, title),
          count !== undefined ? h('span', { className: 'wo-count' }, `· ${count}`) : null,
          h('span', { style: { flex: 1 } }),
          action || null),
        open ? h('div', { className: 'wo-card-body' }, children) : null)
    }

    function Empty({ text }) {
      return h('div', { className: 'wo-empty' }, text || '暂无数据')
    }

    function Chip({ children, tone, title }) {
      return h('span', { className: ['wo-chip', tone || ''].filter(Boolean).join(' '), title }, children)
    }

    function Modal({ title, onClose, children, footer }) {
      React.useEffect(() => {
        const onKey = event => { if (event.key === 'Escape') onClose() }
        document.addEventListener('keydown', onKey)
        return () => document.removeEventListener('keydown', onKey)
      }, [onClose])
      return h('div', { className: 'wo-overlay', onMouseDown: event => { if (event.target === event.currentTarget) onClose() } },
        h('div', { className: 'wo-modal', role: 'dialog', 'aria-modal': 'true' },
          h('div', { className: 'wo-modal-head' }, h('span', null, title), h(Button, { kind: 'ghost', small: true, onClick: onClose }, '✕')),
          h('div', { className: 'wo-modal-body' }, children),
          footer ? h('div', { className: 'wo-modal-foot' }, footer) : null))
    }

    function Field({ label, children }) {
      return h('label', { className: 'wo-field' }, h('span', null, label), children)
    }

    function Track({ value }) {
      return h('div', { className: 'wo-track' }, h('i', { style: { width: `${Math.max(0, Math.min(100, value || 0))}%` } }))
    }

    function MultiPicker({ title, options, value, onChange, onClose }) {
      const [picked, setPicked] = React.useState(() => new Set(value || []))
      const toggle = key => {
        const next = new Set(picked)
        if (next.has(key)) next.delete(key)
        else next.add(key)
        setPicked(next)
      }
      return h(Modal, {
        title,
        onClose,
        footer: [
          h(Button, { key: 'c', kind: 'ghost', onClick: onClose }, '取消'),
          h(Button, { key: 's', kind: 'primary', onClick: () => { onChange([...picked]); onClose() } }, '确定'),
        ],
      },
      options.length === 0 ? h(Empty, { text: '没有可选项' }) : options.map(option => h('label', { className: 'wo-check', key: option.value },
        h('input', {
          type: 'checkbox',
          checked: picked.has(option.value),
          onChange: () => toggle(option.value),
        }),
        h('span', null, option.label, option.sub ? h('small', null, option.sub) : null))))
    }

    /* ------------------------------------------------------- context tags */

    // A tag carries exactly one path: the file the content lives in. A file
    // inside the workspace is addressed relatively (the model runs there), so
    // the tag stays short; only a file outside the workspace keeps its absolute
    // path. The project README is not repeated — workos_context returns it.
    const contextPath = (path, workspace) => {
      const abs = String(path || '')
      const root = String(workspace || '').replace(/[\\/]+$/, '')
      if (!abs || !root) return abs
      return abs.startsWith(`${root}/`) ? abs.slice(root.length + 1) : abs
    }
    const pathTag = (path, workspace) => {
      const shown = contextPath(path, workspace)
      return shown ? ` path="${shown}"` : ''
    }

    function itemContext(project, item, workspace) {
      const deps = (item.deps || []).map(depId => {
        const dep = (item.blockedBy || []).find(entry => entry.itemId === depId)
        return dep ? `${dep.itemId} ${dep.title}（${dep.status}）` : depId
      })
      const lines = [
        `【工作上下文】uid=${project.uid} item=${item.itemId}${pathTag(item.absFile, workspace)}`,
        `项目：${project.name}（${project.statusLabel}${project.goal ? `，目标：${project.goal}` : ''}）`,
        `事项：${item.title}（${item.itemId}，${item.status}${item.due ? `，到期 ${item.due}` : ''}）`,
        item.owner ? `负责人：${item.owner}` : '',
        item.participants.length ? `涉及人员：${item.participants.join('、')}` : '',
        deps.length ? `依赖：${deps.join('；')}` : '',
        item.detail ? `详情：${item.detail}` : '',
      ].filter(Boolean)
      return quote(
        lines.join('\n'),
        '工作上下文',
        project.name,
        `${item.itemId} · ${item.status}${item.due ? ` · ${item.due}` : ''}`,
        item.title,
      )
    }

    /** Standalone (日常工作) item: no project, so uid=0 and the file path carry the context. */
    function dailyItemContext(item, workspace) {
      const lines = [
        `【工作上下文】uid=0 item=${item.itemId}${pathTag(item.absFile, workspace)}`,
        '项目：日常工作（不属于任何项目）',
        `事项：${item.title}（${item.itemId}，${item.status}${item.due ? `，到期 ${item.due}` : ''}${item.stamp ? `，${item.stamp}` : ''}）`,
        item.owner ? `负责人：${item.owner}` : '',
        item.participants.length ? `涉及人员：${item.participants.join('、')}` : '',
        item.detail ? `详情：${item.detail}` : '',
      ].filter(Boolean)
      return quote(lines.join('\n'), '工作上下文', '日常工作', `${item.itemId} · ${item.status}`, item.title)
    }

    function logContext(project, item, log, index, workspace) {
      const text = [
        `【工作上下文】uid=${project.uid} item=${item.itemId} log=${index}${pathTag(item.absFile, workspace)}`,
        `项目：${project.name}`,
        `事项：${item.title}（${item.itemId}，${item.status}）`,
        `日志：${log.time} · ${log.event}`,
        log.solution ? `当时的处理：${log.solution}` : '',
        item.owner ? `负责人：${item.owner}` : '',
        item.participants.length ? `涉及人员：${item.participants.join('、')}` : '',
      ].filter(Boolean).join('\n')
      return quote(text, '工作上下文', project.name, `${log.time} · ${log.event}`, item.title)
    }

    function personContext(contact, contactsPath, workspace) {
      const text = [
        `【工作上下文】person=${contact.id} name=${contact.name}${pathTag(contactsPath, workspace)}`,
        contact.company || contact.role ? `资料：${[contact.company, contact.dept, contact.role].filter(Boolean).join(' · ')}` : '',
        contact.duty ? `负责事项：${contact.duty}` : '',
        contact.phone ? `电话：${contact.phone}` : '',
        contact.experience ? `打交道经验：${contact.experience}` : '打交道经验：（还没有记录）',
      ].filter(Boolean).join('\n')
      return quote(text, '工作上下文', [contact.company, contact.role].filter(Boolean).join(' · '), contact.experience || '暂无打交道经验', contact.name)
    }

    /**
     * Where a contact's name is still referenced. Deletion only removes the
     * contact row; project/item owner fields keep the plain name, so warn with
     * the exact places instead of silently leaving stale owners behind.
     */
    function contactReferences(name, projects = [], dailyItems = []) {
      if (!name) return []
      const out = []
      for (const project of projects || []) {
        if (!project) continue
        if (project.owner === name) out.push(`项目「${project.name}」负责人`)
        if ((project.participants || []).includes(name)) out.push(`项目「${project.name}」涉及人员`)
        for (const item of project.items || []) {
          if (item.owner === name) out.push(`事项 ${item.itemId}「${item.title}」负责人`)
          if ((item.participants || []).includes(name)) out.push(`事项 ${item.itemId}「${item.title}」涉及人员`)
        }
      }
      for (const item of dailyItems || []) {
        if (item.owner === name) out.push(`日常工作 ${item.itemId}「${item.title}」负责人`)
        if ((item.participants || []).includes(name)) out.push(`日常工作 ${item.itemId}「${item.title}」涉及人员`)
      }
      return out
    }

    function projectContext(project, workspace) {
      const text = [
        `【工作上下文】uid=${project.uid}${pathTag(project.absPath, workspace)}`,
        `项目：${project.name}（${project.statusLabel}）`,
        project.goal ? `目标：${project.goal}` : '',
        project.owner ? `负责人：${project.owner}` : '',
        project.participants?.length ? `涉及人员：${project.participants.join('、')}` : '',
        project.end ? `节点：${project.end}` : '',
        `进度：${project.progress}%（${project.doneCount}/${project.total}）`,
      ].filter(Boolean).join('\n')
      return quote(text, '工作上下文', '项目', `${project.statusLabel} · ${project.progress}%`, project.name)
    }

    /* ------------------------------------------------------------- reports */

    const isoOf = date => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
    const addDaysISO = (iso, days) => {
      const date = new Date(`${iso}T00:00:00`)
      date.setDate(date.getDate() + days)
      return isoOf(date)
    }
    const mondayOfISO = iso => {
      const date = new Date(`${iso}T00:00:00`)
      return addDaysISO(iso, -((date.getDay() + 6) % 7))
    }
    const formatRange = (start, end) => start === end ? start : `${start} ~ ${end}`
    const reportKindLabel = type => type === 'daily' ? '日报' : '周报'
    const reportSourceLabel = source => source === 'auto' ? '自动' : '手动'

    const AUTO_REPORT_KINDS = {
      today: { type: 'daily', period: 'today', label: '今天的日报' },
      this_week: { type: 'weekly', period: 'this_week', label: '本周周报（周一至今天）' },
      last_week: { type: 'weekly', period: 'last_week', label: '上周周报（上周一至上周日）' },
    }

    function scopeLabelOf(scope) {
      return scope?.kind === 'project' ? `项目「${scope.name}」` : '个人（全部项目）'
    }

    function manualReportPrompt({ type, start, end }, scope = { kind: 'personal' }) {
      const kind = reportKindLabel(type)
      const range = formatRange(start, end)
      const project = scope.kind === 'project' ? scope : null
      const dataCall = project
        ? `workos_report_data(uid=${project.uid}, type="${type}", start="${start}", end="${end}")`
        : `workos_report_data(type="${type}", start="${start}", end="${end}")`
      const saveCall = project
        ? `workos_report_save(uid=${project.uid}, type="${type}", start="${start}", end="${end}", summary="...", detail="...", source="manual")`
        : `workos_report_save(type="${type}", start="${start}", end="${end}", summary="...", detail="...", source="manual")`
      return [
        project
          ? `【生成项目汇报】请为项目「${project.name}」（uid=${project.uid}）生成 ${range} 的${kind}，并写回该项目文件夹。`
          : `【生成汇报】请生成 ${range} 的${kind}，并写回工作档案。`,
        '',
        `汇报对象：${scopeLabelOf(scope)}`,
        `汇报类型：${kind}`,
        `汇报时段：${range}`,
        '',
        '步骤：',
        `1. 调用 ${dataCall}，获取该时段的事项日志、项目进展和在办事项。只使用工具返回的事实。`,
        project
          ? `2. 只写「${project.name}」这一个项目；不要掺入其他项目的日志或判断。`
          : '2. 按项目组织内容，覆盖该时段所有有日志或进展的项目；不属于项目的事项归到「日常工作」。',
        '3. 写「简介」：2-3 句，概括这段时间最重要的进展、卡点和下一步。',
        '4. 写「详细内容」：按事项组织，写清做了什么、结果、卡点、下一步；该时段没有日志就如实写「本时段没有日志记录」，不要编造人名、数字或承诺。',
        `5. 调用 ${saveCall} 保存。`,
        '6. 保存成功后，用一句话告诉我已生成到哪个文件。',
        '',
        '语气像我自己写的：简洁、具体、可追溯，不写空话套话。',
      ].join('\n')
    }

    function autoReportPrompt(reportKind, scope = { kind: 'personal' }) {
      const spec = AUTO_REPORT_KINDS[reportKind] || AUTO_REPORT_KINDS.today
      const project = scope.kind === 'project' ? scope : null
      const dataCall = project
        ? `workos_report_data(uid=${project.uid}, type="${spec.type}", period="${spec.period}")`
        : `workos_report_data(type="${spec.type}", period="${spec.period}")`
      const saveCall = project
        ? `workos_report_save(uid=${project.uid}, type="${spec.type}", start=<第 1 步返回的 start>, end=<返回的 end>, summary="...", detail="...", source="auto")`
        : `workos_report_save(type="${spec.type}", start=<第 1 步返回的 start>, end=<返回的 end>, summary="...", detail="...", source="auto")`
      return [
        project
          ? `【自动项目汇报】现在是系统当前时间。请为项目「${project.name}」（uid=${project.uid}）生成${spec.label}并写回该项目文件夹。`
          : `【自动汇报】现在是系统当前时间。请生成${spec.label}并写回工作档案。`,
        '',
        `汇报对象：${scopeLabelOf(scope)}`,
        '',
        '步骤：',
        `1. 调用 ${dataCall}，获取对应时段的日志、项目进展和在办事项。只使用工具返回的事实。`,
        project ? `2. 只写「${project.name}」这一个项目，不要掺入其他项目。` : '2. 按项目组织内容；不属于项目的事项归到「日常工作」。',
        '3. 写「简介」：2-3 句，概括最重要的进展、卡点和下一步。',
        '4. 写「详细内容」：按事项组织，写清做了什么、结果、卡点、下一步；该时段没有日志就如实写「本时段没有日志记录」，不要编造人名、数字或承诺。',
        `5. 调用 ${saveCall} 保存；用返回的具体日期，避免跨过午夜时时段漂移。`,
        '6. 保存成功后，用一句话告诉我已生成到哪个文件。',
        '',
        '这是自动生成的汇报，不要修改工作事项或联系人档案。',
      ].join('\n')
    }

    function buildScheduleRequest({ frequency, time, reportKind, workspacePath, scope = { kind: 'personal' } }) {
      const zone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Shanghai'
      const clock = `${/^\d{2}:\d{2}$/.test(time || '') ? time : '18:00'}:00`
      const clockText = clock.slice(0, 5)
      const kind = frequency === 'friday' ? 'friday' : frequency === 'monday' ? 'monday' : 'daily'
      const timing = kind === 'daily'
        ? { kind: 'daily', daily: { time: clock, time_zone: zone } }
        : { kind: 'weekly', weekly: { time: clock, time_zone: zone, weekdays: [kind === 'friday' ? 5 : 1] } }
      const dailyTitle = kind === 'daily'
        ? `工作日报 · 每天 ${clockText}`
        : kind === 'friday'
          ? `工作周报 · 每周五 ${clockText}`
          : `工作周报 · 每周一 ${clockText}`
      const title = scope.kind === 'project' ? `${scope.name} · ${dailyTitle}` : dailyTitle
      return {
        title,
        prompt: autoReportPrompt(reportKind, scope),
        timing,
        target: { kind: 'new_once', create: workspacePath ? { cwd: workspacePath } : {} },
      }
    }

    function ReportCard({ reports, onOpen, onGenerate, onAuto, onRefresh, title = '个人汇报', emptyText }) {
      return h(Card, {
        title,
        count: reports.length,
        action: h('span', { style: { display: 'flex', gap: 4 } },
          h(Button, { small: true, kind: 'primary', onClick: onGenerate }, '生成汇报'),
          h(Button, { small: true, onClick: onAuto }, '自动汇报'),
          onRefresh ? h(Button, { small: true, onClick: onRefresh }, '刷新') : null),
      },
      reports.length === 0
        ? h(Empty, { text: emptyText || '还没有汇报。点「生成汇报」按日期生成日报/周报，或设自动汇报。' })
        : reports.map(report => h('div', { className: 'wo-row', key: report.relPath || `${report.start}-${report.generatedAt}` },
          h('div', { className: 'wo-row-main', style: { cursor: 'pointer' }, onClick: () => onOpen(report) },
            h('div', { className: 'wo-title' }, report.title || `${formatRange(report.start, report.end)} ${reportKindLabel(report.type)}`),
            h('div', { style: { fontSize: 11, color: 'var(--dsw-alias-label-secondary)', marginTop: 2, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' } }, report.summary || '（无简介）'),
            h('div', { className: 'wo-meta' },
              h('span', null, reportKindLabel(report.type)),
              report.scope === 'project' ? h('span', null, report.projectName || '项目') : null,
              h('span', null, formatRange(report.start, report.end)),
              h('span', null, `生成 ${report.generatedAt || '—'}`),
              report.updatedAt && report.updatedAt !== report.generatedAt ? h('span', null, `更新 ${report.updatedAt}`) : null,
              h('span', null, reportSourceLabel(report.source)))),
          h(Button, { small: true, onClick: () => onOpen(report) }, '查看'))))
    }

    function ReportDetailModal({ report, onClose, onSave, busy }) {
      const [editing, setEditing] = React.useState(false)
      const [summary, setSummary] = React.useState(report.summary || '')
      const [detail, setDetail] = React.useState(report.detail || '')
      React.useEffect(() => {
        setSummary(report.summary || '')
        setDetail(report.detail || '')
        setEditing(false)
      }, [report.relPath])
      return h(Modal, {
        title: report.title || `${formatRange(report.start, report.end)} ${reportKindLabel(report.type)}`,
        onClose,
        footer: editing
          ? [
            h(Button, { key: 'c', kind: 'ghost', onClick: () => setEditing(false) }, '取消'),
            h(Button, { key: 's', kind: 'primary', disabled: busy, onClick: () => onSave({ summary: summary.trim(), detail: detail.trim() }) }, '保存'),
          ]
          : [
            h(Button, { key: 'e', kind: 'primary', onClick: () => setEditing(true) }, '编辑'),
            h(Button, { key: 'c', kind: 'ghost', onClick: onClose }, '关闭'),
          ],
      },
      h('div', { className: 'wo-meta' },
        h(Chip, { tone: 'brand' }, reportKindLabel(report.type)),
        h(Chip, null, formatRange(report.start, report.end)),
        h(Chip, null, `生成 ${report.generatedAt || '—'}`),
        report.updatedAt && report.updatedAt !== report.generatedAt ? h(Chip, null, `更新 ${report.updatedAt}`) : null,
        h(Chip, null, reportSourceLabel(report.source))),
      editing
        ? [
          h(Field, { key: 's', label: '简介' }, h('textarea', {
            className: 'wo-textarea', value: summary, onChange: event => setSummary(event.target.value),
          })),
          h(Field, { key: 'd', label: '详细内容' }, h('textarea', {
            className: 'wo-textarea', style: { minHeight: 220 }, value: detail, onChange: event => setDetail(event.target.value),
          })),
        ]
        : [
          h('div', { key: 's' },
            h('div', { style: { fontWeight: 600, fontSize: 11, marginBottom: 3 } }, '简介'),
            h('div', { className: 'wo-pre', style: { padding: 0 } }, report.summary || '（无简介）')),
          h('div', { key: 'd' },
            h('div', { style: { fontWeight: 600, fontSize: 11, marginBottom: 3 } }, '详细内容'),
            h('pre', { className: 'wo-pre', style: { padding: 0, whiteSpace: 'pre-wrap' } }, report.detail || '（无详细内容）')),
        ],
      h('div', { className: 'wo-muted', style: { fontSize: 10, overflowWrap: 'anywhere' } }, report.relPath || ''))
    }

    function ReportGenerateModal({ initialTab, sessionId, workspacePath, services, flash, onClose, onStarted, scope = { kind: 'personal' } }) {
      const isProject = scope.kind === 'project'
      const today = todayISO()
      const [tab, setTab] = React.useState(initialTab === 'auto' ? 'auto' : 'manual')
      const [mode, setMode] = React.useState('day')
      const [date, setDate] = React.useState(today)
      const [start, setStart] = React.useState(mondayOfISO(today))
      const [end, setEnd] = React.useState(today)
      const [frequency, setFrequency] = React.useState('daily')
      const [time, setTime] = React.useState('18:00')
      const [reportKind, setReportKind] = React.useState('today')
      const [immediate, setImmediate] = React.useState(true)
      const [busy, setBusy] = React.useState(false)
      const [error, setError] = React.useState('')

      const quick = (nextMode, nextStart, nextEnd) => {
        setMode(nextMode)
        if (nextMode === 'day') setDate(nextStart)
        else { setStart(nextStart); setEnd(nextEnd) }
      }
      const weekStart = mondayOfISO(today)
      const manualRange = mode === 'day'
        ? { type: 'daily', start: date, end: date }
        : { type: 'weekly', start, end }
      const manualIssue = !manualRange.start || !manualRange.end || manualRange.start > manualRange.end

      const runManual = async () => {
        if (!services?.startReportConversation) {
          setError('当前会话没有可用的对话服务')
          return
        }
        if (manualIssue) {
          setError('结束日期不能早于开始日期')
          return
        }
        setBusy(true)
        setError('')
        try {
          await services.startReportConversation(manualReportPrompt(manualRange, scope), sessionId, workspacePath)
          flash?.(`已新建对话，正在生成${isProject ? scope.name + '的' : ''}${reportKindLabel(manualRange.type)}`)
          onStarted?.()
          onClose()
        } catch (err) {
          setError(err?.message || String(err))
        } finally {
          setBusy(false)
        }
      }

      const runAuto = async () => {
        if (!services?.createSchedule) {
          setError('当前环境没有可用的自动化任务服务')
          return
        }
        setBusy(true)
        setError('')
        try {
          const request = buildScheduleRequest({ frequency, time, reportKind, workspacePath, scope })
          const entry = await services.createSchedule(request)
          const reservedSessionId = entry?.target?.kind === 'new_once' ? entry.target.sessionId : undefined
          let immediateError = ''
          let startedNow = false
          if (immediate) {
            if (!services.startReportConversation) {
              immediateError = '对话服务不可用'
            } else {
              try {
                await services.startReportConversation(autoReportPrompt(reportKind, scope), sessionId, workspacePath, reservedSessionId)
                startedNow = true
              } catch (err) {
                immediateError = err?.message || String(err)
              }
            }
          }
          flash?.(`已创建定时任务：${request.title}`)
          if (immediateError) flash?.(`定时任务已创建，但立即生成失败：${immediateError}`, true)
          if (startedNow) onStarted?.()
          onClose()
        } catch (err) {
          setError(err?.message || String(err))
        } finally {
          setBusy(false)
        }
      }

      const frequencyChanged = value => {
        setFrequency(value)
        setReportKind(value === 'daily' ? 'today' : value === 'friday' ? 'this_week' : 'last_week')
      }

      return h(Modal, {
        title: isProject ? `生成项目汇报 · ${scope.name}` : '生成个人汇报',
        onClose,
        footer: tab === 'manual'
          ? [
            h(Button, { key: 'c', kind: 'ghost', onClick: onClose }, '取消'),
            h(Button, { key: 's', kind: 'primary', disabled: busy, onClick: runManual }, busy ? '正在创建…' : '生成并打开新对话'),
          ]
          : [
            h(Button, { key: 'c', kind: 'ghost', onClick: onClose }, '取消'),
            h(Button, { key: 's', kind: 'primary', disabled: busy, onClick: runAuto }, busy ? '正在创建…' : '创建定时任务'),
          ],
      },
      h('div', { className: 'wo-seg' },
        h('button', { type: 'button', className: tab === 'manual' ? 'on' : '', onClick: () => { setTab('manual'); setError('') } }, '立即生成'),
        h('button', { type: 'button', className: tab === 'auto' ? 'on' : '', onClick: () => { setTab('auto'); setError('') } }, '自动生成')),
      h('div', { className: 'wo-muted', style: { fontSize: 11 } },
        isProject
          ? `汇报对象：项目「${scope.name}」——只汇总该项目的事项日志与进展，写回该项目文件夹的 汇报/日报、汇报/周报。`
          : '汇报对象：个人——汇总全部项目的日志与进展，写回工作档案的 data/日报、data/周报。'),
      tab === 'manual'
        ? [
          h('div', { key: 'mode', className: 'wo-seg' },
            h('button', { type: 'button', className: mode === 'day' ? 'on' : '', onClick: () => setMode('day') }, '按天'),
            h('button', { type: 'button', className: mode === 'range' ? 'on' : '', onClick: () => setMode('range') }, '按时间段')),
          h('div', { key: 'quick', className: 'wo-actions', style: { marginTop: 0 } },
            h(Button, { small: true, onClick: () => quick('day', today, today) }, '今天'),
            h(Button, { small: true, onClick: () => quick('day', addDaysISO(today, -1), addDaysISO(today, -1)) }, '昨天'),
            h(Button, { small: true, onClick: () => quick('range', weekStart, today) }, '本周'),
            h(Button, { small: true, onClick: () => quick('range', addDaysISO(weekStart, -7), addDaysISO(weekStart, -1)) }, '上周')),
          mode === 'day'
            ? h(Field, { key: 'date', label: '选择一天' }, h('input', {
              className: 'wo-input', type: 'date', value: date, onChange: event => setDate(event.target.value),
            }))
            : h('div', { key: 'range', className: 'wo-bar' },
              h(Field, { label: '开始' }, h('input', { className: 'wo-input', type: 'date', value: start, onChange: event => setStart(event.target.value) })),
              h(Field, { label: '结束' }, h('input', { className: 'wo-input', type: 'date', value: end, onChange: event => setEnd(event.target.value) }))),
          h('div', { key: 'preview', style: { fontSize: 11, color: 'var(--dsw-alias-label-secondary)' } },
            manualIssue ? '请选择有效日期' : `将生成：${formatRange(manualRange.start, manualRange.end)} ${reportKindLabel(manualRange.type)}`),
          h('div', { key: 'note', className: 'wo-muted', style: { fontSize: 11, lineHeight: 1.6 } },
            isProject
              ? '确认后会新建一个对话窗口，自动把生成指令发给助手；助手只读取该项目的日志，写回该项目文件夹的 汇报/日报 或 汇报/周报。'
              : '确认后会新建一个对话窗口，自动把生成指令发给助手；助手读取该时段日志后写回 workos/data/日报 或 data/周报。'),
        ]
        : [
          h(Field, { key: 'freq', label: '生成频率' }, h('select', {
            className: 'wo-select', value: frequency, onChange: event => frequencyChanged(event.target.value),
          },
          h('option', { value: 'daily' }, '每天'),
          h('option', { value: 'friday' }, '每周五'),
          h('option', { value: 'monday' }, '每周一'))),
          h(Field, { key: 'time', label: '生成时间' }, h('input', {
            className: 'wo-input', type: 'time', value: time, onChange: event => setTime(event.target.value),
          })),
          h(Field, { key: 'kind', label: '生成内容' }, h('select', {
            className: 'wo-select', value: reportKind, onChange: event => setReportKind(event.target.value),
          },
          h('option', { value: 'today' }, '当天日报'),
          h('option', { value: 'this_week' }, '本周周报'),
          h('option', { value: 'last_week' }, '上周周报'))),
          h('label', { key: 'imm', className: 'wo-check' },
            h('input', { type: 'checkbox', checked: immediate, onChange: event => setImmediate(event.target.checked) }),
            h('span', null, '创建后立即生成一次',
              h('small', null, '之后按上面的时间自动新建对话并生成'))),
          h('div', { key: 'note', className: 'wo-muted', style: { fontSize: 11, lineHeight: 1.6 } },
            '确认后会向 DSH 添加一个自动化任务，并预设汇报类型与提示词。到点会在一个专用的自动化对话里生成并写回；任务可在 DSH 的自动化任务面板里查看、暂停或删除。'),
        ],
      error ? h('div', { style: { color: 'var(--dsw-alias-state-error-primary)', fontSize: 11 } }, error) : null)
    }

    /* ------------------------------------------------------------- home */

    function Home({ state, daily, onOpen, onChat, onAct, onAddItem, busy, reports = [], onGenerateReport, onAutoReport, onOpenReportDetail, onRefresh }) {
      const stats = state.stats
      const dailyItems = daily?.items || []
      const [dailyOpenId, setDailyOpenId] = React.useState('')
      const [dailyEditId, setDailyEditId] = React.useState('')
      const openDaily = dailyItems.find(entry => entry.itemId === dailyOpenId)
      const editingDaily = dailyItems.find(entry => entry.itemId === dailyEditId)
      const dailyProject = { uid: 0, name: '日常工作', statusLabel: '日常', goal: '' }
      const deleteDaily = async item => {
        if (!window.confirm(`删除日常工作事项「${item.title}」？文件会从 日常工作/ 删除，不可恢复。`)) return
        await onAct({ action: 'item.delete', uid: 0, itemId: item.itemId })
        setDailyOpenId('')
        setDailyEditId('')
      }
      const tiles = [
        ['在办', stats.items, 'var(--dsw-alias-brand-primary)'],
        ['逾期', stats.overdue, 'var(--dsw-alias-state-error-primary)'],
        ['阻塞', stats.blocked, 'var(--dsw-alias-state-warn-primary)'],
        ['联系人', stats.people, 'var(--dsw-alias-state-success-primary)'],
      ]
      const focus = state.workbench.focus
      const logs = state.workbench.recentLogs
      const projects = state.projects.filter(project => project.status !== 'done' && project.status !== 'closed')
      return h('div', { className: 'wo-stack' },
        h('div', { className: 'wo-tiles' }, tiles.map(([label, value, color]) => h('div', { className: 'wo-tile', key: label },
          h('div', { className: 'wo-tile-label' }, h('i', { className: 'wo-dot', style: { background: color } }), label),
          h('div', { className: 'wo-metric' }, String(value ?? 0))))),
        h(Card, {
          title: '日常工作',
          count: dailyItems.length,
          action: h(Button, { small: true, kind: 'primary', onClick: onAddItem }, '+ 事项'),
        },
        dailyItems.length === 0
          ? h(Empty, { text: '还没有不属于项目的事项。点右上角「添加事项」，项目留空就会存到 日常工作/。' })
          : dailyItems.map(item => h('div', { className: 'wo-row', key: item.itemId },
            h('div', { className: 'wo-row-main' },
              h('div', { className: 'wo-title' }, item.title),
              h('div', { className: 'wo-meta' },
                h('span', { className: ['wo-chip', toneOf(item)].filter(Boolean).join(' ') }, item.remainingText),
                h('span', null, item.status),
                item.stamp ? h('span', null, item.stamp) : null,
                item.owner ? h('span', null, `负责 ${item.owner}`) : null,
                item.logs.length ? h('span', null, `${item.logs.length} 条日志`) : null)),
            h('div', { className: 'wo-actions', style: { marginTop: 0 } },
              h(Button, { small: true, onClick: () => onChat(dailyItemContext(item, state.workspace)) }, '加入对话'),
              h(Button, { small: true, onClick: () => setDailyOpenId(item.itemId) }, '详情'))))),
        openDaily && !editingDaily ? h(DailyItemModal, {
          item: openDaily,
          contacts: state.contacts,
          onClose: () => setDailyOpenId(''),
          onChat,
          onAct,
          onEdit: target => setDailyEditId(target.itemId),
          onDelete: deleteDaily,
          onLog: (target, input) => onAct({ action: 'item.log.add', uid: 0, itemId: target.itemId, ...input }),
          busy,
          workspace: state.workspace,
        }) : null,
        editingDaily ? h(ItemModal, {
          project: dailyProject,
          contacts: state.contacts,
          item: editingDaily,
          hideDeps: true,
          onClose: () => setDailyEditId(''),
          onSave: async payload => {
            await onAct({ action: 'item.update', uid: 0, itemId: payload.itemId, patch: payload.patch })
            setDailyEditId('')
          },
          busy,
        }) : null,
        h(Card, { title: '现在该处理的', count: focus.length },
          focus.length === 0 ? h(Empty, { text: '没有在办事项，去项目里加一条' }) : focus.slice(0, 8).map(item => h('div', { className: 'wo-row', key: `${item.uid}-${item.itemId}` },
            h('div', { className: 'wo-row-main' },
              h('div', { className: 'wo-title' }, h('span', { className: 'wo-link', onClick: () => onOpen(item.uid, item.itemId) }, `${item.projectName} · `), item.title),
              h('div', { className: 'wo-meta' },
                h('span', { className: ['wo-chip', toneOf(item)].filter(Boolean).join(' ') }, item.remainingText),
                h('span', null, item.status),
                item.owner ? h('span', null, item.owner) : null,
                item.blocked ? h('span', { style: { color: 'var(--dsw-alias-state-warn-primary)' } }, `等 ${item.blockedBy.map(dep => dep.itemId).join('、')}`) : null)),
            h('div', { className: 'wo-actions', style: { marginTop: 0 } },
              h(Button, { small: true, onClick: () => onChat(itemContext({ uid: item.uid, name: item.projectName, statusLabel: '', goal: '' }, item, state.workspace)) }, '加入对话'))))),
        h(Card, { title: '最近日志', count: logs.length },
          logs.length === 0 ? h(Empty, { text: '还没有事项日志' }) : logs.slice(0, 6).map((log, index) => h('div', { className: 'wo-row', key: `${log.uid}-${log.itemId}-${index}` },
            h('div', { className: 'wo-row-main' },
              h('div', { className: 'wo-title' }, h('span', { className: 'wo-link', onClick: () => onOpen(log.uid, log.itemId) }, `${log.projectName} · `), log.event),
              h('div', { className: 'wo-meta' },
                h('span', null, log.itemTitle),
                h('span', null, log.time),
                log.solution ? h('span', null, log.solution) : null)),
            h(Button, { small: true, onClick: () => onChat(logEntryContext(log, state.workspace)) }, '加入对话')))),
        h(Card, { title: '在推项目', count: projects.length },
          projects.length === 0 ? h(Empty, { text: '还没有项目' }) : projects.map(project => h('div', { className: 'wo-item', key: project.uid, onClick: () => onOpen(project.uid) },
            h('div', { className: 'wo-item-top' },
              h('span', { className: 'wo-title' }, project.name),
              h(Chip, { tone: project.status === 'doing' ? 'brand' : '' }, project.statusLabel)),
            h('div', { className: 'wo-meta' },
              h('span', null, project.goal || '未写目标'),
              h('span', null, `在办 ${project.openCount}`),
              project.overdueCount ? h('span', { style: { color: 'var(--dsw-alias-state-error-primary)' } }, `逾期 ${project.overdueCount}`) : null,
              project.blockedCount ? h('span', { style: { color: 'var(--dsw-alias-state-warn-primary)' } }, `阻塞 ${project.blockedCount}`) : null),
            h(Track, { value: project.progress })))),
        h(ReportCard, {
          title: '个人汇报',
          reports,
          emptyText: '还没有个人汇报。点「生成汇报」汇总全部项目的日志，写回 workos/data/日报 或 data/周报。',
          onOpen: onOpenReportDetail,
          onGenerate: onGenerateReport,
          onAuto: onAutoReport,
          onRefresh,
        }))
    }

    function logEntryContext(log, workspace) {
      const text = [
        `【工作上下文】uid=${log.uid} item=${log.itemId} log=${log.index ?? 0}${pathTag(log.absFile, workspace)}`,
        `项目：${log.projectName}`,
        `事项：${log.itemTitle}`,
        `日志：${log.time} · ${log.event}`,
        log.solution ? `当时的处理：${log.solution}` : '',
      ].filter(Boolean).join('\n')
      return quote(text, '工作上下文', log.projectName, `${log.time} · ${log.event}`, log.itemTitle)
    }

    /* ------------------------------------------------------------ projects */

    function ProjectList({ state, onOpen, onCreate, onChat, busy }) {
      const [creating, setCreating] = React.useState(false)
      const projects = state.projects
      return h('div', { className: 'wo-stack' },
        h('div', { className: 'wo-bar' },
          h('span', { className: 'wo-muted', style: { flex: 1, fontSize: 11 } }, `${projects.length} 个项目`),
          h(Button, { kind: 'primary', onClick: () => setCreating(true) }, '新建项目')),
        projects.length === 0 ? h('div', { className: 'wo-card' }, h(Empty, { text: '还没有项目' })) :
          h('div', { className: 'wo-card' }, projects.map(project => h('div', {
            key: project.uid,
            className: 'wo-item wo-item-split',
            onClick: () => onOpen(project.uid),
          },
            h('div', { className: 'wo-item-main' },
              h('div', { className: 'wo-item-top' },
                h('span', { className: 'wo-title' }, project.name),
                h(Chip, { tone: project.status === 'doing' ? 'brand' : '' }, project.statusLabel)),
              h('div', { className: 'wo-meta' },
                h('span', null, project.goal || '未写目标'),
                h('span', null, `${project.progress}%`),
                h('span', null, `在办 ${project.openCount}`),
                project.overdueCount ? h('span', { style: { color: 'var(--dsw-alias-state-error-primary)' } }, `逾期 ${project.overdueCount}`) : null,
                project.blockedCount ? h('span', { style: { color: 'var(--dsw-alias-state-warn-primary)' } }, `阻塞 ${project.blockedCount}`) : null),
              h(Track, { value: project.progress })),
            h('div', { className: 'wo-actions', style: { marginTop: 0 } },
              h(Button, {
                small: true,
                title: '把这个项目加入对话，AI 会先展开项目上下文',
                onClick: event => { event.stopPropagation(); onChat(projectContext(project, state.workspace)) },
              }, '加入对话'))))),
        creating ? h(ProjectModal, {
          busy,
          contacts: state.contacts || [],
          onClose: () => setCreating(false),
          onCreate: async form => { setCreating(false); await onCreate(form) },
        }) : null)
    }

    function contactOptionsOf(contacts, extra = []) {
      const options = (contacts || []).map(contact => ({
        value: contact.name,
        label: contact.name,
        sub: [contact.company, contact.role, contact.experience].filter(Boolean).join(' · '),
      }))
      const known = new Set(options.map(option => option.value))
      for (const name of extra || []) {
        if (!name || known.has(name)) continue
        options.push({ value: name, label: name, sub: '不在联系人里，保存后自动补建' })
      }
      return options
    }

    /** Owner select that keeps the current value selectable even if no contact matches. */
    function OwnerSelect({ value, contacts, onChange }) {
      const names = (contacts || []).map(contact => contact.name)
      const known = names.includes(value)
      return h('select', { className: 'wo-select', value, onChange: event => onChange(event.target.value) },
        value ? null : h('option', { value: '' }, '未指定'),
        !value || known ? null : h('option', { value }, value),
        (contacts || []).map(contact => h('option', { key: contact.id, value: contact.name }, `${contact.name}${contact.role ? ` · ${contact.role}` : ''}`)))
    }

    function ProjectModal({ contacts = [], onClose, onCreate, busy }) {
      const [form, setForm] = React.useState({ name: '', projectType: '活动', goal: '', end: '', overview: '', owner: '我' })
      const [participants, setParticipants] = React.useState([])
      const [picker, setPicker] = React.useState(false)
      const set = (key, value) => setForm(prev => ({ ...prev, [key]: value }))
      return h(Modal, {
        title: '新建项目',
        onClose,
        footer: [
          h(Button, { key: 'c', kind: 'ghost', onClick: onClose }, '取消'),
          h(Button, { key: 's', kind: 'primary', disabled: busy || !form.name.trim(), onClick: () => onCreate({ ...form, participants }) }, '创建'),
        ],
      },
      h(Field, { label: '项目名称' }, h('input', { className: 'wo-input', autoFocus: true, value: form.name, onChange: event => set('name', event.target.value) })),
      h('div', { className: 'wo-bar' },
        h(Field, { label: '类型' }, h('select', { className: 'wo-select', value: form.projectType, onChange: event => set('projectType', event.target.value) }, PROJECT_TYPES.map(type => h('option', { key: type, value: type }, type)))),
        h(Field, { label: '负责人' }, h(OwnerSelect, { value: form.owner, contacts, onChange: name => set('owner', name) }))),
      h(Field, { label: '涉及人员' },
        h('div', { className: 'wo-picker' },
          h('div', { className: 'wo-picked' }, participants.length ? participants.map(name => h(Chip, { key: name }, name)) : h('span', { className: 'wo-muted', style: { fontSize: 11 } }, '未选择')),
          h(Button, { small: true, onClick: () => setPicker(true) }, '选择'))),
      h(Field, { label: '目标（一句话 + 硬节点）' }, h('input', { className: 'wo-input', value: form.goal, onChange: event => set('goal', event.target.value), placeholder: '如：12 月 20 日顺利开展' })),
      h(Field, { label: '关键节点' }, h('input', { className: 'wo-input', type: 'date', value: form.end, onChange: event => set('end', event.target.value) })),
      h(Field, { label: '背景' }, h('textarea', { className: 'wo-textarea', value: form.overview, onChange: event => set('overview', event.target.value), placeholder: '为什么做、牵涉谁' })),
      h('div', { className: 'wo-muted', style: { fontSize: 11 } }, '项目创建后从空白开始，事项按实际情况加；负责人和涉及人员建好后可以在「编辑项目」里改。'),
      picker ? h(MultiPicker, {
        title: '涉及人员',
        options: contactOptionsOf(contacts, participants),
        value: participants,
        onChange: setParticipants,
        onClose: () => setPicker(false),
      }) : null)
    }

    function ItemModal({ project, projects, contacts, item, onClose, onSave, busy, withProjectPicker = false, hideDeps = false }) {
      const editing = Boolean(item)
      const [targetUid, setTargetUid] = React.useState(project?.uid ?? '')
      const [form, setForm] = React.useState({
        title: item?.title || '',
        detail: item?.detail || '',
        status: item?.status || '未开始',
        owner: item?.owner || '我',
        due: item?.due || '',
      })
      const [participants, setParticipants] = React.useState(item?.participants || [])
      const [deps, setDeps] = React.useState(item?.deps || [])
      const [picker, setPicker] = React.useState('')
      const set = (key, value) => setForm(prev => ({ ...prev, [key]: value }))
      const contactOptions = contactOptionsOf(contacts, participants)
      const pickedProject = project || (projects || []).find(entry => Number(entry.uid) === Number(targetUid)) || null
      const showDeps = !hideDeps && Boolean(pickedProject)
      const depOptions = showDeps
        ? (pickedProject.items || [])
          .filter(entry => entry.itemId !== item?.itemId)
          .map(entry => ({ value: entry.itemId, label: `${entry.itemId} ${entry.title}`, sub: `${entry.status}${entry.owner ? ` · ${entry.owner}` : ''}` }))
        : []
      const save = () => onSave({
        uid: project?.uid ?? (Number(targetUid) || 0),
        itemId: item?.itemId,
        patch: {
          title: form.title.trim(),
          detail: form.detail,
          status: form.status,
          owner: form.owner,
          participants,
          due: form.due,
          deps: showDeps ? deps : [],
        },
      })
      return h(Modal, {
        title: editing ? `编辑 ${item.itemId}` : '新增事项',
        onClose,
        footer: [
          h(Button, { key: 'c', kind: 'ghost', onClick: onClose }, '取消'),
          h(Button, { key: 's', kind: 'primary', disabled: busy || !form.title.trim(), onClick: save }, editing ? '保存' : '添加'),
        ],
      },
      withProjectPicker && !project ? h(Field, { label: '所属项目' },
        h('select', {
          className: 'wo-select',
          autoFocus: true,
          value: targetUid === 0 ? '' : String(targetUid || ''),
          onChange: event => {
            setTargetUid(event.target.value === '' ? '' : Number(event.target.value))
            setDeps([])
          },
        },
        h('option', { value: '' }, '日常工作（不归任何项目）'),
        (projects || []).map(entry => h('option', { key: entry.uid, value: String(entry.uid) }, `${entry.name}${entry.statusLabel ? ` · ${entry.statusLabel}` : ''}`)))) : null,
      h(Field, { label: '事项名称' }, h('input', { className: 'wo-input', autoFocus: !withProjectPicker, value: form.title, onChange: event => set('title', event.target.value) })),
      withProjectPicker && !project && !pickedProject
        ? h('div', { className: 'wo-muted', style: { fontSize: 11 } }, '不选项目 = 日常工作：存到 work/我的工作/当年/日常工作/，每个事项一个 md，文件名前缀是添加时的日期时分秒。')
        : null,
      h(Field, { label: '详情' }, h('textarea', { className: 'wo-textarea', value: form.detail, onChange: event => set('detail', event.target.value), placeholder: '要做什么、标准是什么' })),
      h(Field, { label: '状态' }, h('select', { className: 'wo-select', value: form.status, onChange: event => set('status', event.target.value) }, ITEM_STATUSES.map(status => h('option', { key: status, value: status }, status)))),
      h(Field, { label: '负责人' }, h('select', { className: 'wo-select', value: form.owner, onChange: event => set('owner', event.target.value) },
        h('option', { value: '' }, '未指定'),
        contacts.map(contact => h('option', { key: contact.id, value: contact.name }, `${contact.name}${contact.role ? ` · ${contact.role}` : ''}`)))),
      h(Field, { label: '涉及人员' },
        h('div', { className: 'wo-picker' },
          h('div', { className: 'wo-picked' }, participants.length ? participants.map(name => h(Chip, { key: name }, name)) : h('span', { className: 'wo-muted', style: { fontSize: 11 } }, '未选择')),
          h(Button, { small: true, onClick: () => setPicker('people') }, '选择'))),
      h(Field, { label: '到期' }, h('input', { className: 'wo-input', type: 'date', value: form.due, onChange: event => set('due', event.target.value) })),
      showDeps ? h(Field, { label: '依赖事项（同项目，可多选）' },
        h('div', { className: 'wo-picker' },
          h('div', { className: 'wo-picked' }, deps.length ? deps.map(depId => {
            const dep = (pickedProject.items || []).find(entry => entry.itemId === depId)
            return h(Chip, { key: depId }, `${depId} ${dep?.title || ''}`)
          }) : h('span', { className: 'wo-muted', style: { fontSize: 11 } }, '无依赖')),
          h(Button, { small: true, onClick: () => setPicker('deps') }, '选择'))) : null,
      picker === 'people' ? h(MultiPicker, {
        title: '涉及人员',
        options: contactOptions,
        value: participants,
        onChange: setParticipants,
        onClose: () => setPicker(''),
      }) : null,
      picker === 'deps' ? h(MultiPicker, {
        title: '依赖事项',
        options: depOptions,
        value: deps,
        onChange: setDeps,
        onClose: () => setPicker(''),
      }) : null)
    }

    function ItemRow({ project, item, contacts, onChat, onDetail, workspace }) {
      const ownerExperience = contacts.find(contact => contact.name === item.owner)?.experience || ''
      return h('div', { className: 'wo-row' },
        h('div', { className: 'wo-row-main' },
          h('div', { className: 'wo-title' }, item.title),
          h('div', { className: 'wo-meta' },
            h('span', { className: ['wo-chip', toneOf(item)].filter(Boolean).join(' ') }, item.remainingText),
            h('span', null, item.status),
            item.owner ? h('span', { title: ownerExperience }, `负责 ${item.owner}`) : null,
            item.participants.length ? h('span', null, `涉及 ${item.participants.join('、')}`) : null,
            item.deps.length ? h('span', { style: { color: 'var(--dsw-alias-state-warn-primary)' } }, `依赖 ${item.deps.join('、')}`) : null,
            item.logs.length ? h('span', null, `${item.logs.length} 条日志`) : null,
            item.blocked ? h('span', { style: { color: 'var(--dsw-alias-state-warn-primary)' } }, '被依赖卡住') : null)),
        h('div', { className: 'wo-actions', style: { marginTop: 0 } },
          h(Button, { small: true, onClick: () => onChat(itemContext(project, item, workspace)) }, '加入对话'),
          h(Button, { small: true, onClick: () => onDetail(item) }, '详情')))
    }

    function personCellOf(name, contacts, onOpenContact) {
      const contact = contacts.find(entry => entry.name === name)
      const meta = [contact?.company, contact?.role].filter(Boolean).join(' · ')
      return h('span', { className: 'wo-person-cell' },
        h('button', {
          type: 'button',
          className: 'wo-person',
          title: contact ? `编辑联系人 ${name}` : `新建联系人 ${name}`,
          onClick: event => { event.stopPropagation(); onOpenContact(name) },
        }, name),
        meta ? h('span', { className: 'wo-muted', style: { fontSize: 10 } }, meta) : null,
        h('span', { className: 'wo-muted', style: { fontSize: 10 } },
          contact?.experience ? `打交道：${contact.experience}` : '打交道经验：还没有记录'))
    }

    function ItemDetailModal({ project, item, contacts, onClose, onChat, onAct, onEdit, onDelete, onLog, onOpenContact, onOpenItem, onBack, busy, workspace }) {
      return h(Modal, {
        title: `${item.itemId} ${item.title}`,
        onClose,
        footer: [
          onBack ? h(Button, { key: 'back', kind: 'ghost', onClick: onBack }, '← 返回') : null,
          h(Button, { key: 'chat', kind: 'primary', onClick: () => onChat(itemContext(project, item, workspace)) }, '加入对话'),
          h(Button, { key: 'edit', onClick: () => onEdit(item) }, '编辑'),
          h(Button, { key: 'del', kind: 'danger', onClick: () => onDelete(item) }, '删除'),
          h(Button, { key: 'close', kind: 'ghost', onClick: onClose }, '关闭'),
        ].filter(Boolean),
      },
      h('div', { className: 'wo-meta' },
        h('span', { className: ['wo-chip', toneOf(item)].filter(Boolean).join(' ') }, item.remainingText),
        h(Chip, null, item.status),
        item.due ? h(Chip, null, `到期 ${item.due}`) : null,
        item.blocked ? h(Chip, { tone: 'warn' }, '被依赖卡住') : null),
      h('div', { style: { fontSize: 11 } }, item.detail || '（没有详情）'),
      h('div', { className: 'wo-bar' },
        h('select', {
          className: 'wo-select sm',
          value: item.status,
          disabled: busy,
          onChange: event => onAct({ action: 'item.update', uid: project.uid, itemId: item.itemId, patch: { status: event.target.value } }),
        }, ITEM_STATUSES.map(status => h('option', { key: status, value: status }, status))),
        h('span', { className: 'wo-muted', style: { fontSize: 10 } }, '改状态直接写回')),
      h('div', { className: 'wo-kv' },
        h('b', null, '负责人'),
        h('span', null, item.owner
          ? personCellOf(item.owner, contacts, onOpenContact)
          : h('span', { className: 'wo-muted' }, '未指定')),
        h('b', null, '涉及人员'),
        h('span', null, item.participants.length
          ? h('span', { className: 'wo-people' }, item.participants.map(name => h(React.Fragment, { key: name }, personCellOf(name, contacts, onOpenContact))))
          : h('span', { className: 'wo-muted' }, '未添加')),
        h('b', null, '依赖'),
        h('span', null, item.deps.length
          ? item.deps.map(depId => {
            const dep = project.items.find(entry => entry.itemId === depId)
            const done = Boolean(dep) && ['已完成', '已关闭'].includes(dep.status)
            return h('button', {
              key: depId,
              type: 'button',
              className: 'wo-dep',
              title: dep ? `查看 ${depId} 的详情` : '找不到该依赖事项',
              onClick: () => dep && onOpenItem(depId),
            }, h(Chip, { tone: done ? 'ok' : 'warn' }, `${depId} ${dep?.title || '（找不到该事项）'}（${dep?.status || '?'}）`))
          })
          : h('span', { className: 'wo-muted' }, '无'))),
      item.absFile ? h('div', { className: 'wo-muted', style: { fontSize: 10, overflowWrap: 'anywhere' } }, `文件：${contextPath(item.absFile, workspace)}`) : null,
      h('div', { style: { fontWeight: 600, fontSize: 11 } }, '日志'),
      item.logs.length === 0 ? h('div', { className: 'wo-muted', style: { fontSize: 11 } }, '还没有日志') : item.logs.map((log, index) => h('div', { className: 'wo-log', key: `${log.time}-${index}` },
        h('div', { className: 'wo-log-time' }, log.time),
        h('div', { className: 'wo-log-event' }, log.event),
        log.solution ? h('div', { className: 'wo-log-solution' }, `处理：${log.solution}`) : null,
        h('div', { className: 'wo-actions' }, h(Button, { small: true, onClick: () => onChat(logContext(project, item, log, index, workspace)) }, '加入对话')))),
      h(LogForm, { onSubmit: input => onLog(item, input), busy }))
    }

    function LogForm({ onSubmit, busy }) {
      const [event, setEvent] = React.useState('')
      const [solution, setSolution] = React.useState('')
      return h('div', { className: 'wo-form', style: { padding: 0, borderBottom: 0 } },
        h('input', { className: 'wo-input', placeholder: '发生了什么（时间默认现在）', value: event, onChange: item => setEvent(item.target.value) }),
        h('textarea', { className: 'wo-textarea', placeholder: '怎么处理的 / 结果如何', value: solution, onChange: item => setSolution(item.target.value) }),
        h(Button, {
          small: true,
          kind: 'primary',
          disabled: busy || !event.trim(),
          onClick: async () => {
            await onSubmit({ event: event.trim(), solution: solution.trim() })
            setEvent('')
            setSolution('')
          },
        }, '记日志'))
    }

    function DailyItemModal({ item, contacts, onClose, onChat, onAct, onEdit, onDelete, onLog, busy, workspace }) {
      const dailyProject = { uid: 0, name: '日常工作', statusLabel: '日常', goal: '' }
      const ownerExperience = (contacts || []).find(contact => contact.name === item.owner)?.experience || ''
      return h(Modal, {
        title: `日常工作 · ${item.stamp || item.created || item.itemId}`,
        onClose,
        footer: [
          h(Button, { key: 'chat', kind: 'primary', onClick: () => onChat(dailyItemContext(item, workspace)) }, '加入对话'),
          h(Button, { key: 'edit', onClick: () => onEdit(item) }, '编辑'),
          h(Button, { key: 'del', kind: 'danger', onClick: () => onDelete(item) }, '删除'),
          h(Button, { key: 'close', kind: 'ghost', onClick: onClose }, '关闭'),
        ],
      },
      h('div', { className: 'wo-meta' },
        h('span', { className: ['wo-chip', toneOf(item)].filter(Boolean).join(' ') }, item.remainingText),
        h(Chip, null, item.status),
        item.due ? h(Chip, null, `到期 ${item.due}`) : null,
        h(Chip, null, '不属于项目')),
      h('div', { style: { fontSize: 11 } }, item.detail || '（没有详情）'),
      h('div', { className: 'wo-bar' },
        h('select', {
          className: 'wo-select sm',
          value: item.status,
          disabled: busy,
          onChange: event => onAct({ action: 'item.update', uid: 0, itemId: item.itemId, patch: { status: event.target.value } }),
        }, ITEM_STATUSES.map(status => h('option', { key: status, value: status }, status))),
        h('span', { className: 'wo-muted', style: { fontSize: 10 } }, '改状态直接写回')),
      h('div', { className: 'wo-kv' },
        h('b', null, '负责人'),
        h('span', { title: ownerExperience }, item.owner || h('span', { className: 'wo-muted' }, '未指定')),
        h('b', null, '涉及人员'),
        h('span', null, item.participants.length ? item.participants.join('、') : h('span', { className: 'wo-muted' }, '未添加')),
        h('b', null, '文件'),
        h('span', { style: { fontSize: 10, overflowWrap: 'anywhere' } }, contextPath(item.absFile, workspace))),
      h('div', { style: { fontWeight: 600, fontSize: 11 } }, '日志'),
      item.logs.length === 0 ? h('div', { className: 'wo-muted', style: { fontSize: 11 } }, '还没有日志') : item.logs.map((log, index) => h('div', { className: 'wo-log', key: `${log.time}-${index}` },
        h('div', { className: 'wo-log-time' }, log.time),
        h('div', { className: 'wo-log-event' }, log.event),
        log.solution ? h('div', { className: 'wo-log-solution' }, `处理：${log.solution}`) : null,
        h('div', { className: 'wo-actions' }, h(Button, { small: true, onClick: () => onChat(logContext(dailyProject, item, log, index, workspace)) }, '加入对话')))),
      h(LogForm, { onSubmit: input => onLog(item, input), busy }))
    }

    function ProjectDetail({ project, contacts, reports, allProjects = [], dailyItems = [], onBack, onAct, onChat, onDeleteProject, onOpenReport, onOpenReportDetail, onRefresh, busy, initialItemId, workspace }) {
      const [filter, setFilter] = React.useState('open')
      // The detail modal is a stack: clicking a dependency opens that item on
      // top, and "返回" walks back to where you came from.
      const [itemStack, setItemStack] = React.useState(() => (initialItemId ? [initialItemId] : []))
      const [editing, setEditing] = React.useState(null) // { creating: true } | { itemId }
      const [projectEditor, setProjectEditor] = React.useState(false)
      const [contactEditor, setContactEditor] = React.useState(null)
      const summary = project.summary || {}
      const doneCount = project.items.filter(item => ['已完成', '已关闭'].includes(item.status)).length
      const progress = project.items.length ? Math.round((doneCount / project.items.length) * 100) : 0
      const openItems = project.items.filter(item => !['已完成', '已关闭'].includes(item.status))
      const visible = filter === 'open' ? openItems : project.items
      const openItemId = itemStack.length ? itemStack[itemStack.length - 1] : ''
      const openItem = project.items.find(item => item.itemId === openItemId)
      const editingItem = editing?.itemId ? project.items.find(item => item.itemId === editing.itemId) : null
      const projectReports = (reports || []).filter(report =>
        report.scope === 'project' && Number(report.uid) === Number(project.uid))
      React.useEffect(() => { if (initialItemId) setItemStack([initialItemId]) }, [initialItemId])
      const closeItem = () => setItemStack(prev => prev.slice(0, -1))
      const saveItem = async payload => {
        if (payload.itemId) {
          await onAct({ action: 'item.update', uid: project.uid, itemId: payload.itemId, patch: payload.patch })
          setEditing(null)
          setItemStack([payload.itemId])
        } else {
          await onAct({ action: 'item.add', uid: project.uid, ...payload.patch })
          setEditing(null)
        }
      }
      const deleteItem = async item => {
        if (!window.confirm(`删除 ${item.itemId} ${item.title}？被其他事项依赖时不能删除。`)) return
        await onAct({ action: 'item.delete', uid: project.uid, itemId: item.itemId }, true)
        setItemStack(prev => prev.filter(id => id !== item.itemId))
      }
      const openContact = name => {
        const contact = contacts.find(entry => entry.name === name)
        setContactEditor(contact || { name, company: '', dept: '', role: '', phone: '', duty: '', experience: '', note: '' })
      }
      const saveContact = async form => {
        if (contactEditor?.id) await onAct({ action: 'contact.update', id: contactEditor.id, patch: form })
        else await onAct({ action: 'contact.add', ...form })
        setContactEditor(null)
      }
      return h('div', { className: 'wo-stack' },
        h('div', { className: 'wo-bar' },
          h(Button, { kind: 'ghost', small: true, onClick: onBack }, '← 返回'),
          h('span', { className: 'wo-muted', style: { flex: 1, fontSize: 10, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, shortPath(project.relPath))),
        h('div', { className: 'wo-card' },
          h('div', { className: 'wo-card-head' }, project.name,
            h('span', { style: { flex: 1 } }),
            h(Button, { small: true, onClick: () => onChat(projectContext({ ...project, ...summary }, workspace)) }, '加入对话')),
          h('div', { className: 'wo-pad' },
            h('div', { className: 'wo-meta' },
              h(Chip, { tone: project.status === 'doing' ? 'brand' : '' }, project.statusLabel),
              h(Chip, null, project.projectType),
              h(Chip, null, `进度 ${progress}%`),
              project.end ? h(Chip, null, `节点 ${project.end}`) : null,
              openItems.length ? h(Chip, null, `在办 ${openItems.length}`) : h(Chip, { tone: 'ok' }, '无在办')),
            project.goal ? h('div', { style: { fontWeight: 500, marginTop: 5 } }, project.goal) : null,
            h('div', { className: 'wo-kv', style: { padding: '4px 0' } },
              h('b', null, '负责人'),
              h('span', null, project.owner
                ? h('button', { type: 'button', className: 'wo-person', title: '编辑联系人', onClick: () => openContact(project.owner) }, project.owner)
                : h('span', { className: 'wo-muted' }, '未指定')),
              h('b', null, '涉及人员'),
              h('span', null, (project.participants || []).length
                ? h('span', { className: 'wo-people' }, project.participants.map(name => h('button', {
                  key: name, type: 'button', className: 'wo-person', title: '编辑联系人', onClick: () => openContact(name),
                }, name)))
                : h('span', { className: 'wo-muted' }, '未添加'))),
            h('div', { className: 'wo-actions' },
              h('select', {
                className: 'wo-select sm',
                value: project.status,
                disabled: busy,
                onChange: event => onAct({ action: 'project.update', uid: project.uid, patch: { status: event.target.value } }),
              }, PROJECT_STATUSES.map(([value, label]) => h('option', { key: value, value }, label))),
              h(Button, { small: true, onClick: () => setProjectEditor(true) }, '编辑项目'),
              h(Button, { small: true, kind: 'danger', onClick: () => onDeleteProject(project) }, '删除项目')))),
        h(Card, {
          title: '工作事项',
          count: `${visible.length}/${project.items.length}`,
          action: h(Button, { small: true, kind: 'primary', onClick: () => setEditing({ creating: true }) }, '+ 事项'),
        },
        h('div', { className: 'wo-seg' },
          h('button', { type: 'button', className: filter === 'all' ? 'on' : '', onClick: () => setFilter('all') }, `全部 ${project.items.length}`),
          h('button', { type: 'button', className: filter === 'open' ? 'on' : '', onClick: () => setFilter('open') }, `未完成 ${openItems.length}`)),
        project.items.length === 0
          ? h(Empty, { text: '还没有事项。点右上角加一条，或让 AI 从对话里补。' })
          : visible.length === 0
            ? h(Empty, { text: `没有未完成事项（已完成 ${doneCount} 项，切到「全部」查看）` })
            : visible.map(item => h(ItemRow, {
              key: item.itemId,
              project,
              item,
              contacts,
              onChat,
              onDetail: target => setItemStack(prev => [...prev.filter(id => id !== target.itemId), target.itemId]),
              workspace,
            }))),
        h(ReportCard, {
          title: '项目汇报',
          reports: projectReports,
          emptyText: '这个项目还没有汇报。点「生成汇报」只汇总本项目的事项日志，写回本项目的 汇报/ 目录。',
          onOpen: onOpenReportDetail,
          onGenerate: () => onOpenReport('manual', project),
          onAuto: () => onOpenReport('auto', project),
          onRefresh,
        }),
        h(Card, { title: '项目进展', count: project.progress.length, defaultOpen: false },
          project.progress.length === 0 ? h(Empty, null) : project.progress.slice(0, 8).map((row, index) => h('div', { className: 'wo-row', key: index },
            h('div', { className: 'wo-row-main' },
              h('div', { className: 'wo-title' }, row.text),
              h('div', { className: 'wo-meta' }, h('span', null, row.date), h('span', null, row.note)))))),
        project.review ? h(Card, { title: '复盘', defaultOpen: false }, h('pre', { className: 'wo-pre' }, project.review
          .split('\n')
          .map(line => line.replace(/^-\s+\*\*(.+?)\*\*:\s*/, '$1：').replace(/^-\s+/, '• '))
          .join('\n'))) : null,
        editing?.creating ? h(ItemModal, { project, contacts, onClose: () => setEditing(null), onSave: saveItem, busy }) : null,
        editingItem ? h(ItemModal, { project, contacts, item: editingItem, onClose: () => setEditing(null), onSave: saveItem, busy }) : null,
        openItem && !editing ? h(ItemDetailModal, {
          project,
          item: openItem,
          contacts,
          onClose: closeItem,
          onChat,
          onAct,
          onEdit: target => { setEditing({ itemId: target.itemId }); setItemStack([]) },
          onDelete: deleteItem,
          onLog: (target, input) => onAct({ action: 'item.log.add', uid: project.uid, itemId: target.itemId, ...input }),
          onOpenContact: openContact,
          onOpenItem: depId => setItemStack(prev => [...prev, depId]),
          onBack: itemStack.length > 1 ? closeItem : null,
          busy,
          workspace,
        }) : null,
        projectEditor ? h(ProjectEditModal, {
          project,
          contacts,
          onClose: () => setProjectEditor(false),
          onSave: async patch => { await onAct({ action: 'project.update', uid: project.uid, patch }); setProjectEditor(false) },
          busy,
        }) : null,
        contactEditor ? h(ContactModal, {
          contact: contactEditor,
          references: contactEditor?.id ? contactReferences(contactEditor.name, allProjects, dailyItems) : [],
          onClose: () => setContactEditor(null),
          onSave: saveContact,
          onDelete: async target => {
            if (await onAct({ action: 'contact.remove', id: target.id })) setContactEditor(null)
          },
          busy,
        }) : null)
    }

    function ProjectEditModal({ project, contacts = [], onClose, onSave, busy }) {
      // A host that predates the goal/overview split still returns the whole
      // `## 目标与背景` section as overview; drop the goal line so saving the
      // background does not duplicate it.
      const goalText = String(project.goal || '').trim()
      const rawOverview = String(project.overview || '').trim()
      const overviewText = goalText && rawOverview.startsWith(goalText)
        ? rawOverview.slice(goalText.length).trim()
        : rawOverview
      const [form, setForm] = React.useState({
        name: project.name || '',
        projectType: project.projectType || '其他',
        priority: project.priority || '中',
        start: project.start || '',
        end: project.end || '',
        goal: project.goal || '',
        overview: overviewText,
        owner: project.owner || '',
        status: project.status || 'doing',
      })
      const [participants, setParticipants] = React.useState(project.participants || [])
      const [picker, setPicker] = React.useState(false)
      const set = (key, value) => setForm(prev => ({ ...prev, [key]: value }))
      return h(Modal, {
        title: `编辑项目 ${project.name}`,
        onClose,
        footer: [
          h(Button, { key: 'c', kind: 'ghost', onClick: onClose }, '取消'),
          h(Button, { key: 's', kind: 'primary', disabled: busy || !form.name.trim(), onClick: () => onSave({ ...form, participants }) }, '保存'),
        ],
      },
      h(Field, { label: '项目名称' }, h('input', { className: 'wo-input', autoFocus: true, value: form.name, onChange: event => set('name', event.target.value) })),
      h('div', { className: 'wo-bar' },
        h(Field, { label: '状态' }, h('select', { className: 'wo-select', value: form.status, onChange: event => set('status', event.target.value) },
          PROJECT_STATUSES.map(([value, label]) => h('option', { key: value, value }, label)))),
        h(Field, { label: '类型' }, h('select', { className: 'wo-select', value: form.projectType, onChange: event => set('projectType', event.target.value) },
          PROJECT_TYPES.map(type => h('option', { key: type, value: type }, type))))),
      h('div', { className: 'wo-bar' },
        h(Field, { label: '负责人' }, h(OwnerSelect, { value: form.owner, contacts, onChange: name => set('owner', name) })),
        h(Field, { label: '优先级' }, h('select', { className: 'wo-select', value: form.priority, onChange: event => set('priority', event.target.value) },
          ['高', '中', '低'].map(level => h('option', { key: level, value: level }, level))))),
      h(Field, { label: '涉及人员' },
        h('div', { className: 'wo-picker' },
          h('div', { className: 'wo-picked' }, participants.length ? participants.map(name => h(Chip, { key: name }, name)) : h('span', { className: 'wo-muted', style: { fontSize: 11 } }, '未选择')),
          h(Button, { small: true, onClick: () => setPicker(true) }, '选择'))),
      h('div', { className: 'wo-bar' },
        h(Field, { label: '开始' }, h('input', { className: 'wo-input', type: 'date', value: form.start, onChange: event => set('start', event.target.value) })),
        h(Field, { label: '关键节点' }, h('input', { className: 'wo-input', type: 'date', value: form.end, onChange: event => set('end', event.target.value) }))),
      h(Field, { label: '目标（一句话 + 硬节点）' }, h('input', { className: 'wo-input', value: form.goal, onChange: event => set('goal', event.target.value) })),
      h(Field, { label: '背景' }, h('textarea', { className: 'wo-textarea', value: form.overview, onChange: event => set('overview', event.target.value), placeholder: '为什么做、牵涉谁' })),
      h('div', { className: 'wo-muted', style: { fontSize: 10 } }, '改项目名称会同步重命名项目文件夹，并更新年度概述里的链接。'),
      picker ? h(MultiPicker, {
        title: '涉及人员',
        options: contactOptionsOf(contacts, participants),
        value: participants,
        onChange: setParticipants,
        onClose: () => setPicker(false),
      }) : null)
    }

    /* -------------------------------------------------------------- people */

    function People({ state, onAct, onChat, busy }) {
      const [keyword, setKeyword] = React.useState('')
      const [modal, setModal] = React.useState(null)
      const contacts = state.contacts.filter(contact => {
        if (!keyword.trim()) return true
        return `${contact.name}${contact.company}${contact.dept}${contact.role}${contact.duty}${contact.experience}`.includes(keyword.trim())
      })
      return h('div', { className: 'wo-stack' },
        h('div', { className: 'wo-bar' },
          h('input', { className: 'wo-input', placeholder: '搜姓名 / 公司 / 经验', value: keyword, onChange: event => setKeyword(event.target.value) }),
          h(Button, { kind: 'primary', onClick: () => setModal('new') }, '新增')),
        h('div', { className: 'wo-card' },
          contacts.length === 0 ? h(Empty, { text: '还没有联系人' }) : contacts.map(contact => h('div', { className: 'wo-row', key: contact.id },
            h('div', { className: 'wo-row-main' },
              h('div', { className: 'wo-title' }, contact.name, contact.role ? h('span', { className: 'wo-muted' }, ` · ${contact.role}`) : null),
              h('div', { className: 'wo-meta' },
                contact.company ? h('span', null, contact.company) : null,
                contact.duty ? h('span', null, contact.duty) : null,
                contact.phone ? h('span', null, contact.phone) : null),
              h('div', { style: { fontSize: 11, marginTop: 3, color: 'var(--dsw-alias-label-secondary)' } },
                contact.experience ? `打交道：${contact.experience}` : '打交道经验：还没有记录')),
            h('div', { className: 'wo-actions', style: { marginTop: 0 } },
              h(Button, { small: true, onClick: () => onChat(personContext(contact, state.contactsAbsPath, state.workspace)) }, '加入对话'),
              h(Button, { small: true, onClick: () => setModal(contact) }, '编辑'))))),
        modal ? h(ContactModal, {
          contact: modal === 'new' ? null : modal,
          references: modal === 'new' ? [] : contactReferences(modal.name, state.projects, state.daily?.items || []),
          onClose: () => setModal(null),
          onSave: async form => {
            if (modal === 'new') await onAct({ action: 'contact.add', ...form })
            else await onAct({ action: 'contact.update', id: modal.id, patch: form })
            setModal(null)
          },
          onDelete: async target => {
            if (await onAct({ action: 'contact.remove', id: target.id })) setModal(null)
          },
          busy,
        }) : null)
    }

    function ContactModal({ contact, references = [], onClose, onSave, onDelete, busy }) {
      const [form, setForm] = React.useState({
        name: contact?.name || '', company: contact?.company || '', dept: contact?.dept || '',
        role: contact?.role || '', phone: contact?.phone || '', duty: contact?.duty || '',
        experience: contact?.experience || '', note: contact?.note || '',
      })
      const set = (key, value) => setForm(prev => ({ ...prev, [key]: value }))
      const remove = async () => {
        if (!onDelete) return
        const lines = [
          `删除联系人「${contact.name}」？`,
          '只从联系人档案移除，他的资料和打交道经验会一起删除，不可恢复。',
        ]
        if (references.length) {
          lines.push('', `仍有 ${references.length} 处引用，项目/事项里的名字不会自动改：`)
          for (const ref of references.slice(0, 6)) lines.push(`· ${ref}`)
          if (references.length > 6) lines.push(`· 等 ${references.length} 处`)
        } else {
          lines.push('', '目前项目与事项都没有引用这个名字。')
        }
        if (!window.confirm(lines.join('\n'))) return
        await onDelete(contact)
      }
      return h(Modal, {
        title: contact?.id ? `编辑 ${contact.name}` : '新增联系人',
        onClose,
        footer: [
          contact?.id && contact.name !== '我' && onDelete
            ? h('span', { key: 'd', style: { marginRight: 'auto' } },
              h(Button, { kind: 'danger', small: true, disabled: busy, onClick: remove }, '删除联系人'))
            : null,
          h(Button, { key: 'c', kind: 'ghost', onClick: onClose }, '取消'),
          h(Button, { key: 's', kind: 'primary', disabled: busy || !form.name.trim(), onClick: () => onSave(form) }, '保存'),
        ].filter(Boolean),
      },
      h(Field, { label: '姓名' }, h('input', { className: 'wo-input', autoFocus: true, value: form.name, onChange: event => set('name', event.target.value) })),
      h('div', { className: 'wo-bar' },
        h(Field, { label: '公司' }, h('input', { className: 'wo-input', value: form.company, onChange: event => set('company', event.target.value) })),
        h(Field, { label: '部门' }, h('input', { className: 'wo-input', value: form.dept, onChange: event => set('dept', event.target.value) }))),
      h('div', { className: 'wo-bar' },
        h(Field, { label: '职位' }, h('input', { className: 'wo-input', value: form.role, onChange: event => set('role', event.target.value) })),
        h(Field, { label: '电话' }, h('input', { className: 'wo-input', value: form.phone, onChange: event => set('phone', event.target.value) }))),
      h(Field, { label: '负责事项' }, h('input', { className: 'wo-input', value: form.duty, onChange: event => set('duty', event.target.value) })),
      h(Field, { label: '打交道经验（怎么和他相处、下次注意什么）' }, h('textarea', { className: 'wo-textarea', value: form.experience, onChange: event => set('experience', event.target.value), placeholder: '如：好说话，但排期紧时要提前三天催；口头承诺要邮件确认' })),
      h(Field, { label: '备注' }, h('input', { className: 'wo-input', value: form.note, onChange: event => set('note', event.target.value) })),
      contact?.id && contact.name === '我'
        ? h('div', { className: 'wo-muted', style: { fontSize: 11 } }, '「我」是本人档案，不能删除；资料直接在上面改。')
        : null)
    }

    /* ------------------------------------------------------------- settings */

    function Settings({ state, onInit, onRebuild, onMigrate, busy }) {
      const meta = state.indexMeta
      return h('div', { className: 'wo-stack' },
        h(Card, { title: '当前工作区档案' },
          h('div', { className: 'wo-kv' },
            h('b', null, '目录'), h('span', { style: { fontFamily: 'ui-monospace,SFMono-Regular,Menlo,monospace', fontSize: 10 } }, state.root),
            h('b', null, '项目'), h('span', null, String(state.projects.length)),
            h('b', null, '联系人'), h('span', null, String(state.contacts.length)),
            h('b', null, '索引'), h('span', null, meta ? `${meta.docs} 份文档 · ${meta.items} 个事项 · ${meta.logs} 条日志` : '尚未建立'))),
        h(Card, { title: '工作区 Agent' },
          h('div', { className: 'wo-kv' },
            h('b', null, '设定文件'), h('span', { style: { fontFamily: 'ui-monospace,SFMono-Regular,Menlo,monospace', fontSize: 10 } }, `${String(state.root).replace(/\/workos$/, '')}/AGENTS.md`),
            h('b', null, '说明'), h('span', null, 'DSH 会把该文件作为本工作区的 agent 指令自动加载；改它即可调整助手的身份、档案结构约束与写回规则。初始化时写入；插件升级后重新打开驾驶舱会把助手段原地刷新成最新规则，其余内容保留。'),
            h('b', null, '默认负责人'), h('span', null, '新事项默认「我」；在联系人里编辑「我」即可改自己的资料。'))),
        h(Card, { title: '维护' },
          h('div', { className: 'wo-pad', style: { display: 'flex', flexDirection: 'column', gap: 7 } },
            h(Button, { block: true, onClick: onRebuild, disabled: busy }, '重建检索索引'),
            h(Button, { block: true, onClick: onInit, disabled: busy }, '初始化 / 修复档案目录'),
            h(Button, { block: true, onClick: onMigrate, disabled: busy }, '迁移旧档案（单文件 → 文件夹）'),
            h('div', { className: 'wo-muted', style: { fontSize: 11, lineHeight: 1.6 } },
              '工作档案只写在当前工作区的 workos/：data/ 是人、经验和档案；work/ 里一个项目一个文件夹，README.md 是项目主档，事项/ 下每个事项一个 md，日志写在事项文件里。换工作区自动换一套；把别的机器的 data/ 与 work/ 拷进来即可接续。'))),
        h(Card, { title: '怎么用' },
          h('div', { className: 'wo-pad wo-muted', style: { fontSize: 11, lineHeight: 1.7 } },
            '1. 在项目里加事项：负责人、涉及人员从联系人选，依赖只能选同项目的事项；每个事项自动生成独立文件。',
            '2. 遇到问题，点事项或某条日志的「加入对话」，再在输入框里问你的问题；引用里会带上该文件在工作区内的相对路径。',
            '3. AI 会自己展开项目、依赖、人员的打交道经验来回答；每轮对话它都会自动归档到项目/事项并记日志（写清前因后果），不用手动补。')))
    }

    /* ------------------------------------------------------------------ app */

    function App({ sessionId, t, visible, inputActions, services }) {
      const [state, setState] = React.useState(null)
      const [error, setError] = React.useState('')
      const [busy, setBusy] = React.useState(false)
      const [toast, setToast] = React.useState(null)
      const [tab, setTab] = React.useState('home')
      const [detailUid, setDetailUid] = React.useState(null)
      const [detail, setDetail] = React.useState(null)
      const [initialItem, setInitialItem] = React.useState('')
      const [created, setCreated] = React.useState(null)
      const [itemCreator, setItemCreator] = React.useState(false)
      const [reportModal, setReportModal] = React.useState(null)
      const [reportDetail, setReportDetail] = React.useState(null)
      const request = React.useMemo(() => makeRequest(sessionId), [sessionId])
      const toastTimer = React.useRef(null)
      const reportTimer = React.useRef(null)
      const flash = React.useCallback((message, isError) => {
        setToast({ message, isError })
        if (toastTimer.current) window.clearTimeout(toastTimer.current)
        toastTimer.current = window.setTimeout(() => setToast(null), 2800)
      }, [])
      const load = React.useCallback(async () => {
        try {
          const data = await request('/state')
          setState(data)
          setError('')
          if (data.created && data.created.length) setCreated(data.created)
        } catch (err) {
          setError(err.message)
        }
      }, [request])
      React.useEffect(() => { load() }, [load])
      React.useEffect(() => { if (visible) load() }, [visible, load])
      React.useEffect(() => () => {
        if (reportTimer.current) window.clearInterval(reportTimer.current)
      }, [])
      const beginReportPolling = React.useCallback(() => {
        if (reportTimer.current) window.clearInterval(reportTimer.current)
        const startedAt = Date.now()
        reportTimer.current = window.setInterval(() => {
          load()
          if (Date.now() - startedAt > 180000) {
            window.clearInterval(reportTimer.current)
            reportTimer.current = null
          }
        }, 5000)
      }, [load])

      const addToChat = React.useCallback(payload => {
        if (!inputActions) {
          flash('当前输入框不可用，请在会话中打开', true)
          return
        }
        const ok = inputActions.insertQuote(payload.text, payload.summary)
        if (!ok) {
          flash('输入框正忙或内容为空，稍后再试', true)
          return
        }
        flash('已加入对话，直接输入你的问题')
      }, [inputActions, flash])

      const openProject = React.useCallback(async (uid, itemId) => {
        setTab('projects')
        setDetailUid(uid)
        setInitialItem(itemId || '')
        setDetail(null)
        try {
          const data = await request(`/project?uid=${uid}`)
          setDetail(data.project)
        } catch (err) {
          flash(err.message, true)
        }
      }, [request, flash])

      const closeDetail = () => {
        setDetailUid(null)
        setDetail(null)
        setInitialItem('')
      }

      const deleteProject = async project => {
        const folderHint = project.folder === false ? '' : '（会连同项目文件夹里的所有事项和资料一起删除）'
        if (!window.confirm(`删除项目「${project.name}」？${folderHint}项目文件会被删除，并从年度概述移除，不可恢复。`)) return
        setBusy(true)
        try {
          await request('/act', { action: 'project.delete', uid: project.uid })
          closeDetail()
          await load()
          flash('项目已删除')
        } catch (err) {
          flash(err.message, true)
        } finally {
          setBusy(false)
        }
      }

      const act = async (payload, quiet = false) => {
        setBusy(true)
        try {
          await request('/act', payload)
          await load()
          if (detailUid) {
            const data = await request(`/project?uid=${detailUid}`)
            setDetail(data.project)
          }
          if (!quiet) flash('已写回 Markdown')
          return true
        } catch (err) {
          flash(err.message, true)
          return false
        } finally {
          setBusy(false)
        }
      }

      const createItem = async ({ uid, patch }) => {
        setBusy(true)
        try {
          await request('/act', { action: 'item.add', uid: Number(uid) || 0, ...patch })
          setItemCreator(false)
          await load()
          if (detailUid) {
            const data = await request(`/project?uid=${detailUid}`)
            setDetail(data.project)
          }
          flash(uid ? '事项已添加到项目' : '已添加到 日常工作')
        } catch (err) {
          flash(err.message, true)
        } finally {
          setBusy(false)
        }
      }

      const saveReport = async patch => {
        if (!reportDetail) return
        setBusy(true)
        try {
          await request('/act', { action: 'report.update', path: reportDetail.relPath, ...patch })
          await load()
          setReportDetail(null)
          flash('汇报已更新')
        } catch (err) {
          flash(err.message, true)
        } finally {
          setBusy(false)
        }
      }

      const initialize = async () => {
        setBusy(true)
        try {
          const data = await request('/init', {})
          setCreated(data.created || [])
          await load()
          flash('档案已初始化')
        } catch (err) {
          flash(err.message, true)
        } finally {
          setBusy(false)
        }
      }
      const rebuild = async () => {
        setBusy(true)
        try { await request('/index', {}); await load(); flash('索引已重建') }
        catch (err) { flash(err.message, true) }
        finally { setBusy(false) }
      }
      const migrate = async () => {
        setBusy(true)
        try { await request('/act', { action: 'migrate' }); await load(); flash('已迁移到文件夹结构（README + 事项/）') }
        catch (err) { flash(err.message, true) }
        finally { setBusy(false) }
      }

      const tabs = [['home', t('tabHome')], ['projects', t('tabProjects')], ['people', t('tabPeople')], ['settings', t('tabSettings')]]
      const shell = children => h('div', { className: 'wo-root' }, h('style', null, CSS), children)

      if (!state && !error) return shell(h('div', { className: 'wo-empty' }, t('loading')))
      if (!state) {
        return shell(h('div', { className: 'wo-stack', style: { padding: 12 } },
          h('div', { className: 'wo-empty' }, `读取失败：${error}`),
          h(Button, { block: true, onClick: load }, '重试')))
      }

      return h('div', { className: 'wo-root' },
        h('style', null, CSS),
        h('div', { className: 'wo-top' },
          h('div', { className: 'wo-brand' }, t('nav')),
          h('div', { className: 'wo-path', title: state.root }, shortPath(state.root)),
          h(Button, { small: true, kind: 'primary', onClick: () => setReportModal({ tab: 'manual', scope: { kind: 'personal' } }) }, '汇报'),
          h(Button, { small: true, onClick: () => setItemCreator(true), disabled: busy }, '添加事项'),
          h(Button, { small: true, onClick: load, disabled: busy }, t('refresh'))),
        h('div', { className: 'wo-nav' }, tabs.map(([key, label]) =>
          h('button', { key, type: 'button', className: tab === key ? 'on' : '', onClick: () => { setTab(key); if (key !== 'projects') closeDetail() } }, label))),
        h('div', { className: 'wo-scroll' },
          created && created.length ? h('div', { className: 'wo-banner' },
            h('span', null, h('b', null, '已初始化'), ` 当前工作区 workos/，新建 ${created.length} 个文件`),
            h('span', { className: 'wo-link', onClick: () => setCreated(null) }, '知道了')) : null,
          tab === 'home' ? h(Home, {
            state,
            daily: state.daily,
            onOpen: openProject,
            onChat: addToChat,
            onAct: act,
            onAddItem: () => setItemCreator(true),
            reports: (state.reports || []).filter(report => report.scope !== 'project'),
            onGenerateReport: () => setReportModal({ tab: 'manual', scope: { kind: 'personal' } }),
            onAutoReport: () => setReportModal({ tab: 'auto', scope: { kind: 'personal' } }),
            onOpenReportDetail: report => setReportDetail(report),
            onRefresh: load,
            busy,
          }) : null,
          tab === 'projects' ? (detail
            ? h(ProjectDetail, {
              project: detail,
              contacts: state.contacts,
              reports: state.reports || [],
              allProjects: state.projects,
              dailyItems: state.daily?.items || [],
              onBack: closeDetail,
              onAct: act,
              onChat: addToChat,
              onDeleteProject: deleteProject,
              onOpenReport: (mode, target) => setReportModal({
                tab: mode,
                scope: target ? { kind: 'project', uid: target.uid, name: target.name } : { kind: 'personal' },
              }),
              onOpenReportDetail: report => setReportDetail(report),
              onRefresh: load,
              busy,
              initialItemId: initialItem,
              workspace: state.workspace,
            })
            : detailUid
              ? h('div', { className: 'wo-empty' }, '读取项目…')
              : h(ProjectList, { state, onOpen: openProject, onCreate: form => act({ action: 'project.create', ...form }), onChat: addToChat, busy })) : null,
          tab === 'people' ? h(People, { state, onAct: act, onChat: addToChat, busy }) : null,
          tab === 'settings' ? h(Settings, { state, onInit: initialize, onRebuild: rebuild, onMigrate: migrate, busy }) : null),
        itemCreator ? h(ItemModal, {
          projects: state.projects,
          contacts: state.contacts,
          withProjectPicker: true,
          onClose: () => setItemCreator(false),
          onSave: createItem,
          busy,
        }) : null,
        reportModal ? h(ReportGenerateModal, {
          initialTab: reportModal.tab,
          scope: reportModal.scope,
          sessionId,
          workspacePath: state.workspace,
          services,
          flash,
          onClose: () => setReportModal(null),
          onStarted: beginReportPolling,
        }) : null,
        reportDetail ? h(ReportDetailModal, {
          report: reportDetail,
          onClose: () => setReportDetail(null),
          onSave: saveReport,
          busy,
        }) : null,
        error ? h('div', { className: 'wo-toast err' }, error) : null,
        toast ? h('div', { className: `wo-toast${toast.isError ? ' err' : ''}` }, toast.message) : null)
    }

    /* ------------------------------------------------------------- registration */

    function Glyph({ size = 16 }) {
      return h('svg', { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', 'aria-hidden': true, style: { display: 'block' } },
        h('path', { d: 'M4.5 6.2h15v9.6h-15z', stroke: 'currentColor', strokeWidth: 1.6, strokeLinejoin: 'round' }),
        h('path', { d: 'M8 19.2h8', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round' }),
        h('path', { d: 'M12 15.8v3.4', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round' }),
        h('circle', { cx: '8.4', cy: '10.4', r: '1.35', fill: 'currentColor' }),
        h('path', { d: 'M11.4 10.4h5.2M11.4 12.7h3.4', stroke: 'currentColor', strokeWidth: 1.3, strokeLinecap: 'round' }))
    }

    function Body(props) {
      const info = props.useTabInfo ? props.useTabInfo() : undefined
      const visible = info?.tab?.visible ?? true
      return h(App, {
        sessionId: props.sessionId,
        t: props.t,
        visible,
        inputActions: props.inputActions,
        services: props.services,
      })
    }

    return {
      inject: ['slots', 'locale', 'sidebarRightTabs', 'sessions', 'uiWorkspace', 'workspaces', 'remote', 'remote.schedule'],
      apply(ctx) {
        ctx.effect(() => ctx.locale.register(NS, { zh: DICTS.zh, en: DICTS.en }), 'workos: dictionaries')
        const t = ctx.locale.bind(NS)

        /**
         * Create the report Session, send the prompt into it, then open it.
         *
         * Two invariants this keeps, both learned the hard way:
         * - Send before navigating. The cockpit pane is Session-scoped, so opening another
         *   Session unmounts it and both the inevitable error message and the modal disappear;
         *   keeping the pane mounted until the prompt is accepted keeps failures visible.
         * - Send through the Session face instead of the scope-bound conversation service.
         *   `binding.session.prompt` addresses the Session id explicitly and cannot be lost to a
         *   scope rebinding, and its accepted/rejected result is checkable.
         * @param prompt - report instruction.
         * @param sessionId - the Session whose Workspace the new conversation belongs to.
         * @param workspacePath - fallback directory when the Session has no Workspace.
         * @param targetSessionId - identity pre-reserved by an automation task, when starting one now.
         * @returns the created (or claimed) Session id.
         */
        const startReportConversation = async (prompt, sessionId, workspacePath, targetSessionId) => {
          const workspace = ctx.workspaces?.list?.getSnapshot?.().items
            ?.find(item => item.sessionIds.includes(sessionId))
          if (!workspace && !workspacePath) throw new Error('当前会话没有绑定工作区，无法新建对话')
          const newSessionId = await ctx.sessions.create({
            ...(workspace ? { workspaceId: workspace.workspaceId } : { cwd: workspacePath }),
            ...(targetSessionId ? { sessionId: targetSessionId } : {}),
          })
          let outcome
          try {
            outcome = await ctx.sessions.using(newSessionId, { source: 'controllerOperation' }, reference =>
              reference.binding.session.prompt([{ type: 'text', text: prompt }], 'queue'))
          } catch (err) {
            throw new Error(`新建的对话没能接住提示词：${err?.message || String(err)}`)
          }
          if (!outcome?.ok) {
            const reason = outcome?.error ? `${outcome.error.code}: ${outcome.error.message}` : '未知原因'
            throw new Error(`新建的对话拒绝了提示词（${reason}）`)
          }
          ctx.uiWorkspace.openSession(newSessionId)
          return newSessionId
        }

        const createSchedule = async request => {
          if (!ctx.remote?.schedule?.create) throw new Error('当前环境没有可用的自动化任务服务')
          const result = await ctx.remote.schedule.create(request)
          if (!result.ok) {
            throw new Error(result.error?.message || result.error?.code || '创建定时任务失败')
          }
          return result.value
        }

        const reportServices = {
          startReportConversation,
          createSchedule,
        }

        ctx.effect(() => ctx.sidebarRightTabs.register({
          id: TYPE_ID,
          kind: KIND,
          priority: 'extension',
          title: () => t('nav'),
          guide: [{ id: 'open', order: 40, title: () => t('nav'), description: () => t('guide'), icon: Glyph }],
        }), 'workos: tab type')
        ctx.effect(() => ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register({
          name: 'sidebar.right.pane.tab',
          key: TYPE_ID,
          locale: NS,
          inject: sessionId => ({ sessionId, services: reportServices }),
        }, Body)), 'workos: tab body')
      },
    }
  },
})
