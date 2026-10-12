import { ALLOWED_REGIONS } from '../config/constants.js';

export function isValidCode(code) {
  if (typeof code !== 'string') return false;
  return /^[A-Za-z0-9]{4,30}$/.test(code);
}

export function isValidUid(uid) {
  if (typeof uid !== 'string' && typeof uid !== 'number') return false;
  const str = String(uid);
  return /^\d{6,12}$/.test(str);
}

export function isValidRegion(region) {
  if (typeof region !== 'string') return false;
  if (ALLOWED_REGIONS.includes(region)) return true;
  return /^[a-z0-9_]{3,30}$/.test(region) && (region.startsWith('os_') || region.startsWith('prod_'));
}

export function maskUid(uid) {
  if (!uid) return '***';
  const str = String(uid);
  if (str.length <= 4) return '***';
  return str.slice(0, 3) + '***' + str.slice(-3);
}
