import { useState, useEffect, useCallback } from 'react'
import './Options.css'

const DAY_ORDER = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']
const DAY_LABELS = { mon: 'Lun', tue: 'Mar', wed: 'Mer', thu: 'Jeu', fri: 'Ven', sat: 'Sam', sun: 'Dim' }

const DEFAULT_SLOTS = {
  morning: { start: '09:00', end: '12:30' },
  afternoon: { start: '14:00', end: '17:30' },
}

const EMPTY_SCHEDULE = { default: { morning: null, afternoon: null }, days: {} }

// ── SlotEditor ────────────────────────────────────────────────────────────────

function SlotEditor({ slots, onChange }) {
  // slots: { morning: {start, end}|null, afternoon: {start, end}|null }

  function toggleSlot(key, enabled) {
    onChange({ ...slots, [key]: enabled ? { ...DEFAULT_SLOTS[key] } : null })
  }

  function updateTime(key, field, value) {
    onChange({ ...slots, [key]: { ...slots[key], [field]: value } })
  }

  return (
    <div className="slot-editor">
      {['morning', 'afternoon'].map((key) => {
        const slot = slots[key]
        const label = key === 'morning' ? 'Matin' : 'Après-midi'
        return (
          <div key={key} className={`slot-row${slot ? ' slot-row--active' : ''}`}>
            <label className="slot-toggle">
              <input
                type="checkbox"
                checked={!!slot}
                onChange={(e) => toggleSlot(key, e.target.checked)}
              />
              <span className="slot-name">{label}</span>
            </label>
            {slot ? (
              <div className="slot-times">
                <input
                  type="time"
                  value={slot.start}
                  onChange={(e) => updateTime(key, 'start', e.target.value)}
                />
                <span className="slot-arrow">→</span>
                <input
                  type="time"
                  value={slot.end}
                  onChange={(e) => updateTime(key, 'end', e.target.value)}
                />
              </div>
            ) : (
              <span className="slot-disabled">désactivé</span>
            )}
          </div>
        )
      })}
    </div>
  )
}

// ── DayRow ────────────────────────────────────────────────────────────────────

function DayRow({ dayKey, override, defaultSlots, onChange }) {
  // override: undefined (inherit default) | null (repos) | { morning, afternoon }
  const isRest = override === null
  const isCustom = override !== undefined && override !== null

  function setMode(mode) {
    if (mode === 'default') onChange(undefined)
    else if (mode === 'rest') onChange(null)
    else onChange({ morning: defaultSlots?.morning ?? null, afternoon: defaultSlots?.afternoon ?? null })
  }

  return (
    <div className="day-row">
      <div className="day-row-header">
        <span className="day-label">{DAY_LABELS[dayKey]}</span>
        <div className="day-mode-radios">
          <label className={!isRest && !isCustom ? 'active' : ''}>
            <input
              type="radio"
              name={`day-${dayKey}`}
              checked={!isRest && !isCustom}
              onChange={() => setMode('default')}
            />
            Défaut
          </label>
          <label className={isCustom ? 'active' : ''}>
            <input
              type="radio"
              name={`day-${dayKey}`}
              checked={isCustom}
              onChange={() => setMode('custom')}
            />
            Personnalisé
          </label>
          <label className={isRest ? 'active' : ''}>
            <input
              type="radio"
              name={`day-${dayKey}`}
              checked={isRest}
              onChange={() => setMode('rest')}
            />
            Repos
          </label>
        </div>
      </div>
      {isCustom && (
        <div className="day-slot-editor">
          <SlotEditor slots={override} onChange={onChange} />
        </div>
      )}
    </div>
  )
}

// ── Options ───────────────────────────────────────────────────────────────────

export const Options = () => {
  const [schedule, setSchedule] = useState(null)
  const [loaded, setLoaded] = useState(false)
  const [savedFlash, setSavedFlash] = useState(false)

  useEffect(() => {
    chrome.storage.sync.get(['workSchedule'], (result) => {
      setSchedule(result.workSchedule ?? EMPTY_SCHEDULE)
      setLoaded(true)
    })
  }, [])

  const save = useCallback((newSchedule) => {
    chrome.storage.sync.set({ workSchedule: newSchedule }, () => {
      setSavedFlash(true)
      setTimeout(() => setSavedFlash(false), 2000)
    })
  }, [])

  function updateDefault(newDefault) {
    const updated = { ...schedule, default: newDefault }
    setSchedule(updated)
    save(updated)
  }

  function updateDay(dayKey, value) {
    const days = { ...schedule.days }
    if (value === undefined) {
      delete days[dayKey]
    } else {
      days[dayKey] = value
    }
    const updated = { ...schedule, days }
    setSchedule(updated)
    save(updated)
  }

  function applyDefaultToAllDays() {
    const days = {}
    DAY_ORDER.forEach((d) => {
      days[d] = {
        morning: schedule.default.morning ? { ...schedule.default.morning } : null,
        afternoon: schedule.default.afternoon ? { ...schedule.default.afternoon } : null,
      }
    })
    const updated = { ...schedule, days }
    setSchedule(updated)
    save(updated)
  }

  function resetDayOverrides() {
    const updated = { ...schedule, days: {} }
    setSchedule(updated)
    save(updated)
  }

  function resetAll() {
    setSchedule(EMPTY_SCHEDULE)
    save(EMPTY_SCHEDULE)
  }

  if (!loaded) {
    return <main><p className="loading">Chargement…</p></main>
  }

  const hasAnyDayOverride = Object.keys(schedule.days).length > 0

  return (
    <main>
      <header className="opts-header">
        <h1>Claude Monitor</h1>
        <span className="opts-subtitle">Paramètres</span>
      </header>

      <section className="opts-section">
        <div className="opts-section-title">
          Planning journalier
          <span className="opts-badge">facultatif</span>
        </div>
        <p className="opts-description">
          Définissez vos plages de travail habituelles. Quand vous êtes dans une plage active,
          le badge et le graphique sont calés sur la fin de votre demi-journée plutôt que
          sur la prochaine réinitialisation de session Claude.
        </p>

        <div className="opts-block">
          <div className="opts-block-title">Horaires par défaut</div>
          <SlotEditor slots={schedule.default} onChange={updateDefault} />
        </div>

        <details className="opts-details">
          <summary>
            Personnaliser par jour de la semaine
            {hasAnyDayOverride && <span className="opts-override-badge">{Object.keys(schedule.days).length}</span>}
          </summary>

          <div className="opts-day-actions">
            <button className="opts-action-btn" onClick={applyDefaultToAllDays}>
              Appliquer les défauts à tous les jours
            </button>
            {hasAnyDayOverride && (
              <button className="opts-action-btn opts-action-btn--ghost" onClick={resetDayOverrides}>
                Effacer les surcharges
              </button>
            )}
          </div>

          <div className="opts-day-list">
            {DAY_ORDER.map((dayKey) => (
              <DayRow
                key={dayKey}
                dayKey={dayKey}
                override={schedule.days?.[dayKey]}
                defaultSlots={schedule.default}
                onChange={(v) => updateDay(dayKey, v)}
              />
            ))}
          </div>
        </details>
      </section>

      <div className="opts-footer">
        <button className="opts-reset-btn" onClick={resetAll}>
          Tout réinitialiser
        </button>
        <span className={`opts-saved${savedFlash ? ' opts-saved--visible' : ''}`}>
          ✓ Sauvegardé
        </span>
      </div>
    </main>
  )
}

export default Options
