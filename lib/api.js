/**
 * JSON API served by the DSH web server for the cockpit tab.
 *
 * Every call names the Session it speaks for; the resolver maps that Session's
 * working directory to `<workspace>/<subdir>` and initializes it on first use.
 * Agent tools reach the same Store methods through the resolver, so the page
 * and the agent never diverge.
 */

function send(res, status, value) {
  const body = JSON.stringify(value)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(body),
  })
  res.end(body)
}

function readBody(req, limit = 1_000_000) {
  return new Promise((resolve, reject) => {
    let size = 0
    const chunks = []
    req.on('data', chunk => {
      size += chunk.length
      if (size > limit) {
        reject(new Error('请求内容过大'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      const text = Buffer.concat(chunks).toString('utf8')
      if (!text.trim()) return resolve({})
      try {
        resolve(JSON.parse(text))
      } catch {
        reject(new Error('请求内容不是合法 JSON'))
      }
    })
    req.on('error', reject)
  })
}

function sameOrigin(req) {
  const origin = req.headers.origin
  if (!origin) return true
  try {
    return new URL(origin).host === req.headers.host
  } catch {
    return false
  }
}

export function createApi({ resolver, subdir, authorize }) {
  return async function handler(req, res) {
    try {
      if (authorize) {
        const rejection = authorize(req)
        if (rejection) return send(res, rejection, { ok: false, error: '未通过 DSH 浏览器认证' })
      }
      if (!sameOrigin(req)) return send(res, 403, { ok: false, error: '仅允许本页面调用' })
      const url = new URL(req.url || '/workos-api', 'http://localhost')
      const route = url.pathname.replace(/^\/workos-api/, '') || '/'
      const method = req.method || 'GET'

      if (method === 'GET' && route === '/health') {
        return send(res, 200, { ok: true, service: 'workos' })
      }

      if (method === 'POST') {
        const payload = await readBody(req)
        const sessionId = payload.sessionId ? String(payload.sessionId) : undefined

        if (route === '/init') {
          const scope = await resolver.scope(sessionId, { reinitialize: true })
          const stats = await scope.index.sync({ force: true })
          return send(res, 200, { ok: true, root: scope.root, workspace: scope.root, created: scope.created, stats })
        }

        if (route === '/index') {
          const scope = await resolver.scope(sessionId)
          const stats = await scope.index.sync({ force: true })
          return send(res, 200, { ok: true, stats })
        }

        if (route === '/act') {
          const action = String(payload.action || '')
          if (!action) return send(res, 400, { ok: false, error: '缺少 action' })
          const scope = await resolver.scope(sessionId)
          const result = await scope.store.apply(action, payload)
          await scope.index.sync({ force: true })
          return send(res, 200, result)
        }

        return send(res, 404, { ok: false, error: `未知接口：${method} ${route}` })
      }

      const sessionId = url.searchParams.get('sessionId') || undefined
      const scope = await resolver.scope(sessionId)

      if (route === '/state') {
        const state = await scope.store.state()
        const meta = await scope.index.sync().catch(() => null)
        const reports = await scope.store.listReports().catch(() => [])
        return send(res, 200, {
          ...state,
          root: scope.root,
          workspace: scope.workspace,
          subdir,
          reports,
          created: scope.created.splice(0),
          indexMeta: meta,
        })
      }

      if (route === '/reports') {
        const reports = await scope.store.listReports()
        return send(res, 200, { ok: true, root: scope.root, reports })
      }

      if (route === '/project') {
        const uid = Number(url.searchParams.get('uid'))
        if (!uid) return send(res, 400, { ok: false, error: '缺少 uid' })
        const { entry } = await scope.store.findProject(uid)
        const project = await scope.store.loadProjectFile(entry)
        if (!project) return send(res, 404, { ok: false, error: '项目不存在' })
        return send(res, 200, { ok: true, project: { ...project, summary: scope.store.summarize(project) } })
      }

      return send(res, 404, { ok: false, error: `未知接口：${method} ${route}` })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return send(res, 400, { ok: false, error: message })
    }
  }
}
