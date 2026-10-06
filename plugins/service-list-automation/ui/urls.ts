/** The page URL worth remembering: the one where the tool found the create button.
 *  APEX puts the session id in the URL; it expires, so it is dropped (opening the
 *  page without it simply starts a new session, through the login if needed). */
export function cleanPageUrl(raw: string): string | null {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  if (!['http:', 'https:', 'file:'].includes(u.protocol)) return null;
  for (const key of [...u.searchParams.keys()]) {
    if (key.toLowerCase() === 'session') u.searchParams.delete(key);
  }
  return u.toString();
}

export const MAX_RECENT = 5;

/** Most recent first, no repeats, at most `MAX_RECENT`. */
export function rememberUrl(list: unknown, url: string): string[] {
  const clean = Array.isArray(list) ? list.filter((x): x is string => typeof x === 'string') : [];
  return [url, ...clean.filter((x) => x !== url)].slice(0, MAX_RECENT);
}

export const cleanRecent = (list: unknown): string[] =>
  Array.isArray(list) ? list.filter((x): x is string => typeof x === 'string').slice(0, MAX_RECENT) : [];
