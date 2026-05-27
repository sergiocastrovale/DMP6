export const formatDuration = (seconds: number | null): string => {
  if (!seconds || !isFinite(seconds)) { return '0:00' }
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}

export const formatPlaytime = (seconds: number): string => {
  if (seconds === 0) { return '0 seconds' }
  const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`
  const years = Math.floor(seconds / 31536000)
  const remaining = seconds % 31536000
  const months = Math.floor(remaining / 2592000)
  const days = Math.floor((remaining % 2592000) / 86400)
  const hours = Math.floor((remaining % 86400) / 3600)
  const mins = Math.floor((remaining % 3600) / 60)
  const parts: string[] = []
  if (years > 0) { parts.push(plural(years, 'year')) }
  if (months > 0) { parts.push(plural(months, 'month')) }
  if (days > 0) { parts.push(plural(days, 'day')) }
  if (hours > 0) { parts.push(plural(hours, 'hour')) }
  if (mins > 0) { parts.push(plural(mins, 'minute')) }
  return parts.join(', ') || '< 1 minute'
}

export const formatNumber = (n: number): string => {
  return n.toLocaleString()
}

export const formatDate = (iso: string | null): string => {
  if (!iso) { return 'Never' }
  return new Date(iso).toLocaleDateString('pt-PT', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export const formatFileSize = (bytes: number): string => {
  if (!bytes || bytes <= 0) { return '0 B' }
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(bytes) / Math.log(1024))
  const value = bytes / Math.pow(1024, i)
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[i]}`
}
