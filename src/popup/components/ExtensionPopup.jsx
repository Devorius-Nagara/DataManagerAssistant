import React, { useEffect, useRef, useState } from 'react';
import { Settings, Home, FileText, CheckCircle, LogOut } from 'lucide-react';
import { getSheetsAccessToken } from '../sheetsApi.js';
import DefaultMode from './modes/DefaultMode.jsx';
import ShiftStatisticMode from './modes/ShiftStatisticMode.jsx';
import WorkloadMode from './modes/WorkloadMode.jsx';
import CustomReportsMode from './modes/CustomReportsMode.jsx';
import DefaultSettings from './modes/DefaultSettings.jsx';
import ShiftStatisticSettings from './modes/ShiftStatisticSettings.jsx';
import WorkloadSettings from './modes/WorkloadSettings.jsx';
import CustomReportsSettings from './modes/CustomReportsSettings.jsx';
import LogsTab from './LogsTab.jsx';

export default function ExtensionPopup() {
  const [activeTab, setActiveTab] = useState('main');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [timezone, setTimezone] = useState('Europe/Kyiv');
  const [status, setStatus] = useState({ site1: null, site2: null, merge: null });
  const [settings, setSettings] = useState({ site1Tag: '.data-row', site2Tag: '#table-content tr' });
  const [trackensureTags, setTrackensureTags] = useState([]);
  const [selectedTagId, setSelectedTagId] = useState(null);
  const [loadingTags, setLoadingTags] = useState(false);
  const [logs, setLogs] = useState([
    { id: 1, time: new Date().toLocaleTimeString(), site: 'Система', message: 'Розширення запущено', code: null },
  ]);
  const [orchardTeams, setOrchardTeams] = useState([]);
  const [trackensureUsers, setTrackensureUsers] = useState([]);
  const [selectedTeamId, setSelectedTeamId] = useState(null);
  const [selectedTLs, setSelectedTLs] = useState([]);
  const [loadingOrchardTeams, setLoadingOrchardTeams] = useState(false);
  const [loadingTrackUsers, setLoadingTrackUsers] = useState(false);
  const [trackensureSearch, setTrackensureSearch] = useState('');
  const [orchardSearch, setOrchardSearch] = useState('');
  const [tlSearch, setTlSearch] = useState('');
  const [hydrated, setHydrated] = useState(false);
  const [isLoadingFetch, setIsLoadingFetch] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [canInsert, setCanInsert] = useState(false);
  const [savedHint, setSavedHint] = useState('');
  const [includeCancel5, setIncludeCancel5] = useState(true);
  const [includeShift20, setIncludeShift20] = useState(true);
  const [sheetId, setSheetId] = useState('');
  const [missingAgentsList, setMissingAgentsList] = useState([]);
  const [pendingBatchData, setPendingBatchData] = useState([]);
  const [sheetToken, setSheetToken] = useState('');
  const [apiRangeOffset, setApiRangeOffset] = useState(2);
  const [trackensureOffset, setTrackensureOffset] = useState(2);
  const [orchardOffset, setOrchardOffset] = useState(2);
  const [debugCalibrationData, setDebugCalibrationData] = useState(null);
  const [appMode, setAppMode] = useState('default');
  const [isAuth, setIsAuth] = useState(true);
  const [isInitializing, setIsInitializing] = useState(true);
  const [fetchBytes, setFetchBytes] = useState({ site1: 0, site2: 0 });
  const [activeFetchSite, setActiveFetchSite] = useState(null);
  const exportTimeoutRef = useRef(null);

  const handleLogout = () => {
    chrome.runtime.sendMessage({ type: 'LOGOUT' });
    setIsAuth(false);
  };

  const showSaved = (msg = 'Збережено') => {
    setSavedHint(msg);
    setTimeout(() => setSavedHint(''), 1500);
  };

  useEffect(() => {
    chrome.storage.local.get(
      [
        'popupDateFrom',
        'popupDateTo',
        'popupTimezone',
        'popupStatus',
        'popupSettings',
        'popupLogs',
        'trackensureTagId',
        'popupActiveTab',
        'orchardTeamId',
        'trackensureSearch',
        'orchardSearch',
        'selectedTrackensureTLs',
        'tlSearch',
        'fetchInProgress',
        'includeCancel5',
        'includeShift20',
        'sheetId',
        'missingAgentsList',
        'pendingBatchData',
        'apiRangeOffset',
        'trackensureOffset',
        'orchardOffset',
        'debugCalibrationData',
        'appMode',
      ],
      (data) => {
        if (data?.fetchInProgress) setIsLoadingFetch(true);
        setDateFrom(data?.popupDateFrom || '');
        setDateTo(data?.popupDateTo || '');
        if (data?.popupTimezone) setTimezone(data.popupTimezone);
        setStatus(data?.popupStatus ?? { site1: null, site2: null, merge: null });
        setSettings({ ...settings, ...(data?.popupSettings || {}) });
        setLogs(Array.isArray(data?.popupLogs) && data.popupLogs.length > 0 ? data.popupLogs : logs);
        if (data?.trackensureTagId !== undefined) setSelectedTagId(Number(data.trackensureTagId));
        if (data?.orchardTeamId !== undefined) setSelectedTeamId(Number(data.orchardTeamId));
        if (data?.popupActiveTab) setActiveTab(data.popupActiveTab);
        if (data?.trackensureSearch !== undefined) setTrackensureSearch(data.trackensureSearch);
        if (data?.orchardSearch !== undefined) setOrchardSearch(data.orchardSearch);
        if (Array.isArray(data?.selectedTrackensureTLs)) setSelectedTLs(data.selectedTrackensureTLs);
        if (data?.tlSearch !== undefined) setTlSearch(data.tlSearch);
        if (data?.includeCancel5 !== undefined) setIncludeCancel5(Boolean(data.includeCancel5));
        if (data?.includeShift20 !== undefined) setIncludeShift20(Boolean(data.includeShift20));
        if (data?.sheetId) setSheetId(data.sheetId);
        if (Array.isArray(data?.missingAgentsList)) setMissingAgentsList(data.missingAgentsList);
        if (Array.isArray(data?.pendingBatchData)) setPendingBatchData(data.pendingBatchData);
        if (data?.apiRangeOffset !== undefined) setApiRangeOffset(Number(data.apiRangeOffset));
        else setApiRangeOffset(2);
        if (data?.trackensureOffset !== undefined) setTrackensureOffset(Number(data.trackensureOffset));
        else setTrackensureOffset(2);
        if (data?.orchardOffset !== undefined) setOrchardOffset(Number(data.orchardOffset));
        else setOrchardOffset(2);
        if (data?.debugCalibrationData) setDebugCalibrationData(data.debugCalibrationData);
        if (data?.appMode) setAppMode(data.appMode);
        setHydrated(true);
        setIsInitializing(false);
      }
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    chrome.storage.local.set({ popupDateFrom: dateFrom });
  }, [dateFrom, hydrated]);

  useEffect(() => {
    if (!hydrated) return;
    chrome.storage.local.set({ popupDateTo: dateTo });
  }, [dateTo, hydrated]);

  useEffect(() => {
    if (!hydrated) return;
    chrome.storage.local.set({ popupTimezone: timezone });
  }, [timezone, hydrated]);

  useEffect(() => {
    const listener = (changes, area) => {
      if (area !== 'local') return;
      if (changes.debugCalibrationData?.newValue !== undefined) {
        setDebugCalibrationData(changes.debugCalibrationData.newValue);
      }
      if ('missingAgentsList' in changes) {
        setMissingAgentsList(changes.missingAgentsList?.newValue || []);
      }
      if ('pendingBatchData' in changes) {
        setPendingBatchData(changes.pendingBatchData?.newValue || []);
      }
    };
    chrome.storage.onChanged.addListener(listener);
    return () => chrome.storage.onChanged.removeListener(listener);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    chrome.storage.local.set({ popupStatus: status });
  }, [status, hydrated]);

  useEffect(() => {
    if (!hydrated) return;
    chrome.storage.local.set({ popupSettings: settings });
  }, [settings, hydrated]);

  useEffect(() => {
    if (!hydrated) return;
    chrome.storage.local.set({ popupLogs: logs });
  }, [logs, hydrated]);

  useEffect(() => {
    if (!hydrated) return;
    chrome.storage.local.set({ trackensureTagId: selectedTagId });
  }, [selectedTagId, hydrated]);

  useEffect(() => {
    if (!hydrated) return;
    chrome.storage.local.set({ orchardTeamId: selectedTeamId });
  }, [selectedTeamId, hydrated]);

  useEffect(() => {
    if (!hydrated) return;
    chrome.storage.local.set({ selectedTrackensureTLs: selectedTLs });
  }, [selectedTLs, hydrated]);

  useEffect(() => {
    if (!hydrated) return;
    chrome.storage.local.set({ popupActiveTab: activeTab });
  }, [activeTab, hydrated]);

  useEffect(() => {
    if (!hydrated) return;
    chrome.storage.local.set({ trackensureSearch });
  }, [trackensureSearch, hydrated]);

  useEffect(() => {
    if (!hydrated) return;
    chrome.storage.local.set({ orchardSearch });
  }, [orchardSearch, hydrated]);

  useEffect(() => {
    if (!hydrated) return;
    chrome.storage.local.set({ tlSearch });
  }, [tlSearch, hydrated]);

  useEffect(() => {
    if (!hydrated) return;
    chrome.storage.local.set({ fetchInProgress: isLoadingFetch });
  }, [isLoadingFetch, hydrated]);

  useEffect(() => {
    if (!hydrated) return;
    chrome.storage.local.set({ includeCancel5 });
  }, [includeCancel5, hydrated]);

  useEffect(() => {
    if (!hydrated) return;
    chrome.storage.local.set({ includeShift20 });
  }, [includeShift20, hydrated]);

  useEffect(() => {
    if (!hydrated) return;
    chrome.storage.local.set({ sheetId });
  }, [sheetId, hydrated]);

  useEffect(() => {
    if (!hydrated) return;
    chrome.storage.local.set({ missingAgentsList, pendingBatchData });
  }, [missingAgentsList, pendingBatchData, hydrated]);

  useEffect(() => {
    if (!hydrated) return;
    chrome.storage.local.set({ apiRangeOffset });
  }, [apiRangeOffset, hydrated]);

  useEffect(() => {
    if (!hydrated) return;
    chrome.storage.local.set({ appMode });
  }, [appMode, hydrated]);

  const handleModeChange = (newMode) => {
    setAppMode(newMode);
    chrome.storage.local.set({ appMode: newMode });
  };

  useEffect(() => {
    const ready = status.site1 === true && status.site2 === true;
    setCanInsert(ready);
    if (ready) setStatus((prev) => ({ ...prev, merge: true }));
  }, [status.site1, status.site2]);

  useEffect(() => {
    if (!hydrated) return;
    chrome.runtime.sendMessage({ type: 'GET_EXPORT_STATUS' }, (response) => {
      if (chrome.runtime.lastError || !response?.ok || !response.isActive) return;
      setIsExporting(true);
      const elapsed = response.startedAt ? Date.now() - response.startedAt : 0;
      const remaining = Math.max(5000, 120000 - elapsed);
      exportTimeoutRef.current = setTimeout(() => {
        exportTimeoutRef.current = null;
        setIsExporting(false);
        setMissingAgentsList([]);
        setPendingBatchData([]);
        addLog('Sheets', 'Попереднє очікування експорту завершено по таймауту. Перевірте таблицю.', 400);
      }, remaining);
    });
  }, [hydrated]);

  useEffect(() => {
    if (activeTab === 'settings') {
      chrome.storage.local.get(['debugCalibrationData'], (data) => {
        if (data?.debugCalibrationData) setDebugCalibrationData(data.debugCalibrationData);
      });
    }
  }, [activeTab]);

  useEffect(() => {
    const handleMessages = (msg) => {
      if (msg?.action === 'EXPORT_COMPLETED') {
        if (exportTimeoutRef.current) {
          clearTimeout(exportTimeoutRef.current);
          exportTimeoutRef.current = null;
        }
        setIsExporting(false);
        if (msg.error) {
          addLog('Sheets', msg.error, 500);
        }
      }
    };
    chrome.runtime.onMessage.addListener(handleMessages);
    return () => chrome.runtime.onMessage.removeListener(handleMessages);
  }, []);

  const addLog = (site, message, code) => {
    setLogs((prev) => [
      { id: Date.now(), time: new Date().toLocaleTimeString(), site, message, code },
      ...prev,
    ]);
  };

  useEffect(() => {
    const listener = (msg) => {
      if (msg?.type === 'COLLECT_PROGRESS' || msg?.type === 'LOG') {
        addLog(msg.site || 'Система', msg.message, msg.code);
      }
      if (msg?.type === 'FETCH_PROGRESS') {
        const { site, totalBytes = 0 } = msg;
        if (site === 'site1') setFetchBytes((prev) => ({ ...prev, site1: Math.max(prev.site1, totalBytes) }));
        if (site === 'site2') setFetchBytes((prev) => ({ ...prev, site2: Math.max(prev.site2, totalBytes) }));
      }
    };
    chrome.runtime.onMessage.addListener(listener);
    return () => chrome.runtime.onMessage.removeListener(listener);
  }, []);

  const loadTags = () => {
    setLoadingTags(true);
    addLog('Сайт 1', 'Завантаження тегів...', null);
    chrome.runtime.sendMessage({ type: 'GET_TRACKENSURE_TAGS' }, (response) => {
      setLoadingTags(false);
      if (chrome.runtime.lastError) {
        addLog('Сайт 1', chrome.runtime.lastError.message, 500);
        return;
      }
      if (!response?.ok) {
        addLog('Сайт 1', response?.error || 'Не вдалося отримати теги', 500);
        return;
      }
      const tags = response.tags || [];
      setTrackensureTags(tags);
      addLog('Сайт 1', `Отримано ${tags.length} тегів`, 200);
      showSaved();
    });
  };

  const loadOrchardTeams = () => {
    setLoadingOrchardTeams(true);
    addLog('Сайт 2', 'Завантаження команд...', null);
    chrome.runtime.sendMessage({ type: 'GET_ORCHARD_TEAMS' }, (response) => {
      setLoadingOrchardTeams(false);
      if (chrome.runtime.lastError) {
        addLog('Сайт 2', chrome.runtime.lastError.message, 500);
        return;
      }
      if (!response?.ok) {
        addLog('Сайт 2', response?.error || 'Не вдалося отримати команди', 500);
        return;
      }
      const teams = response.teams || [];
      setOrchardTeams(teams);
      addLog('Сайт 2', `Отримано ${teams.length} команд`, 200);
      showSaved();
    });
  };

  const loadTrackUsers = () => {
    setLoadingTrackUsers(true);
    addLog('Сайт 1', 'Завантаження TL...', null);
    chrome.runtime.sendMessage({ type: 'GET_TRACKENSURE_USERS' }, (response) => {
      setLoadingTrackUsers(false);
      if (chrome.runtime.lastError) {
        addLog('Сайт 1', chrome.runtime.lastError.message, 500);
        return;
      }
      if (!response?.ok) {
        addLog('Сайт 1', response?.error || 'Не вдалося отримати TL', 500);
        return;
      }
      const users = response.users || [];
      setTrackensureUsers(users);
      addLog('Сайт 1', `Отримано ${users.length} TL`, 200);
      showSaved();
    });
  };

  const handleSelectTag = (value) => {
    const parsed = value ? Number(value) : null;
    setSelectedTagId(parsed);
    chrome.storage.local.set({ trackensureTagId: parsed });
    setTrackensureSearch(tagsLookupName(parsed) || trackensureSearch);
    addLog('Сайт 1', parsed ? `Обрано тег ID ${parsed}` : 'Тег скинуто', null);
  };

  const handleSelectTeam = (value) => {
    const parsed = value ? Number(value) : null;
    setSelectedTeamId(parsed);
    chrome.storage.local.set({ orchardTeamId: parsed });
    setOrchardSearch(teamsLookupName(parsed) || orchardSearch);
    addLog('Сайт 2', parsed ? `Обрано команду ID ${parsed}` : 'Команду скинуто', null);
  };

  const tagsLookupName = (id) => trackensureTags.find((t) => t.tagId === id)?.tagName;
  const teamsLookupName = (id) => orchardTeams.find((t) => t.teamId === id)?.teamName;

  const handleFetchData = async () => {
    addLog('Система', 'Початок збору даних...', null);
    setFetchBytes({ site1: 0, site2: 0 });
    setIsLoadingFetch(true);
    setCanInsert(false);

    const [activeTabInfo] = await chrome.tabs.query({ active: true, currentWindow: true });
    const activeUrl = activeTabInfo?.url || '';
    const isSite1 = activeUrl.includes('trackensure.com');
    const isSite2 = activeUrl.includes('orchard22.com');

    if (!isSite1 && !isSite2) {
      addLog('Система', 'Відкрийте підтримуваний сайт для збору', 400);
      setIsLoadingFetch(false);
      return;
    }
    setActiveFetchSite(isSite1 ? 'site1' : 'site2');

    const storedTagId = await new Promise((resolve) => {
      chrome.storage.local.get(['trackensureTagId'], (data) => resolve(data.trackensureTagId));
    });
    const storedTeamId = await new Promise((resolve) => {
      chrome.storage.local.get(['orchardTeamId'], (data) => resolve(data.orchardTeamId));
    });
    const storedTLs = await new Promise((resolve) => {
      chrome.storage.local.get(['selectedTrackensureTLs'], (data) => resolve(data.selectedTrackensureTLs || []));
    });
    const tagId = storedTagId || selectedTagId;
    const teamId = storedTeamId || selectedTeamId;
    const tlIds = storedTLs.length ? storedTLs : selectedTLs;
    const dtFrom = dateFrom || undefined;
    const dtTo = dateTo || undefined;

    if (isSite1) {
      setStatus((prev) => ({ ...prev, site1: null }));
    }
    if (isSite2) {
      setStatus((prev) => ({ ...prev, site2: null }));
    }

    chrome.runtime.sendMessage(
      {
        type: 'START_FETCH_CONTEXT',
        payload: {
          tagId,
          teamId,
          tlIds,
          dateFrom: dtFrom,
          dateTo: dtTo,
          timezone,
          includeCancel5: Boolean(includeCancel5),
          includeShift20: Boolean(includeShift20),
          trackensureOffset,
          apiRangeOffset,
          orchardOffset,
        },
      },
      (response) => {
        setActiveFetchSite(null);
        if (chrome.runtime.lastError) {
          addLog('Система', chrome.runtime.lastError.message, 500);
          setStatus({ site1: false, site2: false, merge: null });
          setIsLoadingFetch(false);
          return;
        }
        if (!response?.ok) {
          addLog('Система', response?.error || 'Помилка збору', 500);
          setStatus((prev) => ({
            ...prev,
            site1: response?.site1 ?? prev.site1,
            site2: response?.site2 ?? prev.site2,
          }));
          setIsLoadingFetch(false);
          return;
        }
        const site = response.site;
        const total = response.total || 0;
        if (site === 'site1') setStatus((prev) => ({ ...prev, site1: true }));
        if (site === 'site2') setStatus((prev) => ({ ...prev, site2: true }));
        addLog(site === 'site1' ? 'Сайт 1' : 'Сайт 2', `Успішно зібрано ${total} записів`, 200);
        setIsLoadingFetch(false);
      }
    );
  };

  const handleExportToSheets = async () => {
    if (!sheetId) {
      addLog('Sheets', 'Вкажіть ID Google Таблиці', 400);
      return;
    }
    if (!canInsert) {
      addLog('Sheets', 'Немає готових даних для експорту', 400);
      return;
    }
    setIsExporting(true);
    addLog('Sheets', 'Запуск експорту в Google Sheets...', null);

    try {
      addLog('Sheets', 'Отримання авторизації Google...', null);
      let token = sheetToken;
      if (!token) {
        token = await getSheetsAccessToken();
        setSheetToken(token);
      }

      chrome.runtime.sendMessage(
        {
          action: 'START_EXPORT',
          type: 'START_EXPORT',
          payload: {
            sheetId,
            token, // Pass the token!
            timezone,
            orchardOffset,
            trackensureOffset,
            selectedTLs,
            includeCancel5: Boolean(includeCancel5),
            includeShift20: Boolean(includeShift20),
          }
        }
      );

      addLog('Sheets', 'Запит відправлено у бекграунд (Експорт розпочато).', 200);
    } catch (err) {
      setIsExporting(false);
      addLog('Sheets', 'Помилка авторизації: ' + err.message, 500);
    }
  };

  const handleConfirmMissing = () => {
    if (!pendingBatchData || !pendingBatchData.length) {
      addLog('Система', 'Дані для запису відсутні', 400);
      return;
    }

    setIsExporting(true);

    const closeModal = () => {
      setMissingAgentsList([]);
      setPendingBatchData([]);
    };

    let settled = false;
    const timeoutId = setTimeout(() => {
      if (settled) return;
      settled = true;
      setIsExporting(false);
      closeModal();
      addLog('Sheets', 'Перевищено час очікування від бекграунду (2 хв). Перевірте таблицю.', 500);
    }, 120000);

    chrome.runtime.sendMessage({
      type: 'EXECUTE_SHEETS_BATCH',
      action: 'EXECUTE_SHEETS_BATCH',
      payload: {
        sheetId,
        token: sheetToken,
        batchUpdateData: pendingBatchData,
      }
    }, (response) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutId);
      setIsExporting(false);
      closeModal();

      if (chrome.runtime.lastError) {
        addLog('Sheets', chrome.runtime.lastError.message || 'Помилка зв\'язку з бекграундом', 500);
        return;
      }
      if (response?.ok) {
        addLog('Sheets', 'Експорт завершено (деякі агенти пропущені)', 200);
      } else {
        addLog('Sheets', response?.error || 'Помилка виконання', 500);
      }
    });
  };

  const handleCancelMissing = () => {
    addLog('Sheets', 'Експорт скасовано користувачем', 400);
    setMissingAgentsList([]);
    setPendingBatchData([]);
    setIsExporting(false);
  };

  const handleClear = () => {
    setStatus((prev) => ({ ...prev, site1: null, site2: null, merge: null }));
    addLog('Система', 'Дані та статуси очищено', null);
    setCanInsert(false);
    setIsExporting(false);
    setMissingAgentsList([]);
    setPendingBatchData([]);
    chrome.runtime.sendMessage({ type: 'CLEAR_DATA' });
    showSaved('Очищено');
  };

  const handleClearLogs = () => {
    setLogs([]);
    chrome.storage.local.set({ popupLogs: [] });
    showSaved('Логи очищено');
  };

  if (isInitializing) {
    return <div className="w-[400px] h-[530px] bg-white" />;
  }

  return (
    <div className="w-[400px] h-[530px] bg-white flex flex-col font-sans text-gray-800 shadow-xl overflow-hidden">
      <div className="flex bg-slate-900 text-white p-1">
        <button
          onClick={() => setActiveTab('main')}
          className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 text-xs font-medium rounded-t-md transition-colors ${
            activeTab === 'main' ? 'bg-white text-slate-900' : 'hover:bg-slate-800 text-slate-300'
          }`}
        >
          <Home className="w-4 h-4" /> Мейн
        </button>
        <button
          onClick={() => setActiveTab('settings')}
          className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 text-xs font-medium rounded-t-md transition-colors ${
            activeTab === 'settings' ? 'bg-white text-slate-900' : 'hover:bg-slate-800 text-slate-300'
          }`}
        >
          <Settings className="w-4 h-4" /> Налаштування
        </button>
        <button
          onClick={() => setActiveTab('logs')}
          className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 text-xs font-medium rounded-t-md transition-colors ${
            activeTab === 'logs' ? 'bg-white text-slate-900' : 'hover:bg-slate-800 text-slate-300'
          }`}
        >
          <FileText className="w-4 h-4" /> Логи
        </button>
      </div>

      {savedHint && (
        <div className="absolute top-2 right-2 inline-flex items-center gap-1 bg-green-100 text-green-800 px-3 py-1 rounded-md text-xs shadow-sm animate-pulse">
          <CheckCircle className="w-4 h-4" /> {savedHint}
        </div>
      )}

      <div className="flex-1 overflow-y-auto p-3 bg-white">
        {activeTab === 'main' && (
          <div className="h-full">
            {appMode === 'default' && (
              <DefaultMode
                dateFrom={dateFrom}
                setDateFrom={setDateFrom}
                dateTo={dateTo}
                setDateTo={setDateTo}
                status={status}
                onFetch={handleFetchData}
                onClear={handleClear}
                isLoading={isLoadingFetch}
                canInsert={canInsert}
                onInsert={handleExportToSheets}
                isInserting={isExporting}
                sheetId={sheetId}
                setSheetId={setSheetId}
                missingAgents={missingAgentsList}
                onConfirmMissing={handleConfirmMissing}
                onCancelMissing={handleCancelMissing}
                isFetchingTrackensure={isLoadingFetch && activeFetchSite === 'site1'}
                isFetchingOrchard={isLoadingFetch && activeFetchSite === 'site2'}
                site1FetchBytes={fetchBytes.site1}
                site2FetchBytes={fetchBytes.site2}
              />
            )}
            {appMode === 'shift_statistic' && <ShiftStatisticMode />}
            {appMode === 'workload' && <WorkloadMode />}
            {appMode === 'custom_reports' && <CustomReportsMode />}
          </div>
        )}
        {activeTab === 'settings' && (
          <div className="flex flex-col h-full overflow-hidden">

            {/* 1. ФІКСОВАНА ШАПКА: Перемикач режимів (В один рядок) */}
            <div className="shrink-0 mb-2 pb-2 border-b border-gray-100 flex items-center justify-between">
              <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wide">
                Режим:
              </label>
              <select
                value={appMode}
                onChange={(e) => handleModeChange(e.target.value)}
                className="bg-transparent text-[11px] font-medium text-gray-600 border-none focus:ring-0 p-0 text-right cursor-pointer outline-none w-auto"
              >
                <option value="default">Default</option>
                <option value="shift_statistic">Shift statistic</option>
                <option value="workload">Workload</option>
                <option value="custom_reports">Custom Reports</option>
              </select>
            </div>

            {/* 2. СКРОЛ-ЗОНА: Динамічні налаштування */}
            <div className="flex-1 overflow-y-auto pr-1 pb-2">
              {appMode === 'default' && (
                <DefaultSettings
                  settings={settings}
                  setSettings={setSettings}
                  tags={trackensureTags}
                  loadingTags={loadingTags}
                  onLoadTags={loadTags}
                  selectedTagId={selectedTagId}
                  onSelectTag={handleSelectTag}
                  trackensureSearch={trackensureSearch}
                  setTrackensureSearch={setTrackensureSearch}
                  orchardTeams={orchardTeams}
                  loadingOrchardTeams={loadingOrchardTeams}
                  onLoadOrchardTeams={loadOrchardTeams}
                  selectedTeamId={selectedTeamId}
                  onSelectTeam={handleSelectTeam}
                  orchardSearch={orchardSearch}
                  setOrchardSearch={setOrchardSearch}
                  trackensureUsers={trackensureUsers}
                  loadingTrackUsers={loadingTrackUsers}
                  onLoadTrackUsers={loadTrackUsers}
                  selectedTLs={selectedTLs}
                  tlSearch={tlSearch}
                  setTlSearch={setTlSearch}
                  onSelectTLs={(vals) => {
                    setSelectedTLs(vals);
                    showSaved();
                  }}
                  includeCancel5={includeCancel5}
                  setIncludeCancel5={setIncludeCancel5}
                  includeShift20={includeShift20}
                  setIncludeShift20={setIncludeShift20}
                  apiRangeOffset={apiRangeOffset}
                  setApiRangeOffset={setApiRangeOffset}
                  trackensureOffset={trackensureOffset}
                  setTrackensureOffset={setTrackensureOffset}
                  orchardOffset={orchardOffset}
                  setOrchardOffset={setOrchardOffset}
                  debugCalibrationData={debugCalibrationData}
                />
              )}
              {appMode === 'shift_statistic' && <ShiftStatisticSettings />}
              {appMode === 'workload' && <WorkloadSettings />}
              {appMode === 'custom_reports' && <CustomReportsSettings />}
            </div>

            {/* 3. ФІКСОВАНИЙ ФУТЕР: Кнопка логауту (Ультра-компактна) */}
            <div className="shrink-0 pt-2 mt-2 border-t border-gray-100 flex justify-center">
              {isAuth && (
                <button
                  onClick={handleLogout}
                  className="flex items-center gap-1.5 text-[10px] font-medium text-gray-400 hover:text-red-500 transition-colors py-1 px-2 rounded hover:bg-red-50"
                >
                  <LogOut className="w-3 h-3" /> Вийти з акаунта
                </button>
              )}
            </div>

          </div>
        )}
        {activeTab === 'logs' && <LogsTab logs={logs} onClear={handleClearLogs} />}
      </div>
    </div>
  );
}




