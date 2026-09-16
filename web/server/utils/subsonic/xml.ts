// Subsonic's XML and JSON response bodies are the same tree, just rendered differently. This
// converts a JSON-shaped payload object into that XML using the convention every real Subsonic
// server follows: a scalar field becomes an attribute on its parent element; a nested object field
// becomes a child element (tag = the field's key) whose own scalars become ITS attributes; a nested
// array field becomes one child element per item, each tagged with the array's key (never
// pluralized or wrapped in an extra container) - a scalar array item becomes a text-content element
// instead of an empty self-closing one (e.g. OpenSubsonicExtensions' `versions: [1]`).
export type XmlValue = string | number | boolean | null | undefined | XmlObject | XmlValue[]
export interface XmlObject { [key: string]: XmlValue }

const escapeAttr = (v: string): string =>
  v.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

const escapeText = (v: string): string =>
  v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

const isScalar = (v: XmlValue): v is string | number | boolean =>
  typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean'

const renderScalarElement = (tag: string, value: string | number | boolean): string =>
  `<${tag}>${escapeText(String(value))}</${tag}>`

// A documented Subsonic irregularity: most objects' scalar fields are all attributes, but a
// handful use one field as the element's text content instead (`<genre songCount="1"
// albumCount="1">Electronic</genre>`, not a `value="Electronic"` attribute). Scoped to exactly the
// tags/fields known to need it rather than a general text-content convention.
const TEXT_CONTENT_FIELD: Record<string, string> = { genre: 'value' }

const renderElement = (tag: string, obj: XmlObject): string => {
  const attrs: string[] = []
  const children: string[] = []
  const textField = TEXT_CONTENT_FIELD[tag]

  for (const [key, value] of Object.entries(obj)) {
    if (value === null || value === undefined) {continue}
    if (key === textField && isScalar(value)) {
      children.push(escapeText(String(value)))
    }
    else if (isScalar(value)) {
      attrs.push(`${key}="${escapeAttr(String(value))}"`)
    }
    else if (Array.isArray(value)) {
      for (const item of value) {
        if (item === null || item === undefined) {continue}
        children.push(isScalar(item) ? renderScalarElement(key, item) : renderElement(key, item as XmlObject))
      }
    }
    else {
      children.push(renderElement(key, value))
    }
  }

  const attrStr = attrs.length ? ` ${attrs.join(' ')}` : ''
  return children.length ? `<${tag}${attrStr}>${children.join('')}</${tag}>` : `<${tag}${attrStr}/>`
}

// `attrs` and `body` are merged onto one root element - callers keep them separate (envelope
// attributes vs. response-specific content) purely for readability at the call site.
export const renderSubsonicXml = (attrs: XmlObject, body: XmlObject): string =>
  `<?xml version="1.0" encoding="UTF-8"?>\n${renderElement('subsonic-response', { ...attrs, ...body })}`
