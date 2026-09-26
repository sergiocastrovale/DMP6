// IANA zone handling for "today / this month / this year" boundaries, which belong to the listener's calendar,
// not the container's (UTC).

export const DEFAULT_TIME_ZONE = 'UTC'

// The zone the client reported, or UTC when it is missing or not a zone this runtime knows.
export const resolveTimeZone = (raw: unknown): string => {
  if (typeof raw !== 'string' || !raw || raw.length > 64) {
    return DEFAULT_TIME_ZONE
  }
  try {
    return new Intl.DateTimeFormat('en-US', { timeZone: raw }).resolvedOptions().timeZone
  }
  catch {
    return DEFAULT_TIME_ZONE
  }
}

interface ZonedParts { year: number, month: number, day: number, hour: number, minute: number, second: number }

const formatters = new Map<string, Intl.DateTimeFormat>()

const partsIn = (instant: Date, timeZone: string): ZonedParts => {
  let formatter = formatters.get(timeZone)
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric',
    })
    formatters.set(timeZone, formatter)
  }
  const out: Record<string, number> = {}
  for (const p of formatter.formatToParts(instant)) {
    if (p.type !== 'literal') {
      out[p.type] = Number(p.value)
    }
  }
  return out as unknown as ZonedParts
}

// How far the zone's wall clock is ahead of UTC at `instant`, in ms (DST-aware).
const offsetMs = (instant: Date, timeZone: string): number => {
  const p = partsIn(instant, timeZone)
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(instant.getTime() / 1000) * 1000
}

// The instant at which the wall clock in `timeZone` reads 00:00 on the given calendar day. The offset is looked up
// twice so a day whose midnight sits on the far side of a DST change still lands on the right instant.
export const zonedMidnight = (year: number, month: number, day: number, timeZone: string): Date => {
  const wallAsUtc = Date.UTC(year, month - 1, day)
  const first = wallAsUtc - offsetMs(new Date(wallAsUtc), timeZone)
  return new Date(wallAsUtc - offsetMs(new Date(first), timeZone))
}

// Calendar date of `instant` in `timeZone`.
export const zonedDate = (instant: Date, timeZone: string): { year: number, month: number, day: number } => {
  const { year, month, day } = partsIn(instant, timeZone)
  return { year, month, day }
}
