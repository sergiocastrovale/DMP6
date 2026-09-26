// Strip characters that are illegal in a file or folder name on any of the filesystems the library lives on,
// collapse whitespace, and cap the length. One definition for the download layout and the MP3 renamer.
export const sanitizePathSegment = (s: string): string => s
  .replace(/[<>:"/\\|?*\x00-\x1f]/g, '_')
  .replace(/\s+/g, ' ')
  .trim()
  .slice(0, 200)
