import { describe, expect, it } from 'vitest'
import { buildCsp, buildSecurityHeaders } from '../../../server/utils/securityHeaders'

describe('buildCsp', () => {
  it('forbids framing, plugins and off-origin connections', () => {
    const csp = buildCsp({})
    expect(csp).toContain('frame-ancestors \'none\'')
    expect(csp).toContain('object-src \'none\'')
    expect(csp).toContain('default-src \'self\'')
    expect(csp).toMatch(/connect-src 'self'(;|$)/)
  })

  it('allows the storage bucket origin (and only its origin) for connections when configured', () => {
    const csp = buildCsp({ storagePublicUrl: 'https://cdn.example.com/covers/path' })
    expect(csp).toContain('connect-src \'self\' https://cdn.example.com;')
  })

  it('ignores an unparsable storage URL', () => {
    expect(buildCsp({ storagePublicUrl: 'not a url' })).toMatch(/connect-src 'self';/)
  })
})

describe('buildSecurityHeaders', () => {
  it('always sends the framing and sniffing protections', () => {
    const headers = buildSecurityHeaders({ dev: false })
    expect(headers['X-Frame-Options']).toBe('DENY')
    expect(headers['X-Content-Type-Options']).toBe('nosniff')
    expect(headers['Referrer-Policy']).toBe('same-origin')
  })

  it('sends the CSP in production but not in dev (Vite needs eval and a websocket)', () => {
    expect(buildSecurityHeaders({ dev: false })['Content-Security-Policy']).toBeTruthy()
    expect(buildSecurityHeaders({ dev: true })['Content-Security-Policy']).toBeUndefined()
  })
})
