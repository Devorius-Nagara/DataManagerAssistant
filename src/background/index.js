const TRACK_BASE = 'https://trackensure.com';
const TAGS_URL = `${TRACK_BASE}/tag?actionName=getPermittedTagListForUser`;
const TASKS_FIRST_URL = `${TRACK_BASE}/supportTask?actionName=getSupportTaskListLTByFilterAndPageNumber`;
const TASKS_NEXT_URL = `${TRACK_BASE}/supportTask?actionName=getSupportTaskListByFilterLT`;
const TRACK_USERS_URL = `${TRACK_BASE}/fleet/user?actionName=getACLUserListLTByOrgId`;
const STORAGE_USERS_KEY = 'trackensureUsersCache';
const ORCHARD_BASE = 'https://orchard22.com';
const ORCHARD_TEAMS_URL = `${ORCHARD_BASE}/api/team/lt/select`;
const ORCHARD_SHIFTS_URL = `${ORCHARD_BASE}/api/agent-shift/agent-schedule-shift-calendar-list-by-filter-page-number?tagRequired=true`;
const CLIENT_REQUEST_TYPES = [
  'mobile_assistance',
  'log_editing',
  'ifta_service',
  'report_assistance',
  'troubleshooting',
  'web_assistance',
  'fleet_editor_assistance',
];
let site1Cache = [];
let site2Cache = [];
let aggregationOptions = { includeCancel5: true, includeShift20: true };
let debugSaved = false;

const DATA_KEYS = { site1: 'trackensureData', site2: 'orchardData', fetchFlag: 'fetchInProgress' };
const SUPPORTED_TIMEZONES = ['Europe/Kyiv', 'America/Toronto'];

const getGoogleToken = () => {
  return new Promise((resolve, reject) => {
    chrome.identity.getAuthToken({ interactive: true }, function(token) {
      if (chrome.runtime.lastError || !token) {
        reject(chrome.runtime.lastError);
      } else {
        resolve(token);
      }
    });
  });
};

const logToPopup = (site, message, code, payload) => {
  chrome.runtime.sendMessage({
    type: 'COLLECT_PROGRESS',
    site,
    message: payload ? `${message} | ${JSON.stringify(payload)}` : message,
    code,
  });
};

const setFetchFlag = (value) => chrome.storage.local.set({ [DATA_KEYS.fetchFlag]: value });

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const type = message?.type || message?.action;
  if (!type) return false;

  console.log("[BACKGROUND] Отримано команду:", type);

  switch (type) {
    case 'GET_TRACKENSURE_TAGS':
      fetchTags()
        .then((tags) => sendResponse({ ok: true, tags }))
        .catch((err) => sendResponse({ ok: false, error: err?.message || 'Не вдалося отримати теги' }));
      return true;
    case 'GET_TRACKENSURE_USERS':
      fetchTrackensureUsers()
        .then((users) => sendResponse({ ok: true, users }))
        .catch((err) => sendResponse({ ok: false, error: err?.message || 'Не вдалося отримати TL' }));
      return true;
    case 'START_FETCH_SITE_1': {
      const { tagId, tlIds = [], days, dateFrom, dateTo, timezone, apiRangeOffset = 2 } = message.payload || {};
      if (!tagId && (!Array.isArray(tlIds) || tlIds.length === 0)) {
        sendResponse({ ok: false, error: 'tagId або TL відсутні' });
        return false;
      }
      setFetchFlag(true);
      const dateFromMs = dateFrom ? convertDateTimeToMs(dateFrom, apiRangeOffset) : days ? Date.now() - Number(days || 0) * 86400000 : undefined;
      const dateToMs = dateTo ? convertDateTimeToMs(dateTo, apiRangeOffset) : Date.now();
      fetchAllTasks({ tagId, tlIds, dateFromMs, dateToMs })
        .then((data) => {
          site1Cache = data;
          sendResponse({ ok: true, total: data.length });
        })
        .catch((err) => sendResponse({ ok: false, error: err?.message || 'Помилка збору' }))
        .finally(() => setFetchFlag(false));
      return true;
    }
    case 'GET_ORCHARD_TEAMS':
      fetchOrchardTeams()
        .then((teams) => sendResponse({ ok: true, teams }))
        .catch((err) => sendResponse({ ok: false, error: err?.message || 'Не вдалося отримати команди' }));
      return true;
    case 'START_FETCH_SITE_2': {
      const { teamId, days, token } = message.payload || {};
      if (!teamId) {
        sendResponse({ ok: false, error: 'teamId відсутній' });
        return false;
      }
      setFetchFlag(true);
      fetchAllOrchardShifts(teamId, days || 7, token)
        .then((data) => {
          site2Cache = data;
          sendResponse({ ok: true, total: data.length });
        })
        .catch((err) => sendResponse({ ok: false, error: err?.message || 'Помилка збору Orchard22' }))
        .finally(() => setFetchFlag(false));
      return true;
    }
    case 'START_FETCH_CONTEXT': {
      const {
        tagId,
        teamId,
        days,
        tlIds = [],
        dateFrom,
        dateTo,
        timezone,
        apiRangeOffset = 2,
        orchardOffset = 2,
        includeCancel5 = true,
        includeShift20 = true,
      } = message.payload || {};
      aggregationOptions = { includeCancel5: Boolean(includeCancel5), includeShift20: Boolean(includeShift20) };
      chrome.storage.local.set({ includeCancel5: aggregationOptions.includeCancel5, includeShift20: aggregationOptions.includeShift20 });
      setFetchFlag(true);
      handleContextFetch({ tagId, teamId, days, tlIds, dateFrom, dateTo, timezone, apiRangeOffset, orchardOffset })
        .then((resp) => sendResponse(resp))
        .catch((err) => sendResponse({ ok: false, error: err?.message || 'Помилка контекстного збору' }))
        .finally(() => setFetchFlag(false));
      return true;
    }
    case 'RUN_COLLECTION':
      runCollection(message.payload)
        .then((result) => sendResponse({ ok: true, ...result }))
        .catch((err) => sendResponse({ ok: false, error: err?.message || 'Unknown error' }));
      return true;
    case 'GET_TSV_MATRIX':
      handleGetTsvMatrix(message.payload)
        .then((resp) => sendResponse(resp))
        .catch((err) => sendResponse({ ok: false, error: err?.message || 'Помилка формування TSV' }));
      return true;
    case 'VALIDATE_SHEETS_MAPPING': {
      validateSheetsMapping(message.payload)
        .then((resp) => sendResponse(resp))
        .catch((err) => sendResponse({ ok: false, error: err?.message || 'Помилка валідації таблиці' }));
      return true;
    }
    case 'EXECUTE_SHEETS_BATCH': {
      executeSheetsBatch(message.payload)
        .then((resp) => sendResponse(resp))
        .catch((err) => sendResponse({ ok: false, error: err?.message || 'Помилка запису в Sheets' }));
      return true;
    }
    case 'START_EXPORT': {
      handleStartExport(message.payload)
        .then(() => sendResponse({ ok: true }))
        .catch((err) => sendResponse({ ok: false, error: err.message }));
      return true;
    }
    case 'LOGOUT': {
      chrome.storage.local.remove(['googleAccessToken', 'googleTokenExpiry'], () => {
        chrome.notifications.create({ type: 'basic', iconUrl: 'assets/icon128.png', title: 'Очищення', message: 'Дані авторизації очищено з пам\'яті.' });
        sendResponse({ ok: true });
      });
      return true;
    }
    case 'CLEAR_DATA':
      site1Cache = [];
      site2Cache = [];
      chrome.storage.local.remove([DATA_KEYS.site1, DATA_KEYS.site2]);
      sendResponse({ ok: true });
      return false;
    case 'AGGREGATE_TRACKENSURE':
      aggregateTrackensure()
        .then((resp) => sendResponse(resp))
        .catch((err) => sendResponse({ ok: false, error: err?.message || 'Помилка зведення' }));
      return true;
    default:
      return false;
  }
});

