// Deliberately loose - not full RFC 5322, just "looks like an email" (something@something.tld,
// no whitespace). Good enough to reject obvious junk without rejecting real addresses.
export const isValidEmail = (email: string): boolean =>
  /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
