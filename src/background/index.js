import { logToPopup, readFromStorage, setFetchFlag, convertDateTimeToMs, DATA_KEYS } from './shared.js';
import { fetchTags, fetchTrackensureUsers, fetchAllTasks, fetchDisputeTasks, fetchComplainsTasks, fetchTaskHistories, fetchWorkloadTasks, fetchQueues, fetchCallHistory, STORAGE_USERS_KEY } from './api/trackensure.js';
import { fetchOrchardTeams, fetchAllOrchardShifts, ensureOrchardToken, fetchAgentWorkHours, fetchOrchardDepartments, fetchOrchardTeamsByDept, fetchWorkloadSchedules, fetchWorkloadActualHours } from './api/orchard.js';
import { fetchSheetValuesBg, executeSheetsBatch, exportCustomReport, exportWorkloadReport } from './api/sheets.js';
import { buildSheetMatrix, mapMatrixToUpdatesBg, inferMonthYear, aggregateData, aggregateTrackensure } from './modes/defaultModeBuilder.js';
import { buildWorkloadStats, buildWorkloadMatrix } from './modes/workloadModeBuilder.js';

let site1Cache = [];
let site2Cache = [];
let aggregationOptions = { includeCancel5: true, includeShift20: true };
let debugSaved = false;
let workloadStopRequested = false;
const workloadGetStop = () => workloadStopRequested;

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
          trySendAggregateReport();
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
      fetchAllOrchardShifts({ teamId })
        .then((data) => {
          site2Cache = data;
          trySendAggregateReport();
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
      (async () => {
        try {
          await chrome.storage.local.set({ exportInProgress: true, exportStartedAt: Date.now() });

          const { sheetId, token } = message.payload || {};
          let { batchUpdateData } = message.payload || {};

          // Fallback: якщо payload не містить даних (велике повідомлення відхилено браузером),
          // завантажуємо batchUpdateData з storage де воно вже збережено з START_EXPORT
          if (!Array.isArray(batchUpdateData) || !batchUpdateData.length) {
            const stored = await chrome.storage.local.get(['pendingBatchData']);
            batchUpdateData = stored.pendingBatchData;
          }

          console.log('[EXECUTE_SHEETS_BATCH] Записую', batchUpdateData?.length ?? 0, 'діапазонів');
          const resp = await executeSheetsBatch({ sheetId, token, batchUpdateData });

          await chrome.storage.local.remove(['exportInProgress', 'exportStartedAt', 'missingAgentsList', 'pendingBatchData']);
          chrome.runtime.sendMessage({ action: 'EXPORT_COMPLETED' });
          sendResponse({ ok: true, result: resp });
        } catch (err) {
          console.error('[EXECUTE_SHEETS_BATCH] помилка:', err);
          await chrome.storage.local.remove(['exportInProgress', 'exportStartedAt']);
          chrome.runtime.sendMessage({ action: 'EXPORT_COMPLETED', error: err?.message || 'Помилка запису в Sheets' });
          sendResponse({ ok: false, error: err?.message || 'Помилка запису в Sheets' });
        }
      })();
      return true;
    }
    case 'GET_EXPORT_STATUS': {
      chrome.storage.local.get(['exportInProgress', 'exportStartedAt'], (data) => {
        const MAX_MS = 180000;
        const isActive = Boolean(data.exportInProgress) &&
                         Boolean(data.exportStartedAt) &&
                         Date.now() - data.exportStartedAt < MAX_MS;
        sendResponse({ ok: true, isActive, startedAt: data.exportStartedAt || null });
      });
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
    case 'FETCH_CUSTOM_REPORT': {
      (async () => {
        try {
          const { reportType = 'dispute_tasks', dateFrom, dateTo, tagId, apiOffset = 2 } = message.payload || {};
          if (!dateFrom || !dateTo) {
            sendResponse({ ok: false, error: 'Відсутні дати' });
            return;
          }
          const dateFromMs = convertDateTimeToMs(dateFrom, apiOffset);
          const dateToMs = convertDateTimeToMs(dateTo, apiOffset);

          let tasks;
          if (reportType === 'complains') {
            logToPopup('Custom', 'Збір Complains задач...', null);
            tasks = await fetchComplainsTasks({ dateFromMs, dateToMs, teamId: tagId });

            if (tasks.length) {
              logToPopup('Custom', `Зібрано ${tasks.length} задач. Завантаження коментарів...`, null);
              const taskIds = tasks.map((t) => t.taskId).filter(Boolean);
              const historiesMap = await fetchTaskHistories(taskIds);
              tasks = tasks.map((t) => ({ ...t, _comments: historiesMap[t.taskId] || [] }));
            }
          } else {
            logToPopup('Custom', 'Збір Dispute задач...', null);
            tasks = await fetchDisputeTasks({ dateFromMs, dateToMs, teamId: tagId });
          }

          await chrome.storage.local.set({ customReportData: tasks, customReportType: reportType });

          logToPopup('Custom', `Зібрано ${tasks.length} задач`, 200);
          sendResponse({ ok: true, total: tasks.length });
        } catch (err) {
          console.error('[FETCH_CUSTOM_REPORT] помилка:', err);
          sendResponse({ ok: false, error: err?.message || 'Помилка зчитування' });
        }
      })();
      return true;
    }
    case 'EXPORT_CUSTOM_REPORT': {
      (async () => {
        try {
          const { sheetId, token, trackensureOffset = 2, dateRangeStr } = message.payload || {};
          if (!sheetId || !token) {
            sendResponse({ ok: false, error: "Відсутні обов'язкові параметри" });
            return;
          }
          const stored = await chrome.storage.local.get(['customReportData', 'customReportType']);
          const tasks = stored.customReportData;
          const reportType = stored.customReportType || 'dispute_tasks';
          if (!Array.isArray(tasks) || !tasks.length) {
            sendResponse({ ok: false, error: 'Немає зчитаних даних. Спочатку запустіть зчитування.' });
            return;
          }

          const dataMatrix = reportType === 'complains'
            ? buildComplainsMatrix(tasks, trackensureOffset)
            : buildDisputeMatrix(tasks, trackensureOffset);
          const fallbackName = reportType === 'complains' ? 'Complains Report' : 'Dispute Report';

          logToPopup('Custom', `Запис ${tasks.length} рядків у Sheets...`, null);
          await exportCustomReport(token, sheetId, dataMatrix, dateRangeStr || fallbackName);

          logToPopup('Custom', `Звіт записано: ${tasks.length} рядків`, 200);
          sendResponse({ ok: true, rowCount: tasks.length });
        } catch (err) {
          console.error('[EXPORT_CUSTOM_REPORT] помилка:', err);
          sendResponse({ ok: false, error: err?.message || 'Помилка експорту' });
        }
      })();
      return true;
    }
    case 'GET_WORKLOAD_DEPARTMENTS':
      fetchOrchardDepartments()
        .then((departments) => sendResponse({ ok: true, departments }))
        .catch((err) => sendResponse({ ok: false, error: err?.message || 'Помилка департаментів' }));
      return true;
    case 'GET_WORKLOAD_TEAMS': {
      const { departmentId } = message.payload || {};
      fetchOrchardTeamsByDept(departmentId)
        .then((teams) => sendResponse({ ok: true, teams }))
        .catch((err) => sendResponse({ ok: false, error: err?.message || 'Помилка команд' }));
      return true;
    }
    case 'GET_WORKLOAD_QUEUES':
      fetchQueues()
        .then((queues) => sendResponse({ ok: true, queues }))
        .catch((err) => sendResponse({ ok: false, error: err?.message || 'Помилка ліній' }));
      return true;
    case 'FETCH_WORKLOAD_DATA': {
      (async () => {
        try {
          workloadStopRequested = false;
          const { dateFrom, dateTo, shiftTagIds } = message.payload || {};
          if (!dateFrom || !dateTo) { sendResponse({ ok: false, error: 'Відсутні дати' }); return; }

          const apiOffset    = Number((await readFromStorage('apiRangeOffset')) ?? 2);
          const orchardTzOff = Number((await readFromStorage('orchardOffset'))   ?? 2);
          const dateFromMs   = convertDateTimeToMs(dateFrom, apiOffset);
          const dateToMs     = convertDateTimeToMs(dateTo.includes('T') ? dateTo : `${dateTo}T23:59`, apiOffset);

          const teamIds      = (await readFromStorage('wlTeamIds'))      || [];
          const queueIds     = (await readFromStorage('wlQueueIds'))     || [];
          const storedTeams  = (await readFromStorage('wlTeams'))        || [];
          const departmentId = Number((await readFromStorage('wlDepartmentId')) ?? 2);
          const analyzeCalls = (await readFromStorage('wlAnalyzeCalls')) !== false;

          // ── Phase 1: TrackEnsure shift tasks ─────────────────────────────
          chrome.runtime.sendMessage({ type: 'WORKLOAD_PHASE', phase: 'te_start' });
          logToPopup('Workload', 'Збір TE shift тасків...', null);
          let tasks;
          try {
            tasks = await fetchWorkloadTasks({ dateFromMs, dateToMs, shiftTagIds, getShouldStop: workloadGetStop });
          } catch (err) {
            chrome.runtime.sendMessage({ type: 'WORKLOAD_PHASE', phase: 'te_error' });
            throw err;
          }
          if (workloadStopRequested) { sendResponse({ ok: false, error: 'Зупинено' }); return; }
          chrome.runtime.sendMessage({ type: 'WORKLOAD_PHASE', phase: 'te_done' });

          // ── Phase 2: Call history ─────────────────────────────────────────
          chrome.runtime.sendMessage({ type: 'WORKLOAD_PHASE', phase: 'calls_start' });
          logToPopup('Workload', 'Збір дзвінків...', null);
          let calls = [];
          try {
            calls = await fetchCallHistory({ dateFromMs, dateToMs, queueIds, getShouldStop: workloadGetStop, analyzeCalls });
          } catch (err) {
            chrome.runtime.sendMessage({ type: 'WORKLOAD_PHASE', phase: 'calls_error' });
            logToPopup('Workload', `Помилка дзвінків: ${err?.message}`, 500);
            // non-fatal — continue without calls
          }
          if (workloadStopRequested) { sendResponse({ ok: false, error: 'Зупинено' }); return; }
          chrome.runtime.sendMessage({ type: 'WORKLOAD_PHASE', phase: 'calls_done' });

          // ── Phase 3: Orchard schedules + work hours ───────────────────────
          let schedules = [];
          let workHours = {};
          if (Array.isArray(teamIds) && teamIds.length) {
            chrome.runtime.sendMessage({ type: 'WORKLOAD_PHASE', phase: 'orchard_start' });
            logToPopup('Workload', `Збір Orchard розкладів для ${teamIds.length} команд...`, null);
            try {
              schedules = await fetchWorkloadSchedules({ dateFromMs, dateToMs, teamIds, departmentId, getShouldStop: workloadGetStop });
            } catch (err) {
              chrome.runtime.sendMessage({ type: 'WORKLOAD_PHASE', phase: 'orchard_error' });
              throw err;
            }
            if (workloadStopRequested) { sendResponse({ ok: false, error: 'Зупинено' }); return; }

            const agentIds = new Set(
              schedules.map(s => s.agentId ?? s.agentDTO?.userId ?? s.agentDTO?.agentId).filter(Boolean)
            );
            logToPopup('Workload', `Збір годин для ${agentIds.size} агентів...`, null);
            try {
              workHours = await fetchWorkloadActualHours({ dateFromMs, dateToMs, agentIds, getShouldStop: workloadGetStop });
            } catch (err) {
              chrome.runtime.sendMessage({ type: 'WORKLOAD_PHASE', phase: 'orchard_error' });
              throw err;
            }
            if (workloadStopRequested) { sendResponse({ ok: false, error: 'Зупинено' }); return; }
            chrome.runtime.sendMessage({ type: 'WORKLOAD_PHASE', phase: 'orchard_done' });
          } else {
            logToPopup('Workload', 'Команди Orchard не обрані — пропуск Orchard', null);
          }

          // ── Calculate stats ───────────────────────────────────────────────
          const { rows } = buildWorkloadStats({
            rawTasks: tasks, rawSchedules: schedules, rawWorkHours: workHours,
            rawCalls: calls, teams: storedTeams, tzOffset: orchardTzOff,
          });

          await chrome.storage.local.set({
            wlRawTasks: tasks, wlRawSchedules: schedules,
            wlRawWorkHours: workHours, wlRawCalls: calls, wlStats: rows,
            workloadDebugRows: rows,
          });
          logToPopup('Workload', `Готово: ${tasks.length} тасків, ${calls.length} дзвінків, ${schedules.length} змін`, 200);
          sendResponse({ ok: true, total: tasks.length, stats: rows });
        } catch (err) {
          console.error('[FETCH_WORKLOAD_DATA] помилка:', err);
          sendResponse({ ok: false, error: err?.message || 'Помилка зчитування' });
        }
      })();
      return true;
    }
    case 'EXPORT_WORKLOAD_REPORT': {
      (async () => {
        try {
          const { sheetId, token, sheetTitle } = message.payload || {};
          if (!sheetId || !token) { sendResponse({ ok: false, error: "Відсутні обов'язкові параметри" }); return; }
          const stored = await chrome.storage.local.get(['wlStats']);
          const rows = stored.wlStats;
          if (!Array.isArray(rows) || !rows.length) {
            sendResponse({ ok: false, error: 'Немає зчитаних даних. Спочатку запустіть зчитування.' });
            return;
          }
          const matrix = buildWorkloadMatrix(rows);
          logToPopup('Workload', `Запис ${rows.length} рядків у Sheets...`, null);
          await exportWorkloadReport(token, sheetId, matrix, sheetTitle);
          logToPopup('Workload', 'Workload звіт записано', 200);
          sendResponse({ ok: true, rowCount: rows.length });
        } catch (err) {
          console.error('[EXPORT_WORKLOAD_REPORT] помилка:', err);
          sendResponse({ ok: false, error: err?.message || 'Помилка експорту' });
        }
      })();
      return true;
    }
    case 'STOP_WORKLOAD_FETCH': {
      workloadStopRequested = true;
      logToPopup('Workload', 'Зупинено користувачем', null);
      sendResponse({ ok: true });
      return false;
    }
    case 'CLEAR_WORKLOAD_DATA': {
      chrome.storage.local.remove(['wlRawTasks', 'wlRawSchedules', 'wlRawWorkHours', 'wlRawCalls', 'wlStats']);
      sendResponse({ ok: true });
      return false;
    }
    default:
      return false;
  }
});

