import { logToPopup, readFromStorage, safeParse, DATA_KEYS } from '../shared.js';

const ORCHARD_BASE = 'https://orchard22.com';
const ORCHARD_TEAMS_URL = `${ORCHARD_BASE}/api/team/lt/select`;
const ORCHARD_DEPARTMENTS_URL = `${ORCHARD_BASE}/api/department/lt/select`;
const ORCHARD_SHIFTS_URL = `${ORCHARD_BASE}/api/agent-shift/agent-schedule-shift-calendar-list-by-filter-page-number?tagRequired=true`;
const ORCHARD_WORK_HOURS_URL = `${ORCHARD_BASE}/api/calendar/work-hour/list-by-filter`;
const ORCHARD_CAPTURE_FILTER = { urls: ['https://*.orchard22.com/*'] };

chrome.webRequest.onSendHeaders.addListener(
  (details) => {
    const authHeader = (details.requestHeaders || []).find((h) => h.name.toLowerCase() === 'authorization');
    if (authHeader && authHeader.value && authHeader.value.startsWith('Bearer ')) {
      const token = authHeader.value.replace('Bearer ', '').trim();
      chrome.storage.local.set({ orchardToken: token });
      logToPopup('Сайт 2', 'Отримано Bearer токен автоматично', 200);
    }
  },
  ORCHARD_CAPTURE_FILTER,
  ['requestHeaders', 'extraHeaders']
);

export async function ensureOrchardToken() {
  const existing = await readFromStorage('orchardToken');
  if (existing) return existing;
  logToPopup('Сайт 2', 'Очікування Bearer токена...', null);
  const tokenPromise = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      chrome.storage.onChanged.removeListener(listener);
      reject(new Error('Таймаут очікування токена'));
    }, 15000);
    const listener = (changes, area) => {
      if (area === 'local' && changes.orchardToken?.newValue) {
        clearTimeout(timeout);
        chrome.storage.onChanged.removeListener(listener);
        resolve(changes.orchardToken.newValue);
      }
    };
    chrome.storage.onChanged.addListener(listener);
  });

  const tabs = await chrome.tabs.query({ url: '*://*.orchard22.com/*' });
  if (tabs && tabs.length) {
    chrome.tabs.reload(tabs[0].id);
  } else {
    chrome.tabs.create({ url: 'https://orchard22.com/' });
  }
  return tokenPromise;
}

export async function fetchOrchardTeams() {
  const token = await ensureOrchardToken();
  if (!token) throw new Error('Відсутній Orchard токен');
  const headers = {
    'Content-Type': 'application/json',
    Accept: 'application/json, text/plain, */*',
    Authorization: `Bearer ${token}`,
  };
  logToPopup('Сайт 2', 'Відправка запиту за командами', null, {});
  const res = await fetch(ORCHARD_TEAMS_URL, { method: 'POST', credentials: 'include', headers, body: JSON.stringify({}) });
  const status = res.status;
  const textBody = await res.text();
  if (!res.ok) {
    console.error('Orchard teams HTTP error', { status, textBody });
    logToPopup('Сайт 2', 'HTTP помилка команд', status, { textBody });
    throw new Error(`HTTP ${status}`);
  }
  const data = safeParse(textBody);
  if (!Array.isArray(data)) {
    logToPopup('Сайт 2', 'Неочікувана відповідь команд', status, { textBody });
    throw new Error('Невірний формат команд');
  }
  return data;
}

export async function fetchAllOrchardShifts({ teamId, dateFromMs, dateToMs }) {
  const token = await ensureOrchardToken();
  if (!token) throw new Error('Відсутній Orchard токен');
  const dateFrom = dateFromMs || Date.now();
  const dateTo = dateToMs || Date.now();
  const payload = {
    dateFrom,
    dateTo,
    onlyCandidate: false,
    showRejectedDayOff: false,
    departmentIdSet: [2],
    teamIdSet: [teamId],
    agentIdSet: [],
    candidateIdSet: [],
    tagNameSet: [],
    teUserIdSet: [],
    pageNumber: 1,
    limitOnPage: null,
    activeStatus: 'Active',
  };
  logToPopup('Сайт 2', 'Початок збору змін', null, { teamId, dateFrom, dateTo });
  const headers = {
    'Content-Type': 'application/json',
    Accept: 'application/json, text/plain, */*',
    Authorization: `Bearer ${token}`,
  };
  const res = await fetch(ORCHARD_SHIFTS_URL, { method: 'POST', credentials: 'include', headers, body: JSON.stringify(payload) });
  const status = res.status;
  const textBody = await res.text();
  if (!res.ok) {
    console.error('Orchard shifts HTTP error', { status, textBody });
    logToPopup('Сайт 2', 'HTTP помилка змін', status, { textBody });
    throw new Error(`HTTP ${status}`);
  }
  const data = safeParse(textBody);
  const tasks = Array.isArray(data?.agentScheduleShiftCalendarDTOList)
    ? data.agentScheduleShiftCalendarDTOList
    : Array.isArray(data?.data?.agentScheduleShiftCalendarDTOList)
    ? data.data.agentScheduleShiftCalendarDTOList
    : [];
  if (!tasks.length) {
    logToPopup('Сайт 2', 'Отримано 0 записів Orchard', status || 200);
  } else {
    const sample = tasks[0] || {};
    logToPopup(
      'Сайт 2',
      `Отримано ${tasks.length} записів. Приклад: Agent: ${sample.agentName || sample.agentId}, Date: ${sample.shiftDate}, Status: ${sample.shiftStatus}`,
      status || 200
    );
    chrome.runtime.sendMessage({ type: 'FETCH_PROGRESS', site: 'site2', count: tasks.length, totalBytes: textBody.length });
  }
  chrome.storage.local.set({ [DATA_KEYS.site2]: tasks });
  return tasks;
}

