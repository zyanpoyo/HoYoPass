import { GAMES } from '../config/constants.js';
import { formatLogTimestamp } from '../utils/message-formatter.js';
import { getGameLocalized, t } from '../utils/i18n.js';

export function isLogForGame(log, gameKey) {
  if (!log) return false;
  if (log.gameKey) {
    return log.gameKey === gameKey;
  }
  const msg = log.message || '';
  const jaName = GAMES[gameKey]?.name;
  const enName = getGameLocalized(gameKey, 'en')?.name;

  if ((jaName && msg.includes(jaName)) || (enName && msg.includes(enName))) {
    return true;
  }

  const otherNames = [];
  Object.keys(GAMES).forEach(k => {
    if (k !== gameKey) {
      otherNames.push(GAMES[k]?.name);
      otherNames.push(getGameLocalized(k, 'en')?.name);
    }
  });

  return !otherNames.some(name => name && msg.includes(name));
}

export function buildLatestLogSummary(latestLog, lang = 'ja') {
  if (!latestLog) {
    return { text: t('latestLogEmpty', [], lang), isError: false };
  }
  const time = formatLogTimestamp(latestLog.timestamp);
  const timeSuffix = time ? ` (${time})` : '';
  if (latestLog.type === 'ERROR') {
    return { text: t('latestLogError', [timeSuffix], lang), isError: true };
  }
  if (latestLog.type === 'WARN') {
    return { text: t('latestLogWarn', [timeSuffix], lang), isError: false };
  }
  return { text: t('latestLogSuccess', [timeSuffix], lang), isError: false };
}

export function stripGamePrefix(rawMessage, gameKey) {
  let cleanMsg = rawMessage || '';
  const jaPrefix = `${GAMES[gameKey]?.name}: `;
  const enPrefix = `${getGameLocalized(gameKey, 'en')?.name}: `;

  if (cleanMsg.startsWith(jaPrefix)) {
    cleanMsg = cleanMsg.slice(jaPrefix.length);
  } else if (cleanMsg.startsWith(enPrefix)) {
    cleanMsg = cleanMsg.slice(enPrefix.length);
  }
  return cleanMsg;
}

export async function renderLogs(currentGameKey, currentLang) {
  const container = document.getElementById('logs-container');
  const summaryEl = document.getElementById('latest-log-summary');
  if (!container) return;

  const data = await chrome.storage.local.get('exec_logs');
  const allLogs = data.exec_logs || [];
  const logs = allLogs.filter(log => isLogForGame(log, currentGameKey));

  if (summaryEl) {
    const { text, isError } = buildLatestLogSummary(logs[0], currentLang);
    summaryEl.textContent = text;
    summaryEl.classList.toggle('has-error', isError);
  }

  container.innerHTML = '';
  if (!logs.length) {
    const empty = document.createElement('div');
    empty.textContent = t('noLogs', [], currentLang);
    empty.style.color = '#64748b';
    container.appendChild(empty);
    return;
  }

  logs.forEach(log => {
    const item = document.createElement('div');
    item.className = log.type === 'ERROR' ? 'log-item log-error' : 'log-item';
    const time = formatLogTimestamp(log.timestamp);
    const cleanMsg = stripGamePrefix(log.message || log.type || '', currentGameKey);
    item.textContent = `[${time}] ${cleanMsg}`;
    container.appendChild(item);
  });
}
