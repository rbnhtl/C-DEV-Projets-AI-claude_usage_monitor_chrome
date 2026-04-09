import { getActiveWorkSlot, computeWorkRefWidth } from '../shared/workSchedule.js'

const THRESHOLDS = [50, 70, 90]
const HISTORY_MAX = 60 // 60 × 5 min = 5h de données

function computeRefWidth(resetLabel, totalMins) {
  const remaining = parseRemainingMinutes(resetLabel)
  if (remaining === null) return null
  const elapsed = Math.max(0, totalMins - remaining)
  return Math.min(100, (elapsed / totalMins) * 100)
}

function getColor(percent, refWidth) {
  if (refWidth === null) return '#6b7280'
  const deviation = percent - refWidth
  if (deviation > 30) return '#8b5cf6'
  if (deviation > 10) return '#ef4444'
  if (deviation < -10) return '#22c55e'
  return '#6b7280'
}

async function updateBadge(data) {
  const percent = data?.session?.percent
  if (percent == null) return

  let refWidth
  const stored = await chrome.storage.sync.get(['workSchedule'])
  const workSlot = getActiveWorkSlot(stored.workSchedule ?? null)
  if (workSlot) {
    const sessionRemaining = parseRemainingMinutes(data.session.resetLabel)
    refWidth = computeWorkRefWidth(sessionRemaining, workSlot.remainingMins)
  } else {
    refWidth = computeRefWidth(data.session.resetLabel, 5 * 60)
  }

  chrome.action.setBadgeText({ text: `${percent}%` })
  chrome.action.setBadgeBackgroundColor({ color: getColor(percent, refWidth) })
}

function sendNotification(id, title, message) {
  chrome.notifications.create(id, {
    type: 'basic',
    iconUrl: chrome.runtime.getURL('img/logo-48.png'),
    title,
    message,
  })
}

// ── Parsing du label de reset (même logique que popup/contentScript) ──────────

const FR_DAYS = { lun: 1, mar: 2, mer: 3, jeu: 4, ven: 5, sam: 6, dim: 0 }

