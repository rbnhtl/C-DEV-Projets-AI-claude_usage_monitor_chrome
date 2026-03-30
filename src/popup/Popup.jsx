import { useState, useEffect } from 'react'
import './Popup.css'

function getColor(percent, refWidth) {
  if (refWidth === null) return '#6b7280'
  const deviation = percent - refWidth
  if (deviation > 30) return '#8b5cf6'
  if (deviation > 10) return '#ef4444'
  if (deviation < -10) return '#22c55e'
  return '#6b7280'
}

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

// ── Sparkline ─────────────────────────────────────────────────────────────────

function Sparkline({ history }) {
  if (!history || history.length < 2) return null

  const W = 204
  const H = 48
  const PAD_T = 6
  const PAD_B = 4
  const chartH = H - PAD_T - PAD_B

  const values = history.map((h) => h.sessionPct)
  const n = values.length

  const toY = (v) => PAD_T + chartH - (Math.min(v, 100) / 100) * chartH

  const pts = values.map((v, i) => ({
    x: (i / (n - 1)) * W,
    y: toY(v),
    v,
  }))

  const y0 = toY(0)
  const y50 = toY(50)
  const y100 = toY(100)
  const lastPt = pts[pts.length - 1]

  return (
    <svg width={W} height={H} className="sparkline">
      {/* Bornes et ligne médiane */}
      <line x1={0} y1={y100} x2={W} y2={y100} stroke="#2a2a2a" strokeWidth="1" />
      <line x1={0} y1={y50} x2={W} y2={y50} stroke="#2a2a2a" strokeWidth="1" strokeDasharray="3,3" />
      <line x1={0} y1={y0} x2={W} y2={y0} stroke="#2a2a2a" strokeWidth="1" />
      {/* Étiquettes */}
      <text x={W} y={y100 - 1} textAnchor="end" fontSize="7" fill="#3a3a3a">100%</text>
      <text x={W} y={y50 - 1} textAnchor="end" fontSize="7" fill="#3a3a3a">50%</text>
      {/* Segments colorés selon la valeur */}
      {pts.slice(0, -1).map((p, i) => (
        <line
          key={i}
          x1={p.x.toFixed(1)} y1={p.y.toFixed(1)}
          x2={pts[i + 1].x.toFixed(1)} y2={pts[i + 1].y.toFixed(1)}
          stroke="#6b7280"
          strokeWidth="1.5"
          strokeLinecap="round"
        />
      ))}
      {/* Point courant */}
      <circle cx={lastPt.x.toFixed(1)} cy={lastPt.y.toFixed(1)} r="2.5" fill="#6b7280" />
    </svg>
  )
}

// ── UsageCard ─────────────────────────────────────────────────────────────────

function UsageCard({ label, percent, resetLabel, totalMins, history }) {
  const { refWidth, indicator } = computeStats(percent, resetLabel, totalMins)
  const color = getColor(percent, refWidth)

  return (
    <div className="usage-card">
      <div className="usage-card-header">
        <span className="usage-label">{label}</span>
        <span className="usage-percent" style={{ color }}>{percent}%</span>
      </div>
      <div className="usage-bar-wrapper">
        <div className="usage-bar-track">
          {refWidth !== null && <div className="usage-bar-ref" style={{ width: `${refWidth}%` }} />}
          <div className="usage-bar-fill" style={{ width: `${Math.min(percent, 100)}%`, background: color }} />
        </div>
        {refWidth !== null && (
          <div className="usage-bar-tick" style={{ left: `${refWidth}%` }} />
        )}
      </div>
      <div className="usage-reset">
        {resetLabel}
        {indicator && (
          <span style={{ color: indicator.color, fontWeight: 700, marginLeft: 5 }}>
            {indicator.symbol}
          </span>
        )}
      </div>
      {history && history.length >= 2 && (
        <div className="sparkline-wrapper">
          <Sparkline history={history} color={color} />
        </div>
      )}
    </div>
  )
}

// ── Popup ─────────────────────────────────────────────────────────────────────

const REFRESH_INTERVAL_MS = 2 * 60 * 1000

function formatCountdown(ms) {
  if (ms <= 0) return null
  const totalSec = Math.ceil(ms / 1000)
  const m = Math.floor(totalSec / 60)
  const s = totalSec % 60
  return m > 0 ? `${m}:${String(s).padStart(2, '0')}` : `0:${String(s).padStart(2, '0')}`
}

export const Popup = () => {
  const [data, setData] = useState(null)
  const [history, setHistory] = useState([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [now, setNow] = useState(Date.now())
  const [refreshStartedAt, setRefreshStartedAt] = useState(null)

  function loadData() {
    chrome.runtime.sendMessage({ type: 'GET_USAGE' }, (response) => {
      setData(response?.data ?? null)
      setHistory(response?.history ?? [])
      setLoading(false)
    })
  }

  useEffect(() => { loadData() }, [])

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [])

  useEffect(() => {
    const onMessage = (request) => {
      if (request.type !== 'DATA_UPDATED') return
      setRefreshStartedAt(null)
      setRefreshing(false)
      loadData()
    }
    chrome.runtime.onMessage.addListener(onMessage)
    return () => chrome.runtime.onMessage.removeListener(onMessage)
  }, [])

  useEffect(() => {
    if (!refreshing) return
    const timeout = setTimeout(() => setRefreshing(false), 30_000)
    return () => clearTimeout(timeout)
  }, [refreshing])

  function handleRefresh() {
    setRefreshing(true)
    setRefreshStartedAt(Date.now())
    chrome.runtime.sendMessage({ type: 'MANUAL_REFRESH' })
  }

  const updatedMinutesAgo = data ? Math.round((now - data.fetchedAt) / 60000) : null
  const baseAt = refreshStartedAt ?? data?.fetchedAt ?? null
  const nextUpdateMs = baseAt !== null ? (baseAt + REFRESH_INTERVAL_MS) - now : null
  const countdown = nextUpdateMs !== null ? formatCountdown(nextUpdateMs) : null

  return (
    <main>
      <div className="popup-header">
        <a
          className="popup-title"
          href="https://claude.ai/settings/usage"
          target="_blank"
          rel="noreferrer"
          title="Voir la page d'utilisation"
        >
          Utilisation Claude <span className="popup-title-icon">↗</span>
        </a>
        <button className="refresh-btn" onClick={handleRefresh} disabled={refreshing} title="Actualiser">
          {refreshing ? '⟳' : '↻'}
        </button>
      </div>

      {loading ? (
        <div className="empty-state">Chargement…</div>
      ) : !data ? (
        <div className="empty-state">
          Ouvrez <strong>claude.ai</strong> pour charger les données d'utilisation.
        </div>
      ) : (
        <>
          <UsageCard
            label="Session actuelle"
            percent={data.session.percent}
            resetLabel={data.session.resetLabel}
            totalMins={5 * 60}
            history={history}
          />
          <UsageCard
            label="Cette semaine"
            percent={data.weekly.percent}
            resetLabel={data.weekly.resetLabel}
            totalMins={7 * 24 * 60}
          />
          {updatedMinutesAgo != null && (
            <div className="last-updated">
              Mis à jour il y a {updatedMinutesAgo < 1 ? "moins d'une" : updatedMinutesAgo} min
            </div>
          )}
          <div className="next-update">
            {countdown
              ? <>Prochaine maj dans <span className="next-update-countdown">{countdown}</span></>
              : 'Mise à jour en cours…'
            }
          </div>
        </>
      )}
    </main>
  )
}

export default Popup
