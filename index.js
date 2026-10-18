/**
 * Host half of the selection translator.
 *
 * The browser cannot call translation providers directly (CORS plus no
 * credential handling), so it posts the selected text to this same-origin
 * route. Translation itself is delegated to the Host `translator` service.
 * That service is composed for Agent contexts, so the route looks it up on the
 * root context first and then on every live Agent context.
 */
export const name = 'selection-translator'
export const inject = ['webServer', 'translator']

const ROUTE_PATH = '/api/dsh/selection-translator'
const MAX_TEXT_CHARS = 6000

function json(res, status, body) {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  })
  res.end(JSON.stringify(body))
}

function sameOrigin(req) {
  if (req.headers['sec-fetch-site'] === 'cross-site') return false
  const origin = req.headers.origin
  if (typeof origin !== 'string' || origin === '' || origin === 'null') return true
  const host = req.headers.host
  if (typeof host !== 'string' || host === '') return false
  try {
    return new URL(origin).host === host
  } catch {
    return false
  }
}

function readBody(req, limit = 128 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > limit) {
        reject(new Error('body-too-large'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      try {
        resolve(chunks.length === 0 ? {} : JSON.parse(Buffer.concat(chunks).toString('utf8')))
      } catch {
        reject(new Error('invalid-json'))
      }
    })
    req.on('error', reject)
  })
}

function describeError(error) {
  if (error instanceof Error) return error.message || error.name
  return String(error)
}

function getService(scope, key) {
  try {
    return typeof scope?.get === 'function' ? scope.get(key) : undefined
  } catch {
    return undefined
  }
}

/**
 * The translator is provided to Agent compositions. Prefer the root service
 * when a composition places it there, otherwise reuse a live Agent's service.
 */
function translatorScopes(ctx) {
  const candidates = []
  const root = getService(ctx, 'translator')
  if (root !== undefined) candidates.push({ label: 'root', translator: root })

  const agents = getService(ctx, 'agents')
  if (agents !== undefined && typeof agents.list === 'function') {
    try {
      for (const agent of agents.list()) {
        const translator = getService(agent?.ctx, 'translator')
        if (translator !== undefined && !candidates.some((entry) => entry.translator === translator)) {
          candidates.push({ label: 'agent', translator })
        }
      }
    } catch {
      /* an agent disposing mid-scan must not fail the request */
    }
  }
  return candidates
}

/** Anonymous providers are the only ones this route may use without a Session. */
const ANONYMOUS_PROVIDERS = ['bing', 'google']

function pickProviders(available) {
  if (!Array.isArray(available)) return []
  return ANONYMOUS_PROVIDERS.filter((provider) => available.includes(provider))
}

/** Whether the browser module loader advertised this package's client half. */
function clientModuleState(ctx) {
  const clientModules = getService(ctx, 'clientModules')
  if (clientModules === undefined || typeof clientModules.clientPath !== 'function') return undefined
  try {
    return clientModules.clientPath('dsh-selection-translator') !== undefined
  } catch {
    return undefined
  }
}

/**
 * Translate one fragment. The service normalizes provider-specific language
 * tags, but the target tag differs between providers in older Harness builds,
 * so a small ordered list keeps both generations working.
 */
async function translateWithService(translator, text, signal) {
  const available = await translator.availableProviders(signal)
  const providers = pickProviders(available)
  if (providers.length === 0) {
    const error = new Error('no-anonymous-translation-provider')
    error.available = Array.isArray(available) ? available : []
    throw error
  }
  let lastError
  for (const provider of providers) {
    for (const targetLanguage of ['zh', 'zh-CN', 'zh-Hans']) {
      try {
        const spec = translator.resolve({
          text,
          targetLanguage,
          provider,
        })
        const translated = await translator.translate(spec, signal)
        if (typeof translated === 'string' && translated.trim() !== '') {
          return { text: translated.trim(), provider }
        }
      } catch (error) {
        lastError = error
      }
    }
  }
  throw lastError instanceof Error ? lastError : new Error('translation-failed')
}

export function apply(ctx) {
  const route = {
    kind: 'exact',
    path: ROUTE_PATH,
    async handler(req, res) {
      if (!sameOrigin(req)) {
        json(res, 403, { ok: false, error: 'cross-site-request-rejected' })
        return
      }

      if (req.method === 'GET') {
        const scopes = translatorScopes(ctx)
        const providers = []
        for (const scope of scopes) {
          try {
            const available = await scope.translator.availableProviders()
            for (const provider of Array.isArray(available) ? available : []) {
              if (!providers.includes(provider)) providers.push(provider)
            }
          } catch {
            /* diagnostics only */
          }
        }
        json(res, 200, {
          ok: true,
          translator: scopes.length > 0,
          scopes: scopes.map((entry) => entry.label),
          providers,
          clientModule: clientModuleState(ctx),
          route: ROUTE_PATH,
        })
        return
      }

      if (req.method !== 'POST') {
        json(res, 405, { ok: false, error: 'method-not-allowed' })
        return
      }

      try {
        const body = await readBody(req)
        const text = typeof body === 'object' && body !== null ? body.text : undefined
        if (typeof text !== 'string' || text.trim() === '') {
          json(res, 400, { ok: false, error: 'empty-text' })
          return
        }
        const trimmed = text.trim()
        const scopes = translatorScopes(ctx)
        if (scopes.length === 0) {
          json(res, 503, { ok: false, error: 'translator-service-unavailable' })
          return
        }
        const serviceLimit = scopes[0].translator.maxTextChars
        const limit = Number.isFinite(serviceLimit) && serviceLimit > 0
          ? Math.min(MAX_TEXT_CHARS, serviceLimit)
          : MAX_TEXT_CHARS
        if (trimmed.length > limit) {
          json(res, 413, { ok: false, error: 'text-too-long', maxTextChars: limit })
          return
        }
        let lastError
        for (const scope of scopes) {
          const controller = new AbortController()
          const timer = setTimeout(() => controller.abort(), 20_000)
          try {
            const result = await translateWithService(scope.translator, trimmed, controller.signal)
            json(res, 200, { ok: true, text: result.text, provider: result.provider, scope: scope.label })
            return
          } catch (error) {
            lastError = error
          } finally {
            clearTimeout(timer)
          }
        }
        throw lastError instanceof Error ? lastError : new Error('translation-failed')
      } catch (error) {
        json(res, 500, {
          ok: false,
          error: describeError(error),
          available: Array.isArray(error?.available) ? error.available : undefined,
        })
      }
    },
  }

  ctx.effect(() => {
    const dispose = ctx.webServer.register(route)
    return () => dispose()
  }, 'selection-translator: same-origin translation route')
}
