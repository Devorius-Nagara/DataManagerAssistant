import { logToPopup, readFromStorage, safeParse, DATA_KEYS } from '../shared.js';

const TRACK_BASE = 'https://trackensure.com';
const TAGS_URL = `${TRACK_BASE}/tag?actionName=getPermittedTagListForUser`;
const TASKS_FIRST_URL = `${TRACK_BASE}/supportTask?actionName=getSupportTaskListLTByFilterAndPageNumber`;
const TASKS_NEXT_URL = `${TRACK_BASE}/supportTask?actionName=getSupportTaskListByFilterLT`;
const TRACK_USERS_URL = `${TRACK_BASE}/fleet/user?actionName=getACLUserListLTByOrgId`;
const TASK_HISTORY_URL = `${TRACK_BASE}/supportTaskHistory?actionName=getSupportTaskHistoryListByTaskId`;
export const STORAGE_USERS_KEY = 'trackensureUsersCache';
export const CLIENT_REQUEST_TYPES = [
  'mobile_assistance',
  'log_editing',
  'ifta_service',
  'report_assistance',
  'troubleshooting',
  'web_assistance',
  'fleet_editor_assistance',
];

export async function fetchTags() {
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

export async function fetchTrackensureUsers() {
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

export async function fetchAllTasks({ tagId, tlIds = [], dateFromMs, dateToMs }) {
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

  chrome.storage.local.set({ [DATA_KEYS.site1]: unique });
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
  let totalBytes = 0;
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
    logToPopup('Сайт 1', `Запит сторінки ${isFirstPage ? 1 : 'next'}`, null);
    const { data, status, textBody } = await fetchJson(url, payload);
    const tasks = normalizeTasks(data);
    if (!Array.isArray(tasks) || tasks.length === 0) {
      logToPopup('Сайт 1', 'Отримано 0 записів', status || 200, { taskTeamLeaderId, tagId });
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
    totalBytes += textBody.length;
    chrome.runtime.sendMessage({ type: 'FETCH_PROGRESS', site: 'site1', count: all.length, totalBytes });
    beforeTaskId = tasks[tasks.length - 1]?.taskId;
    if (!beforeTaskId) break;
    isFirstPage = false;
  }
  return all;
}

export async function fetchDisputeTasks({ dateFromMs, dateToMs, teamId }) {
  const dateFrom = dateFromMs || Date.now();
  const dateTo = dateToMs || Date.now();
  const all = [];
  let beforeTaskId = null;
  let isFirstPage = true;
  let totalBytes = 0;

  while (true) {
    const url = isFirstPage ? TASKS_FIRST_URL : TASKS_NEXT_URL;
    const payload = isFirstPage
      ? {
          dateFrom,
          dateTo,
          tagIdSet: teamId ? [teamId] : [],
          limitOnPage: 500,
          showDisputeRequired: true,
          pageNumber: 1,
        }
      : {
          dateFrom,
          dateTo,
          tagIdSet: teamId ? [teamId] : [],
          limitOnPage: 500,
          showDisputeRequired: true,
          beforeTaskId,
          callerMgrUserId: null,
          driverIdByDriverName: null,
          taskOwnerId: null,
          createdBy: null,
        };

    const { data, status, textBody } = await fetchJson(url, payload);
    const tasks = normalizeTasks(data);

    if (!tasks.length) break;

    all.push(...tasks);
    totalBytes += textBody.length;
    chrome.runtime.sendMessage({ type: 'FETCH_PROGRESS', site: 'site1', count: all.length, totalBytes });

    beforeTaskId = tasks[tasks.length - 1]?.taskId;
    if (!beforeTaskId) break;
    isFirstPage = false;
  }

  logToPopup('Custom', `Зібрано ${all.length} dispute задач`, 200);
  return all;
}

export async function fetchComplainsTasks({ dateFromMs, dateToMs, teamId }) {
  const dateFrom = dateFromMs || Date.now();
  const dateTo = dateToMs || Date.now();
  const all = [];
  let beforeTaskId = null;
  let isFirstPage = true;
  let totalBytes = 0;

  while (true) {
    const url = isFirstPage ? TASKS_FIRST_URL : TASKS_NEXT_URL;
    const payload = isFirstPage
      ? {
          dateFrom,
          dateTo,
          tagIdSet: teamId ? [teamId] : [],
          limitOnPage: 500,
          status: 'completed',
          includeRequestTypeList: ['complain'],
          pageNumber: 1,
        }
      : {
          dateFrom,
          dateTo,
          tagIdSet: teamId ? [teamId] : [],
          limitOnPage: 500,
          status: 'completed',
          includeRequestTypeList: ['complain'],
          beforeTaskId,
          callerMgrUserId: null,
          driverIdByDriverName: null,
          taskOwnerId: null,
          createdBy: null,
        };

    const { data, status, textBody } = await fetchJson(url, payload);
    const tasks = normalizeTasks(data);

    if (!tasks.length) break;

    all.push(...tasks);
    totalBytes += textBody.length;
    chrome.runtime.sendMessage({ type: 'FETCH_PROGRESS', site: 'site1', count: all.length, totalBytes });

    beforeTaskId = tasks[tasks.length - 1]?.taskId;
    if (!beforeTaskId) break;
    isFirstPage = false;
  }

  logToPopup('Custom', `Зібрано ${all.length} complains задач`, 200);
  return all;
}

// Fetches filtered comment history for a list of taskIds in batches of 10
// to avoid rate-limiting (429) from the TrackEnsure API.
// Returns: { [taskId]: string[] } — only non-empty comments per task.
export async function fetchTaskHistories(taskIds) {
  const BATCH_SIZE = 10;
  const result = {};
  const ids = Array.from(taskIds).filter(Boolean);

  for (let i = 0; i < ids.length; i += BATCH_SIZE) {
    const batch = ids.slice(i, i + BATCH_SIZE);

    await Promise.all(
      batch.map(async (taskId) => {
        try {
          const res = await fetch(`${TASK_HISTORY_URL}&taskId=${taskId}`, {
            method: 'GET',
            credentials: 'include',
          });
          if (!res.ok) {
            result[taskId] = [];
            return;
          }
          const text = await res.text();
          const data = safeParse(text);
          const items = Array.isArray(data) ? data : (Array.isArray(data?.data) ? data.data : []);
          result[taskId] = items
            .filter((h) => h?.comment && String(h.comment).trim())
            .map((h) => String(h.comment).trim());
        } catch {
          result[taskId] = [];
        }
      })
    );

    logToPopup('Custom', `Коментарі: ${Math.min(i + BATCH_SIZE, ids.length)} / ${ids.length} тасків`, null);
  }

  return result;
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
