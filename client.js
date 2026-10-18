window.__ModuleLoader__.load({
  id: 'dsh-selection-translator',
  factory(require) {
    const React = require('react')
    const h = React.createElement

    const NS = 'selection-translator'
    const ROUTE = '/api/dsh/selection-translator'
    const TRANSLATED_ATTR = 'data-dsh-translated'
    const BLOCK_SELECTOR = 'p, li, h1, h2, h3, h4, h5, h6, blockquote, dt, dd, td, th, figcaption, div'
    const OPAQUE_SELECTOR = 'pre, code, kbd, samp, textarea'
    const MEDIA_SELECTOR = 'img, svg, math, video, audio, canvas'
    const SKIP_SELECTOR = OPAQUE_SELECTOR + ', ' + MEDIA_SELECTOR + ', [data-dsh-translated]'
    const MAX_BLOCK_CHARS = 3400
    const BATCH_SIZE = 8

    const DICTS = {
      'zh-CN': {
        copy: '复制',
        translate: '翻译成中文',
        restore: '取消翻译',
        translating: '正在翻译',
        failed: '翻译失败，请重试',
        empty: '没有可翻译的文字',
        untitled: '已翻译 · 右键可还原',
      },
      en: {
        copy: 'Copy',
        translate: 'Translate to Chinese',
        restore: 'Undo translation',
        translating: 'Translating',
        failed: 'Translation failed, please retry',
        empty: 'Nothing to translate',
        untitled: 'Translated · right-click to restore',
      },
    }

    const CSS = `
      .dsh-st-menu{position:fixed;z-index:2147483000;min-width:196px;max-width:300px;padding:5px;border-radius:10px;background:var(--dsw-alias-bg-overlay,#ffffff);border:1px solid var(--dsw-alias-border-l1,rgba(15,23,42,.12));box-shadow:0 10px 30px rgba(15,23,42,.18);font-family:inherit;font-size:13px;line-height:1.4;color:var(--dsw-alias-label-primary,#0f172a);-webkit-user-select:none;user-select:none;pointer-events:auto}
      .dsh-st-item{display:flex;align-items:center;gap:8px;padding:7px 10px;border-radius:7px;cursor:pointer;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;outline:none}
      .dsh-st-item:hover{background:var(--dsw-alias-bg-layer-2,rgba(15,23,42,.07))}
      .dsh-st-item[data-disabled="true"]{opacity:.6;cursor:default}
      .dsh-st-item[data-disabled="true"]:hover{background:transparent}
      .dsh-st-icon{display:inline-flex;width:16px;height:16px;flex:none;align-items:center;justify-content:center;opacity:.85}
      .dsh-st-sep{height:1px;margin:4px 6px;background:var(--dsw-alias-border-l1,rgba(15,23,42,.1))}
      .dsh-st-error{font-size:11px;line-height:1.4;color:var(--dsw-alias-state-error-primary,#dc2626);padding:3px 10px 4px;white-space:normal}
      .dsh-st-progress{display:flex;flex-direction:column;gap:5px;padding:5px 10px 3px}
      .dsh-st-progress-track{height:4px;border-radius:999px;background:var(--dsw-alias-bg-layer-2,rgba(15,23,42,.1));overflow:hidden}
      .dsh-st-progress-fill{height:100%;border-radius:999px;background:var(--dsw-alias-brand-primary,#4d6bfe);transition:width .2s ease}
      .dsh-st-progress-label{display:flex;justify-content:space-between;gap:10px;font-size:11px;color:var(--dsw-alias-label-secondary,#64748b)}
      .dsh-st-translated{text-decoration:underline dotted currentColor;text-decoration-thickness:1px;text-underline-offset:2px;cursor:text}
    `

    /** span -> the translation group it belongs to. */
    const records = new Map()
    /** Every group currently applied, for disposal. */
    const groups = new Set()

    /**
     * The menu is deliberately Chinese-only: the caller asked for 汉字 labels
     * regardless of the active UI locale.
     */
    function createT() {
      return (key) => DICTS['zh-CN'][key] || key
    }

    function isEditable(node) {
      if (!(node instanceof Element)) return false
      return node.closest('input, textarea, select, [contenteditable=""], [contenteditable="true"], [contenteditable="plaintext-only"]') !== null
    }

    function translatedAncestor(node) {
      if (!(node instanceof Element)) return null
      return node.closest('[' + TRANSLATED_ATTR + '="1"]')
    }

    /** True when the point falls inside the live selection's painted boxes. */
    function pointInSelection(selection, x, y) {
      if (!selection || selection.isCollapsed || selection.rangeCount === 0) return false
      const rects = selection.getRangeAt(0).getClientRects()
      for (const rect of rects) {
        if (x >= rect.left - 2 && x <= rect.right + 2 && y >= rect.top - 2 && y <= rect.bottom + 2) return true
      }
      return false
    }

    /** Latin/Cyrillic/Greek/Arabic/Indic/kana/Hangul: worth sending to a zh target. */
    const LETTER_RE = /[A-Za-z\u00C0-\u024F\u0370-\u04FF\u0590-\u05FF\u0600-\u06FF\u0900-\u097F\u3040-\u30FF\uAC00-\uD7AF]/

    function hasLetter(text) {
      return LETTER_RE.test(text)
    }

    function collectTextNodes(range) {
      const root = range.commonAncestorContainer
      const container = root.nodeType === Node.TEXT_NODE ? root.parentNode : root
      if (!container) return []
      const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT)
      const nodes = []
      let node
      while ((node = walker.nextNode())) {
        if (!node.nodeValue) continue
        if (!range.intersectsNode(node)) continue
        nodes.push(node)
      }
      return nodes
    }

    function coversBlock(range, block) {
      try {
        const whole = document.createRange()
        whole.selectNodeContents(block)
        return range.compareBoundaryPoints(0, whole) <= 0 && range.compareBoundaryPoints(2, whole) >= 0
      } catch {
        return false
      }
    }

    /**
     * A block that nests other blocks (a list item holding a paragraph, a div
     * holding sections) must not be rebuilt as a leaf: its nested content is
     * owned by those inner blocks.
     */
    function hasNestedBlock(block) {
      for (const child of block.querySelectorAll(BLOCK_SELECTOR)) {
        if (child !== block) return true
      }
      return false
    }

    function buildBlockSource(block) {
      const codeNodes = []
      let source = ''
      const walk = (parent) => {
        for (const child of parent.childNodes) {
          if (child.nodeType === Node.TEXT_NODE) {
            source += child.nodeValue
            continue
          }
          if (child.nodeType !== Node.ELEMENT_NODE) continue
          if (child.matches(OPAQUE_SELECTOR) || child.matches(MEDIA_SELECTOR)) {
            const index = codeNodes.length
            codeNodes.push(child)
            source += '[[' + index + ']]'
            continue
          }
          if (child.tagName === 'BR') {
            source += '\n'
            continue
          }
          if (child.matches('script, style')) continue
          if (child !== block && child.matches(BLOCK_SELECTOR)) continue
          walk(child)
        }
      }
      walk(block)
      return { source, codeNodes }
    }

    function segmentForNode(node, range) {
      const value = node.nodeValue || ''
      let start = 0
      let end = value.length
      if (node === range.startContainer) start = range.startOffset
      if (node === range.endContainer) end = range.endOffset
      if (start >= end) return null
      const text = value.slice(start, end)
      const leading = (text.match(/^\s+/) || [''])[0]
      const trailing = (text.match(/\s+$/) || [''])[0]
      const core = text.slice(leading.length, text.length - trailing.length)
      if (core === '') return null
      return {
        start: start + leading.length,
        end: end - trailing.length,
        prefix: leading,
        suffix: trailing,
        core,
      }
    }

    /**
     * Split the selection into translation units. A fully selected block is
     * rebuilt from one request (code elements travel as placeholders); a
     * partially selected block is translated text-node by text-node.
     */
    function planUnits(range) {
      const nodes = collectTextNodes(range)
      const blockMap = new Map()
      for (const node of nodes) {
        const parent = node.parentElement
        if (!parent) continue
        if (parent.closest(SKIP_SELECTOR)) continue
        const block = parent.closest(BLOCK_SELECTOR)
        if (!block || !block.isConnected) continue
        const list = blockMap.get(block)
        if (list) list.push(node)
        else blockMap.set(block, [node])
      }

      const units = []
      for (const [block, blockNodes] of blockMap) {
        if (!hasNestedBlock(block) && coversBlock(range, block)) {
          const built = buildBlockSource(block)
          if (hasLetter(built.source) && built.source.length <= MAX_BLOCK_CHARS) {
            units.push({ kind: 'block', block, source: built.source, codeNodes: built.codeNodes })
            continue
          }
        }
        for (const node of blockNodes) {
          const segment = segmentForNode(node, range)
          if (!segment || !hasLetter(segment.core)) continue
          units.push({
            kind: 'text',
            node,
            start: segment.start,
            end: segment.end,
            core: segment.core,
            source: segment.core,
          })
        }
      }
      return units
    }

    function applyBlock(unit, translated, title) {
      const { block, codeNodes } = unit
      if (!block.isConnected) return null
      const original = document.createDocumentFragment()
      while (block.firstChild) original.append(block.firstChild)

      const spans = []
      const appendText = (text) => {
        if (text === '') return
        if (text.trim() === '') {
          block.append(document.createTextNode(text))
          return
        }
        const span = document.createElement('span')
        span.className = 'dsh-st-translated'
        span.setAttribute(TRANSLATED_ATTR, '1')
        span.title = title
        span.textContent = text
        block.append(span)
        spans.push(span)
      }

      const placed = new Set()
      const pattern = /\[\[(\d+)\]\]/g
      let lastIndex = 0
      let match
      while ((match = pattern.exec(translated)) !== null) {
        appendText(translated.slice(lastIndex, match.index))
        const index = Number(match[1])
        const code = codeNodes[index]
        if (code) {
          block.append(code.cloneNode(true))
          placed.add(index)
        }
        lastIndex = pattern.lastIndex
      }
      appendText(translated.slice(lastIndex))

      for (let index = 0; index < codeNodes.length; index += 1) {
        if (!placed.has(index)) block.append(codeNodes[index].cloneNode(true))
      }

      if (spans.length === 0) {
        block.replaceChildren(original)
        return null
      }
      return { block, original, spans }
    }

    function applyText(unit, translated, title) {
      const { node, start, end, core } = unit
      if (!node.isConnected) return null
      const range = document.createRange()
      try {
        range.setStart(node, start)
        range.setEnd(node, end)
      } catch {
        return null
      }
      const span = document.createElement('span')
      span.className = 'dsh-st-translated'
      span.setAttribute(TRANSLATED_ATTR, '1')
      span.title = title
      span.textContent = translated
      try {
        range.surroundContents(span)
      } catch {
        return null
      }
      return { span, original: core }
    }

    function applyUnits(units, results, group, title) {
      let applied = 0
      units.forEach((unit, index) => {
        const result = results[index]
        if (!result || result.ok !== true || typeof result.text !== 'string') return
        const translated = result.text.trim()
        if (translated === '' || translated === unit.source.trim()) return
        if (unit.kind === 'block') {
          const entry = applyBlock(unit, translated, title)
          if (!entry) return
          group.blocks.push(entry)
          for (const span of entry.spans) records.set(span, group)
          applied += 1
          return
        }
        const entry = applyText(unit, translated, title)
        if (!entry) return
        group.texts.push(entry)
        records.set(entry.span, group)
        applied += 1
      })
      return applied
    }

    function restoreGroup(group) {
      if (!group || group.done) return
      group.done = true
      for (const entry of group.blocks) {
        for (const span of entry.spans) records.delete(span)
        if (entry.block.isConnected) entry.block.replaceChildren(entry.original)
      }
      for (const entry of group.texts) {
        records.delete(entry.span)
        if (entry.span.isConnected) entry.span.replaceWith(document.createTextNode(entry.original))
      }
      groups.delete(group)
    }

    function restoreAll() {
      for (const group of [...groups]) restoreGroup(group)
    }

    async function copyText(text) {
      try {
        await navigator.clipboard.writeText(text)
        return true
      } catch {
        /* fall through to a temporary selection */
      }
      try {
        const area = document.createElement('textarea')
        area.value = text
        area.setAttribute('readonly', '')
        area.style.position = 'fixed'
        area.style.top = '-9999px'
        document.body.appendChild(area)
        area.select()
        const copied = document.execCommand('copy')
        area.remove()
        return copied
      } catch {
        return false
      }
    }

    /**
     * Electron's native context menu is built in the main process from the
     * renderer selection state, so preventing the DOM default is not enough:
     * clearing the selection here keeps that native menu (and its lone Copy
     * item) from appearing beside this one.
     */
    function clearSelection() {
      try {
        const selection = window.getSelection()
        if (selection) selection.removeAllRanges()
      } catch {
        /* a stale selection is harmless */
      }
    }

    async function fetchBatch(texts, signal) {
      const response = await fetch(ROUTE, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ texts }),
        signal,
      })
      let payload
      try {
        payload = await response.json()
      } catch {
        payload = null
      }
      if (!response.ok || payload === null || payload.ok !== true || !Array.isArray(payload.results)) {
        throw new Error(payload && typeof payload.error === 'string' ? payload.error : 'http-' + response.status)
      }
      return payload.results
    }

    function Icon(props) {
      if (props.name === 'copy') {
        return h('svg', {
          width: 16, height: 16, viewBox: '0 0 16 16', fill: 'none',
          stroke: 'currentColor', strokeWidth: 1.3, strokeLinejoin: 'round',
          'aria-hidden': 'true',
        },
          h('rect', { key: 'a', x: 5.2, y: 5.2, width: 8, height: 8, rx: 2 }),
          h('path', { key: 'b', d: 'M10.8 5.2V4.2A2 2 0 0 0 8.8 2.2H4.2a2 2 0 0 0-2 2v4.6a2 2 0 0 0 2 2h1' }),
        )
      }
      return h('svg', {
        width: 16, height: 16, viewBox: '0 0 16 16', fill: 'none',
        stroke: 'currentColor', strokeWidth: 1.3, strokeLinecap: 'round', strokeLinejoin: 'round',
        'aria-hidden': 'true',
      },
        h('path', { key: 'a', d: 'M1.8 3.2h6.4M5 3.2v7.4M2 10.6h6' }),
        h('path', { key: 'b', d: 'M9.4 6.6 11.7 13l2.3-6.4M10.2 10.8h3' }),
      )
    }

    function apply(ctx) {
      const locale = ctx.get('locale')
      const t = createT()

      const owned = []
      if (locale && typeof locale.register === 'function') {
        for (const id of ['zh-CN', 'en']) {
          try {
            const dispose = locale.register(NS, id, DICTS[id])
            if (typeof dispose === 'function') owned.push(dispose)
          } catch {
            /* an unknown built-in id simply keeps the embedded fallback */
          }
        }
      }

      function MenuLayer() {
        const [menu, setMenu] = React.useState(null)
        const menuRef = React.useRef(null)
        const openRef = React.useRef(false)
        const jobRef = React.useRef(null)

        React.useEffect(() => {
          openRef.current = menu !== null
        }, [menu])

        React.useEffect(() => {
          const close = () => {
            if (jobRef.current !== null) {
              jobRef.current.abort()
              jobRef.current = null
            }
            setMenu(null)
          }
          /** Selection captured on right mousedown, before the native menu reads it. */
          let pending = null

          const place = (x, y) => {
            const width = 220
            const height = menuRef.current ? menuRef.current.offsetHeight : 168
            const left = Math.max(8, Math.min(x, window.innerWidth - width - 8))
            const top = Math.max(8, Math.min(y, window.innerHeight - height - 8))
            return { left, top }
          }

          const selectionSnapshot = (x, y) => {
            const selection = window.getSelection()
            if (!selection || selection.isCollapsed || selection.rangeCount === 0) return null
            if (typeof x === 'number' && !pointInSelection(selection, x, y)) return null
            const text = selection.toString()
            if (text.trim() === '') return null
            return { text, range: selection.getRangeAt(0).cloneRange() }
          }

          const onContextMenu = (event) => {
            if (event.defaultPrevented) return
            const raw = event.target
            const target = raw instanceof Element ? raw : raw && raw.parentElement
            if (!target) return
            if (menuRef.current && menuRef.current.contains(target)) {
              pending = null
              return
            }
            if (isEditable(target)) {
              pending = null
              if (openRef.current) close()
              return
            }

            const translated = translatedAncestor(target)
            if (translated) {
              event.preventDefault()
              event.stopPropagation()
              pending = null
              clearSelection()
              const position = place(event.clientX, event.clientY)
              setMenu({
                mode: 'restore',
                x: position.left,
                y: position.top,
                text: translated.textContent || '',
                span: translated,
                range: null,
                busy: false,
                progress: null,
                error: '',
              })
              return
            }

            const snapshot = pending ?? selectionSnapshot(event.clientX, event.clientY)
            pending = null
            if (!snapshot) {
              if (openRef.current) close()
              return
            }
            event.preventDefault()
            event.stopPropagation()
            clearSelection()
            const position = place(event.clientX, event.clientY)
            setMenu({
              mode: 'translate',
              x: position.left,
              y: position.top,
              text: snapshot.text,
              range: snapshot.range,
              span: null,
              busy: false,
              progress: null,
              error: '',
            })
          }

          const onMouseDown = (event) => {
            if (event.button !== 2) pending = null
            if (menuRef.current && menuRef.current.contains(event.target)) return
            const raw = event.target
            const target = raw instanceof Element ? raw : raw && raw.parentElement
            if (event.button === 2 && target && !isEditable(target) && !translatedAncestor(target)) {
              pending = selectionSnapshot(event.clientX, event.clientY)
              if (pending) clearSelection()
            }
            if (openRef.current) close()
          }

          const onKeyDown = (event) => {
            if (event.key === 'Escape' && openRef.current) close()
          }

          const onResize = () => {
            if (openRef.current) close()
          }

          document.addEventListener('contextmenu', onContextMenu, true)
          document.addEventListener('mousedown', onMouseDown, true)
          document.addEventListener('keydown', onKeyDown, true)
          window.addEventListener('resize', onResize)
          window.addEventListener('blur', onResize)
          return () => {
            document.removeEventListener('contextmenu', onContextMenu, true)
            document.removeEventListener('mousedown', onMouseDown, true)
            document.removeEventListener('keydown', onKeyDown, true)
            window.removeEventListener('resize', onResize)
            window.removeEventListener('blur', onResize)
          }
        }, [])

        const styleElement = h('style', { key: 'dsh-st-styles' }, CSS)

        if (menu === null) return styleElement

        const translateAction = async () => {
          if (menu.busy || !menu.range) return
          if (jobRef.current !== null) jobRef.current.abort()
          const controller = new AbortController()
          jobRef.current = controller

          let units
          try {
            units = planUnits(menu.range)
          } catch {
            units = []
          }
          if (units.length === 0) {
            setMenu((current) => (current === null ? current : { ...current, error: t('empty') }))
            jobRef.current = null
            return
          }

          const group = { blocks: [], texts: [], done: false }
          setMenu((current) => (current === null ? current : {
            ...current,
            busy: true,
            error: '',
            progress: { done: 0, total: units.length },
          }))

          try {
            const results = []
            for (let offset = 0; offset < units.length; offset += BATCH_SIZE) {
              const slice = units.slice(offset, offset + BATCH_SIZE)
              const batch = await fetchBatch(slice.map((unit) => unit.source), controller.signal)
              results.push(...batch)
              setMenu((current) => (current === null ? current : {
                ...current,
                progress: { done: Math.min(offset + slice.length, units.length), total: units.length },
              }))
            }
            if (controller.signal.aborted) return
            const applied = applyUnits(units, results, group, t('untitled'))
            if (applied === 0) throw new Error('translation-failed')
            groups.add(group)
            setMenu(null)
          } catch (error) {
            if (controller.signal.aborted) return
            setMenu((current) => (current === null ? current : { ...current, busy: false, error: t('failed') }))
          } finally {
            if (jobRef.current === controller) jobRef.current = null
          }
        }

        const action = () => {
          if (menu.busy) return
          if (menu.mode === 'restore') {
            const span = menu.span
            setMenu(null)
            if (span) {
              const group = records.get(span)
              if (group) restoreGroup(group)
              else if (span.isConnected) span.replaceWith(document.createTextNode(span.textContent || ''))
            }
            return
          }
          void translateAction()
        }

        const actionLabel = menu.busy
          ? t('translating')
          : menu.mode === 'restore'
            ? t('restore')
            : t('translate')

        const children = [
          h('div', {
            key: 'copy',
            className: 'dsh-st-item',
            role: 'menuitem',
            tabIndex: -1,
            onMouseDown: (event) => event.preventDefault(),
            onClick: () => {
              const text = menu.text
              setMenu(null)
              void copyText(text)
            },
          }, [
            h('span', { key: 'icon', className: 'dsh-st-icon' }, h(Icon, { key: 'i', name: 'copy' })),
            h('span', { key: 'label' }, t('copy')),
          ]),
          h('div', { key: 'sep', className: 'dsh-st-sep' }),
        ]

        if (menu.error !== '') {
          children.push(h('div', { key: 'error', className: 'dsh-st-error' }, menu.error))
        }

        if (menu.busy) {
          const done = menu.progress ? menu.progress.done : 0
          const total = menu.progress ? menu.progress.total : 0
          const percent = total > 0 ? Math.round((done / total) * 100) : 0
          children.push(h('div', { key: 'progress', className: 'dsh-st-progress' }, [
            h('div', { key: 'track', className: 'dsh-st-progress-track' },
              h('div', { key: 'fill', className: 'dsh-st-progress-fill', style: { width: percent + '%' } })),
            h('div', { key: 'label', className: 'dsh-st-progress-label' }, [
              h('span', { key: 'text' }, t('translating')),
              h('span', { key: 'count' }, done + '/' + total),
            ]),
          ]))
        }

        children.push(h('div', {
          key: 'translate',
          className: 'dsh-st-item',
          role: 'menuitem',
          tabIndex: -1,
          'data-disabled': menu.busy ? 'true' : 'false',
          onMouseDown: (event) => event.preventDefault(),
          onClick: action,
        }, [
          h('span', { key: 'icon', className: 'dsh-st-icon' }, h(Icon, { key: 'i', name: 'translate' })),
          h('span', { key: 'label' }, actionLabel),
        ]))

        return h(React.Fragment, null, styleElement, h('div', {
          ref: menuRef,
          className: 'dsh-st-menu',
          role: 'menu',
          style: { left: menu.x + 'px', top: menu.y + 'px' },
          onContextMenu: (event) => event.preventDefault(),
          onMouseDown: (event) => event.stopPropagation(),
        }, children))
      }

      ctx.effect(() => () => {
        for (const dispose of owned) dispose()
        restoreAll()
      }, 'selection-translator: dictionaries and restored selections')

      ctx.slots.inject('shell.overlay', () => ctx.slots.register({
        name: 'shell.overlay',
        id: 'selection-translator',
        order: 200,
      }, MenuLayer))
    }

    return { inject: ['slots'], apply }
  },
})