export async function fetchOrchardDepartments() {
  const token = await ensureOrchardToken();
  const res = await fetch(ORCHARD_DEPARTMENTS_URL, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({}),
  });
  const text = await res.text();
  if (!res.ok) {
    logToPopup('Workload', `Помилка департаментів: HTTP ${res.status}`, res.status);
    throw new Error(`HTTP ${res.status}`);
  }
  const data = safeParse(text);
  return Array.isArray(data) ? data : (Array.isArray(data?.data) ? data.data : []);
}

export async function fetchOrchardTeamsByDept(departmentId) {
  const token = await ensureOrchardToken();
  const res = await fetch(ORCHARD_TEAMS_URL, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ departmentId }),
  });
  const text = await res.text();
  if (!res.ok) {
    logToPopup('Workload', `Помилка команд департаменту ${departmentId}: HTTP ${res.status}`, res.status);
    throw new Error(`HTTP ${res.status}`);
  }
  const data = safeParse(text);
  return Array.isArray(data) ? data : (Array.isArray(data?.data) ? data.data : []);
}

export async function fetchWorkloadSchedules({ dateFromMs, dateToMs, teamIds, departmentId = 2, getShouldStop }) {
  const token = await ensureOrchardToken();
  const all = [];
  let totalBytes = 0;
  for (const teamId of teamIds) {
    if (getShouldStop?.()) break;
    const payload = {
      dateFrom: dateFromMs,
      dateTo: dateToMs,
      onlyCandidate: false,
      showRejectedDayOff: false,
      departmentIdSet: [departmentId],
      teamIdSet: [teamId],
      agentIdSet: [],
      candidateIdSet: [],
      tagNameSet: [],
      teUserIdSet: [],
      pageNumber: 1,
      limitOnPage: null,
      activeStatus: 'Active',
    };
    const res = await fetch(ORCHARD_SHIFTS_URL, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(payload),
    });
    const text = await res.text();
    if (!res.ok) {
      logToPopup('Workload', `Orchard schedules HTTP ${res.status} для команди ${teamId}`, res.status);
      continue;
    }
    const data = safeParse(text);
    const shifts = Array.isArray(data?.agentScheduleShiftCalendarDTOList)
      ? data.agentScheduleShiftCalendarDTOList
      : (Array.isArray(data?.data?.agentScheduleShiftCalendarDTOList) ? data.data.agentScheduleShiftCalendarDTOList : []);
    // Tag each record with its source teamId so role/shift mapping works later
    all.push(...shifts.map(s => ({ ...s, _teamId: teamId })));
    totalBytes += text.length;
    chrome.runtime.sendMessage({ type: 'FETCH_PROGRESS', site: 'wl_orchard', count: all.length, totalBytes });
    logToPopup('Workload', `Orchard команда ${teamId}: ${shifts.length} змін`, 200);
  }
  logToPopup('Workload', `Зібрано ${all.length} розкладів Orchard`, 200);
  return all;
}

export async function fetchWorkloadActualHours({ dateFromMs, dateToMs, agentIds, getShouldStop }) {
  const token = await ensureOrchardToken();
  const BATCH_SIZE = 10;
  const result = {};
  const ids = Array.from(agentIds).filter(Boolean);
  let totalBytes = 0;
  for (let i = 0; i < ids.length; i += BATCH_SIZE) {
    if (getShouldStop?.()) break;
    const batch = ids.slice(i, i + BATCH_SIZE);
    await Promise.all(
      batch.map(async (agentId) => {
        try {
          const res = await fetch(ORCHARD_WORK_HOURS_URL, {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json', Accept: 'application/json', Authorization: `Bearer ${token}` },
            body: JSON.stringify({ agentId, cutOff: true, dateFrom: dateFromMs, dateTo: dateToMs }),
          });
          if (!res.ok) { result[agentId] = []; return; }
          const text = await res.text();
          totalBytes += text.length;
          const parsed = safeParse(text);
          result[agentId] = Array.isArray(parsed?.data) ? parsed.data : (Array.isArray(parsed) ? parsed : []);
        } catch {
          result[agentId] = [];
        }
      })
    );
    logToPopup('Workload', `Orchard hours: ${Math.min(i + BATCH_SIZE, ids.length)} / ${ids.length} агентів`, null);
    chrome.runtime.sendMessage({ type: 'FETCH_PROGRESS', site: 'wl_orchard', count: Object.keys(result).length, totalBytes });
  }
  logToPopup('Workload', `Зібрано годин для ${Object.keys(result).length} агентів`, 200);
  return result;
}

export async function fetchAgentWorkHours({ token, agentIds, dateFromMs, dateToMs }) {
  const cache = {};
  const fetchFrom = dateFromMs || (Date.now() - 30 * 86400000);
  const fetchTo = dateToMs || Date.now();
  for (const agId of agentIds) {
    try {
      const resp = await fetch(ORCHARD_WORK_HOURS_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json, text/plain, */*',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          agentId: agId,
          cutOff: true,
          dateFrom: fetchFrom,
          dateTo: fetchTo,
        }),
      });
      if (resp.ok) {
        const parsed = await resp.json();
        cache[agId] = Array.isArray(parsed?.data) ? parsed.data : (Array.isArray(parsed) ? parsed : []);
      }
    } catch (e) {
      console.error('Work Hours Error:', e);
    }
  }
  return cache;
}
