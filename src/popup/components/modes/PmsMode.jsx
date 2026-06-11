import React, { useEffect, useRef, useState } from 'react';
import { getSheetsAccessToken } from '../../sheetsApi.js';
import DefaultMode from './DefaultMode.jsx';

export default function PmsMode() {
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [sheetId, setSheetId] = useState('');
  const [status, setStatus] = useState({ site1: null, site2: null, merge: null });
  const [isLoadingFetch, setIsLoadingFetch] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [canInsert, setCanInsert] = useState(false);
  const [missingAgentsList, setMissingAgentsList] = useState([]);
  const [pendingBatchData, setPendingBatchData] = useState([]);
  const [sheetToken, setSheetToken] = useState('');
  const [fetchBytes, setFetchBytes] = useState({ site1: 0, site2: 0 });
  const [activeFetchSite, setActiveFetchSite] = useState(null);
  const [fetchError, setFetchError] = useState('');
  const [needsTabs, setNeedsTabs] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const [isProdMod, setIsProdMod] = useState(false);
  const [prodMonth, setProdMonth] = useState(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  });
  const exportTimeoutRef = useRef(null);

  useEffect(() => {
    chrome.storage.local.get(
      ['pmsDateFrom', 'pmsDateTo', 'pmsSheetId', 'pmsMissingAgents', 'pmsPendingBatchData', 'pmsFetchInProgress', 'pmsStatus', 'pmsProdMod', 'pmsProdMonth'],
      (data) => {
        if (data.pmsDateFrom) setDateFrom(data.pmsDateFrom);
        if (data.pmsDateTo) setDateTo(data.pmsDateTo);
        if (data.pmsSheetId) setSheetId(data.pmsSheetId);
        if (Array.isArray(data.pmsMissingAgents)) setMissingAgentsList(data.pmsMissingAgents);
        if (Array.isArray(data.pmsPendingBatchData)) setPendingBatchData(data.pmsPendingBatchData);
        if (data.pmsFetchInProgress) setIsLoadingFetch(true);
        if (data.pmsStatus) setStatus(data.pmsStatus);
        if (data.pmsProdMod !== undefined) setIsProdMod(Boolean(data.pmsProdMod));
        if (data.pmsProdMonth) setProdMonth(data.pmsProdMonth);
        setHydrated(true);
      }
    );
  }, []);

  useEffect(() => { if (hydrated) chrome.storage.local.set({ pmsDateFrom: dateFrom }); }, [dateFrom, hydrated]);
  useEffect(() => { if (hydrated) chrome.storage.local.set({ pmsDateTo: dateTo }); }, [dateTo, hydrated]);
  useEffect(() => { if (hydrated) chrome.storage.local.set({ pmsSheetId: sheetId }); }, [sheetId, hydrated]);
  useEffect(() => { if (hydrated) chrome.storage.local.set({ pmsFetchInProgress: isLoadingFetch }); }, [isLoadingFetch, hydrated]);
  useEffect(() => { if (hydrated) chrome.storage.local.set({ pmsStatus: status }); }, [status, hydrated]);
  useEffect(() => { if (hydrated) chrome.storage.local.set({ pmsProdMod: isProdMod }); }, [isProdMod, hydrated]);
  useEffect(() => { if (hydrated) chrome.storage.local.set({ pmsProdMonth: prodMonth }); }, [prodMonth, hydrated]);

  useEffect(() => {
    const ready = status.site1 === true && status.site2 === true;
    setCanInsert(ready);
    if (ready) setStatus((prev) => ({ ...prev, merge: true }));
  }, [status.site1, status.site2]);

  useEffect(() => {
    const listener = (changes, area) => {
      if (area !== 'local') return;
      if ('pmsMissingAgents' in changes) setMissingAgentsList(changes.pmsMissingAgents?.newValue || []);
      if ('pmsPendingBatchData' in changes) setPendingBatchData(changes.pmsPendingBatchData?.newValue || []);
    };
    chrome.storage.onChanged.addListener(listener);
    return () => chrome.storage.onChanged.removeListener(listener);
  }, []);

  useEffect(() => {
    const handleMessages = (msg) => {
      if (msg?.action === 'PMS_EXPORT_COMPLETED') {
        if (exportTimeoutRef.current) {
          clearTimeout(exportTimeoutRef.current);
          exportTimeoutRef.current = null;
        }
        setIsExporting(false);
      }
      if (msg?.type === 'FETCH_PROGRESS') {
        const { site, totalBytes = 0 } = msg;
        if (site === 'site1') setFetchBytes((prev) => ({ ...prev, site1: Math.max(prev.site1, totalBytes) }));
        if (site === 'site2') setFetchBytes((prev) => ({ ...prev, site2: Math.max(prev.site2, totalBytes) }));
      }
      if (msg?.type === 'PMS_PHASE') {
        if (msg.phase === 'te_start')      setActiveFetchSite('site1');
        if (msg.phase === 'orchard_start') setActiveFetchSite('site2');
        if (msg.phase === 'te_done')       setStatus((p) => ({ ...p, site1: true }));
        if (msg.phase === 'te_error')      setStatus((p) => ({ ...p, site1: false }));
        if (msg.phase === 'orchard_done')  setStatus((p) => ({ ...p, site2: true }));
        if (msg.phase === 'orchard_error') setStatus((p) => ({ ...p, site2: false }));
      }
    };
    chrome.runtime.onMessage.addListener(handleMessages);
    return () => chrome.runtime.onMessage.removeListener(handleMessages);
  }, []);

  const computeFetchDates = () => {
    if (!isProdMod || !prodMonth) return { finalDateFrom: dateFrom, finalDateTo: dateTo };
    const [yearStr, monthStr] = prodMonth.split('-');
    const year = Number(yearStr);
    const month = Number(monthStr);
    const startDate = new Date(year, month - 1, 1, 0, 0);
    const endDate   = new Date(year, month, 0, 23, 59); // day 0 of next month = last day of current month
    const pad = (n) => String(n).padStart(2, '0');
    const fmt = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
    return { finalDateFrom: fmt(startDate), finalDateTo: fmt(endDate) };
  };

  const handleFetchData = () => {
    setFetchBytes({ site1: 0, site2: 0 });
    setIsLoadingFetch(true);
    setCanInsert(false);
    setFetchError('');
    setNeedsTabs(false);
    setStatus({ site1: null, site2: null, merge: null });

    const { finalDateFrom, finalDateTo } = computeFetchDates();

    chrome.storage.local.get(
      ['pmsTagId', 'pmsTeamId', 'pmsTLIds', 'pmsApiRangeOffset', 'pmsOrchardOffset', 'pmsIncludeCancel5', 'pmsIncludeShift20'],
      (settings) => {
        chrome.runtime.sendMessage(
          {
            type: 'FETCH_PMS_DATA',
            payload: {
              tagId:  settings.pmsTagId,
              teamId: settings.pmsTeamId,
              tlIds:  settings.pmsTLIds || [],
              dateFrom: finalDateFrom || undefined,
              dateTo:   finalDateTo   || undefined,
              apiRangeOffset: settings.pmsApiRangeOffset ?? 2,
              orchardOffset:  settings.pmsOrchardOffset  ?? 2,
              includeCancel5: settings.pmsIncludeCancel5 !== false,
              includeShift20: settings.pmsIncludeShift20 !== false,
            },
          },
          (response) => {
            setActiveFetchSite(null);
            setIsLoadingFetch(false);
            if (chrome.runtime.lastError) {
              const msg = chrome.runtime.lastError.message || "Помилка зв'язку";
              setFetchError(msg);
              return;
            }
            if (!response?.ok) {
              const msg = response?.error || 'Помилка збору';
              setFetchError(msg);
              setNeedsTabs(Boolean(response?.needsTabs));
            }
          }
        );
      }
    );
  };

  const handleStopDefault = () => {
    chrome.runtime.sendMessage({ type: 'STOP_PMS_FETCH' });
    setIsLoadingFetch(false);
    setActiveFetchSite(null);
    setStatus((p) => ({
      site1: p.site1 === null ? false : p.site1,
      site2: p.site2 === null ? false : p.site2,
      merge: null,
    }));
  };

  const handleExportToSheets = async () => {
    if (!sheetId) return;
    if (!canInsert) return;
    setIsExporting(true);

    try {
      let token = sheetToken;
      if (!token) {
        token = await getSheetsAccessToken();
        setSheetToken(token);
      }

      const exportAction = isProdMod ? 'EXPORT_PROD_REPORT' : 'EXPORT_PMS_REPORT';
      chrome.runtime.sendMessage({
        action: exportAction,
        type: exportAction,
        payload: { sheetId, token },
      });

      exportTimeoutRef.current = setTimeout(() => {
        exportTimeoutRef.current = null;
        setIsExporting(false);
        setMissingAgentsList([]);
        setPendingBatchData([]);
      }, 120000);
    } catch (err) {
      setIsExporting(false);
    }
  };

  const handleConfirmMissing = () => {
    if (!pendingBatchData || !pendingBatchData.length) return;
    setIsExporting(true);

    let settled = false;
    const timeoutId = setTimeout(() => {
      if (settled) return;
      settled = true;
      setIsExporting(false);
      setMissingAgentsList([]);
      setPendingBatchData([]);
    }, 120000);

    chrome.runtime.sendMessage(
      {
        type: 'EXECUTE_PMS_SHEETS_BATCH',
        action: 'EXECUTE_PMS_SHEETS_BATCH',
        payload: { sheetId, token: sheetToken },
      },
      (response) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeoutId);
        setIsExporting(false);
        setMissingAgentsList([]);
        setPendingBatchData([]);
      }
    );
  };

  const handleCancelMissing = () => {
    setMissingAgentsList([]);
    setPendingBatchData([]);
    setIsExporting(false);
  };

  const handleClear = () => {
    setStatus({ site1: null, site2: null, merge: null });
    setCanInsert(false);
    setIsExporting(false);
    setMissingAgentsList([]);
    setPendingBatchData([]);
    chrome.storage.local.set({ pmsStatus: null, pmsProdMod: false });
    chrome.runtime.sendMessage({ type: 'CLEAR_PMS_DATA' });
  };

  return (
    <DefaultMode
      dateFrom={dateFrom}
      setDateFrom={setDateFrom}
      dateTo={dateTo}
      setDateTo={setDateTo}
      status={status}
      onFetch={handleFetchData}
      onStop={handleStopDefault}
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
      fetchError={fetchError}
      needsTabs={needsTabs}
      isProdMod={isProdMod}
      onToggleProdMod={() => setIsProdMod((v) => !v)}
      prodMonth={prodMonth}
      onProdMonthChange={setProdMonth}
    />
  );
}
