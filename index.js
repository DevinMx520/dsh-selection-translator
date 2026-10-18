/**
 * Host half of the selection translator.
 *
 * The browser posts selected fragments to this same-origin route. Translation
 * is delegated to the Host `translator` service; long fragments are split into
 * provider-sized chunks and translated in order, so the browser never has to
 * reject a selection as "too long".
 */
export const name = 'selection-translator'
export const inject = ['webServer', 'translator']

const ROUTE_PATH = '/api/dsh/selection-translator'
const MAX_TEXTS = 24
const CHUNK_CHARS = 3500
const CONCURRENCY = 3
const CACHE_LIMIT = 300
const REQUEST_TIMEOUT_MS = 20_000

/** Successful whole-fragment translations, capped to keep memory bounded. */
const cache = new Map()

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

function readBody(req, limit = 1024 * 1024) {
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

/** The translator is composed for Agent contexts; root is preferred. */
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

/** Anonymous providers are the only ones this route may use without a Session. */
const ANONYMOUS_PROVIDERS = ['bing', 'google']

function pickProviders(available) {
  if (!Array.isArray(available)) return []
  return ANONYMOUS_PROVIDERS.filter((provider) => available.includes(provider))
}

/** Prefer a paragraph/sentence boundary and never split a surrogate pair. */
function findCut(text, limit) {
  const windowText = text.slice(0, limit)
  let index = windowText.lastIndexOf('\n\n')
  if (index >= limit * 0.5) return index + 2

  const sentence = /[.!?。！？；;]\s+/g
  let last = -1
  let match
  while ((match = sentence.exec(windowText)) !== null) last = match.index + match[0].length
  if (last >= limit * 0.5) return last

  index = Math.max(windowText.lastIndexOf('\n'), windowText.lastIndexOf(' '))
  if (index >= limit * 0.5) return index + 1

  let cut = limit
  const code = text.charCodeAt(cut - 1)
  if (code >= 0xd800 && code <= 0xdbff) cut -= 1
  return cut
}

function splitText(text, limit) {
  if (text.length <= limit) return [text]
  const chunks = []
  let rest = text
  while (rest.length > limit) {
    const cut = findCut(rest, limit)
    chunks.push(rest.slice(0, cut))
    rest = rest.slice(cut)
  }
  if (rest !== '') chunks.push(rest)
  return chunks
}

async function translateChunk(session, text, signal) {
  let lastError
  for (const provider of session.providers) {
    for (const targetLanguage of ['zh', 'zh-CN', 'zh-Hans']) {
      try {
        const spec = session.translator.resolve({ text, targetLanguage, provider })
        const translated = await session.translator.translate(spec, signal)
        if (typeof translated === 'string' && translated.trim() !== '') return translated.trim()
      } catch (error) {
        lastError = error
      }
    }
  }
  throw lastError instanceof Error ? lastError : new Error('translation-failed')
}

function remember(key, value) {
  if (cache.size >= CACHE_LIMIT) {
    const oldest = cache.keys().next().value
    if (oldest !== undefined) cache.delete(oldest)
  }
  cache.set(key, value)
}

async function translateWithSession(session, text, signal) {
  const cached = cache.get(text)
  if (cached !== undefined) return cached
  const parts = []
  for (const chunk of splitText(text, CHUNK_CHARS)) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
    let merged = controller.signal
    if (signal !== undefined) {
      try {
        merged = AbortSignal.any([signal, controller.signal])
      } catch {
        merged = controller.signal
      }
    }
    try {
      parts.push(await translateChunk(session, chunk, merged))
    } finally {
      clearTimeout(timer)
    }
  }
  const translated = parts.join('')
  remember(text, translated)
  return translated
}

async function translateText(sessions, text, signal) {
  if (text.trim() === '') return ''
  let lastError
  for (const session of sessions) {
    try {
      return await translateWithSession(session, text, signal)
    } catch (error) {
      lastError = error
    }
  }
  throw lastError instanceof Error ? lastError : new Error('translation-failed')
}

async function translateBatch(sessions, texts, signal) {
  const results = new Array(texts.length)
  let cursor = 0
  const workers = Array.from({ length: Math.min(CONCURRENCY, texts.length) }, async () => {
    while (true) {
      const index = cursor
      cursor += 1
      if (index >= texts.length) return
      const text = texts[index]
      if (typeof text !== 'string') {
        results[index] = { ok: false, error: 'invalid-text' }
        continue
      }
      if (text.trim() === '') {
        results[index] = { ok: true, text: '' }
        continue
      }
      try {
        results[index] = { ok: true, text: await translateText(sessions, text, signal) }
      } catch (error) {
        results[index] = { ok: false, error: describeError(error) }
      }
    }
  })
  await Promise.all(workers)
  return results
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

      const scopes = translatorScopes(ctx)

      if (req.method === 'GET') {
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

      const controller = new AbortController()
      req.on('aborted', () => controller.abort())
      res.on('close', () => {
        if (!res.writableEnded) controller.abort()
      })

      try {
        let sessions = []
        for (const scope of scopes) {
          try {
            const available = await scope.translator.availableProviders(controller.signal)
            const providers = pickProviders(available)
            if (providers.length > 0) sessions.push({ translator: scope.translator, providers })
          } catch {
            /* an unusable scope is skipped */
          }
        }
        if (sessions.length === 0) {
          json(res, 503, { ok: false, error: 'no-anonymous-translation-provider' })
          return
        }

        const body = await readBody(req)

        if (Array.isArray(body.texts)) {
          const texts = body.texts
          if (texts.length === 0) {
            json(res, 400, { ok: false, error: 'empty-texts' })
            return
          }
          if (texts.length > MAX_TEXTS) {
            json(res, 400, { ok: false, error: 'too-many-texts', maxTexts: MAX_TEXTS })
            return
          }
          const results = await translateBatch(sessions, texts, controller.signal)
          json(res, 200, { ok: true, results })
          return
        }

        const text = typeof body.text === 'string' ? body.text.trim() : ''
        if (text === '') {
          json(res, 400, { ok: false, error: 'empty-text' })
          return
        }
        const translated = await translateText(sessions, text, controller.signal)
        json(res, 200, { ok: true, text: translated })
      } catch (error) {
        if (controller.signal.aborted) {
          json(res, 499, { ok: false, error: 'aborted' })
          return
        }
        json(res, 500, { ok: false, error: describeError(error) })
      }
    },
  }

  ctx.effect(() => {
    const dispose = ctx.webServer.register(route)
    return () => dispose()
  }, 'selection-translator: same-origin translation route')
}
