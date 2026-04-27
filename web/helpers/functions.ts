export const formatDuration = (seconds: number | null): string => {
  if (!seconds || !isFinite(seconds)) { return '0:00' }
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}

export const formatPlaytime = (seconds: number): string => {
  if (seconds === 0) { return '0 seconds' }
  const days = Math.floor(seconds / 86400)
  const hours = Math.floor((seconds % 86400) / 3600)
  const mins = Math.floor((seconds % 3600) / 60)
  const parts: string[] = []
  if (days > 0) { parts.push(`${days}d`) }
  if (hours > 0) { parts.push(`${hours}h`) }
  if (mins > 0) { parts.push(`${mins}m`) }
  return parts.join(' ') || '< 1m'
}

export const formatNumber = (n: number): string => {
  return n.toLocaleString()
}
