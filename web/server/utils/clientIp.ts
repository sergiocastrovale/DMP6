// The client address used to key brute-force throttles. Behind Cloudflare Tunnel every request reaches the
// container from cloudflared, so the socket address alone says nothing - the real client is in
// `cf-connecting-ip`. But that header is just text: taken from any peer, an attacker rotates it per request and
// every attempt gets a fresh throttle key. So it is honoured only when the *socket peer* is inside
// TRUSTED_PROXY_CIDRS (default: the docker bridge range cloudflared connects from, plus loopback), and
// X-Forwarded-For is never read.
import type { H3Event } from 'h3'

export const DEFAULT_TRUSTED_PROXY_CIDRS = '172.16.0.0/12,127.0.0.0/8'

interface Cidr {
  base: number
  mask: number
}

const ipv4ToInt = (ip: string): number | null => {
  const parts = ip.split('.')
  if (parts.length !== 4) {
    return null
  }
  let value = 0
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part) || Number(part) > 255) {
      return null
    }
    value = value * 256 + Number(part)
  }
  return value
}

// "::ffff:172.18.0.5" is how Node reports an IPv4 peer on a dual-stack socket.
const normalizeIp = (ip: string): string => ip.trim().replace(/^::ffff:/i, '')

export const parseCidrs = (list: string): Cidr[] =>
  list.split(',').flatMap((entry) => {
    const [addr, bits = '32'] = entry.trim().split('/')
    const base = ipv4ToInt(addr ?? '')
    const prefix = Number(bits)
    if (base === null || !Number.isInteger(prefix) || prefix < 0 || prefix > 32) {
      return []
    }
    const mask = prefix === 0 ? 0 : (0xFFFFFFFF << (32 - prefix)) >>> 0
    return [{ base: (base & mask) >>> 0, mask }]
  })

export const isTrustedPeer = (peer: string | undefined, cidrs: Cidr[]): boolean => {
  const value = ipv4ToInt(normalizeIp(peer ?? ''))
  return value !== null && cidrs.some(c => ((value & c.mask) >>> 0) === c.base)
}

export interface ClientIpInput {
  peer: string | undefined
  cfConnectingIp: string | undefined
  trustedCidrs: string
}

export const resolveClientIp = ({ peer, cfConnectingIp, trustedCidrs }: ClientIpInput): string => {
  const claimed = cfConnectingIp?.trim()
  return claimed && isTrustedPeer(peer, parseCidrs(trustedCidrs))
    ? claimed
    : normalizeIp(peer ?? '') || 'unknown'
}

export const clientIp = (event: H3Event): string =>
  resolveClientIp({
    peer: event.node.req.socket.remoteAddress,
    cfConnectingIp: getRequestHeader(event, 'cf-connecting-ip'),
    trustedCidrs: process.env.TRUSTED_PROXY_CIDRS || DEFAULT_TRUSTED_PROXY_CIDRS,
  })
