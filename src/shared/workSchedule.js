// Day keys aligned with Date.getDay() (0 = Sunday)
const DAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']

/**
 * Returns the active work slot for the given time, or null if outside configured slots.
 *
 * workSchedule: {
 *   default: { morning: {start, end}|null, afternoon: {start, end}|null },
 *   days: { mon: <slot>|null|undefined, ... }  (undefined = inherit default)
 * }
 *
 * @param {object|null} workSchedule
 * @param {Date} now
 * @returns {{ end: Date, remainingMins: number, label: string, slotName: 'morning'|'afternoon' } | null}
 */
export function getActiveWorkSlot(workSchedule, now = new Date()) {
  if (!workSchedule) return null

  const dayKey = DAY_KEYS[now.getDay()]
  const dayOverride = workSchedule.days?.[dayKey]
  // undefined → inherit default; null or object → use as-is (null = repos)
  const daySchedule = dayOverride !== undefined ? dayOverride : workSchedule.default

  if (!daySchedule) return null

  for (const slotName of ['morning', 'afternoon']) {
    const slot = daySchedule[slotName]
    if (!slot?.start || !slot?.end) continue

    const [sh, sm] = slot.start.split(':').map(Number)
    const [eh, em] = slot.end.split(':').map(Number)

    const start = new Date(now)
    start.setHours(sh, sm, 0, 0)

    const end = new Date(now)
    end.setHours(eh, em, 0, 0)

    if (now >= start && now < end) {
      const remainingMins = (end - now) / 60000
      return {
        end,
        remainingMins,
        label: `${eh}h${String(em).padStart(2, '0')}`,
        slotName,
      }
    }
  }

  return null
}

/**
 * Computes work-based refWidth (rythme attendu calé sur la fin de demi-journée).
 *
 * sessionElapsed = sessionTotalMins - sessionRemainingMins
 * workTotal      = sessionElapsed + workRemainingMins
 * refWidth       = sessionElapsed / workTotal * 100
 *
 * @param {number|null} sessionRemainingMins - from parseRemainingMinutes(resetLabel)
 * @param {number} workRemainingMins - from getActiveWorkSlot().remainingMins
 * @param {number} sessionTotalMins - 300 (5h) par défaut
 * @returns {number|null}
 */
export function computeWorkRefWidth(sessionRemainingMins, workRemainingMins, sessionTotalMins = 300) {
  if (sessionRemainingMins === null || workRemainingMins == null) return null
  const elapsed = Math.max(0, sessionTotalMins - sessionRemainingMins)
  const total = elapsed + workRemainingMins
  if (total <= 0) return null
  return Math.min(100, (elapsed / total) * 100)
}
