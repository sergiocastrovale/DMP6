import { describe, expect, it } from 'vitest'
import { renderSubsonicXml } from '../../../../server/utils/subsonic/xml'

describe('renderSubsonicXml', () => {
  it('renders scalar fields as attributes on the root element', () => {
    const xml = renderSubsonicXml({ status: 'ok', version: '1.16.1' }, {})
    expect(xml).toBe('<?xml version="1.0" encoding="UTF-8"?>\n<subsonic-response status="ok" version="1.16.1"/>')
  })

  it('renders a nested object as a child element with its own attributes', () => {
    const xml = renderSubsonicXml({ status: 'ok' }, { license: { valid: true } })
    expect(xml).toContain('<license valid="true"/>')
  })

  it('renders a nested array as repeated same-tagged elements, not a wrapper', () => {
    const xml = renderSubsonicXml({ status: 'ok' }, {
      artists: { index: [{ name: 'A', artist: [{ id: '1', name: 'ABBA' }, { id: '2', name: 'Air' }] }] },
    })
    expect(xml).toContain('<index name="A"><artist id="1" name="ABBA"/><artist id="2" name="Air"/></index>')
  })

  it('renders a scalar array item as a text-content element', () => {
    const xml = renderSubsonicXml({ status: 'ok' }, {
      openSubsonicExtensions: [{ name: 'formPost', versions: [1] }],
    })
    expect(xml).toContain('<openSubsonicExtensions name="formPost"><versions>1</versions></openSubsonicExtensions>')
  })

  it('renders genre.value as text content, not an attribute (Subsonic irregularity)', () => {
    const xml = renderSubsonicXml({ status: 'ok' }, {
      genres: { genre: [{ value: 'Electronic', songCount: 3, albumCount: 1 }] },
    })
    expect(xml).toContain('<genre songCount="3" albumCount="1">Electronic</genre>')
    expect(xml).not.toContain('value=')
  })

  it('omits null/undefined fields entirely', () => {
    const xml = renderSubsonicXml({ status: 'ok' }, { album: { id: '1', year: undefined, comment: null } })
    expect(xml).toContain('<album id="1"/>')
  })

  it('escapes attribute and text special characters', () => {
    const xml = renderSubsonicXml({ status: 'ok' }, {
      album: { title: 'Rock & Roll "Anthem"' },
      genres: { genre: [{ value: 'R&B' }] },
    })
    expect(xml).toContain('title="Rock &amp; Roll &quot;Anthem&quot;"')
    expect(xml).toContain('>R&amp;B<')
  })
})
