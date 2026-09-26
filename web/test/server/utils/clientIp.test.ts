import { describe, expect, it } from 'vitest'
import { DEFAULT_TRUSTED_PROXY_CIDRS, isTrustedPeer, parseCidrs, resolveClientIp } from '../../../server/utils/clientIp'

describe('parseCidrs / isTrustedPeer', () => {
  const cidrs = parseCidrs(DEFAULT_TRUSTED_PROXY_CIDRS)

  it('trusts docker-bridge and loopback peers', () => {
    expect(isTrustedPeer('172.18.0.5', cidrs)).toBe(true)
    expect(isTrustedPeer('172.31.255.254', cidrs)).toBe(true)
    expect(isTrustedPeer('127.0.0.1', cidrs)).toBe(true)
  })

  it('does not trust LAN or public peers', () => {
    expect(isTrustedPeer('192.168.1.50', cidrs)).toBe(false)
    expect(isTrustedPeer('172.32.0.1', cidrs)).toBe(false)
    expect(isTrustedPeer('8.8.8.8', cidrs)).toBe(false)
  })

  it('understands IPv4-mapped IPv6 peers', () => {
    expect(isTrustedPeer('::ffff:172.18.0.5', cidrs)).toBe(true)
    expect(isTrustedPeer('::ffff:8.8.8.8', cidrs)).toBe(false)
  })

  it('rejects garbage, missing peers and bad CIDR entries', () => {
    expect(isTrustedPeer(undefined, cidrs)).toBe(false)
    expect(isTrustedPeer('not-an-ip', cidrs)).toBe(false)
    expect(parseCidrs('nonsense, 10.0.0.0/33, 10.0.0.0/8')).toHaveLength(1)
  })

  it('a /32 matches exactly one address and /0 matches everything', () => {
    expect(isTrustedPeer('10.1.2.3', parseCidrs('10.1.2.3/32'))).toBe(true)
    expect(isTrustedPeer('10.1.2.4', parseCidrs('10.1.2.3/32'))).toBe(false)
    expect(isTrustedPeer('1.2.3.4', parseCidrs('0.0.0.0/0'))).toBe(true)
  })
})

describe('resolveClientIp', () => {
  const trusted = DEFAULT_TRUSTED_PROXY_CIDRS

  it('uses cf-connecting-ip when the socket peer is a trusted proxy', () => {
    expect(resolveClientIp({ peer: '172.18.0.5', cfConnectingIp: '203.0.113.9', trustedCidrs: trusted })).toBe('203.0.113.9')
  })

  it('ignores a forged cf-connecting-ip from an untrusted peer', () => {
    expect(resolveClientIp({ peer: '198.51.100.7', cfConnectingIp: '203.0.113.9', trustedCidrs: trusted })).toBe('198.51.100.7')
  })

  it('falls back to the peer when no header is sent', () => {
    expect(resolveClientIp({ peer: '172.18.0.5', cfConnectingIp: undefined, trustedCidrs: trusted })).toBe('172.18.0.5')
  })

  it('reports unknown when there is no peer at all', () => {
    expect(resolveClientIp({ peer: undefined, cfConnectingIp: undefined, trustedCidrs: trusted })).toBe('unknown')
  })

  it('honours a custom trusted list', () => {
    expect(resolveClientIp({ peer: '192.168.1.2', cfConnectingIp: '203.0.113.9', trustedCidrs: '192.168.1.0/24' })).toBe('203.0.113.9')
  })
})