async function handleStartExport(payload) {
  try {
    console.log('[START_EXPORT] 1. Початок виконання. Токен Google передано з Popup...');
    const token = payload.token;
    if (!token) {
      throw new Error('Не отримано токен з Popup!');
    }
    console.log('[START_EXPORT] 2. Токен Гугл отримано успішно!');

    console.log('[START_EXPORT] 3. Формування TSV матриці (зведення даних)...');
    const matrixResp = await handleGetTsvMatrix(payload);
    if (!matrixResp.ok) throw new Error(matrixResp.error || 'Failed to get matrix');
    console.log('[START_EXPORT] 4. Матриця сформована успішно!');

    console.log('[START_EXPORT] 5. Валідація і мапінг для Google Sheets...');
    const validationResp = await validateSheetsMapping({
      rows: matrixResp.rows,
      sheetId: payload.sheetId,
      token,
      utcOffset: payload.orchardOffset
    });
    if (!validationResp.ok) throw new Error(validationResp.error || 'Failed validation');
    console.log('[START_EXPORT] 6. Мапінг успішний!');

    const batchData = validationResp.batchUpdateData;
    const missingAgents = validationResp.missingAgents || [];

    if (!batchData || !batchData.length) {
      throw new Error('Відсутні дані для запису (спробуйте інший діапазон або агенти не знайдені в таблиці)');
    }

    if (missingAgents.length > 0) {
      // КРОК 1: Якщо є відсутні агенти, зберігаємо їх у пам'ять і не записуємо відразу
      console.log('[START_EXPORT] 7. Знайдено відсутніх агентів, зберігаємо в пам\'ять:', missingAgents);
      await chrome.storage.local.set({
        missingAgentsList: missingAgents,
        pendingBatchData: batchData
      });
      chrome.runtime.sendMessage({ action: "EXPORT_COMPLETED" });
      return; // Завершуємо роботу, чекаємо на підтвердження в UI
    }

    console.log('[START_EXPORT] 8. Виконання batchUpdate...');
    // Якщо відсутніх немає — виконуємо відразу
    await executeSheetsBatch({
      sheetId: payload.sheetId,
      token,
      batchUpdateData: batchData
    });

    console.log('[START_EXPORT] 9. Експорт завершено успішно!');
    chrome.runtime.sendMessage({ action: "EXPORT_COMPLETED" });
    try {
      chrome.notifications.create({
        type: 'basic',
        iconUrl: 'assets/icon128.png',
        title: 'Експорт завершено',
        message: 'Статистику успішно записано у Google Таблицю!'
      });
    } catch(err) { console.log('Notification error:', err); }
  } catch (err) {
    console.error('[START_EXPORT] КРИТИЧНА ПОМИЛКА:', err);
    chrome.runtime.sendMessage({ action: "EXPORT_COMPLETED" });
    try {
      chrome.notifications.create({
        type: 'basic',
        iconUrl: 'assets/icon128.png',
        title: 'Помилка експорту',
        message: err.message || 'Невідома помилка'
      });
    } catch(notifErr) { console.log('Notification error:', notifErr); }
  }
}

async function handleContextFetch({ tagId, teamId, days, tlIds = [], dateFrom, dateTo, timezone, apiRangeOffset = 2, orchardOffset = 2 }) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !tab.url) {
    return { ok: false, error: 'Відкрийте підтримуваний сайт для збору' };
  }
  const url = tab.url;
  debugSaved = false;
  const dateFromMs = convertDateTimeToMs(dateFrom, apiRangeOffset);
  const dateToMs = convertDateTimeToMs(dateTo, apiRangeOffset);
  if (url.includes('trackensure.com')) {
    if (!tagId && (!Array.isArray(tlIds) || tlIds.length === 0)) return { ok: false, error: 'Не обрано тег чи TL', site1: false };
    const data = await fetchAllTasks({ tagId, tlIds, dateFromMs, dateToMs });
    return { ok: true, site: 'site1', total: data.length };
  }
  if (url.includes('orchard22.com')) {
    if (!teamId) return { ok: false, error: 'Не обрано команду', site2: false };
    const data = await fetchAllOrchardShifts({ teamId, dateFromMs, dateToMs });
    return { ok: true, site: 'site2', total: data.length };
  }
  return { ok: false, error: 'Відкрийте підтримуваний сайт для збору' };
}

async function fetchTags() {
  const body = { tagType: 'admin-user-tag' };
  logToPopup('Сайт 1', 'Відправка запиту за тегами', null, body);
  const { data, status, textBody } = await fetchJson(TAGS_URL, body);
  if (!Array.isArray(data) || !data.length) {
    logToPopup('Сайт 1', 'Порожня відповідь для тегів', status || 200, { textBody });
  }
  return data;
}

function normalizeTasks(response) {
  if (Array.isArray(response?.supportTaskDTOList)) return response.supportTaskDTOList;
  if (Array.isArray(response)) return response;
  if (Array.isArray(response?.data)) return response.data;
  if (Array.isArray(response?.items)) return response.items;
  if (Array.isArray(response?.tasks)) return response.tasks;
  return [];
}

async function fetchTrackensureUsers() {
  logToPopup('Сайт 1', 'Завантаження TL списку', null);
  const res = await fetch(TRACK_USERS_URL, { method: 'GET', credentials: 'include' });
  const status = res.status;
  const textBody = await res.text();
  if (!res.ok) {
    console.error('Trackensure users HTTP error', { status, textBody });
    logToPopup('Сайт 1', 'HTTP помилка списку TL', status, { textBody });
    throw new Error(`HTTP ${status}`);
  }
  const data = safeParse(textBody);
  console.log('Trackensure raw users', { status, data, preview: textBody.slice(0, 500) });
  if (!Array.isArray(data)) return [];
  chrome.storage.local.set({ [STORAGE_USERS_KEY]: data });
  return data;
}

function dedupeTasks(tasks) {
  const map = new Map();
  tasks.forEach((t) => {
    if (!t?.taskId) return;
    if (!map.has(t.taskId)) {
      map.set(t.taskId, t);
      return;
    }
    const existing = map.get(t.taskId);
    // Preserve TL origin so TL лічильники не губляться при злитті дублів за тегом і TL
    if (t.origin === 'tl') {
      map.set(t.taskId, {
        ...existing,
        origin: 'tl',
        originTLId: t.originTLId ?? existing.originTLId,
        originTLName: t.originTLName ?? existing.originTLName,
      });
    }
  });
  return Array.from(map.values());
}

async function fetchAllTasks({ tagId, tlIds = [], dateFromMs, dateToMs }) {
  debugSaved = false;
  const dateFrom = dateFromMs || Date.now();
  const dateTo = dateToMs || Date.now();
  const totalTasks = [];
  const tlCache = await readFromStorage(STORAGE_USERS_KEY);
  const tlName = (id) => (Array.isArray(tlCache) ? tlCache.find((u) => u.userId === id)?.fullName : undefined);
  const tlCountsRaw = {};

  if (tagId) {
    const tagTasks = await fetchTasksPaginated({ dateFrom, dateTo, tagId, origin: { type: 'tag' } });
    totalTasks.push(...tagTasks);
  }
  if (Array.isArray(tlIds) && tlIds.length) {
    for (const tlId of tlIds) {
      const tlTasks = await fetchTasksPaginated({ dateFrom, dateTo, taskTeamLeaderId: tlId, origin: { type: 'tl', tlId, tlName: tlName(tlId) } });
      tlCountsRaw[tlId] = {
        count: (tlCountsRaw[tlId]?.count || 0) + tlTasks.length,
        name: tlName(tlId),
      };
      totalTasks.push(...tlTasks);
    }
  }

  const unique = dedupeTasks(totalTasks);


  logToPopup('Сайт 1', `Отримано ${unique.length} унікальних записів`, 200);

  // Авто-зведення прямо після збору
  const { agentLines, tlLines } = aggregateTrackensureInline(unique, tlCountsRaw, tlCache);
  chrome.runtime.sendMessage({
    type: 'LOG',
    site: 'Сайт 1',
    message: agentLines.length ? `Підсумок: Агенти\n${agentLines.join('\n')}` : 'Підсумок: Агенти — немає даних',
    code: 200,
  });
  chrome.runtime.sendMessage({
    type: 'LOG',
    site: 'Сайт 1',
    message: tlLines.length ? `Підсумок: TL\n${tlLines.join('\n')}` : 'Підсумок: TL — немає даних',
    code: 200,
  });

  site1Cache = unique;
  chrome.storage.local.set({ [DATA_KEYS.site1]: unique });
  trySendAggregateReport();
  return unique;
}

function aggregateTrackensureInline(tasks, tlCountsRaw = {}, tlCache = []) {
  const tagTasks = tasks.filter((t) => (t.origin || 'tag') === 'tag');
  const tagCounts = tagTasks.reduce((acc, t) => {
    const key = t.ownerDTO?.fullName || 'Без імені';
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});

  const tlCounts = Object.keys(tlCountsRaw).length
    ? Object.fromEntries(
        Object.entries(tlCountsRaw).map(([id, info]) => {
          const nameFromCache = Array.isArray(tlCache) ? tlCache.find((u) => u.userId === Number(id))?.fullName : undefined;
          const nameFromTasks = tasks.find((t) => t.originTLId === Number(id))?.originTLName;
          const nameFromInfo = info?.name;
          return [nameFromCache || nameFromTasks || nameFromInfo || id, info?.count || 0];
        })
      )
    : tasks
        .filter((t) => t.origin === 'tl')
        .reduce((acc, t) => {
          const key = t.originTLName || t.originTLId || 'unknown';
          acc[key] = (acc[key] || 0) + 1;
          return acc;
        }, {});

  const agentLines = Object.entries(tagCounts).map(([name, count]) => `${name} - ${count} тасків`);
  const tlLines = Object.entries(tlCounts).map(([name, count]) => `${name} - ${count} тасків`);
  return { tagCounts, tlCounts, agentLines, tlLines };
}