function parseRemainingMinutes(label) {
  if (!label) return null
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

// ── Historique ────────────────────────────────────────────────────────────────

async function appendToHistory(newData, isReset) {
  const stored = await chrome.storage.local.get(['usageHistory'])
  const history = isReset ? [] : (stored.usageHistory ?? [])
  const entry = {
    sessionPct: newData.session.percent,
    weeklyPct: newData.weekly.percent,
    fetchedAt: newData.fetchedAt,
  }
  const updated = [...history, entry].slice(-HISTORY_MAX)
  chrome.storage.local.set({ usageHistory: updated })
}

// ── Notifications ─────────────────────────────────────────────────────────────

async function checkNotifications(newData) {
  const stored = await chrome.storage.local.get(['usageData', 'notifiedThresholds'])
  const oldData = stored.usageData
  const notifiedThresholds = stored.notifiedThresholds ?? []

  const newPct = newData.session.percent
  const oldPct = oldData?.session?.percent ?? 0
  const sessionRemaining = parseRemainingMinutes(newData.session.resetLabel)

  // Reset détecté : le % a diminué significativement
  if (oldData && newPct < oldPct - 5) {
    sendNotification(
      `usage-reset-${Date.now()}`,
      'Claude · Session réinitialisée',
      `Votre quota est remis à zéro. Utilisation actuelle : ${newPct}%.`,
    )
    await chrome.storage.local.set({ notifiedThresholds: [] })
    appendToHistory(newData, true)
    return
  }

  const newNotified = [...notifiedThresholds]

  // Reset imminent (≤ 15 min)
  if (
    sessionRemaining !== null &&
    sessionRemaining <= 15 &&
    !notifiedThresholds.includes('reset-imminent')
  ) {
    sendNotification(
      'usage-reset-imminent',
      'Claude · Reset imminent',
      `Votre session se réinitialise dans ${Math.round(sessionRemaining)} min.`,
    )
    newNotified.push('reset-imminent')
  }

  // Croisement de seuils
  const messages = {
    50: 'La moitié de votre session est consommée.',
    70: 'Vous avez consommé 70% de votre session actuelle.',
    90: 'Vous approchez de la limite. Pensez à espacer vos échanges.',
  }
  for (const threshold of THRESHOLDS) {
    if (!notifiedThresholds.includes(threshold) && newPct >= threshold) {
      sendNotification(
        `usage-${threshold}`,
        `Claude · ${threshold}% de session utilisés`,
        messages[threshold],
      )
      newNotified.push(threshold)
    }
  }

  if (newNotified.length !== notifiedThresholds.length) {
    await chrome.storage.local.set({ notifiedThresholds: newNotified })
  }

  appendToHistory(newData, false)
}

// ── Alarm & tabs ──────────────────────────────────────────────────────────────

// Script injecté dans un onglet claude.ai pour fetcher l'usage via iframe (même origine)
function injectFetchScript() {
  if (document.getElementById('__claude-usage-bg-iframe')) return
  const iframe = document.createElement('iframe')
  iframe.id = '__claude-usage-bg-iframe'
  iframe.src = 'https://claude.ai/settings/usage'
  iframe.style.cssText = 'position:fixed;width:1px;height:1px;opacity:0;pointer-events:none;top:-200px;left:-200px'
  document.body.appendChild(iframe)
  const timer = setTimeout(() => {
    iframe.remove()
    window.removeEventListener('message', handler)
  }, 20_000)
  function handler(e) {
    if (e.origin !== 'https://claude.ai') return
    if (e.data?.type !== 'CLAUDE_USAGE_FROM_IFRAME') return
    window.removeEventListener('message', handler)
    clearTimeout(timer)
    iframe.remove()
    chrome.runtime.sendMessage({ type: 'USAGE_UPDATE', data: e.data.data })
  }
  window.addEventListener('message', handler)
}

async function notifyClaudeTabs() {
  const tabs = await chrome.tabs.query({ url: 'https://claude.ai/*' })
  if (tabs.length === 0) return

  const results = await Promise.all(
    tabs.map(async (tab) => {
      try {
        await chrome.tabs.sendMessage(tab.id, { type: 'FORCE_REFRESH' })
        return true
      } catch {
        return false
      }
    })
  )

  if (results.every((r) => r === false)) {
    // Content script non connecté : injecter directement dans le premier onglet
    chrome.scripting.executeScript({
      target: { tabId: tabs[0].id },
      world: 'ISOLATED',
      func: injectFetchScript,
    }).catch(() => {})
  }
}

function ensureAlarm() {
  chrome.alarms.get('usage-refresh', (alarm) => {
    if (!alarm) chrome.alarms.create('usage-refresh', { periodInMinutes: 2 })
  })
}

chrome.runtime.onInstalled.addListener(() => {
  ensureAlarm()
  notifyClaudeTabs()
})
chrome.runtime.onStartup.addListener(() => {
  ensureAlarm()
  notifyClaudeTabs()
})

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'usage-refresh') notifyClaudeTabs()
})

// Déclenche un refresh dès qu'un onglet claude.ai est chargé
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete' && tab.url?.startsWith('https://claude.ai/')) {
    setTimeout(() => {
      chrome.tabs.sendMessage(tabId, { type: 'FORCE_REFRESH' }).catch(() => {})
    }, 2000) // laisse le temps au content script de s'initialiser
  }
})

// ── Messages ──────────────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((request, _sender, sendResponse) => {
  if (request.type === 'USAGE_UPDATE') {
    const incoming = request.data?.fetchedAt
    chrome.storage.local.get(['usageData'], ({ usageData }) => {
      if (usageData?.fetchedAt === incoming) return
      checkNotifications(request.data)
      chrome.storage.local.set({ usageData: request.data })
      updateBadge(request.data)
      chrome.runtime.sendMessage({ type: 'DATA_UPDATED' }).catch(() => {})
    })
    return
  }

  if (request.type === 'MANUAL_REFRESH') {
    notifyClaudeTabs()
    return
  }

  if (request.type === 'GET_USAGE') {
    chrome.storage.local.get(['usageData', 'usageHistory'], (result) => {
      sendResponse({
        data: result.usageData ?? null,
        history: result.usageHistory ?? [],
      })
    })
    return true
  }
})
