import { logToPopup, readFromStorage, setFetchFlag, convertDateTimeToMs, DATA_KEYS } from './shared.js';
import { fetchTags, fetchTrackensureUsers, fetchAllTasks, fetchDisputeTasks, fetchComplainsTasks, fetchTaskHistories, fetchWorkloadTasks, fetchQueues, fetchCallHistory, STORAGE_USERS_KEY } from './api/trackensure.js';
import { fetchOrchardTeams, fetchAllOrchardShifts, ensureOrchardToken, fetchAgentWorkHours, fetchOrchardDepartments, fetchOrchardTeamsByDept, fetchWorkloadSchedules, fetchWorkloadActualHours } from './api/orchard.js';
import { fetchSheetValuesBg, executeSheetsBatch, exportCustomReport, exportWorkloadReport, exportPmsReport, exportPmsToSheets, exportProdToSheets } from './api/sheets.js';
import { buildSheetMatrix, mapMatrixToUpdatesBg, inferMonthYear, aggregateData, aggregateTrackensure } from './modes/defaultModeBuilder.js';
import { buildSheetMatrix as pmsBuildSheetMatrix, mapMatrixToUpdatesBg as pmsMapMatrixToUpdatesBg, inferMonthYear as pmsInferMonthYear, aggregateData as pmsAggregateData } from './modes/pmsModeBuilder.js';
import { buildWorkloadStats, buildWorkloadMatrix } from './modes/workloadModeBuilder.js';