async function fetchTasksPaginated({ dateFrom, dateTo, tagId, taskTeamLeaderId, origin }) {
  const all = [];
  let beforeTaskId = null;
  let isFirstPage = true;
  while (true) {
    const url = isFirstPage ? TASKS_FIRST_URL : TASKS_NEXT_URL;
    const payload = isFirstPage
      ? {
          dateFrom,
          limitOnPage: 500,
          beforeTaskId: null,
          tagIdSet: tagId ? [tagId] : undefined,
          dateTo,
          pageNumber: 1,
          taskTeamLeaderId: taskTeamLeaderId || undefined,
        }
      : {
          dateFrom,
          limitOnPage: 500,
          beforeTaskId,
          tagIdSet: tagId ? [tagId] : undefined,
          dateTo,
          taskTeamLeaderId: taskTeamLeaderId || undefined,
          callerMgrUserId: null,
          driverIdByDriverName: null,
          taskOwnerId: null,
          createdBy: null,
        };
    if (isFirstPage) console.log('=== API PAYLOAD ===', payload);
    logToPopup('Сайт 1', `Запит сторінки ${isFirstPage ? 1 : 'next'}`, null, payload);
    const { data, status, textBody } = await fetchJson(url, payload);
    console.log('Trackensure raw response', { url, status, payload, data, textBodyPreview: textBody?.slice(0, 500) });
    const tasks = normalizeTasks(data);
    console.log('Trackensure parsed tasks array', tasks);
    if (!Array.isArray(tasks) || tasks.length === 0) {
      logToPopup('Сайт 1', 'Отримано 0 записів', status || 200, { textBody, taskTeamLeaderId, tagId });
      break;
    }
    const enriched = tasks.map((t) => ({ ...t, origin: origin?.type || 'tag', originTLId: origin?.tlId, originTLName: origin?.tlName }));
    const sampleTask = tasks[0] || {};
    logToPopup(
      'Сайт 1',
      `Отримано ${tasks.length} записів. Приклад: TaskID: ${sampleTask.taskId}, Тип: ${sampleTask.requestType}, TL: ${taskTeamLeaderId || 'n/a'}`,
      status || 200
    );
    all.push(...enriched);
    beforeTaskId = tasks[tasks.length - 1]?.taskId;
    logToPopup('Сайт 1', 'Накопичено записів', null, { total: all.length, beforeTaskId });
    if (!beforeTaskId) break;
    isFirstPage = false;
  }
  return all;
}

async function aggregateTrackensure() {
  const stored = await readFromStorage(DATA_KEYS.site1);
  const tasks = Array.isArray(stored) ? stored : [];
  if (!tasks.length) return { ok: false, error: 'Немає даних для зведення' };

  const tagTasks = tasks.filter((t) => (t.origin || 'tag') === 'tag');
  const simplified = tagTasks.map((t) => ({
    requestType: t.requestType,
    status: t.status,
    totalSpentTimeSec: t.totalSpentTimeSec,
    ownerFullName: t.ownerDTO?.fullName,
  }));

  const tagCounts = simplified.reduce((acc, t) => {
    const key = t.ownerFullName || 'Без імені';
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});

  const tlCounts = tasks
    .filter((t) => t.origin === 'tl')
    .reduce((acc, t) => {
      const key = t.originTLName || t.originTLId || 'unknown';
      acc[key] = (acc[key] || 0) + 1;
      return acc;
    }, {});

  const lines = [
    ...Object.entries(tagCounts).map(([name, count]) => `${name} - ${count}`),
    ...Object.entries(tlCounts).map(([name, count]) => `${name} TL - ${count}`),
  ];

  chrome.runtime.sendMessage({
    type: 'COLLECT_PROGRESS',
    site: 'Сайт 1',
    message: lines.join('\n') || 'Результати порожні',
    code: 200,
  });

  console.log('Tag tasks simplified', simplified);
  return { ok: true, tlCounts, tagTasks: simplified };
}

const ORCHARD_CAPTURE_FILTER = { urls: ['https://*.orchard22.com/*'] };

chrome.webRequest.onSendHeaders.addListener(
  (details) => {
    const authHeader = (details.requestHeaders || []).find((h) => h.name.toLowerCase() === 'authorization');
    if (authHeader && authHeader.value && authHeader.value.startsWith('Bearer ')) {
      const token = authHeader.value.replace('Bearer ', '').trim();
      console.log('Captured Orchard Bearer token', { tokenPreview: token.slice(0, 12) + '...' });
      chrome.storage.local.set({ orchardToken: token });
      logToPopup('Сайт 2', 'Отримано Bearer токен автоматично', 200);
    }
  },
  ORCHARD_CAPTURE_FILTER,
  ['requestHeaders', 'extraHeaders']
);

