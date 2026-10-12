import { API_CONFIG, GAMES } from '../config/constants.js';
import { publicFetch } from './http-client.js';
import { isValidCode } from './security.js';

export async function fetchValidCodes(gameKey = 'GENSHIN') {
  const param = GAMES[gameKey]?.hoyoCodesParam || gameKey.toLowerCase();
  const url = `https://hoyo-codes.seria.moe/codes?game=${param}`;
  const response = await publicFetch(url);

  if (!response.ok) {
    throw new Error(`HTTP_ERROR_${response.status}`);
  }

  const contentType = response.headers.get('content-type') || '';
  if (!contentType.includes('application/json')) {
    throw new Error('SECURITY_ERROR: Content-Type must be application/json');
  }

  const text = await response.text();
  if (text.length > API_CONFIG.MAX_EXTERNAL_PAYLOAD_BYTES) {
    throw new Error('SECURITY_ERROR: Payload exceeds 256KB size limit.');
  }

  const data = JSON.parse(text);
  const rawList = Array.isArray(data) ? data : (data.codes || []);

  if (rawList.length > API_CONFIG.MAX_NEW_CODES_PER_FETCH) {
    throw new Error('SECURITY_ERROR: Fetched code count exceeds sanity threshold.');
  }

  const validCodes = [];
  for (const item of rawList) {
    const code = typeof item === 'string' ? item : item.code;
    const status = typeof item === 'object' && item.status ? item.status.toLowerCase() : 'active';
    if ((status === 'ok' || status === 'active' || status === 'valid') && isValidCode(code)) {
      validCodes.push(code.trim());
    }
  }

  return [...new Set(validCodes)];
}
