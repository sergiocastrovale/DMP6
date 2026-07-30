// server/utils/*.ts rely on Nitro's auto-imported h3 helpers (createError, defineEventHandler, ...).
// Outside the real Nitro runtime (the `unit`/`integration` vitest projects run plain Node/happy-dom,
// not Nuxt) those globals don't exist, so polyfill the ones server utils actually call at the top level.
import { createError, defineEventHandler, getCookie, getRequestURL, setCookie, deleteCookie, readBody, sendRedirect } from 'h3'

Object.assign(globalThis, {
  createError,
  defineEventHandler,
  getCookie,
  setCookie,
  deleteCookie,
  readBody,
  getRequestURL,
  sendRedirect,
})