async function handleStartExport(payload) {
  try {
    const token = payload.token;
    if (!token) {
      throw new Error('Не отримано токен з Popup!');
    }

    const matrixResp = await handleGetTsvMatrix(payload);
    if (!matrixResp.ok) throw new Error(matrixResp.error || 'Failed to get matrix');

    const validationResp = await validateSheetsMapping({
      rows: matrixResp.rows,
      sheetId: payload.sheetId,
      token,
      utcOffset: payload.orchardOffset
    });
    if (!validationResp.ok) throw new Error(validationResp.error || 'Failed validation');

    const batchData = validationResp.batchUpdateData;
    const missingAgents = validationResp.missingAgents || [];

    if (!batchData || !batchData.length) {
      throw new Error('Відсутні дані для запису (спробуйте інший діапазон або агенти не знайдені в таблиці)');
    }

    if (missingAgents.length > 0) {
      await chrome.storage.local.set({
        missingAgentsList: missingAgents,
        pendingBatchData: batchData
      });
      chrome.runtime.sendMessage({ action: 'EXPORT_COMPLETED' });
      return;
    }

    await executeSheetsBatch({
      sheetId: payload.sheetId,
      token,
      batchUpdateData: batchData
    });

    chrome.runtime.sendMessage({ action: 'EXPORT_COMPLETED' });
    try {
      chrome.notifications.create({
        type: 'basic',
        iconUrl: 'assets/icon128.png',
        title: 'Експорт завершено',
        message: 'Статистику успішно записано у Google Таблицю!'
      });
    } catch { /* ignore notification errors */ }
  } catch (err) {
    console.error('[START_EXPORT] помилка:', err);
    chrome.runtime.sendMessage({ action: 'EXPORT_COMPLETED', error: err.message || 'Невідома помилка' });
    try {
      chrome.notifications.create({
        type: 'basic',
        iconUrl: 'assets/icon128.png',
        title: 'Помилка експорту',
        message: err.message || 'Невідома помилка'
      });
    } catch { /* ignore notification errors */ }
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
    site1Cache = data;
    trySendAggregateReport();
    return { ok: true, site: 'site1', total: data.length };
  }
  if (url.includes('orchard22.com')) {
    if (!teamId) return { ok: false, error: 'Не обрано команду', site2: false };
    const data = await fetchAllOrchardShifts({ teamId, dateFromMs, dateToMs });
    site2Cache = data;
    trySendAggregateReport();
    return { ok: true, site: 'site2', total: data.length };
  }
  return { ok: false, error: 'Відкрийте підтримуваний сайт для збору' };
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

  let agentWorkHoursCache = {};
  try {
    const orchardToken = await ensureOrchardToken();
    if (orchardToken) {
      const uniqueAgentIds = new Set();
      orchard.forEach((entry) => {
        const agId = entry?.agentDTO?.userId || entry?.agentDTO?.agentId || entry?.agentId || entry?.candidateId;
        if (agId) uniqueAgentIds.add(agId);
      });

      agentWorkHoursCache = await fetchAgentWorkHours({
        token: orchardToken,
        agentIds: uniqueAgentIds,
        dateFromMs: baseDateFromMs,
        dateToMs: Date.now(),
      });
    }
  } catch (e) {
    console.error('Work Hours outer Error:', e);
  }

  const rows = buildSheetMatrix(trackTasks, orchard, tlCache, { includeCancel5, includeShift20, selectedTLs, timezone, orchardOffset, baseDateFromMs, agentWorkHoursCache });
  return { ok: true, rows };
}

