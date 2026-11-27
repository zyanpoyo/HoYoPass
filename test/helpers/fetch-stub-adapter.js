/**
 * ApiGateway 決定論的テスト用の fetch スタブアダプター。
 * globalThis.fetch を書き換えずにリクエスト履歴の記録とレスポンス制御を行う。
 */
export function jsonResponse(body, { status = 200, headers = { 'content-type': 'application/json' } } = {}) {
  const payload = typeof body === 'string' ? body : JSON.stringify(body);
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers(headers),
    text: async () => payload,
    json: async () => JSON.parse(payload)
  };
}

export function textResponse(text, { status = 200, headers = { 'content-type': 'text/html' } } = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers(headers),
    text: async () => text
  };
}

export function createFetchStubAdapter(handler) {
  const calls = [];
  const fetchFn = async (url, opts = {}) => {
    const entry = { url: String(url), opts };
    calls.push(entry);
    return handler(entry.url, opts, calls.length - 1);
  };
  return { fetchFn, calls };
}