async function ensureOrchardToken() {
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

async function fetchOrchardTeams() {
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
  console.log('Orchard raw teams', { status, data, preview: textBody.slice(0, 500) });
  if (!Array.isArray(data)) {
    logToPopup('Сайт 2', 'Неочікувана відповідь команд', status, { textBody });
    throw new Error('Невірний формат команд');
  }
  return data;
}

async function fetchAllOrchardShifts({ teamId, dateFromMs, dateToMs }) {
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
  console.log('Orchard raw shifts', { status, data, preview: textBody.slice(0, 500) });
  const tasks = Array.isArray(data?.agentScheduleShiftCalendarDTOList)
    ? data.agentScheduleShiftCalendarDTOList
    : Array.isArray(data?.data?.agentScheduleShiftCalendarDTOList)
    ? data.data.agentScheduleShiftCalendarDTOList
    : [];
  console.log('Orchard parsed shifts array', tasks);
  if (!tasks.length) {
    logToPopup('Сайт 2', 'Отримано 0 записів Orchard', status || 200, { textBody });
  } else {
    const sample = tasks[0] || {};
    logToPopup(
      'Сайт 2',
      `Отримано ${tasks.length} записів. Приклад: Agent: ${sample.agentName || sample.agentId}, Date: ${sample.shiftDate}, Status: ${sample.shiftStatus}`,
      status || 200
    );
  }
  site2Cache = tasks;
  chrome.storage.local.set({ [DATA_KEYS.site2]: tasks });
  trySendAggregateReport();
  return tasks;
}

function safeParse(text) {
  try {
    return JSON.parse(text);
  } catch (err) {
    console.error('JSON parse error', { textPreview: text?.slice(0, 500), err });
    throw err;
  }
}

async function readFromStorage(key) {
  return new Promise((resolve) => chrome.storage.local.get([key], (data) => resolve(data?.[key])));
}

async function fetchJson(url, body) {
  const res = await fetch(url, {
    method: 'POST',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/plain, */*',
    },
    body: JSON.stringify(body || {}),
  });
  const status = res.status;
  const textBody = await res.text();
  if (!res.ok) {
    console.error('Trackensure HTTP error', { url, status, body, textBody });
    logToPopup('Сайт 1', 'HTTP помилка', status, { textBody });
    throw new Error(`HTTP ${status}`);
  }
  let parsed;
  try {
    parsed = JSON.parse(textBody);
  } catch (err) {
    console.error('Trackensure JSON parse error', { url, status, body, textBody, err });
    logToPopup('Сайт 1', 'JSON parse error', status, { textBody });
    throw err;
  }
  return { data: parsed, status, textBody };
}

// legacy content-script collection stub
async function runCollection({ days, selectors }) {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  const site1 = tabs[0] ? await requestParse(tabs[0].id, selectors.site1Tag, days) : [];
  const site2 = tabs[1] ? await requestParse(tabs[1].id, selectors.site2Tag, days) : [];
  const merged = [...site1, ...site2];
  return { site1, site2, merged };
}

function requestParse(tabId, selector, days) {
  return new Promise((resolve, reject) => {
    chrome.tabs.sendMessage(tabId, { type: 'PARSE_SITE', selector, days }, (response) => {
      if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
      if (!response?.ok) return reject(new Error(response?.error || 'Parse failed'));
      resolve(response.data || []);
    });
  });
}


function getApiTimestamp(dateStr, timeStr = '00:00', offsetHours = 0) {
  if (!dateStr || !timeStr) return null;
  const utcDate = new Date(`${dateStr}T${timeStr}:00Z`);
  return utcDate.getTime() - Number(offsetHours) * 3600000;
}

function convertDateTimeToMs(dateTimeStr, offsetHours = 0) {
  if (!dateTimeStr) return null;
  const [datePart, timePart] = String(dateTimeStr).split('T');
  return getApiTimestamp(datePart, timePart || '00:00', offsetHours);
}

const cleanName = (str = '') => (str || '').toLowerCase().replace(/\s+/g, ' ').trim();

function shouldIncludeTask(task, includeCancel5 = true) {
  const status = String(task?.status || '').toLowerCase();
  const isCanceled = status.includes('cancel');
  if (!isCanceled) return true;
  if (!includeCancel5) return false;
  const startMs = Number(task?.createDate);
  const endMs = Number(
    task?.endTime ??
      task?.endDate ??
      task?.end_date ??
      (startMs && task?.totalSpentTimeSec ? startMs + Number(task.totalSpentTimeSec) * 1000 : undefined)
  );
  if (Number.isNaN(startMs) || Number.isNaN(endMs)) return false;
  return endMs - startMs >= 300000;
}


function aggregateData(trackTasks = [], orchardSchedules = [], tlCache = [], options = aggregationOptions) {
  const formatDate = (ms) => {
    if (!ms) return 'невідомо';
    return new Intl.DateTimeFormat('uk-UA', { day: 'numeric', month: 'long' }).format(new Date(ms));
  };

  const offsetHours = Number(options.orchardOffset ?? options.utcOffset ?? 2);
  const calibrationData = {};

  const normalizeName = (name = '') => {
    const lowered = name.toLowerCase();
    return lowered.replace(/ext\.?\s*\d+/g, '').replace(/\s+/g, ' ').trim();
  };

  const includeCanceled = options.includeCancel5Min ?? options.includeCancel5 ?? true;

  const filteredTasks = trackTasks.filter((t) => shouldIncludeTask(t, includeCanceled));

  const trackByOwner = filteredTasks.reduce((acc, t) => {
    const name = t?.ownerDTO?.fullName;
    if (!name) return acc;
    const norm = normalizeName(name);
    if (!acc[norm]) acc[norm] = [];
    acc[norm].push(t);
    return acc;
  }, {});

  const calibrationByOwner = (trackTasks || []).reduce((acc, t) => {
    const name = t?.ownerDTO?.fullName;
    if (!name) return acc;
    const norm = normalizeName(name);
    if (!acc[norm]) acc[norm] = [];
    acc[norm].push(t);
    return acc;
  }, {});

  const selectedTlIds = new Set(options.selectedTLs || []);
  const tlNamesNormalized = new Set(
    (tlCache || [])
      .filter((u) => selectedTlIds.size === 0 || selectedTlIds.has(u.userId))
      .map((u) => normalizeName(u.fullName || ''))
      .filter(Boolean)
  );

  const agentSections = [];
  orchardSchedules.forEach((entry) => {
    const name = entry?.agentDTO?.fullName || entry?.agentName || 'Невідомий агент';
    const norm = normalizeName(name);
    const agentTasks = trackByOwner[norm] || [];
    const calibrationTasks = calibrationByOwner[norm] || agentTasks;
    const shifts = entry?.agentScheduleShiftCalendarItemDTOList || [];
    const dayOffs = entry?.agentDayOffSchedulingDTOList || [];

    const daySummary = {};
    const isTLAgent = tlNamesNormalized.has(norm);
    const isBufferEnabled = options.includeShift20 === true || options.includeShift20 === 'true';
    const bufferMs = isBufferEnabled ? 20 * 60 * 1000 : 0;
    let firstMatchedShift = null;
    const currentAgentName = name;
    if (!calibrationData[currentAgentName]) calibrationData[currentAgentName] = {};

    calibrationTasks.forEach((task) => {
      const taskMs = Number(task?.createDate);
      if (!taskMs) return;

      const matchedShift = shifts.find((shift) => {
        const startMs = Number(shift?.dateFrom) - bufferMs;
        const endMs = Number(shift?.dateTo) + bufferMs;
        return taskMs >= startMs && taskMs <= endMs;
      });

      if (matchedShift) {
        const dayKey = getDayFromTimestamp(Number(matchedShift.dateFrom), offsetHours);
        if (dayKey && dayKey >= 1 && dayKey <= 31) {
          if (!calibrationData[currentAgentName][dayKey]) calibrationData[currentAgentName][dayKey] = { shift: null, tasks: [] };
          calibrationData[currentAgentName][dayKey].shift = { start: Number(matchedShift.dateFrom), end: Number(matchedShift.dateTo) };
        }
      }

      const targetDayForDebug = matchedShift
        ? getDayFromTimestamp(Number(matchedShift.dateFrom), offsetHours)
        : getDayFromTimestamp(taskMs, offsetHours);
      if (!targetDayForDebug || targetDayForDebug < 1 || targetDayForDebug > 31) return;
      if (!calibrationData[currentAgentName][targetDayForDebug]) calibrationData[currentAgentName][targetDayForDebug] = { shift: null, tasks: [] };

      let type = String(task?.type || '').toLowerCase();
      const reqType = (task?.requestType || '').toLowerCase();
      if (!type && isTLAgent) {
        if (CLIENT_REQUEST_TYPES.includes(reqType)) type = 'client';
        else if (reqType) type = 'org';
      }
      if (!type && (task?.origin || '').toLowerCase().includes('assign')) type = 'assign';
      if (!type && reqType) type = reqType;
      if (!type) type = 'client';

      const compactType = type === 'client' ? 'c' : type;

      calibrationData[currentAgentName][targetDayForDebug].tasks.push({
        t: taskMs,
        s: (task.status || '').toLowerCase().substring(0, 6),
        d: task.endTime ? Number(task.endTime) - Number(task.createDate) : 0,
        y: compactType,
      });
    });

    agentTasks.forEach((task) => {
      const taskMs = Number(task?.createDate);
      if (!taskMs) return;

      const matchedShift = shifts.find((shift) => {
        const startMs = Number(shift?.dateFrom) - bufferMs;
        const endMs = Number(shift?.dateTo) + bufferMs;
        return taskMs >= startMs && taskMs <= endMs;
      });

      if (!matchedShift) return;

      if (!firstMatchedShift) firstMatchedShift = matchedShift;

      const label = formatDate(Number(matchedShift.dateFrom) + offsetHours * 3600000);
      const current = daySummary[label] || (isTLAgent ? { client: 0, org: 0, status: null } : { tasks: 0, status: null });

      if (isTLAgent) {
        const type = (task?.requestType || '').toLowerCase();
        if (CLIENT_REQUEST_TYPES.includes(type)) daySummary[label] = { ...current, client: (current.client || 0) + 1, org: current.org || 0 };
        else daySummary[label] = { ...current, client: current.client || 0, org: (current.org || 0) + 1 };
      } else {
        daySummary[label] = { ...current, tasks: (current.tasks || 0) + 1 };
      }
    });

    dayOffs.forEach((off) => {
      let currentMs = Number(off?.dateFrom);
      const endMs = Number(off?.dateTo ?? off?.dateFrom);
      const status = off?.scheduleType || off?.shiftStatus;
      const letter = statusToLetter(status);
      if (!letter) return;

      while (currentMs <= endMs) {
        const day = getSafeFullDay(currentMs);
        if (day && day >= 1 && day <= 31) {
          const label = formatDate(currentMs + offsetHours * 3600000);
          const current = daySummary[label] || (isTLAgent ? { client: 0, org: 0, status: null } : { tasks: 0, status: null });
          daySummary[label] = { ...current, status: letter };
        }
        currentMs += 86400000;
      }
    });

    const lines = Object.entries(daySummary).map(([day, info]) => {
      if (isTLAgent) {
        const client = info.client || 0;
        const org = info.org || 0;
        if (client + org > 0) return `${day} - Client tasks ${client} | Org Task ${org}`;
        if (info.status) return `${day} - ${info.status}`;
        return `${day} - Client tasks 0 | Org Task 0`;
      }
      if ((info.tasks || 0) > 0) return `${day} - ${info.tasks} тасків`;
      if (info.status) return `${day} - ${info.status}`;
      return `${day} - 0 тасків`;
    });

    if (lines.length) {
      agentSections.push(`Агент ${name}:`);
      agentSections.push(...lines);
      agentSections.push('');
    }

  });

  const tlDaily = {};
  filteredTasks.forEach((t) => {
    // Підтримка мульти-TL: беремо усі TL з DTO або списку ID
    let tlIds = [];
    if (Array.isArray(t.supportTaskTeamLeaderDTOList) && t.supportTaskTeamLeaderDTOList.length) {
      tlIds = t.supportTaskTeamLeaderDTOList.map((dto) => dto.userId).filter(Boolean);
    } else if (Array.isArray(t.supportTaskTeamLeaderIdList) && t.supportTaskTeamLeaderIdList.length) {
      tlIds = t.supportTaskTeamLeaderIdList.filter(Boolean);
    } else if (t.originTLId) {
      tlIds = [t.originTLId];
    }
    if (!tlIds.length) return;

    const day = formatDate(Number(t.createDate));

    tlIds.forEach((tlIdRaw) => {
      const tlId = Number(tlIdRaw);
      if (selectedTlIds.size && !selectedTlIds.has(tlId)) return; // рахуємо лише обрані TL, якщо вибір є

      // Ім'я TL: з DTO, з кешу, з origin
      const nameFromDto = Array.isArray(t.supportTaskTeamLeaderDTOList)
        ? t.supportTaskTeamLeaderDTOList.find((dto) => Number(dto.userId) === tlId)?.fullName
        : undefined;
      const nameFromCache = (tlCache || []).find((u) => u.userId === tlId)?.fullName;
      const tlName = nameFromDto || nameFromCache || t.originTLName || tlId || 'Невідомий TL';

      if (!tlDaily[tlName]) tlDaily[tlName] = {};
      tlDaily[tlName][day] = (tlDaily[tlName][day] || 0) + 1;
    });
  });

  const tlSections = [];
  Object.entries(tlDaily).forEach(([name, days]) => {
    tlSections.push(`TL ${name}:`);
    Object.entries(days).forEach(([day, count]) => {
      tlSections.push(`${day} - ${count} тасків`);
    });
    tlSections.push('');
  });

  console.log('[BACKGROUND] Спроба зберегти ВСІХ агентів у storage...');
  chrome.storage.local.set({ debugCalibrationData: calibrationData }, () => {
    if (chrome.runtime.lastError) {
      console.error('[BACKGROUND] ПОМИЛКА ЗБЕРЕЖЕННЯ:', chrome.runtime.lastError);
    } else {
      console.log('[BACKGROUND] Збереження всіх агентів успішне!');
    }
  });

  return { agentMessage: agentSections.join('\n').trim(), tlMessage: tlSections.join('\n').trim() };
}

async function handleGetTsvMatrix(payload = {}) {
  const storedTimezone = await readFromStorage('popupTimezone');
  const storedOrchardOffset = await readFromStorage('orchardOffset');
  const tlCache = (await readFromStorage(STORAGE_USERS_KEY)) || [];
  const storedSelectedTLs = (await readFromStorage('selectedTrackensureTLs')) || [];
  const includeCancel5 = payload.includeCancel5 ?? aggregationOptions.includeCancel5 ?? true;
  const includeShift20 = payload.includeShift20 ?? aggregationOptions.includeShift20 ?? true;
  const timezone = payload.timezone || storedTimezone || 'Europe/Kyiv';
  const orchardOffset = payload.orchardOffset !== undefined ? Number(payload.orchardOffset) : Number(storedOrchardOffset ?? 2);
  const selectedTLs = Array.isArray(payload.selectedTLs) && payload.selectedTLs.length ? payload.selectedTLs : storedSelectedTLs;
  const storedDateFrom = await readFromStorage('popupDateFrom');
  const baseDateFromMs = payload.dateFrom ? convertDateTimeToMs(payload.dateFrom, orchardOffset) : (storedDateFrom ? convertDateTimeToMs(storedDateFrom, orchardOffset) : null);

  const trackTasks = Array.isArray(site1Cache) && site1Cache.length ? site1Cache : (await readFromStorage(DATA_KEYS.site1)) || [];
  const orchard = Array.isArray(site2Cache) && site2Cache.length ? site2Cache : (await readFromStorage(DATA_KEYS.site2)) || [];

  if (!trackTasks.length || !orchard.length) {
    return { ok: false, error: 'Немає зведених даних для TSV' };
  }

  const agentWorkHoursCache = {};
  console.log('[START_EXPORT] Fetching Work Hours for all unique agents...');
  try {
    const orchardToken = await ensureOrchardToken();
    if (orchardToken) {
      const uniqueAgentIds = new Set();
      orchard.forEach((entry) => {
        const agId = entry?.agentDTO?.userId || entry?.agentDTO?.agentId || entry?.agentId || entry?.candidateId;
        if (agId) uniqueAgentIds.add(agId);
      });

      const fetchFrom = baseDateFromMs || (Date.now() - 30 * 86400000);
      const fetchTo = Date.now();

      for (const agId of uniqueAgentIds) {
        try {
          const resp = await fetch('https://orchard22.com/api/calendar/work-hour/list-by-filter', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Accept: 'application/json, text/plain, */*',
              Authorization: `Bearer ${orchardToken}`
            },
            body: JSON.stringify({
              agentId: agId,
              cutOff: true,
              dateFrom: fetchFrom,
              dateTo: fetchTo
            })
          });
          if (resp.ok) {
            const parsed = await resp.json();
            agentWorkHoursCache[agId] = Array.isArray(parsed?.data) ? parsed.data : (Array.isArray(parsed) ? parsed : []);
          }
        } catch (e) {
          console.error('Work Hours Error:', e);
        }
      }
    }
  } catch (e) {
    console.error('Work Hours outer Error:', e);
  }

  const rows = buildSheetMatrix(trackTasks, orchard, tlCache, { includeCancel5, includeShift20, selectedTLs, timezone, orchardOffset, baseDateFromMs, agentWorkHoursCache });
  return { ok: true, rows };
}

