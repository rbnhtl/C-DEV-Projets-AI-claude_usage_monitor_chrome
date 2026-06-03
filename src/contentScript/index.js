import { getActiveWorkSlot, computeWorkRefWidth } from '../shared/workSchedule.js'

// ── Iframe context (settings/usage page loaded as hidden iframe) ───────────────

if (window !== window.top && window.location.pathname.includes('/settings/usage')) {
  function extractUsageData() {
    const bars = document.querySelectorAll('[role="progressbar"]')
    if (bars.length < 2) return null

    function getResetLabel(bar) {
      // Remonte au div.flex-row contenant le progressbar ET son label sibling
      return bar.closest('.flex-row')?.querySelector('.whitespace-nowrap')?.textContent?.trim() ?? ''
    }

    return {
      session: {
        percent: parseInt(bars[0].getAttribute('aria-valuenow') ?? '0', 10),
        resetLabel: getResetLabel(bars[0]),
      },
      weekly: {
        percent: parseInt(bars[1].getAttribute('aria-valuenow') ?? '0', 10),
        resetLabel: getResetLabel(bars[1]),
      },
      fetchedAt: Date.now(),
    }
  }

  function dispatchData(data) {
    window.parent.postMessage({ type: 'CLAUDE_USAGE_FROM_IFRAME', data }, 'https://claude.ai')
    chrome.runtime.sendMessage({ type: 'USAGE_UPDATE', data }).catch(() => {})
  }

  function sendWhenReady() {
    const data = extractUsageData()
    if (data) {
      dispatchData(data)
      return
    }

    const observer = new MutationObserver(() => {
      const d = extractUsageData()
      if (d) {
        observer.disconnect()
        dispatchData(d)
      }
    })
    const observeTarget = document.body ?? document.documentElement
    if (observeTarget) {
      observer.observe(observeTarget, { childList: true, subtree: true })
    }
    setTimeout(() => observer.disconnect(), 15_000)
  }

  if (document.body) {
    sendWhenReady()
  } else {
    document.addEventListener('DOMContentLoaded', sendWhenReady)
  }

} else if (window === window.top) {
  // ── Main page logic ─────────────────────────────────────────────────────────

  function getColor(percent, refWidth) {
    if (refWidth === null) return '#6b7280'
    const deviation = percent - refWidth
    if (deviation > 30) return '#8b5cf6'
    if (deviation > 10) return '#ef4444'
    if (deviation < -10) return '#22c55e'
    return '#6b7280'
  }

  // ── Work schedule state ──────────────────────────────────────────────────────

  let workSchedule = null

  // ── Rate computation ─────────────────────────────────────────────────────────

  const FR_DAYS = { lun: 1, mar: 2, mer: 3, jeu: 4, ven: 5, sam: 6, dim: 0 }

  function parseRemainingMinutes(label) {
    if (label.includes('dans')) {
      let mins = 0
      const d = label.match(/(\d+)\s*j/)
      const h = label.match(/(\d+)\s*h/)
      const m = label.match(/(\d+)\s*min/)
      if (d) mins += parseInt(d[1]) * 1440
      if (h) mins += parseInt(h[1]) * 60
      if (m) mins += parseInt(m[1])
      return mins > 0 ? mins : null
    }
    const dayMatch = label.match(/(lun|mar|mer|jeu|ven|sam|dim)\.?\s*(\d+):(\d+)/i)
    if (dayMatch) {
      const targetDay = FR_DAYS[dayMatch[1].toLowerCase()]
      const now = new Date()
      const target = new Date()
      target.setHours(parseInt(dayMatch[2]), parseInt(dayMatch[3]), 0, 0)
      let daysUntil = (targetDay - now.getDay() + 7) % 7
      if (daysUntil === 0 && target <= now) daysUntil = 7
      target.setDate(target.getDate() + daysUntil)
      return Math.max(0, (target - now) / 60000)
    }
    return null
  }

  function computeRefWidth(resetLabel, totalMins) {
    const remaining = parseRemainingMinutes(resetLabel)
    if (remaining === null) return null
    const elapsed = Math.max(0, totalMins - remaining)
    return Math.min(100, (elapsed / totalMins) * 100)
  }

  // Retourne le refWidth effectif en tenant compte de la période de travail.
  // Si la session se réinitialise avant la fin de la période, la période est N/A
  // et on utilise la coloration session seule.
  function computeEffectiveRefWidth(sessionResetLabel, totalMins = 5 * 60) {
    const sessionRemaining = parseRemainingMinutes(sessionResetLabel)
    const workSlot = getActiveWorkSlot(workSchedule)
    if (workSlot && (sessionRemaining === null || sessionRemaining >= workSlot.remainingMins)) {
      return { refWidth: computeWorkRefWidth(sessionRemaining, workSlot.remainingMins, totalMins), workSlot }
    }
    return { refWidth: computeRefWidth(sessionResetLabel, totalMins), workSlot: null }
  }

  function computeStats(percent, resetLabel, totalMins) {
    const remaining = parseRemainingMinutes(resetLabel)
    if (remaining === null) return { refWidth: null, indicator: null }
    const elapsed = Math.max(0, totalMins - remaining)
    const refWidth = Math.min(100, (elapsed / totalMins) * 100)
    if (elapsed < 5) return { refWidth, indicator: null }
    const deviation = percent - refWidth
    let indicator
    if (deviation > 30) indicator = { symbol: '↑↑', color: '#8b5cf6' }
    else if (deviation > 10) indicator = { symbol: '↑', color: '#ef4444' }
    else if (deviation < -10) indicator = { symbol: '↓', color: '#22c55e' }
    else indicator = { symbol: '—', color: '#6b7280' }
    return { refWidth, indicator }
  }

  // ── Fetch via hidden iframe ──────────────────────────────────────────────────

  let iframePending = false

  function fetchViaIframe() {
    if (iframePending) return Promise.resolve(null)
    iframePending = true

    document.getElementById('__claude-usage-iframe')?.remove()

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        iframe.remove()
        iframePending = false
        reject(new Error('iframe timeout'))
      }, 20_000)

      function onMessage(e) {
        if (e.origin !== 'https://claude.ai') return
        if (e.data?.type !== 'CLAUDE_USAGE_FROM_IFRAME') return
        window.removeEventListener('message', onMessage)
        clearTimeout(timer)
        iframe.remove()
        iframePending = false
        resolve(e.data.data)
      }

      window.addEventListener('message', onMessage)

      const iframe = document.createElement('iframe')
      iframe.id = '__claude-usage-iframe'
      iframe.src = 'https://claude.ai/settings/usage'
      iframe.style.cssText =
        'position:fixed;width:1px;height:1px;opacity:0;pointer-events:none;top:-200px;left:-200px'
      document.body.appendChild(iframe)
    })
  }

  // ── Widget DOM ───────────────────────────────────────────────────────────────

  const WIDGET_ID = 'claude-usage-ext'
  const CARD_ID = 'claude-usage-ext-card'
  let lastData = null

  function removeCard() {
    document.getElementById(CARD_ID)?.remove()
  }

  function buildProgressBar(percent, refWidth, color) {
    const refBar = refWidth !== null
      ? `<div style="position:absolute;top:0;left:0;height:100%;width:${refWidth}%;background:#4a4a4a;border-radius:4px;"></div>`
      : ''
    const tick = refWidth !== null
      ? `<div style="position:absolute;top:-3px;left:${refWidth}%;height:12px;width:2px;background:#999;border-radius:1px;transform:translateX(-50%);pointer-events:none"></div>`
      : ''
    return `
      <div style="position:relative">
        <div style="position:relative;background:#333;border-radius:4px;height:6px;overflow:hidden">
          ${refBar}
          <div style="position:absolute;top:0;left:0;height:100%;width:${Math.min(percent, 100)}%;background:${color};border-radius:4px;transition:width .3s"></div>
        </div>
        ${tick}
      </div>
    `
  }

  function row(label, percent, resetLabel, totalMins) {
    const { refWidth, indicator } = computeStats(percent, resetLabel, totalMins)
    const color = getColor(percent, refWidth)
    const indicatorHtml = indicator
      ? `<span style="color:${indicator.color};font-weight:700;margin-left:5px">${indicator.symbol}</span>`
      : ''
    return `
      <div style="margin-bottom:12px">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:5px">
          <span style="font-size:12px;color:#aaa">${label}</span>
          <span style="font-size:13px;font-weight:600;color:${color}">${percent}%</span>
        </div>
        ${buildProgressBar(percent, refWidth, color)}
        <div style="font-size:11px;color:#666;margin-top:4px">${resetLabel}${indicatorHtml}</div>
      </div>
    `
  }

  // Ligne dédiée à la période de travail active (même logique que WorkUsageCard de la popup)
  function workRow(percent, sessionRemainingMins, activeWorkSlot) {
    const refWidth = computeWorkRefWidth(sessionRemainingMins, activeWorkSlot.remainingMins)
    const color = getColor(percent, refWidth)

    let indicator = null
    if (refWidth !== null) {
      const sessionElapsed = sessionRemainingMins !== null ? Math.max(0, 5 * 60 - sessionRemainingMins) : 0
      if (sessionElapsed >= 5) {
        const deviation = percent - refWidth
        if (deviation > 30) indicator = { symbol: '↑↑', color: '#8b5cf6' }
        else if (deviation > 10) indicator = { symbol: '↑', color: '#ef4444' }
        else if (deviation < -10) indicator = { symbol: '↓', color: '#22c55e' }
        else indicator = { symbol: '—', color: '#6b7280' }
      }
    }

    const slotLabel = activeWorkSlot.slotName === 'morning' ? 'Matin' : 'Après-midi'
    const wMins = Math.round(activeWorkSlot.remainingMins)
    const wH = Math.floor(wMins / 60)
    const wM = wMins % 60
    const timeLabel = wH > 0
      ? `Fin dans ${wH}h${wM > 0 ? ` ${wM} min` : ''}`
      : `Fin dans ${wM} min`

    const indicatorHtml = indicator
      ? `<span style="color:${indicator.color};font-weight:700;margin-left:5px">${indicator.symbol}</span>`
      : ''

    return `
      <div style="margin-bottom:12px">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:5px">
          <span style="font-size:12px;color:#aaa">${slotLabel} · fin ${activeWorkSlot.label}</span>
          <span style="font-size:13px;font-weight:600;color:${color}">${percent}%</span>
        </div>
        ${buildProgressBar(percent, refWidth, color)}
        <div style="font-size:11px;color:#666;margin-top:4px">${timeLabel}${indicatorHtml}</div>
      </div>
    `
  }

  function showCard(data, anchorEl) {
    removeCard()

    const rect = anchorEl.getBoundingClientRect()
    const card = document.createElement('div')
    card.id = CARD_ID
    card.style.cssText = `
      position: fixed;
      bottom: ${window.innerHeight - rect.top + 8}px;
      left: ${rect.left + rect.width / 2}px;
      transform: translateX(-50%);
      background: #1a1a1a;
      border: 1px solid #333;
      border-radius: 10px;
      padding: 14px 16px;
      min-width: 230px;
      z-index: 99999;
      font-family: inherit;
      box-shadow: 0 8px 24px rgba(0,0,0,0.4);
    `

    const sessionRemaining = parseRemainingMinutes(data.session.resetLabel)
    const currentWorkSlot = getActiveWorkSlot(workSchedule)
    // La période ne régit pas la coloration si la session se réinitialise avant sa fin
    const activeWorkSlot = currentWorkSlot &&
      (sessionRemaining === null || sessionRemaining >= currentWorkSlot.remainingMins)
      ? currentWorkSlot
      : null

    const minutesAgo = Math.round((Date.now() - data.fetchedAt) / 60_000)
    card.innerHTML = `
      <div style="font-size:12px;font-weight:600;color:#888;margin-bottom:10px;text-transform:uppercase;letter-spacing:.05em">Utilisation Claude</div>
      ${activeWorkSlot ? workRow(data.session.percent, sessionRemaining, activeWorkSlot) : ''}
      ${row('Session actuelle', data.session.percent, data.session.resetLabel, 5 * 60)}
      ${row('Cette semaine', data.weekly.percent, data.weekly.resetLabel, 7 * 24 * 60)}
      <div style="font-size:10px;color:#555;margin-top:4px">Mis à jour il y a ${minutesAgo < 1 ? "moins d'une" : minutesAgo} min</div>
    `

    document.body.appendChild(card)
    setTimeout(() => document.addEventListener('click', removeCard, { once: true }), 0)
  }

  function injectWidget(anchorEl, data) {
    document.getElementById(WIDGET_ID)?.remove()

    const wrapper = document.createElement('div')
    wrapper.id = WIDGET_ID
    wrapper.style.cssText = 'display:inline-flex;align-items:center'

    const badge = document.createElement('button')
    const { refWidth } = computeEffectiveRefWidth(data.session.resetLabel, 5 * 60)
    const color = getColor(data.session.percent, refWidth)
    badge.style.cssText = `
      display:inline-flex;align-items:center;gap:3px;
      padding:3px 8px;border-radius:6px;
      border:1px solid ${color}44;background:${color}18;color:${color};
      font-size:12px;font-weight:600;cursor:pointer;font-family:inherit;
      line-height:1;white-space:nowrap;
    `
    badge.textContent = `${data.session.percent}%`
    badge.title = 'Utilisation Claude'

    badge.addEventListener('click', (e) => {
      e.stopPropagation()
      if (document.getElementById(CARD_ID)) {
        removeCard()
      } else {
        showCard(lastData ?? data, wrapper)
      }
    })

    wrapper.appendChild(badge)
    anchorEl.insertAdjacentElement('afterend', wrapper)
  }

  function updateWidget(data) {
    lastData = data
    const badge = document.querySelector(`#${WIDGET_ID} button`)
    if (!badge) return
    const { refWidth } = computeEffectiveRefWidth(data.session.resetLabel, 5 * 60)
    const color = getColor(data.session.percent, refWidth)
    badge.textContent = `${data.session.percent}%`
    badge.style.color = color
    badge.style.borderColor = `${color}44`
    badge.style.background = `${color}18`
  }

  // ── Model selector detection ─────────────────────────────────────────────────

  function findModelSelectorAnchor() {
    const byTestId = document.querySelector('[data-testid="model-selector-dropdown"]')
    if (byTestId) return byTestId
    for (const btn of document.querySelectorAll('button')) {
      const text = btn.textContent ?? ''
      if (text.includes('Sonnet') || text.includes('Opus') || text.includes('Haiku')) return btn
    }
    return null
  }

  function tryInjectWidget(data) {
    if (document.getElementById(WIDGET_ID)) {
      updateWidget(data)
      return
    }
    const anchor = findModelSelectorAnchor()
    if (anchor) injectWidget(anchor, data)
  }

  // ── Core logic ───────────────────────────────────────────────────────────────

  async function refresh() {
    try {
      const data = await fetchViaIframe()
      if (!data) return
      lastData = data
      // Sur /settings/usage l'iframe envoie déjà USAGE_UPDATE, pas besoin de le renvoyer
      if (!window.location.pathname.includes('/settings/usage')) {
        chrome.storage.local.set({ usageData: data })
        chrome.runtime.sendMessage({ type: 'USAGE_UPDATE', data }).catch(() => {})
      }
      tryInjectWidget(data)
    } catch {
      // Fail silently
    }
  }

  chrome.runtime.onMessage.addListener((request) => {
    if (request.type === 'FORCE_REFRESH') refresh()
  })

  function startMain() {
    // Charger le planning en priorité pour que le premier refresh soit coloré correctement
    chrome.storage.sync.get(['workSchedule'], (syncResult) => {
      workSchedule = syncResult.workSchedule ?? null

      chrome.storage.local.get(['usageData'], (result) => {
        if (result.usageData) lastData = result.usageData
        refresh()
      })
    })

    chrome.storage.sync.onChanged.addListener((changes) => {
      if (changes.workSchedule) {
        workSchedule = changes.workSchedule.newValue ?? null
        if (lastData) updateWidget(lastData)
      }
    })

    const observer = new MutationObserver(() => {
      if (lastData && !document.getElementById(WIDGET_ID)) {
        const anchor = findModelSelectorAnchor()
        if (anchor) injectWidget(anchor, lastData)
      }
    })
    observer.observe(document.body, { childList: true, subtree: true })

    setInterval(refresh, 2 * 60 * 1000)
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', startMain)
  } else {
    startMain()
  }
}
