// Turning an on-screen SVG into a downloadable PNG, split so the fiddly part is testable.
//
// The map's country fills are `<pattern>`s whose images are already data: URIs (the cover mosaics
// are drawn to a canvas and inlined via toDataURL), so a serialized copy is fully self-contained -
// nothing is fetched at draw time and the rasterizing canvas never gets tainted.

// A live Leaflet SVG carries a transform that pans/zooms its contents and usually has no explicit
// size, so serializing it as-is produces an image that is either empty or clipped. This returns
// standalone markup with the viewport pinned to what is on screen and an opaque background painted
// underneath (an SVG with no background rasterizes to transparent, which reads as a black rectangle
// in most viewers).
export const standaloneSvgMarkup = (
  innerMarkup: string,
  width: number,
  height: number,
  background: string,
): string => {
  const body = innerMarkup.replace(/^\s*<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '')
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`,
    `<rect width="${width}" height="${height}" fill="${background}"/>`,
    body,
    '</svg>',
  ].join('')
}

// Filenames are user-visible and end up in a download folder next to everything else, so they carry
// what the file is plus the day it was made.
export const exportFilename = (prefix: string, date = new Date()): string => {
  const stamp = [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
  ].join('-')
  return `${prefix}-${stamp}.png`
}