function statusToLetter(statusRaw) {
  const status = String(statusRaw || '').toLowerCase();
  if (status.includes('vacation')) return 'V';
  if (status.includes('day off') || status.includes('dayoff') || status.includes('off')) return 'O';
  if (status.includes('sick')) return 'S';
  return '';
}

// Для цілодобових подій фіксуємо час на 12:00 UTC, щоб зміщення не перекидало дату
function getSafeFullDay(timestamp) {
  if (!timestamp) return null;
  const d = new Date(Number(timestamp));
  d.setUTCHours(12);
  return d.getUTCDate();
}

function getDayFromTimestamp(timestamp, offsetHours = 2) {
  if (!timestamp) return null;
  const date = new Date(Number(timestamp) + Number(offsetHours) * 3600000);
  return date.getUTCDate();
}

function buildSheetMatrix(trackTasks = [], orchardData = [], tlCache = [], options = {}) {
  const timeZone = options.timezone || 'Europe/Kyiv';
  const offsetHours = Number(options.orchardOffset ?? options.utcOffset ?? 2);
  const header = [''].concat(Array.from({ length: 31 }, (_, idx) => String(idx + 1)));
  const rows = [header];

  // КРОК 1: Визначення Головного Місяця (Base Month)
  const baseDate = options.baseDateFromMs ? new Date(options.baseDateFromMs) : (trackTasks[0] ? new Date(Number(trackTasks[0].createDate)) : new Date());
  const baseMonth = baseDate.getMonth();
  const baseYear = baseDate.getFullYear();

  const normalizeName = (name = '') => name.toLowerCase().replace(/ext\.?\s*\d+/g, '').replace(/\s+/g, ' ').trim();
  const selectedTlIds = new Set((options.selectedTLs || []).map((id) => Number(id)));
  const tlNamesNormalized = new Set(
    (tlCache || [])
      .filter((u) => !selectedTlIds.size || selectedTlIds.has(Number(u.userId)))
      .map((u) => normalizeName(u.fullName || ''))
      .filter(Boolean)
  );
  const orchardNormalized = (orchardData || []).map((entry) => {
    const norm = normalizeName(entry?.agentDTO?.fullName || entry?.agentName || '');
    return { norm, clean: cleanName(norm), entry };
  });

  const findOrchardEntry = (name) => {
    const normTarget = normalizeName(name || '');
    const cleanTarget = cleanName(normTarget);
    if (!cleanTarget) return orchardNormalized.find(({ norm }) => norm === normTarget)?.entry || null;
    return (
      orchardNormalized.find(({ norm, clean }) => norm === normTarget || clean === cleanTarget || norm.includes(cleanTarget) || cleanTarget.includes(norm))
        ?.entry || null
    );
  };

  const includeCanceled = options.includeCancel5Min ?? options.includeCancel5 ?? true;
  const isBufferEnabled = options.includeShift20 === true || options.includeShift20 === 'true';
  const filteredTasks = (trackTasks || []).filter((t) => shouldIncludeTask(t, includeCanceled));

  const trackByOwner = filteredTasks.reduce((acc, t) => {
    const name = t?.ownerDTO?.fullName;
    if (!name) return acc;
    const norm = normalizeName(name);
    if (!acc[norm]) acc[norm] = [];
    acc[norm].push(t);
    return acc;
  }, {});

  const tlAssignDaily = {};
  filteredTasks.forEach((t) => {
    let tlIds = [];
    if (Array.isArray(t.supportTaskTeamLeaderDTOList) && t.supportTaskTeamLeaderDTOList.length) {
      tlIds = t.supportTaskTeamLeaderDTOList.map((dto) => dto.userId).filter(Boolean);
    } else if (Array.isArray(t.supportTaskTeamLeaderIdList) && t.supportTaskTeamLeaderIdList.length) {
      tlIds = t.supportTaskTeamLeaderIdList.filter(Boolean);
    } else if (t.originTLId) {
      tlIds = [t.originTLId];
    }

    const taskMs = Number(t.createDate);
    if (!taskMs) return;
    const bufferMs = isBufferEnabled ? 20 * 60 * 1000 : 0;

    tlIds.forEach((tlIdRaw) => {
      const tlId = Number(tlIdRaw);
      if (selectedTlIds.size && !selectedTlIds.has(tlId)) return;

      const nameFromDto = Array.isArray(t.supportTaskTeamLeaderDTOList)
        ? t.supportTaskTeamLeaderDTOList.find((dto) => Number(dto.userId) === tlId)?.fullName
        : undefined;
      const nameFromCache = (tlCache || []).find((u) => Number(u.userId) === tlId)?.fullName;
      const tlName = nameFromDto || nameFromCache || t.originTLName || `TL ${tlId}`;
      const norm = normalizeName(tlName);

      const orchardTL = findOrchardEntry(tlName);
      const tlShifts = orchardTL ? orchardTL.agentScheduleShiftCalendarItemDTOList || [] : [];
      const matchedShift = tlShifts.find((shift) => {
        const startMs = Number(shift?.dateFrom) - bufferMs;
        const endMs = Number(shift?.dateTo) + bufferMs;
        return taskMs >= startMs && taskMs <= endMs;
      });

      if (!matchedShift) return;

      const assignDateObj = new Date(Number(matchedShift.dateFrom) + offsetHours * 3600000);
      if (assignDateObj.getUTCMonth() !== baseMonth || assignDateObj.getUTCFullYear() !== baseYear) return;

      const dayNum = getDayFromTimestamp(matchedShift.dateFrom, offsetHours);
      if (!dayNum || dayNum < 1 || dayNum > 31) return;

      if (!tlAssignDaily[norm]) tlAssignDaily[norm] = { label: tlName, days: {} };
      if (!tlAssignDaily[norm].days[dayNum]) tlAssignDaily[norm].days[dayNum] = 0;
      tlAssignDaily[norm].days[dayNum] += 1;
    });
  });

  const processAgent = (entry) => {
    const nameRaw = entry?.agentDTO?.fullName || entry?.agentName || 'Невідомий агент';
    const norm = normalizeName(nameRaw);
    const isTL = tlNamesNormalized.has(norm);
    const dayCellsClient = Array(31).fill('');
    const dayCellsOrg = Array(31).fill('');
    const dayCellsAgent = Array(31).fill('');
    const dayOffStatuses = {};

    const orchardAgent = findOrchardEntry(nameRaw);
    const shifts = orchardAgent ? orchardAgent.agentScheduleShiftCalendarItemDTOList || [] : [];
    const dayOffs = orchardAgent ? orchardAgent.agentDayOffSchedulingDTOList || [] : [];
    const agentTasks = trackByOwner[norm] || [];

    const dayBuckets = {};
    const bufferMs = isBufferEnabled ? 20 * 60 * 1000 : 0;

    if (nameRaw.toLowerCase().includes('magdy')) {
      console.log('=== ДЕБАГ: MUHAMAD MAGDY ===');
      console.log('1. Сирих тасків з Trackensure:', agentTasks.length);

      const orchardAgentDebug = (orchardData || []).find((a) => {
        const orchName = cleanName(a.agentDTO?.fullName || a.agentName);
        const trName = cleanName(nameRaw);
        return orchName === trName || orchName.includes(trName) || trName.includes(orchName);
      });

      console.log('2. Знайдено в Orchard:', orchardAgentDebug ? 'ТАК' : 'НІ', orchardAgentDebug ? orchardAgentDebug.agentDTO?.fullName : '');
      console.log('3. Кількість змін (Shifts):', shifts.length);
      console.log('4. Буфер увімкнено:', isBufferEnabled, '| МС:', bufferMs);

      agentTasks.forEach((task) => {
        const taskMs = Number(task.createDate);
        const taskTimeStr = taskMs ? new Date(taskMs).toISOString() : 'invalid';

        const matchedShiftDebug = shifts.find((shift) => {
          const startMs = Number(shift.dateFrom) - bufferMs;
          const endMs = Number(shift.dateTo) + bufferMs;
          return taskMs >= startMs && taskMs <= endMs;
        });

        let isSkippedByCancel = false;
        const isCancelled = String(task.status || '').toLowerCase().includes('cancel');
        if (isCancelled && includeCanceled) {
          const duration = task.endTime ? Number(task.endTime) - Number(task.createDate) : 0;
          if (duration < 300000) {
            isSkippedByCancel = true;
          }
        }

        console.log(
          `Task ${task.taskId} | Час: ${taskTimeStr} | Статус: ${task.status} | Скасовано <5хв: ${isSkippedByCancel} | Знайдена зміна: ${
            matchedShiftDebug ? matchedShiftDebug.shiftId : 'НЕ ЗНАЙДЕНО'
          }`
        );
      });
      console.log('============================');
    }

    agentTasks.forEach((task) => {
      const taskMs = Number(task?.createDate);
      if (!taskMs) return;

      const matchedShift = shifts.find((shift) => {
        const startMs = Number(shift?.dateFrom) - bufferMs;
        const endMs = Number(shift?.dateTo) + bufferMs;
        return taskMs >= startMs && taskMs <= endMs;
      });

      // ДЕБАГ ДЛЯ НІЧНОЇ ЗМІНИ (30 квітня - 1 травня)
try {
    const currentAgentName = nameRaw;
    // Шукаємо тестового агента (напр. Roman Parubochyi)
    if (currentAgentName && currentAgentName.toLowerCase().includes("roman") && task && task.createDate) {
        const tDate = new Date(Number(task.createDate));
        
        // Відстежуємо тільки таски, які відбулися 30-го або 1-го числа
        if (tDate.getDate() === 30 || tDate.getDate() === 1) {
            console.log(`\n=== ДЕБАГ ТАСКА: ${tDate.toLocaleString()} ===`);
            console.log("1. Сирих тасків з Trackensure:", agentTasks.length);
            console.log("2. Час таска (createDate):", task.createDate);

            if (matchedShift) {
                console.log("3. Знайдено зміну:", new Date(Number(matchedShift.dateFrom)).toLocaleString(), "-", new Date(Number(matchedShift.dateTo)).toLocaleString());

                // Якщо у тебе далі є змінна targetDay (цільовий день для запису в колонку), виведи її:
                if (typeof targetDay !== 'undefined') {
                    console.log("4. Визначений targetDay для запису:", targetDay);
                }
              } else {
                console.log("3. ЗМІНУ НЕ ЗНАЙДЕНО (matchedShift is undefined або false)");

                // Виведемо всі зміни цього агента поруч, щоб побачити, що ми пропустили
                console.log("   Усі зміни агента в Orchard навколо цієї дати:");
                if (shifts && Array.isArray(shifts)) {
                    shifts.forEach(s => {
                        const sStart = new Date(Number(s.dateFrom));
                        // Показуємо зміни в межах +- 2 дні від таска
                        if (Math.abs(Number(s.dateFrom) - Number(task.createDate)) < 86400000 * 2) {
                            console.log(`   -> ${sStart.toLocaleString()} - ${new Date(Number(s.dateTo)).toLocaleString()}`);
                        }
                    });
                }
              }
        }
    }
} catch (e) {
    console.error("[SAFE DEBUG] Помилка дебагу:", e);
}

      if (!matchedShift) return;

      const targetDay = getDayFromTimestamp(matchedShift.dateFrom, offsetHours || 2);

      const targetDateObj = new Date(Number(matchedShift.dateFrom) + (offsetHours || 2) * 3600000);
      // КРИТИЧНИЙ ФІКС: Перевіряємо, чи належить подія до нашого місяця експорту
      if (targetDateObj.getUTCMonth() !== baseMonth || targetDateObj.getUTCFullYear() !== baseYear) return;

      if (!targetDay || targetDay < 1 || targetDay > 31) return;

      if (!dayBuckets[targetDay]) {
        dayBuckets[targetDay] = isTL ? { client: 0, org: 0 } : { tasks: 0 };
      }

      if (isTL) {
        const type = (task?.requestType || '').toLowerCase();
        if (CLIENT_REQUEST_TYPES.includes(type)) dayBuckets[targetDay].client += 1;
        else dayBuckets[targetDay].org += 1;
      } else {
        dayBuckets[targetDay].tasks += 1;
      }
    });

    dayOffs.forEach((off) => {
      let currentMs = Number(off?.dateFrom);
      const endMs = Number(off?.dateTo ?? off?.dateFrom);
      const letter = statusToLetter(off?.scheduleType || off?.shiftStatus);
      if (!letter) return;

      while (currentMs <= endMs) {
        const d = new Date(currentMs + offsetHours * 3600000);
        if (d.getUTCMonth() === baseMonth && d.getUTCFullYear() === baseYear) {
            const day = getSafeFullDay(currentMs);
            if (day && day >= 1 && day <= 31) {
              dayOffStatuses[day] = letter;
            }
        }
        currentMs += 86400000;
      }
    });

    Object.entries(dayBuckets).forEach(([dayKey, info]) => {
      const idx = Number(dayKey) - 1;
      if (isTL) {
        dayCellsClient[idx] = (Number(dayCellsClient[idx]) || 0) + (info.client || 0) || '';
        dayCellsOrg[idx] = (Number(dayCellsOrg[idx]) || 0) + (info.org || 0) || '';
      } else {
        dayCellsAgent[idx] = (Number(dayCellsAgent[idx]) || 0) + (info.tasks || 0) || '';
      }
    });

    // КРОК 4: Підміна результату на "L" суворо за графіком
    const agId = entry?.agentDTO?.userId || entry?.agentDTO?.agentId || entry?.agentId || entry?.candidateId;
    const workHoursArray = options.agentWorkHoursCache?.[agId] || [];

    shifts.forEach(shift => {
      const shiftStartMs = Number(shift.dateFrom);
      const shiftDateObj = new Date(shiftStartMs + (offsetHours || 2) * 3600000);

      if (shiftDateObj.getUTCMonth() !== baseMonth || shiftDateObj.getUTCFullYear() !== baseYear) return;

      const shiftDay = shiftDateObj.getUTCDate();
      if (!shiftDay || shiftDay < 1 || shiftDay > 31) return;

      const matchedWork = workHoursArray.find(wh => {
        const whStart = wh.eventStartDTO?.eventDate || wh.eventDateMs;
        if (!whStart) return false;

        // 1. Перевіряємо збіг по дню (залишаємо як базовий фільтр)
        const whDate = new Date(Number(whStart) + (offsetHours || 2) * 3600000);
        const isSameDay = whDate.getUTCFullYear() === baseYear &&
                          whDate.getUTCMonth() === baseMonth &&
                          whDate.getUTCDate() === shiftDay;

        if (!isSameDay) return false;

        // 2. КРИТИЧНИЙ ФІКС: Перевіряємо різницю в часі (дельту)
        // Фактична зміна має починатися не далі ніж +/- 4 години від запланованої
        const timeDiffMs = Math.abs(Number(whStart) - shiftStartMs);
        const fourHoursMs = 4 * 60 * 60 * 1000;

        return timeDiffMs <= fourHoursMs;
      });

      if (matchedWork && matchedWork.workTimeMs != null && Number(matchedWork.workTimeMs) < 18000000) {
        if (isTL) {
          dayCellsClient[shiftDay - 1] = 'L';
        } else {
          dayCellsAgent[shiftDay - 1] = 'L';
        }
      } else {
        if (!isTL && dayCellsAgent[shiftDay - 1] === '') {
          dayCellsAgent[shiftDay - 1] = 0;
        } else if (isTL && dayCellsClient[shiftDay - 1] === '') {
          dayCellsClient[shiftDay - 1] = 0;
        }
      }
    });

    if (isTL) {
      const rowClient = ['Agent ' + nameRaw + ' - TeamLeader ext. (ENG)'];
      const rowTlAssigns = ['Total TL Assigns'];
      const rowOrg = ['Org Tasks'];
      for (let i = 1; i <= 31; i++) {
        const clientVal = dayCellsClient[i - 1] || dayOffStatuses[i] || '';
        const orgVal = dayCellsOrg[i - 1] || '';
        const assignsVal = tlAssignDaily[norm]?.days?.[i] || '';
        rowClient.push(clientVal === 0 ? '' : clientVal);
        rowTlAssigns.push(assignsVal === 0 ? '' : assignsVal);
        rowOrg.push(orgVal === 0 ? '' : orgVal);
      }
      rows.push(rowClient, rowTlAssigns, rowOrg);
    } else {
      const row = [nameRaw + ' - ext. (ENG)'];
      for (let i = 1; i <= 31; i++) {
        const val = dayCellsAgent[i - 1] || dayOffStatuses[i] || '';
        row.push(val === 0 ? '' : val);
      }
      rows.push(row);
    }
  };

  (orchardData || []).forEach(processAgent);

  return rows;
}