async function validateSheetsMapping(payload = {}) {
  const { rows, sheetId, token, targetMonth, targetYear, utcOffset = 0 } = payload || {};
  if (!sheetId || !token || !Array.isArray(rows)) throw new Error('sheetId, token або дані відсутні');
  const monthYear = inferMonthYear(targetMonth, targetYear, site1Cache, site2Cache);
  const sheet = await fetchSheetValuesBg(sheetId, token);
  const { updates, missingAgents } = mapMatrixToUpdatesBg(rows, sheet, monthYear, utcOffset);
  if (!updates.length) {
    console.warn('[validateSheetsMapping] Цикл мапінгу не зібрав жодного агента');
  }
  return { ok: true, missingAgents, batchUpdateData: updates };
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

function toHHMMSS(seconds) {
  if (seconds == null || isNaN(Number(seconds))) return '';
  const s = Math.abs(Math.round(Number(seconds)));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}

function sanitizeCell(value) {
  if (value == null) return '';
  const str = String(value);
  return /^[=+\-@]/.test(str) ? `'${str}` : str;
}

function formatDateOffset(ms, offset) {
  if (!ms) return '';
  const d = new Date(Number(ms) + Number(offset) * 3600000);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
}

function buildBaseRow(task, trackensureOffset) {
  return [
    sanitizeCell(task?.taskId),
    sanitizeCell(formatDateOffset(task?.createDate, trackensureOffset)),
    sanitizeCell(task?.status),
    sanitizeCell(task?.requestType),
    sanitizeCell(task?.eldType),
    sanitizeCell(task?.organizationDTO?.name),
    sanitizeCell(task?.driverProfileDTO?.fullName),
    sanitizeCell(toHHMMSS(task?.inProgressSpendTimeSec)),
    sanitizeCell(toHHMMSS(task?.totalNoChargeTimeSec)),
    sanitizeCell(toHHMMSS(task?.totalSpentTimeSec)),
    sanitizeCell(task?.ownerDTO?.fullName),
  ];
}

function buildDisputeMatrix(tasks, trackensureOffset = 2) {
  const headers = [
    'taskId', 'createDate', 'status', 'requestType', 'eldType',
    'Organization', 'Driver', 'inProgressTime', 'noChargeTime', 'totalSpentTime',
    'Owner', 'disputeReason',
  ];
  const rows = tasks.map((task) => [
    ...buildBaseRow(task, trackensureOffset),
    sanitizeCell(task?.supportTaskDisputeDTO?.disputeReason),
  ]);
  return [headers, ...rows];
}

function buildComplainsMatrix(tasks, trackensureOffset = 2) {
  // Find the maximum comment count across all tasks to build dynamic column headers
  const maxComments = tasks.reduce((max, t) => Math.max(max, (t._comments || []).length), 0);
  const commentHeaders = Array.from({ length: maxComments }, (_, i) => `comment ${i + 1}`);

  const headers = [
    'taskId', 'createDate', 'status', 'requestType', 'eldType',
    'Organization', 'Driver', 'inProgressTime', 'noChargeTime', 'totalSpentTime',
    'Owner', 'Task Details', ...commentHeaders,
  ];

  const rows = tasks.map((task) => {
    const comments = task._comments || [];
    const commentCells = Array.from({ length: maxComments }, (_, i) => sanitizeCell(comments[i] ?? ''));
    return [...buildBaseRow(task, trackensureOffset), sanitizeCell(task?.taskDetails), ...commentCells];
  });

  return [headers, ...rows];
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
