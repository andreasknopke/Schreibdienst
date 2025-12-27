// Zentrale Fetch-Hilfsfunktion mit automatischem DB-Token Header
// Wird im Frontend verwendet, um alle API-Aufrufe mit dem Token zu versehen

import { getDbToken } from './dbToken';

interface FetchOptions extends RequestInit {
  // Optional: Bereits vorhandene Headers werden gemergt
}

/**
 * Wrapper für fetch, der automatisch den X-DB-Token Header hinzufügt
 * wenn ein Token im localStorage vorhanden ist.
 */
export async function fetchWithDbToken(
  url: string | URL | Request,
  options: FetchOptions = {}
): Promise<Response> {
  const token = getDbToken();
  
  // Merge Headers
  const existingHeaders = options.headers instanceof Headers 
    ? Object.fromEntries(options.headers.entries())
    : (options.headers as Record<string, string> || {});
  
  const headers = {
    ...existingHeaders,
    ...(token ? { 'X-DB-Token': token } : {})
  };
  
  return fetch(url, {
    ...options,
    headers
  });
}

/**
 * Erstellt Header-Objekt mit DB-Token (falls vorhanden)
 * Kann mit anderen Headers gemergt werden
 */
export function getDbTokenHeaders(): Record<string, string> {
  const token = getDbToken();
  if (token) {
    return { 'X-DB-Token': token };
  }
  return {};
}
