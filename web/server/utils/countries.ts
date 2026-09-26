// English region names come from the runtime's ICU data (Intl.DisplayNames) rather than a hand-kept table; the previous
// 250-entry table was byte-identical to it. A code the runtime does not know is shown as itself.
const regionNames = new Intl.DisplayNames(['en'], { type: 'region', fallback: 'code' })

export const countryName = (code: string): string => {
  try {
    return regionNames.of(code) ?? code
  }
  catch {
    return code
  }
}
