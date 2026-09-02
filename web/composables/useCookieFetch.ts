// $fetch to our own API during SSR is a plain server-side HTTP request - it does NOT automatically
// carry the incoming request's cookies (unlike the browser, which attaches them for a client-side
// $fetch for free). Every settings form called `$fetch('/api/settings')` straight from
// `useAsyncData` with no cookie forwarding, so the very first hard load of a settings page (direct
// URL, refresh) sent an unauthenticated SSR request, got a silent 401, and rendered with null data -
// blank fields, an empty permissions table - while a client-side re-fetch never happened because
// useAsyncData treats the (failed) SSR result as already fetched. useAuth.ts's loadMe already forwards
// cookies this way; every settings-page SSR fetch needs the same treatment.
export const useCookieFetch = <T>(url: string, opts: Record<string, any> = {}): Promise<T> =>
  $fetch<T>(url, {
    ...opts,
    headers: {
      ...(import.meta.server ? useRequestHeaders(['cookie']) : {}),
      ...(opts.headers ?? {}),
    },
  })
