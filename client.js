window.__ModuleLoader__.load({
  id: 'dsh-selection-translator',
  factory(require) {
    const React = require('react')
    const h = React.createElement

    const NS = 'selection-translator'
    const ROUTE = '/api/dsh/selection-translator'
    const TRANSLATED_ATTR = 'data-dsh-translated'

    const DICTS = {
      'zh-CN': {
        copy: '复制',
        translate: '翻译成中文',
        restore: '取消翻译',
        translating: '正在翻译…',
        failed: '翻译失败，请重试',
        tooLong: '选中的文字过长，请缩短后再试',
        empty: '没有可翻译的文字',
        untitled: '已翻译 · 右键可还原',
      },
      en: {
        copy: 'Copy',
        translate: 'Translate to Chinese',
        restore: 'Undo translation',
        translating: 'Translating…',
        failed: 'Translation failed, please retry',
        tooLong: 'Selection is too long, please shorten it',
        empty: 'Nothing to translate',
        untitled: 'Translated · right-click to restore',
      },
    }

    const CSS = `
      .dsh-st-menu{position:fixed;z-index:2147483000;min-width:184px;max-width:280px;padding:5px;border-radius:10px;background:var(--dsw-alias-bg-overlay,#ffffff);border:1px solid var(--dsw-alias-border-l1,rgba(15,23,42,.12));box-shadow:0 10px 30px rgba(15,23,42,.18);font-family:inherit;font-size:13px;line-height:1.4;color:var(--dsw-alias-label-primary,#0f172a);-webkit-user-select:none;user-select:none;pointer-events:auto}
      .dsh-st-item{display:flex;align-items:center;gap:8px;padding:7px 10px;border-radius:7px;cursor:pointer;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;outline:none}
      .dsh-st-item:hover{background:var(--dsw-alias-bg-layer-2,rgba(15,23,42,.07))}
      .dsh-st-item[data-disabled="true"]{opacity:.6;cursor:default}
      .dsh-st-item[data-disabled="true"]:hover{background:transparent}
      .dsh-st-icon{display:inline-flex;width:16px;height:16px;flex:none;align-items:center;justify-content:center;opacity:.85}
      .dsh-st-sep{height:1px;margin:4px 6px;background:var(--dsw-alias-border-l1,rgba(15,23,42,.1))}
      .dsh-st-error{font-size:11px;line-height:1.4;color:var(--dsw-alias-state-error-primary,#dc2626);padding:3px 10px 4px;white-space:normal}
      .dsh-st-translated{text-decoration:underline dotted currentColor;text-decoration-thickness:1px;text-underline-offset:2px;cursor:text}
    `

    /** Original DOM fragments of in-place translations, keyed by their span. */
    const records = new Map()

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

    /** Put `translated` where the selection was and keep the original nodes detached. */
    function markTranslated(range, translated, originalTitle) {
      const span = document.createElement('span')
      span.className = 'dsh-st-translated'
      span.setAttribute(TRANSLATED_ATTR, '1')
      span.title = originalTitle || ''
      span.textContent = translated
      const original = range.extractContents()
      records.set(span, { fragment: original })
      range.insertNode(span)
      return span
    }

    function restoreTranslated(span) {
      if (!(span instanceof Element) || !span.isConnected) return
      const record = records.get(span)
      if (record === undefined) {
        span.replaceWith(document.createTextNode(span.textContent || ''))
        return
      }
      records.delete(span)
      span.replaceWith(record.fragment)
    }

    function restoreAll() {
      for (const [span, record] of records) {
        if (span.isConnected) span.replaceWith(record.fragment)
      }
      records.clear()
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

    async function requestTranslation(text) {
      const response = await fetch(ROUTE, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text, target: 'zh' }),
      })
      let payload
      try {
        payload = await response.json()
      } catch {
        payload = null
      }
      if (!response.ok || payload === null || payload.ok !== true || typeof payload.text !== 'string') {
        const reason = payload && typeof payload.error === 'string' ? payload.error : 'http-' + response.status
        const error = new Error(reason)
        error.code = reason
        throw error
      }
      return payload.text
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

        React.useEffect(() => {
          openRef.current = menu !== null
        }, [menu])

        React.useEffect(() => {
          const close = () => setMenu(null)
          /** Selection captured on right mousedown, before the native menu reads it. */
          let pending = null

          const place = (x, y) => {
            const width = 210
            const height = menuRef.current ? menuRef.current.offsetHeight : 96
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
          if (menu.busy) return
          setMenu((current) => (current === null ? current : { ...current, busy: true, error: '' }))
          try {
            if (!menu.range || !menu.range.startContainer.isConnected) throw new Error('selection-lost')
            const translated = await requestTranslation(menu.text)
            markTranslated(menu.range, translated, t('untitled'))
            setMenu(null)
          } catch (error) {
            const message = error && error.code === 'text-too-long' ? t('tooLong') : t('failed')
            setMenu((current) => (current === null ? current : { ...current, busy: false, error: message }))
          }
        }

        const actionLabel = menu.busy
          ? t('translating')
          : menu.mode === 'restore'
            ? t('restore')
            : t('translate')

        const action = () => {
          if (menu.busy) return
          if (menu.mode === 'restore') {
            const span = menu.span
            setMenu(null)
            restoreTranslated(span)
            return
          }
          void translateAction()
        }

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