let site1Cache = [];
let site2Cache = [];
let aggregationOptions = { includeCancel5: true, includeShift20: true };
let debugSaved = false;
let workloadStopRequested = false;
const workloadGetStop = () => workloadStopRequested;
let defaultStopRequested = false;
let pmsStopRequested = false;

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
    case 'STOP_DEFAULT_FETCH':
      defaultStopRequested = true;
      sendResponse({ ok: true });
      return false;

    case 'FETCH_DEFAULT_DATA': {
      (async () => {
        try {
          defaultStopRequested = false;
          const {
            tagId, teamId, tlIds = [], dateFrom, dateTo,
            apiRangeOffset = 2, orchardOffset = 2,
            includeCancel5 = true, includeShift20 = true,
          } = message.payload || {};

          aggregationOptions = { includeCancel5: Boolean(includeCancel5), includeShift20: Boolean(includeShift20) };
          const dateFromMs = convertDateTimeToMs(dateFrom, apiRangeOffset);
          const dateToMs   = dateTo?.includes('T')
            ? convertDateTimeToMs(dateTo, apiRangeOffset)
            : convertDateTimeToMs(`${dateTo}T23:59`, apiRangeOffset);

          // ── Phase 1: TrackEnsure ────────────────────────────────────────
          chrome.runtime.sendMessage({ type: 'DEFAULT_PHASE', phase: 'te_start' });
          logToPopup('Default', 'Збір TrackEnsure тасків...', null);
          try {
            const data = await fetchAllTasks({ tagId, tlIds, dateFromMs, dateToMs });
            if (defaultStopRequested) { sendResponse({ ok: false, error: 'Зупинено' }); return; }
            site1Cache = data;
            chrome.runtime.sendMessage({ type: 'DEFAULT_PHASE', phase: 'te_done', total: data.length });
            logToPopup('Default', `TrackEnsure: ${data.length} записів`, 200);
          } catch (err) {
            chrome.runtime.sendMessage({ type: 'DEFAULT_PHASE', phase: 'te_error' });
            const m = (err?.message || '').toLowerCase();
            const isAuthErr = m.includes('401') || m.includes('403') || m.includes('token') ||
                              m.includes('unauthorized') || m.includes('failed to fetch');
            sendResponse({
              ok: false,
              needsTabs: isAuthErr,
              error: isAuthErr
                ? 'Будь ласка, відкрийте вкладки TrackEnsure та Orchard22 у браузері і повторіть спробу'
                : (err?.message || 'Помилка TrackEnsure'),
            });
            return;
          }

          // ── Phase 2: Orchard ────────────────────────────────────────────
          chrome.runtime.sendMessage({ type: 'DEFAULT_PHASE', phase: 'orchard_start' });
          logToPopup('Default', 'Збір Orchard розкладів...', null);
          try {
            const data = await fetchAllOrchardShifts({ teamId, dateFromMs, dateToMs });
            if (defaultStopRequested) { sendResponse({ ok: false, error: 'Зупинено' }); return; }
            site2Cache = data;
            chrome.runtime.sendMessage({ type: 'DEFAULT_PHASE', phase: 'orchard_done', total: data.length });
            logToPopup('Default', `Orchard: ${data.length} записів`, 200);
          } catch (err) {
            chrome.runtime.sendMessage({ type: 'DEFAULT_PHASE', phase: 'orchard_error' });
            const m = (err?.message || '').toLowerCase();
            const isAuthErr = m.includes('401') || m.includes('403') || m.includes('token') ||
                              m.includes('unauthorized') || m.includes('failed to fetch');
            sendResponse({
              ok: false,
              needsTabs: isAuthErr,
              error: isAuthErr
                ? 'Будь ласка, відкрийте вкладки TrackEnsure та Orchard22 у браузері і повторіть спробу'
                : (err?.message || 'Помилка Orchard'),
            });
            return;
          }

          trySendAggregateReport();
          sendResponse({ ok: true, site1Total: site1Cache.length, site2Total: site2Cache.length });
        } catch (err) {
          console.error('[FETCH_DEFAULT_DATA] помилка:', err);
          sendResponse({ ok: false, error: err?.message || 'Помилка зчитування' });
        }
      })();
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

    case 'FETCH_PMS_DATA': {
      // ── Exact clone of FETCH_DEFAULT_DATA, fully isolated in pms* storage keys ──
      (async () => {
        try {
          pmsStopRequested = false;
          const {
            tagId, teamId, tlIds = [], dateFrom, dateTo,
            apiRangeOffset = 2, orchardOffset = 2,
            includeCancel5 = true, includeShift20 = true,
          } = message.payload || {};

          const dateFromMs = convertDateTimeToMs(dateFrom, apiRangeOffset);
          const dateToMs   = dateTo?.includes('T')
            ? convertDateTimeToMs(dateTo, apiRangeOffset)
            : convertDateTimeToMs(`${dateTo}T23:59`, apiRangeOffset);

          // Persist settings so handlePmsStartExport can read them during export
          await chrome.storage.local.set({
            pmsDateFrom:      dateFrom,
            pmsDateTo:        dateTo,
            pmsOrchardOffset: orchardOffset,
            pmsIncludeCancel5: includeCancel5,
            pmsIncludeShift20: includeShift20,
            pmsSelectedTLs:   tlIds,
          });

          // ── Phase 1: TrackEnsure ────────────────────────────────────────
          chrome.runtime.sendMessage({ type: 'PMS_PHASE', phase: 'te_start' });
          logToPopup('PMS', 'Збір TrackEnsure тасків...', null);
          let tasks;
          try {
            tasks = await fetchAllTasks({ tagId, tlIds, dateFromMs, dateToMs });
            if (pmsStopRequested) { sendResponse({ ok: false, error: 'Зупинено' }); return; }
            chrome.runtime.sendMessage({ type: 'PMS_PHASE', phase: 'te_done', total: tasks.length });
            logToPopup('PMS', `TrackEnsure: ${tasks.length} тасків`, 200);
          } catch (err) {
            chrome.runtime.sendMessage({ type: 'PMS_PHASE', phase: 'te_error' });
            const m = (err?.message || '').toLowerCase();
            const isAuth = m.includes('401') || m.includes('403') || m.includes('token') ||
                           m.includes('unauthorized') || m.includes('failed to fetch');
            sendResponse({
              ok: false,
              needsTabs: isAuth,
              error: isAuth
                ? 'Будь ласка, відкрийте вкладки TrackEnsure та Orchard22 і повторіть спробу'
                : (err?.message || 'Помилка TrackEnsure'),
            });
            return;
          }

          // ── Phase 2: Orchard ────────────────────────────────────────────
          chrome.runtime.sendMessage({ type: 'PMS_PHASE', phase: 'orchard_start' });
          logToPopup('PMS', 'Збір Orchard розкладів...', null);
          let schedules;
          try {
            schedules = await fetchAllOrchardShifts({ teamId, dateFromMs, dateToMs });
            if (pmsStopRequested) { sendResponse({ ok: false, error: 'Зупинено' }); return; }
            chrome.runtime.sendMessage({ type: 'PMS_PHASE', phase: 'orchard_done', total: schedules.length });
            logToPopup('PMS', `Orchard: ${schedules.length} записів`, 200);
          } catch (err) {
            chrome.runtime.sendMessage({ type: 'PMS_PHASE', phase: 'orchard_error' });
            const m = (err?.message || '').toLowerCase();
            const isAuth = m.includes('401') || m.includes('403') || m.includes('token') ||
                           m.includes('unauthorized') || m.includes('failed to fetch');
            sendResponse({
              ok: false,
              needsTabs: isAuth,
              error: isAuth
                ? 'Будь ласка, відкрийте вкладки TrackEnsure та Orchard22 і повторіть спробу'
                : (err?.message || 'Помилка Orchard'),
            });
            return;
          }

          // Store PMS data in isolated keys — Default mode's trackensureData/orchardData untouched
          await chrome.storage.local.set({ pmsRawTasks: tasks, pmsRawSchedules: schedules });
          pmsTrySendAggregateReport();
          logToPopup('PMS', `Готово: TE ${tasks.length} / Orchard ${schedules.length}`, 200);
          sendResponse({ ok: true, site1Total: tasks.length, site2Total: schedules.length });
        } catch (err) {
          console.error('[FETCH_PMS_DATA] помилка:', err);
          sendResponse({ ok: false, error: err?.message || 'Помилка зчитування' });
        }
      })();
      return true;
    }

    case 'EXPORT_PMS_REPORT': {
      (async () => {
        try {
          await handlePmsStartExport(message.payload);
          sendResponse({ ok: true });
        } catch (err) {
          console.error('[ЕКСПОРТ КРИТИЧНА ПОМИЛКА] PMS:', err);
          chrome.runtime.sendMessage({ action: 'PMS_EXPORT_COMPLETED', error: err.message });
          sendResponse({ ok: false, error: err.message, status: 'Error' });
        }
      })();
      return true;
    }

    case 'EXPORT_PROD_REPORT': {
      (async () => {
        try {
          await handleProdStartExport(message.payload);
          sendResponse({ ok: true });
        } catch (err) {
          console.error('[ЕКСПОРТ КРИТИЧНА ПОМИЛКА] PROD:', err);
          chrome.runtime.sendMessage({ action: 'PMS_EXPORT_COMPLETED', error: err.message });
          sendResponse({ ok: false, error: err.message, status: 'Error' });
        }
      })();
      return true;
    }

    case 'CLEAR_PMS_DATA': {
      chrome.storage.local.remove(['pmsRawTasks', 'pmsRawSchedules', 'pmsMissingAgents', 'pmsPendingBatchData']);
      sendResponse({ ok: true });
      return false;
    }

    case 'STOP_PMS_FETCH': {
      pmsStopRequested = true;
      logToPopup('PMS', 'Зупинено користувачем', null);
      sendResponse({ ok: true });
      return false;
    }

    case 'EXECUTE_PMS_SHEETS_BATCH': {
      (async () => {
        try {
          const { sheetId, token } = message.payload || {};
          const stored = await chrome.storage.local.get(['pmsPendingBatchData']);
          const batchUpdateData = stored.pmsPendingBatchData;

          if (!Array.isArray(batchUpdateData) || !batchUpdateData.length) {
            sendResponse({ ok: false, error: 'Немає даних для запису (pmsPendingBatchData порожній)' });
            return;
          }

          console.log('[EXECUTE_PMS_SHEETS_BATCH] Записую', batchUpdateData.length, 'діапазонів');
          const resp = await executeSheetsBatch({ sheetId, token, batchUpdateData });
          await chrome.storage.local.remove(['pmsMissingAgents', 'pmsPendingBatchData']);
          chrome.runtime.sendMessage({ action: 'PMS_EXPORT_COMPLETED' });
          sendResponse({ ok: true, result: resp });
        } catch (err) {
          console.error('[EXECUTE_PMS_SHEETS_BATCH] помилка:', err);
          chrome.runtime.sendMessage({ action: 'PMS_EXPORT_COMPLETED', error: err?.message });
          sendResponse({ ok: false, error: err?.message || 'Помилка запису в Sheets' });
        }
      })();
      return true;
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

// ── PMS export — exact clone of handleStartExport, reads from pms* storage keys ──────────────────
async function handlePmsStartExport(payload) {
  const token = payload?.token;
  if (!token) throw new Error('Не отримано токен!');

  // Read PMS data and settings from isolated storage keys
  const stored = await chrome.storage.local.get([
    'pmsRawTasks', 'pmsRawSchedules',
    'pmsDateFrom', 'pmsDateTo', 'pmsOrchardOffset', 'pmsIncludeCancel5', 'pmsIncludeShift20', 'pmsSelectedTLs',
  ]);

  const tasks     = stored.pmsRawTasks     || [];
  const schedules = stored.pmsRawSchedules || [];
  if (!tasks.length || !schedules.length) {
    throw new Error('Немає PMS даних. Спочатку запустіть зчитування.');
  }

  const orchardOffset  = Number(stored.pmsOrchardOffset  ?? payload.orchardOffset  ?? 2);
  const includeCancel5 = stored.pmsIncludeCancel5 !== false;
  const includeShift20 = stored.pmsIncludeShift20 !== false;
  const selectedTLs    = stored.pmsSelectedTLs  || payload.selectedTLs || [];
  const timezone       = payload.timezone || 'Europe/Kyiv';
  const tlCache        = (await readFromStorage(STORAGE_USERS_KEY)) || [];
  const pmsDateFrom    = stored.pmsDateFrom || payload.dateFrom;
  const baseDateFromMs = pmsDateFrom ? convertDateTimeToMs(pmsDateFrom, orchardOffset) : null;

  // Fetch work hours for "L" marker — same as handleGetTsvMatrix
  let agentWorkHoursCache = {};
  try {
    const orchardToken = await ensureOrchardToken();
    if (orchardToken) {
      const uniqueAgentIds = new Set();
      schedules.forEach((entry) => {
        const agId = entry?.agentDTO?.userId || entry?.agentDTO?.agentId || entry?.agentId;
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
    console.error('[PMS EXPORT] Work hours error (non-fatal):', e);
  }

  // Build matrix — pms clone of Default mode function
  const rows = pmsBuildSheetMatrix(tasks, schedules, tlCache, {
    includeCancel5, includeShift20, selectedTLs, timezone, orchardOffset,
    baseDateFromMs, agentWorkHoursCache,
  });

  if (!rows || rows.length <= 1) {
    throw new Error('Матриця порожня — перевірте дані або налаштування PMS');
  }

  // Infer month/year from PMS data — pms clone of Default mode function
  const monthYear = pmsInferMonthYear(null, null, tasks, schedules);

  // Read and validate the sheet — pms clone of Default mode approach
  const sheetValues = await fetchSheetValuesBg(payload.sheetId, token);
  const { updates: batchData, missingAgents } = pmsMapMatrixToUpdatesBg(rows, sheetValues, monthYear, orchardOffset);

  // ── DEBUG: Фінальний payload для рядків 13-33 (перші 4 агенти) ──────────────
  {
    const targetRows = Array.from({ length: 21 }, (_, i) => i + 13);
    const debugPayload = batchData.filter((item) => {
      const match = item.range.match(/\d+$/);
      return match ? targetRows.includes(parseInt(match[0], 10)) : false;
    });
    console.log(`[ФІНАЛЬНИЙ ПЕЙЛОАД] Всього записів для рядків 13-33:`, debugPayload.length);
    if (debugPayload.length > 0) {
      console.log(`[ФІНАЛЬНИЙ ПЕЙЛОАД] Деталі (перші 20):`, JSON.stringify(debugPayload.slice(0, 20), null, 2));
    } else {
      console.log(`[ФІНАЛЬНИЙ ПЕЙЛОАД] ❌ Жодного запису для рядків 13-33. Всього в batchData:`, batchData.length, '| Відсутні агенти:', missingAgents.length, missingAgents);
      console.log(`[ФІНАЛЬНИЙ ПЕЙЛОАД] Всі унікальні рядки в batchData:`, [...new Set(batchData.map(i => { const m = i.range.match(/\d+$/); return m ? parseInt(m[0]) : '?'; }))].sort((a,b)=>a-b));
    }

    const rangeCounts = {};
    batchData.forEach((item) => {
      if (!rangeCounts[item.range]) rangeCounts[item.range] = [];
      rangeCounts[item.range].push(item.values[0][0]);
    });
    const overwriteIssues = Object.entries(rangeCounts)
      .filter(([, vals]) => vals.length > 1)
      .map(([range, values]) => ({ range, values }));
    if (overwriteIssues.length > 0) {
      console.log(`[КРИТИЧНО] Знайдено дублікати діапазонів! Клітинки перезаписуються:`, overwriteIssues);
    } else {
      console.log(`[ФІНАЛЬНИЙ ПЕЙЛОАД] Дублікатів діапазонів не знайдено.`);
    }

    const zeroOrEmpty = batchData.filter((item) => {
      const v = item.values?.[0]?.[0];
      return v === '' || v === 0 || v === '0' || v == null;
    });
    if (zeroOrEmpty.length > 0) {
      console.log(`[ФІНАЛЬНИЙ ПЕЙЛОАД] ⚠️ Знайдено ${zeroOrEmpty.length} записів з нульовим/порожнім значенням:`, JSON.stringify(zeroOrEmpty.slice(0, 10), null, 2));
    }
  }
  // ─────────────────────────────────────────────────────────────────────────────

  if (!batchData.length && !missingAgents.length) {
    throw new Error('Відсутні дані для запису — перевірте, чи правильний місяць у рядку 2 таблиці');
  }

  if (missingAgents.length > 0) {
    // Same missing-agents flow as Default mode, but uses pms* keys
    await chrome.storage.local.set({ pmsMissingAgents: missingAgents, pmsPendingBatchData: batchData });
    chrome.runtime.sendMessage({ action: 'PMS_EXPORT_COMPLETED' });
    return;
  }

  await executeSheetsBatch({ sheetId: payload.sheetId, token, batchUpdateData: batchData });
  chrome.runtime.sendMessage({ action: 'PMS_EXPORT_COMPLETED' });

  try {
    chrome.notifications.create({
      type: 'basic', iconUrl: 'assets/icon128.png',
      title: 'PMS Експорт завершено',
      message: `Записано ${batchData.length} оновлень у Google Таблицю!`,
    });
  } catch { /* non-fatal */ }
}

async function handleProdStartExport(payload) {
  console.log('[PROD.MOD] Починаю експорт...');

  const token = payload?.token;
  if (!token) throw new Error('Не отримано токен!');

  const stored = await chrome.storage.local.get([
    'pmsRawTasks', 'pmsRawSchedules',
    'pmsDateFrom', 'pmsOrchardOffset', 'pmsIncludeCancel5', 'pmsIncludeShift20', 'pmsSelectedTLs',
  ]);

  const tasks     = stored.pmsRawTasks     || [];
  const schedules = stored.pmsRawSchedules || [];
  console.log('[PROD.MOD] Завантажено з storage: tasks =', tasks.length, ', schedules =', schedules.length);
  if (!tasks.length || !schedules.length) {
    throw new Error('Немає PMS даних. Спочатку запустіть зчитування.');
  }

  const orchardOffset  = Number(stored.pmsOrchardOffset  ?? payload.orchardOffset  ?? 2);
  const includeCancel5 = stored.pmsIncludeCancel5 !== false;
  const includeShift20 = stored.pmsIncludeShift20 !== false;
  const selectedTLs    = stored.pmsSelectedTLs  || payload.selectedTLs || [];
  const timezone       = payload.timezone || 'Europe/Kyiv';
  const tlCache        = (await readFromStorage(STORAGE_USERS_KEY)) || [];
  const pmsDateFrom    = stored.pmsDateFrom || payload.dateFrom;
  const pmsDateTo      = stored.pmsDateTo   || payload.dateTo;
  const baseDateFromMs = pmsDateFrom ? convertDateTimeToMs(pmsDateFrom, orchardOffset) : null;

  console.log('[PROD.MOD] Будую матрицю (pmsBuildSheetMatrix)...');
  const rows = pmsBuildSheetMatrix(tasks, schedules, tlCache, {
    includeCancel5, includeShift20, selectedTLs, timezone, orchardOffset,
    baseDateFromMs, agentWorkHoursCache: {},
  });
  console.log('[PROD.MOD] Матриця побудована, рядків:', rows?.length ?? 0);

  if (!rows || rows.length <= 1) {
    throw new Error('Матриця порожня — перевірте дані або налаштування PMS');
  }

  console.log('[PROD.MOD] Зчитую лист Productivity для карти рядків...');
  const prodSheetValues = await fetchSheetValuesBg(payload.sheetId, token, 'Productivity!A:A');
  const prodRowCount = prodSheetValues?.values?.length ?? 0;
  console.log('[PROD.MOD] Карта рядків побудована, знайдено рядків у Productivity:', prodRowCount);

  // ── Збираємо рейти агентів з Orchard ─────────────────────────────────────────
  // TODO: тимчасово вимкнено
  // const rateMap = {};
  // ...
  // ─────────────────────────────────────────────────────────────────────────────

  // ── Збираємо відпрацьований час (Total Hours) з Orchard ──────────────────────
  console.log('[PROD.MOD] Збираю відпрацьований час агентів...');
  const wkDateFromMs = baseDateFromMs;

  // Fallback: якщо pmsDateTo не збережено (старий fetch), реконструюємо кінець місяця
  let wkDateToMs = pmsDateTo
    ? convertDateTimeToMs(pmsDateTo.includes('T') ? pmsDateTo : `${pmsDateTo}T23:59`, orchardOffset)
    : null;
  if (!wkDateToMs && wkDateFromMs) {
    const d = new Date(wkDateFromMs + orchardOffset * 3600000); // локальний час
    const endOfMonth = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0, 23, 59, 0));
    wkDateToMs = endOfMonth.getTime() - orchardOffset * 3600000;
    console.log('[PROD WORK HOURS] pmsDateTo відсутній — реконструйовано кінець місяця:', new Date(wkDateToMs).toISOString());
  }

  // workHoursMap: agentName → totalHours; після збору інжектуємо у PMS_TIME rows матриці
  const workHoursMap = {};

  if (wkDateFromMs && wkDateToMs) {
    console.log('[PROD WORK HOURS] Дати запиту:', new Date(wkDateFromMs).toISOString(), '→', new Date(wkDateToMs).toISOString());
    try {
      const orchardToken = await ensureOrchardToken();
      if (orchardToken) {
        const orchardHeaders = {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          Authorization: `Bearer ${orchardToken}`,
        };
        const seenIds = new Set();
        for (const entry of schedules) {
          const agentId   = entry?.agentDTO?.userId || entry?.agentDTO?.agentId || entry?.agentId || entry?.candidateId;
          const agentName = entry?.agentDTO?.fullName || entry?.agentName;
          if (!agentId || !agentName || seenIds.has(agentId)) continue;
          seenIds.add(agentId);

          const isDebugAgent = agentName.includes('Anastasiia') || agentName.includes('Artem');
          const reqPayload = { agentId, cutOff: true, dateFrom: wkDateFromMs, dateTo: wkDateToMs };
          if (isDebugAgent) {
            console.log(`\n[DEBUG WORK HOURS] === Агент: ${agentName} ===`);
            console.log('[DEBUG WORK HOURS] Payload:', reqPayload);
          }

          try {
            const res = await fetch('https://orchard22.com/api/calendar/work-hour/list-by-filter', {
              method: 'POST',
              credentials: 'include',
              headers: orchardHeaders,
              body: JSON.stringify(reqPayload),
            });

            if (isDebugAgent) {
              console.log(`[DEBUG WORK HOURS] Response status: ${res.status} ${res.statusText}`);
            }

            if (res.ok) {
              const data = await res.json();
              let totalMs = 0;
              if (Array.isArray(data)) data.forEach((item) => { totalMs += Number(item.workTimeMs) || 0; });
              const totalHours = Math.round((totalMs / 3600000) * 100) / 100;
              workHoursMap[agentName] = totalHours;

              if (isDebugAgent) {
                console.log(`[DEBUG WORK HOURS] Знайдено записів: ${Array.isArray(data) ? data.length : 0}`);
                console.log(`[DEBUG WORK HOURS] Сума totalMs: ${totalMs}`);
                console.log(`[DEBUG WORK HOURS] Фінальні Total Hours: ${totalHours}\n`);
              }
            } else {
              const errText = await res.text().catch(() => '');
              console.error(`[DEBUG WORK HOURS ERROR] Server error для ${agentName} (${res.status}):`, errText);
              workHoursMap[agentName] = 0;
            }
          } catch (err) {
            console.error(`[DEBUG WORK HOURS ERROR] Fetch failed для ${agentName}:`, err);
            workHoursMap[agentName] = 0;
          }
        }
      }
    } catch (e) {
      console.warn('[PROD WORK HOURS] Не вдалося отримати токен Orchard:', e);
    }
  } else {
    console.warn('[PROD WORK HOURS] Відсутні дати — пропускаємо збір відпрацьованого часу');
  }
  console.log('[PROD.MOD] Відпрацьований час зібрано для', Object.keys(workHoursMap).length, 'агентів');

  // Інжектуємо prodTotalHours у PMS_TIME rows матриці як row[11]
  // Це усуває потребу в map-лукапі по імені в exportProdToSheets
  {
    let injectAgent = null;
    for (const row of rows) {
      const label = String(row[0] || '');
      if (label.startsWith('PMS_MAIN:')) { injectAgent = label.slice('PMS_MAIN:'.length); continue; }
      if (label === 'PMS_TIME:' && injectAgent) {
        row[11] = workHoursMap[injectAgent] ?? 0;
        injectAgent = null;
      }
    }
  }
  // ─────────────────────────────────────────────────────────────────────────────

  console.log('[PROD.MOD] Викликаю exportProdToSheets...');
  const { notFoundAgents, updatesCount } = await exportProdToSheets({
    token,
    spreadsheetId: payload.sheetId,
    matrixRows: rows,
    prodSheetValues,
    // rateMap,  // TODO: тимчасово вимкнено
  });
  console.log('[PROD.MOD] Експорт завершено успішно! Оновлень:', updatesCount, '| Не знайдено:', notFoundAgents);

  chrome.runtime.sendMessage({ action: 'PMS_EXPORT_COMPLETED' });

  try {
    const notFoundMsg = notFoundAgents.length > 0 ? ` (не знайдено: ${notFoundAgents.join(', ')})` : '';
    chrome.notifications.create({
      type: 'basic', iconUrl: 'assets/icon128.png',
      title: 'Prod.Mod Експорт завершено',
      message: `Записано ${updatesCount} оновлень у лист Productivity!${notFoundMsg}`,
    });
  } catch { /* non-fatal */ }
}

function pmsTrySendAggregateReport() {
  chrome.storage.local.get(
    ['pmsRawTasks', 'pmsRawSchedules', STORAGE_USERS_KEY, 'pmsTLIds', 'pmsIncludeCancel5', 'pmsIncludeShift20', 'pmsOrchardOffset'],
    (data) => {
      const tasks     = data.pmsRawTasks     || [];
      const schedules = data.pmsRawSchedules || [];
      if (!tasks.length || !schedules.length) return;

      const tlCache = data?.[STORAGE_USERS_KEY] || [];
      const options = {
        includeCancel5: data?.pmsIncludeCancel5 !== false,
        includeShift20: data?.pmsIncludeShift20 !== false,
        selectedTLs:    data?.pmsTLIds          || [],
        orchardOffset:  Number(data?.pmsOrchardOffset ?? 2),
      };
      const { agentMessage, tlMessage } = pmsAggregateData(tasks, schedules, tlCache, options);
      if (agentMessage) {
        chrome.runtime.sendMessage({ type: 'LOG', site: 'PMS', message: agentMessage, code: 200 });
      }
      if (tlMessage) {
        chrome.runtime.sendMessage({ type: 'LOG', site: 'PMS', message: tlMessage, code: 200 });
      }
    }
  );
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
