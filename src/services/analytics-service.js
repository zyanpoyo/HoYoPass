import { API_CONFIG } from '../config/constants.js';
import { getSettings, getOrCreateGaClientId, needsPolicyReview } from './storage-service.js';
import { resolveLanguage } from '../utils/i18n.js';

export function toGaGameKey(gameKey) {
  switch (gameKey) {
    case 'GENSHIN':
      return 'genshin';
    case 'STAR_RAIL':
      return 'hsr';
    case 'ZZZ':
      return 'zzz';
    default:
      return 'none';
  }
}

export function toRedeemTrigger(triggerSource) {
  if (triggerSource === 'MANUAL') return 'manual';
  if (triggerSource === 'INITIAL_RUN') return 'initial';
  return 'auto';
}

export function toCheckinTrigger(triggerSource) {
  if (triggerSource === 'MANUAL') return 'manual';
  return 'auto';
}

const ALLOWED_EVENT_PARAMS = {
  code_redeem_result: ['game', 'trigger', 'status', 'error_reason'],
  daily_checkin_result: ['game', 'trigger', 'status', 'error_reason'],
  onboarding_complete: ['genshin_enabled', 'hsr_enabled', 'zzz_enabled'],
  ui_action: ['action_type', 'game'],
  code_list_fetch_error: ['game', 'http_status', 'error_type']
};

export function sanitizeEventParams(eventName, params = {}) {
  const allowedKeys = ALLOWED_EVENT_PARAMS[eventName];
  if (!allowedKeys) {
    return null;
  }
  const clean = {};
  for (const key of allowedKeys) {
    if (params[key] !== undefined && params[key] !== null) {
      if (typeof params[key] === 'boolean') {
        clean[key] = String(params[key]);
      } else if (typeof params[key] === 'number') {
        clean[key] = params[key];
      } else {
        clean[key] = String(params[key]).slice(0, 100);
      }
    }
  }
  return clean;
}

export async function getOrCreateSessionId(nowMs = Date.now()) {
  const now = nowMs;
  try {
    if (typeof chrome !== 'undefined' && chrome.storage?.session) {
      const data = await chrome.storage.session.get(['ga_session_id', 'ga_last_active']);
      const sid = data.ga_session_id;
      const lastActive = Number(data.ga_last_active || 0);

      if (sid && lastActive && (now - lastActive < API_CONFIG.GA_SESSION_TIMEOUT_MS)) {
        await chrome.storage.session.set({ ga_last_active: now });
        return String(sid);
      }

      const newSid = String(now);
      await chrome.storage.session.set({
        ga_session_id: newSid,
        ga_last_active: now
      });
      return newSid;
    }
  } catch {
    // ignore
  }
  return String(now);
}

export async function syncConsentBadge() {
  try {
    if (typeof chrome === 'undefined' || !chrome.action?.setBadgeText) return;
    const settings = await getSettings();
    const needsReview = !settings.analyticsConsentReviewed || needsPolicyReview(settings);
    if (settings.optInAccepted && needsReview) {
      await chrome.action.setBadgeText({ text: '!' });
      if (chrome.action.setBadgeBackgroundColor) {
        await chrome.action.setBadgeBackgroundColor({ color: '#f59e0b' });
      }
    } else {
      await chrome.action.setBadgeText({ text: '' });
    }
  } catch {
    // ignore
  }
}

export async function sendGAEvent(eventName, rawParams = {}) {
  try {
    const settings = await getSettings();
    if (!settings.analyticsConsentReviewed || !settings.analyticsEnabled) {
      return { success: false, reason: 'OPTED_OUT' };
    }

    const cleanParams = sanitizeEventParams(eventName, rawParams);
    if (!cleanParams) {
      return { success: false, reason: 'INVALID_EVENT' };
    }

    // 共通パラメータの付与
    let appVersion = '1.3.4';
    try {
      if (typeof chrome !== 'undefined' && chrome.runtime?.getManifest) {
        appVersion = chrome.runtime.getManifest()?.version || appVersion;
      }
    } catch {
      // ignore
    }

    cleanParams.app_version = appVersion;
    cleanParams.engagement_time_msec = 100;
    cleanParams.lang = resolveLanguage(settings.language);
    cleanParams.session_id = await getOrCreateSessionId();
    const clientId = await getOrCreateGaClientId();
    cleanParams.client_id = clientId;
    cleanParams.custom_client_id = clientId;

    // 開発版フレーバー時は通信を行わずローカルログのみ
    if (API_CONFIG.IS_DEV) {
      if (typeof console !== 'undefined' && console.debug) {
        console.debug('[GA4 Dev]', eventName, cleanParams);
      }
      return { success: true, isDev: true, eventName, params: cleanParams };
    }

    const measurementId = API_CONFIG.GA_MEASUREMENT_ID;
    const apiSecret = API_CONFIG.GA_API_SECRET;
    if (!measurementId || !apiSecret) {
      return { success: false, reason: 'NO_CREDENTIALS' };
    }

    const payload = {
      client_id: clientId,
      events: [
        {
          name: eventName,
          params: cleanParams
        }
      ]
    };

    const endpoint = `https://www.google-analytics.com/mp/collect?measurement_id=${encodeURIComponent(measurementId)}&api_secret=${encodeURIComponent(apiSecret)}`;
    const signal = (typeof AbortSignal !== 'undefined' && AbortSignal.timeout)
      ? AbortSignal.timeout(API_CONFIG.GA_TIMEOUT_MS)
      : undefined;

    // CORS preflight を回避する単純リクエスト（Content-Typeヘッダーを明示しない）
    await fetch(endpoint, {
      method: 'POST',
      body: JSON.stringify(payload),
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
      signal
    });

    return { success: true, eventName, params: cleanParams };
  } catch (err) {
    // GA4 送信の失敗はいかなる場合もメイン動作に影響を与えないよう握りつぶす
    return { success: false, reason: 'ERROR', error: err?.message };
  }
}