async function fetchSheetValuesBg(spreadsheetId, token) {
  const readRange = 'A1:ZZ500';
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${readRange}`;
  console.log('[ДЕБАГ SHEETS GET] Зчитування діапазону:', readRange);
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Sheets GET ${res.status}: ${text.slice(0, 200)}`);
  }
  return JSON.parse(text);
}

function columnToLetter(colIndexZeroBased) {
  let dividend = colIndexZeroBased + 1;
  let columnName = '';
  while (dividend > 0) {
    const modulo = (dividend - 1) % 26;
    columnName = String.fromCharCode(65 + modulo) + columnName;
    dividend = Math.floor((dividend - modulo) / 26);
  }
  return columnName;
}

function cleanNameBase(raw = '') {
  return raw
    .toString()
    .toLowerCase()
    .replace(/\(eng\)/g, '')
    .replace(/teamleader/g, '')
    .replace(/agent\s*/g, '')
    .replace(/-?\s*ext[^\s]*/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function mapMatrixToUpdatesBg(matrixRows, sheetValues, monthYear = {}, utcOffset = 0) {
  const values = Array.isArray(sheetValues?.values) ? sheetValues.values : sheetValues || [];
  const sheetRows = Array.isArray(sheetValues?.result?.values) ? sheetValues.result.values : values;
  const colAFull = (sheetRows || []).map((row) => (row && row[0] ? row[0].toString().toLowerCase().trim() : ''));
  console.log('[ДЕБАГ МАПІНГУ] Стовпець А з Google Sheets (перші 20):', colAFull.slice(0, 20));
  const dateToCol = {};
  const targetMonth = Number(monthYear.month) || (new Date().getMonth() + 1);
  const targetYear = Number(monthYear.year) || new Date().getFullYear();
  const monthNamesEn = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
  const monthNamesUa = ['січень', 'лютий', 'березень', 'квітень', 'травень', 'червень', 'липень', 'серпень', 'вересень', 'жовтень', 'листопад', 'грудень'];
  const targetNameEn = monthNamesEn[targetMonth - 1];
  const targetNameUa = monthNamesUa[targetMonth - 1];

  const row2 = (sheetRows || [])[1] || [];
  const row3 = (sheetRows || [])[2] || [];
  const headerRowData = row3;

  console.log('=== ДЕБАГ ШАПКИ ТАБЛИЦІ ===');
  console.log('Довжина row2:', row2.length, '| Довжина row3/headerRowData:', headerRowData.length);
  console.log('Отриманий рядок із заголовками (headerRowData):', headerRowData);
  let startCol = -1;
  let endCol = Math.max(row2.length, row3.length);

  for (let i = 0; i < row2.length; i++) {
    const valRaw = row2[i];
    const val = String(valRaw || '').toLowerCase().trim();
    if (!val) continue;
    const containsMonth = val.includes(targetNameEn) || val.includes(targetNameUa) || val.includes(` ${targetMonth} `) || val.startsWith(`${targetMonth}/`) || val.includes(`.${targetMonth}.`);
    const containsYear = val.includes(String(targetYear));
    if (containsMonth && containsYear) {
      startCol = i;
      for (let j = i + 1; j < row2.length; j++) {
        const nextVal = row2[j];
        if (nextVal && String(nextVal).trim() !== '' && !String(nextVal).includes('=')) {
          endCol = j;
          break;
        }
      }
      break;
    }
  }

  console.log(`[ДЕБАГ] Результат пошуку місяця ${targetMonth}/${targetYear}: startCol=${startCol}, endCol=${endCol}`);

  const maxHeaderCol = Math.max(row2.length, row3.length, startCol === -1 ? 0 : startCol + 40);
  if (startCol !== -1 && endCol <= startCol + 1) {
    // Fallback: якщо row2 обрізаний або майже порожній, даємо вікно на 40 колонок вперед від місяця.
    endCol = Math.min(maxHeaderCol, startCol + 40);
  }

  const parseDayFromHeaderCell = (cell) => {
    const cellValue = String(cell ?? '').trim();
    if (!cellValue) return null;

    // Випадок "23" / " 23 ".
    const strictDay = cellValue.match(/^(\d{1,2})$/);
    if (strictDay) {
      const day = parseInt(strictDay[1], 10);
      return day >= 1 && day <= 31 ? day : null;
    }

    // Випадки дати: "23.04", "23/04/2026", "23-04-2026", тощо.
    const dateLikeDay = cellValue.match(/^(\d{1,2})(?:\D|$)/);
    if (dateLikeDay) {
      const day = parseInt(dateLikeDay[1], 10);
      return day >= 1 && day <= 31 ? day : null;
    }

    return null;
  };

  if (startCol !== -1) {
    for (let col = startCol; col < endCol; col++) {
      const rawCell = row3[col];
      const day = parseDayFromHeaderCell(rawCell);
      if (day !== null) {
        dateToCol[day] = col;
      }
      if (day === null && String(rawCell ?? '').trim()) {
        console.log('[ДЕБАГ ШАПКИ] Пропущено заголовок дня (не розпізнано):', { col, rawCell });
      }
    }
  } else {
    console.error(`КРИТИЧНО: Місяць ${targetMonth}/${targetYear} не знайдено в Row 2!`);
  }

  console.log('[ДЕБАГ МАПІНГУ] КІНЦЕВА КАРТА ДАТ (Тільки для цього місяця):', dateToCol);
  if (!Object.keys(dateToCol).length) {
    console.error('КРИТИЧНО: Дати 1-31 не знайдено у визначеному діапазоні місяця!');
    console.log('[ДЕБАГ] Вміст рядків 2 і 3 для аналізу:', row2, row3);
  }

  const colA = values.map((row) => (row && row[0] ? row[0].toString().toLowerCase().trim() : ''));

  const updates = [];
  const missing = [];

  const shouldDebugAgent = (name = '') => {
    const lowered = String(name || '').toLowerCase();
    return lowered.includes('roman') || lowered.includes('magdy');
  };

  for (let i = 1; i < matrixRows.length; i++) {
    const row = matrixRows[i];
    const label = String(row[0] || '');
    const isTL = label.toLowerCase().includes('teamleader');
    const baseName = cleanNameBase(label);
    const debugAgent = shouldDebugAgent(label) || shouldDebugAgent(baseName);
    console.log(`[ДЕБАГ МАПІНГУ] Шукаємо ${isTL ? 'TL' : 'агента'}: "${baseName}"`);

    if (isTL) {
      const assignsRow = matrixRows[i + 1];
      const orgRow = matrixRows[i + 2];
      const tlRowIdx = colA.findIndex((cell) => cell.includes(baseName) && cell.includes('teamleader'));
      if (tlRowIdx === -1 || !assignsRow || !orgRow) {
        missing.push(baseName);
        const firstName = baseName.split(' ')[0];
        const partialMatch = colA.find((cell) => cell.includes(firstName));
        console.warn(`[ДЕБАГ МАПІНГУ] ❌ TL "${baseName}" НЕ ЗНАЙДЕНО. Збіг по першому слову (${firstName}):`, partialMatch || 'НЕМАЄ');
        if (debugAgent) {
          console.log(`=== ДЕБАГ ЕКСПОРТУ ДЛЯ: ${label} ===`);
          console.log('1. Знайдений рядок у таблиці:', tlRowIdx === -1 ? 'НЕ ЗНАЙДЕНО' : tlRowIdx + 1);
          console.log('2. Зібрані дані для колонок (rowValues): НЕ ІСНУЄ (немає рядка TL або службових рядків)');
          console.log('3. Чи буде зроблено push? Перевіряємо умови... -> НІ (tlRowIdx === -1 || !assignsRow || !orgRow)');
        }
        i += 2;
        continue;
      }
      console.log(`[ДЕБАГ МАПІНГУ] ✅ TL знайдено у рядку ${tlRowIdx}`);
      const targetRows = [tlRowIdx, tlRowIdx + 1, tlRowIdx + 2];
      const beforeCount = updates.length;
      const rowValues = [];
      [row, assignsRow, orgRow].forEach((srcRow, idx) => {
        for (let day = 1; day <= 31; day++) {
          const colIdx = dateToCol[day];
          const value = srcRow[day];
          if (debugAgent && (value !== undefined && value !== null && value !== '')) {
            console.log('[ДЕБАГ КОЛОНОК] Спроба записати день', day, 'у колонку номер', colIdx, '| рядок TL:', targetRows[idx] + 1, '| значення:', value);
          }
          if (colIdx === undefined) continue;
          if (value === undefined || value === null || value === '') continue;
          const range = `${columnToLetter(colIdx)}${targetRows[idx] + 1}`;
          rowValues.push({ day, colIdx, range, value, srcRowType: idx === 0 ? 'client/status' : idx === 1 ? 'assigns' : 'org' });
          updates.push({ range, values: [[value]] });
        }
      });
      if (debugAgent) {
        const hasChanges = rowValues.length > 0;
        console.log(`=== ДЕБАГ ЕКСПОРТУ ДЛЯ: ${label} ===`);
        console.log('1. Знайдений рядок у таблиці:', tlRowIdx + 1);
        console.log('2. Зібрані дані для колонок (rowValues):', rowValues);
        console.log('3. Чи буде зроблено push? Перевіряємо умови... ->', hasChanges ? `ТАК (+${updates.length - beforeCount})` : 'НІ (rowValues.length === 0)');
      }
      i += 2;
      continue;
    }

    let agentRowIdx = colA.findIndex((cell) => cell.includes(baseName) && !cell.includes('teamleader'));
    if (agentRowIdx === -1) {
      agentRowIdx = colA.findIndex((cell) => cell.includes(baseName));
      if (agentRowIdx !== -1) {
        console.warn(`[ДЕБАГ МАПІНГУ] ⚠️ Агента "${baseName}" знайдено через фоллбек (рядок ${agentRowIdx})`);
      }
    }
    if (agentRowIdx === -1) {
      missing.push(baseName);
      const firstName = baseName.split(' ')[0];
      const partialMatch = colA.find((cell) => cell.includes(firstName));
      console.warn(`[ДЕБАГ МАПІНГУ] ❌ Агента "${baseName}" НЕ ЗНАЙДЕНО. Збіг по першому слову (${firstName}):`, partialMatch || 'НЕМАЄ');
      if (debugAgent) {
        console.log(`=== ДЕБАГ ЕКСПОРТУ ДЛЯ: ${label} ===`);
        console.log('1. Знайдений рядок у таблиці:', 'НЕ ЗНАЙДЕНО');
        console.log('2. Зібрані дані для колонок (rowValues): НЕ ІСНУЄ (agentRowIdx === -1)');
        console.log('3. Чи буде зроблено push? Перевіряємо умови... -> НІ (agentRowIdx === -1)');
      }
      continue;
    }

    console.log(`[ДЕБАГ МАПІНГУ] ✅ Агента "${baseName}" знайдено у рядку ${agentRowIdx}`);

    const beforeCount = updates.length;
    const rowValues = [];
    const sourceNonEmptyDays = [];
    for (let day = 1; day <= 31; day++) {
      const colIdx = dateToCol[day];
      const value = row[day];
      if (value !== undefined && value !== null && value !== '') {
        sourceNonEmptyDays.push({ day, value });
      }
      if (debugAgent && (value !== undefined && value !== null && value !== '')) {
        console.log('[ДЕБАГ КОЛОНОК] Спроба записати день', day, 'у колонку номер', colIdx, '| рядок агента:', agentRowIdx + 1, '| значення:', value);
      }
      if (colIdx === undefined) continue;
      if (value === undefined || value === null || value === '') continue;
      const range = `${columnToLetter(colIdx)}${agentRowIdx + 1}`;
      rowValues.push({ day, colIdx, range, value });
      updates.push({ range, values: [[value]] });
    }

    if (debugAgent) {
      const hasChanges = rowValues.length > 0;
      console.log(`=== ДЕБАГ ЕКСПОРТУ ДЛЯ: ${label} ===`);
      console.log('1. Знайдений рядок у таблиці:', agentRowIdx + 1);
      console.log('2. Зібрані дані для колонок (rowValues):', rowValues);
      console.log('3. Чи буде зроблено push? Перевіряємо умови... ->', hasChanges ? `ТАК (+${updates.length - beforeCount})` : 'НІ (rowValues.length === 0)');
      if (!hasChanges && sourceNonEmptyDays.length) {
        console.warn('[ДЕБАГ ЕКСПОРТУ] Є дані у вихідному рядку, але вони не потрапили в updates. sourceNonEmptyDays:', sourceNonEmptyDays);
        console.warn('[ДЕБАГ ЕКСПОРТУ] Поточний dateToCol (можливо, не знайдені колонки для потрібних днів):', dateToCol);
      }
    }
  }

  return { updates, missingAgents: missing };
}

async function validateSheetsMapping(payload = {}) {
  const { rows, sheetId, token, targetMonth, targetYear, utcOffset = 0 } = payload || {};
  if (!sheetId || !token || !Array.isArray(rows)) throw new Error('sheetId, token або дані відсутні');
  const monthYear = inferMonthYear(targetMonth, targetYear);
  console.log('[ДЕБАГ] Місяць для мапінгу:', monthYear, 'UTC Offset:', utcOffset);
  const sheet = await fetchSheetValuesBg(sheetId, token);
  const { updates, missingAgents } = mapMatrixToUpdatesBg(rows, sheet, monthYear, utcOffset);
  console.log('[КРОК 1 - БЕКГРАУНД] Зібрані дані для запису:', updates);
  if (!updates.length) {
    console.error('КРИТИЧНА ПОМИЛКА: Цикл мапінгу не зібрав ЖОДНОГО агента!');
  }
  console.log('Sheets validation', { missingCount: missingAgents.length, updateCount: updates.length });
  return { ok: true, missingAgents, batchUpdateData: updates };
}

function inferMonthYear(targetMonth, targetYear) {
  if (targetMonth && targetYear) return { month: targetMonth, year: targetYear };
  const allDates = [];
  site1Cache.forEach((t) => {
    const ts = Number(t?.createDate);
    if (!Number.isNaN(ts)) allDates.push(ts);
  });
  site2Cache.forEach((s) => {
    const ts = Number(s?.shiftDate || s?.dateFrom || s?.shiftDateFrom);
    if (!Number.isNaN(ts)) allDates.push(ts);
  });
  const ts = allDates.length ? Math.min(...allDates) : Date.now();
  const d = new Date(ts);
  return { month: d.getMonth() + 1, year: d.getFullYear() };
}

async function executeSheetsBatch(payload = {}) {
  const { sheetId, token, batchUpdateData } = payload || {};
  if (!sheetId || !token || !Array.isArray(batchUpdateData)) throw new Error('Невірні дані для запису');
  if (!batchUpdateData.length) throw new Error('Немає клітинок для оновлення');
  console.log('ДАНІ ПЕРЕД ВІДПРАВКОЮ В API:', JSON.stringify(batchUpdateData));
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values:batchUpdate`;
  const body = {
    valueInputOption: 'USER_ENTERED',
    data: batchUpdateData,
  };
  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    let errorText = '';
    try {
      const errJson = await res.json();
      errorText = JSON.stringify(errJson, null, 2);
      console.error('GOOGLE API ERROR DETAILS:', errorText);
      throw new Error(`Google API відхилив запит: ${errJson.error?.message || 'Невідома помилка 400'}`);
    } catch (err) {
      if (!errorText) {
        const fallback = await res.text();
        console.error('GOOGLE API ERROR (TEXT):', fallback);
        throw new Error(`Sheets update ${res.status}: ${fallback.slice(0, 200)}`);
      }
      throw err;
    }
  }
  const text = await res.text();
  try {
    const parsed = JSON.parse(text);
    return { ok: true, result: parsed };
  } catch (err) {
    return { ok: true, raw: text };
  }
}

function trySendAggregateReport() {
  if (!site1Cache?.length || !site2Cache?.length) return;
  chrome.storage.local.get([STORAGE_USERS_KEY, 'selectedTrackensureTLs', 'includeCancel5', 'includeShift20', 'orchardOffset'], (data) => {
    const tlCache = data?.[STORAGE_USERS_KEY] || [];
    const options = {
      includeCancel5: data?.includeCancel5 !== false,
      includeShift20: data?.includeShift20 !== false,
      selectedTLs: data?.selectedTrackensureTLs || [],
      orchardOffset: Number(data?.orchardOffset ?? 2),
    };
    const { agentMessage, tlMessage } = aggregateData(site1Cache, site2Cache, tlCache, options);
    if (agentMessage) {
      chrome.runtime.sendMessage({ type: 'LOG', site: 'Зведення', message: agentMessage, code: 200 });
    }
    if (tlMessage) {
      chrome.runtime.sendMessage({ type: 'LOG', site: 'Зведення', message: tlMessage, code: 200 });
    }
  });
 }


