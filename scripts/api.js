// One place that knows how the module talks to the Tome API: the base URL, the
// connection token, and the JSON envelope. Action handlers and reporters call
// `api(...)` instead of re-deriving headers.

/** @type {{ apiBase: string, token: string } | null} */
let credentials = null;

/**
 * @param {string} apiBase
 * @param {string} token
 */
export function configureApi(apiBase, token) {
  credentials = { apiBase: apiBase.replace(/\/+$/, ''), token };
}

export class ApiError extends Error {
  /**
   * @param {number} status
   * @param {string} message
   * @param {unknown} body
   */
  constructor(status, message, body) {
    super(message);
    this.status = status;
    this.body = body;
  }
}

/**
 * @param {string} path  Path under `/api/`, e.g. `foundry-connections/me/actors`.
 * @param {{ method?: string, body?: unknown, fetchImpl?: typeof fetch }} [options]
 * @returns {Promise<any>}
 */
export async function api(path, { method = 'GET', body, fetchImpl = globalThis.fetch } = {}) {
  if (!credentials) {
    throw new Error('World Building Tome API is not configured.');
  }

  const res = await fetchImpl(`${credentials.apiBase}/api/${path.replace(/^\/+/, '')}`, {
    method,
    headers: {
      Authorization: `Bearer ${credentials.token}`,
      Accept: 'application/json',
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  const text = await res.text();
  const parsed = text ? safeJson(text) : null;

  if (!res.ok) {
    throw new ApiError(res.status, `${method} ${path} returned ${res.status}`, parsed);
  }

  return parsed;
}

function safeJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}
