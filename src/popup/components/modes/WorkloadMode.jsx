import React, { useState, useEffect } from 'react';
import { Download, X, Loader2, Table as TableIcon, Bug } from 'lucide-react';
import { getSheetsAccessToken } from '../../sheetsApi.js';

const SHIFT_TAGS = [
  { id: 482304, label: 'MORNING SHIFT' },
  { id: 482305, label: 'MAIN SHIFT' },
  { id: 482306, label: 'NIGHT SHIFT' },
];

function formatBytes(b) {
  if (!b) return '';
  if (b < 1024) return `${b} B`;
  if (b < 1048576) return `${(b / 1024).toFixed(1)} KB`;
  return `${(b / 1048576).toFixed(2)} MB`;
}

function StatusItem({ label, status, bytes }) {
  const dot =
    status === 'loading' ? 'bg-blue-400 animate-pulse'
    : status === 'done'  ? 'bg-green-500'
    : status === 'error' ? 'bg-red-500'
    : 'bg-gray-300';
  const txt =
    status === 'done'  ? 'text-green-700'
    : status === 'error' ? 'text-red-600'
    : 'text-gray-600';
  return (
    <div className="flex items-center justify-between text-[11px]">
      <div className="flex items-center gap-1.5">
        <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${dot}`} />
        <span className={txt}>{label}</span>
      </div>
      {bytes > 0 && <span className="font-mono text-gray-400 text-[10px]">{formatBytes(bytes)}</span>}
    </div>
  );
}

export default function WorkloadMode() {
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [selectedTagIds, setSelectedTagIds] = useState([482304, 482305, 482306]);
  const [sheetId, setSheetId] = useState('');

  const [analyzeCalls, setAnalyzeCalls] = useState(true);

  const [isFetching, setIsFetching] = useState(false);
  const [fetchError, setFetchError] = useState('');
  const [stats, setStats] = useState([]);

  const [teStatus,     setTeStatus]     = useState('idle');
  const [callsStatus,  setCallsStatus]  = useState('idle');
  const [orchardStatus, setOrchardStatus] = useState('idle');
  const [teBytes,      setTeBytes]      = useState(0);
  const [callsBytes,   setCallsBytes]   = useState(0);
  const [orchardBytes, setOrchardBytes] = useState(0);

  const [isExporting, setIsExporting] = useState(false);
  const [exportError, setExportError] = useState('');
  const [exportSuccess, setExportSuccess] = useState('');

  const [showDebug, setShowDebug] = useState(false);
  const [debugDate, setDebugDate] = useState('');
  const [debugShift, setDebugShift] = useState('Night Shift');

  useEffect(() => {
    chrome.storage.local.get(['wlDateFrom', 'wlDateTo', 'wlSelectedTagIds', 'wlSheetId', 'wlStats', 'wlAnalyzeCalls'], (data) => {
      if (data.wlDateFrom) setDateFrom(data.wlDateFrom);
      if (data.wlDateTo) setDateTo(data.wlDateTo);
      if (Array.isArray(data.wlSelectedTagIds) && data.wlSelectedTagIds.length) setSelectedTagIds(data.wlSelectedTagIds);
      if (data.wlSheetId) setSheetId(data.wlSheetId);
      if (Array.isArray(data.wlStats) && data.wlStats.length) setStats(data.wlStats);
      if (data.wlAnalyzeCalls !== undefined) setAnalyzeCalls(data.wlAnalyzeCalls !== false);
    });

    const listener = (msg) => {
      if (msg?.type === 'FETCH_PROGRESS') {
        if (msg.site === 'wl_te')      setTeBytes((p)      => Math.max(p, msg.totalBytes || 0));
        if (msg.site === 'wl_calls')   setCallsBytes((p)   => Math.max(p, msg.totalBytes || 0));
        if (msg.site === 'wl_orchard') setOrchardBytes((p) => Math.max(p, msg.totalBytes || 0));
      }
      if (msg?.type === 'WORKLOAD_PHASE') {
        switch (msg.phase) {
          case 'te_start':      setTeStatus('loading');      break;
          case 'te_done':       setTeStatus('done');         break;
          case 'te_error':      setTeStatus('error');        break;
          case 'calls_start':   setCallsStatus('loading');   break;
          case 'calls_done':    setCallsStatus('done');      break;
          case 'calls_error':   setCallsStatus('error');     break;
          case 'orchard_start': setOrchardStatus('loading'); break;
          case 'orchard_done':  setOrchardStatus('done');    break;
          case 'orchard_error': setOrchardStatus('error');   break;
        }
      }
    };
    chrome.runtime.onMessage.addListener(listener);
    return () => chrome.runtime.onMessage.removeListener(listener);
  }, []);

  const saveDateFrom = (v) => { setDateFrom(v); chrome.storage.local.set({ wlDateFrom: v }); };
  const saveDateTo   = (v) => { setDateTo(v);   chrome.storage.local.set({ wlDateTo: v }); };
  const saveSheetId  = (v) => { setSheetId(v);  chrome.storage.local.set({ wlSheetId: v }); };

  const toggleTag = (id) => {
    const next = selectedTagIds.includes(id) ? selectedTagIds.filter(t => t !== id) : [...selectedTagIds, id];
    setSelectedTagIds(next);
    chrome.storage.local.set({ wlSelectedTagIds: next });
  };

  const handleFetch = () => {
    if (!dateFrom || !dateTo) { setFetchError('Вкажіть діапазон дат'); return; }
    if (!selectedTagIds.length) { setFetchError('Оберіть хоча б один Shift Tag'); return; }
    setFetchError('');
    setExportError('');
    setExportSuccess('');
    setStats([]);
    setIsFetching(true);
    setTeStatus('idle'); setCallsStatus('idle'); setOrchardStatus('idle');
    setTeBytes(0); setCallsBytes(0); setOrchardBytes(0);

    chrome.runtime.sendMessage(
      { type: 'FETCH_WORKLOAD_DATA', payload: { dateFrom, dateTo, shiftTagIds: selectedTagIds } },
      (response) => {
        setIsFetching(false);
        if (chrome.runtime.lastError) {
          setFetchError(chrome.runtime.lastError.message || "Помилка зв'язку");
          setTeStatus(s => s === 'loading' ? 'error' : s);
          setCallsStatus(s => s === 'loading' ? 'error' : s);
          setOrchardStatus(s => s === 'loading' ? 'error' : s);
          return;
        }
        if (!response?.ok) { setFetchError(response?.error || 'Помилка зчитування'); return; }
        const rows = response.stats || [];
        setStats(rows);
        if (!rows.length) setFetchError('Дані зчитано, але не знайдено записів');
      }
    );
  };

  const handleStop = () => {
    chrome.runtime.sendMessage({ type: 'STOP_WORKLOAD_FETCH' });
    setIsFetching(false);
    setTeStatus(s => s === 'loading' ? 'error' : s);
    setCallsStatus(s => s === 'loading' ? 'error' : s);
    setOrchardStatus(s => s === 'loading' ? 'error' : s);
    setFetchError('Зупинено користувачем');
  };

  const handleClear = () => {
    setStats([]);
    setFetchError('');
    setExportError('');
    setExportSuccess('');
    setTeStatus('idle'); setCallsStatus('idle'); setOrchardStatus('idle');
    setTeBytes(0); setCallsBytes(0); setOrchardBytes(0);
    chrome.runtime.sendMessage({ type: 'CLEAR_WORKLOAD_DATA' });
  };

  const handleExport = async () => {
    if (!sheetId) { setExportError('Вкажіть ID Google Таблиці'); return; }
    setExportError('');
    setExportSuccess('');
    setIsExporting(true);
    try {
      const token = await getSheetsAccessToken();
      const fromStr = dateFrom ? new Date(dateFrom.slice(0, 10) + 'T12:00:00Z').toLocaleDateString('uk-UA', { day: '2-digit', month: '2-digit' }) : '';
      const toStr   = dateTo   ? new Date(dateTo.slice(0, 10)   + 'T12:00:00Z').toLocaleDateString('uk-UA', { day: '2-digit', month: '2-digit' }) : '';
      const sheetTitle = fromStr && toStr ? `Workload ${fromStr}-${toStr}` : 'Workload Report';

      chrome.runtime.sendMessage(
        { type: 'EXPORT_WORKLOAD_REPORT', payload: { sheetId, token, sheetTitle } },
        (response) => {
          setIsExporting(false);
          if (chrome.runtime.lastError) { setExportError(chrome.runtime.lastError.message || "Помилка зв'язку"); return; }
          if (!response?.ok) { setExportError(response?.error || 'Помилка експорту'); return; }
          setExportSuccess(`Готово! Записано ${response.rowCount ?? 0} рядків.`);
        }
      );
    } catch (err) {
      setIsExporting(false);
      setExportError('Помилка авторизації: ' + err.message);
    }
  };

  const showStatus = teStatus !== 'idle' || orchardStatus !== 'idle' || (analyzeCalls && callsStatus !== 'idle');
  const canExport  = stats.length > 0 && !isFetching;

  return (
    <div className="space-y-3">

      {/* Date + time range */}
      <div className="space-y-2">
        <div className="space-y-1">
          <label className="block text-xs font-medium text-gray-700">Початок (дата і час)</label>
          <input type="datetime-local" value={dateFrom} onChange={e => saveDateFrom(e.target.value)}
            className="w-full px-2.5 py-1.5 border border-gray-300 rounded-md shadow-sm text-xs focus:outline-none focus:ring-2 focus:ring-blue-500" />
        </div>
        <div className="space-y-1">
          <label className="block text-xs font-medium text-gray-700">Кінець (дата і час)</label>
          <input type="datetime-local" value={dateTo} onChange={e => saveDateTo(e.target.value)}
            className="w-full px-2.5 py-1.5 border border-gray-300 rounded-md shadow-sm text-xs focus:outline-none focus:ring-2 focus:ring-blue-500" />
        </div>
      </div>

      {/* Shift Tags */}
      <div className="space-y-1.5">
        <label className="block text-xs font-medium text-gray-700">Shift Tags</label>
        <div className="space-y-1">
          {SHIFT_TAGS.map(({ id, label }) => {
            const checked = selectedTagIds.includes(id);
            return (
              <label key={id} className={`flex items-center gap-2 px-2.5 py-1.5 rounded-md border cursor-pointer transition-colors ${checked ? 'border-blue-400 bg-blue-50' : 'border-gray-200 bg-gray-50 hover:border-blue-200 hover:bg-blue-50/40'}`}>
                <input type="checkbox" checked={checked} onChange={() => toggleTag(id)}
                  className="w-3.5 h-3.5 rounded border-gray-300 text-blue-500 focus:ring-blue-400" />
                <span className="text-xs text-gray-800 font-medium">{label}</span>
                <span className="ml-auto text-[10px] text-gray-400 font-mono">{id}</span>
              </label>
            );
          })}
        </div>
      </div>

      {/* Calls analysis toggle */}
      <label className="flex items-center gap-2 cursor-pointer select-none">
        <input
          type="checkbox"
          checked={analyzeCalls}
          onChange={e => {
            setAnalyzeCalls(e.target.checked);
            chrome.storage.local.set({ wlAnalyzeCalls: e.target.checked });
          }}
          className="w-3.5 h-3.5 rounded border-gray-300 text-blue-500 focus:ring-blue-400"
        />
        <span className="text-xs text-gray-700 font-medium">Аналізувати телефонію (Пікові години)</span>
      </label>

      {/* Sheet ID */}
      <div className="space-y-1">
        <label className="block text-xs font-medium text-gray-700">ID Google Таблиці</label>
        <input type="text" value={sheetId} onChange={e => saveSheetId(e.target.value.trim())}
          placeholder="Наприклад: 1A2B3C..."
          className="w-full px-2.5 py-1.5 border border-gray-300 rounded-md shadow-sm text-xs focus:outline-none focus:ring-2 focus:ring-blue-500" />
      </div>

      {/* Fetch phase status indicators */}
      {showStatus && (
        <div className="border border-gray-100 rounded-lg p-2.5 bg-gray-50 space-y-1.5">
          <StatusItem label="TrackEnsure — Shift Tasks"      status={teStatus}      bytes={teBytes} />
          {analyzeCalls && (
            <StatusItem label="TrackEnsure — Дзвінки"        status={callsStatus}   bytes={callsBytes} />
          )}
          <StatusItem label="Orchard22 — Розклади та Години" status={orchardStatus} bytes={orchardBytes} />
        </div>
      )}

      {/* Messages */}
      {fetchError && (
        <div className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-md px-2.5 py-1.5">{fetchError}</div>
      )}
      {exportError && (
        <div className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-md px-2.5 py-1.5">{exportError}</div>
      )}
      {exportSuccess && (
        <div className="text-xs text-green-700 bg-green-50 border border-green-200 rounded-md px-2.5 py-1.5">{exportSuccess}</div>
      )}

      {/* Action buttons */}
      <div className="flex gap-2">
        <button type="button" onClick={handleFetch} disabled={isFetching || !dateFrom || !dateTo}
          className="flex-1 flex items-center justify-center gap-1.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-60 disabled:cursor-not-allowed text-white px-3 py-1.5 rounded-md text-xs font-medium transition-colors">
          {isFetching ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-4 h-4" />}
          {isFetching ? 'Зчитування...' : 'Зчитати'}
        </button>
        {isFetching ? (
          <button type="button" onClick={handleStop}
            className="flex-1 flex items-center justify-center gap-1.5 bg-red-600 hover:bg-red-700 text-white px-3 py-1.5 rounded-md text-xs font-medium transition-colors">
            <X className="w-4 h-4" /> Зупинити
          </button>
        ) : (
          <button type="button" onClick={handleClear} disabled={!stats.length && !showStatus}
            className="flex-1 flex items-center justify-center gap-1.5 bg-gray-200 hover:bg-gray-300 disabled:opacity-40 disabled:cursor-not-allowed text-gray-700 px-3 py-1.5 rounded-md text-xs font-medium transition-colors">
            Очистити
          </button>
        )}
      </div>

      {/* Export + Debug buttons — shown when stats are ready */}
      {canExport && !isExporting && (
        <div className="flex gap-2">
          <button type="button" onClick={handleExport} disabled={!sheetId}
            className="flex-1 flex items-center justify-center gap-1.5 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-60 disabled:cursor-not-allowed text-white px-3 py-1.5 rounded-md text-xs font-medium transition-colors">
            <TableIcon className="w-4 h-4" /> Експортувати в Sheets
          </button>
          <button type="button"
            onClick={() => { setDebugDate(stats[0]?.date || ''); setShowDebug(true); }}
            className="flex items-center justify-center gap-1 bg-slate-100 hover:bg-slate-200 text-slate-700 px-2.5 py-1.5 rounded-md text-xs font-medium transition-colors"
            title="Дебаг даних">
            <Bug className="w-3.5 h-3.5" /> Дебаг
          </button>
        </div>
      )}
      {isExporting && (
        <div className="flex items-center justify-center gap-2 text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-md px-2.5 py-1.5">
          <Loader2 className="w-3.5 h-3.5 animate-spin" /> Запис у таблицю...
        </div>
      )}

      {/* Debug modal */}
      {showDebug && (
        <div className="fixed inset-0 z-50 flex flex-col bg-white">
          <div className="flex items-center justify-between px-3 py-2 bg-slate-900 text-white flex-shrink-0">
            <span className="text-xs font-semibold">Дебаг даних</span>
            <button onClick={() => setShowDebug(false)} className="text-slate-300 hover:text-white">
              <X className="w-4 h-4" />
            </button>
          </div>
          <div className="flex gap-2 p-2 border-b border-gray-100 flex-shrink-0">
            <select value={debugDate} onChange={e => setDebugDate(e.target.value)}
              className="flex-1 px-2 py-1.5 border border-gray-300 rounded text-xs focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white">
              {[...new Set(stats.map(r => r.date))].sort().map(d => (
                <option key={d} value={d}>{d}</option>
              ))}
            </select>
            <select value={debugShift} onChange={e => setDebugShift(e.target.value)}
              className="flex-1 px-2 py-1.5 border border-gray-300 rounded text-xs focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white">
              {['Morning Shift', 'Main Shift', 'Night Shift'].map(s => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </div>
          <div className="flex-1 overflow-y-auto divide-y divide-gray-100">
            {(() => {
              const row = stats.find(r => r.date === debugDate && r.shiftName === debugShift);
              if (!row?.details) return (
                <div className="px-3 py-4 text-xs text-gray-400 text-center">Немає даних для вибраного рядка.</div>
              );
              const { scheduledAgents, scheduledTLs, absentAgents, absentTLs, extraAgents } = row.details;
              const sections = [
                { title: 'Заплановані Агенти', items: scheduledAgents, hCls: 'bg-blue-50 text-blue-800' },
                { title: 'Заплановані TL',     items: scheduledTLs,    hCls: 'bg-indigo-50 text-indigo-800' },
                { title: 'Відсутні Агенти',    items: absentAgents,    hCls: 'bg-red-50 text-red-800' },
                { title: 'Відсутні TL',        items: absentTLs,       hCls: 'bg-orange-50 text-orange-800' },
                { title: 'Екстра',             items: extraAgents,     hCls: 'bg-green-50 text-green-800' },
              ];
              return sections.map(({ title, items, hCls }) => (
                <div key={title}>
                  <div className={`px-3 py-1.5 flex justify-between items-center ${hCls}`}>
                    <span className="text-[11px] font-semibold">{title}</span>
                    <span className="text-[10px] font-mono opacity-60">({items.length})</span>
                  </div>
                  <div className="divide-y divide-gray-50">
                    {items.length === 0
                      ? <div className="px-3 py-1 text-[11px] text-gray-400 italic">—</div>
                      : items.map((name, i) => (
                          <div key={i} className="px-3 py-1 text-[11px] text-gray-700">{name}</div>
                        ))
                    }
                  </div>
                </div>
              ));
            })()}
          </div>
        </div>
      )}

      {/* Preview table */}
      {stats.length > 0 && (
        <div className="border border-gray-100 rounded-lg overflow-hidden">
          <div className="overflow-x-auto overflow-y-auto max-h-52">
            <table className="w-full text-[10px] border-collapse min-w-max">
              <thead className="sticky top-0">
                <tr className="bg-blue-50">
                  {['Дата','Зміна','Тасків','TL','Агенти','Відсут. TL','Відсут. Аг.','Екстра','Пік (дзвінки)','Очік.'].map(h => (
                    <th key={h} className="px-1.5 py-1 text-left font-semibold text-gray-700 border border-gray-200 whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {stats.map((row, i) => (
                  <tr key={i} className={i % 2 === 0 ? 'bg-white' : 'bg-gray-50/60'}>
                    <td className="px-1.5 py-0.5 border border-gray-200 font-mono whitespace-nowrap">{row.date}</td>
                    <td className="px-1.5 py-0.5 border border-gray-200 whitespace-nowrap">{row.shiftName}</td>
                    <td className="px-1.5 py-0.5 border border-gray-200 text-center">{row.taskCount}</td>
                    <td className="px-1.5 py-0.5 border border-gray-200 text-center">{row.tlCount}</td>
                    <td className="px-1.5 py-0.5 border border-gray-200 text-center">{row.agentCount}</td>
                    <td className={`px-1.5 py-0.5 border border-gray-200 text-center ${(row.absentTlCount ?? 0) > 0 ? 'text-red-600 font-medium' : ''}`}>{row.absentTlCount ?? 0}</td>
                    <td className={`px-1.5 py-0.5 border border-gray-200 text-center ${(row.absentAgentCount ?? 0) > 0 ? 'text-red-600 font-medium' : ''}`}>{row.absentAgentCount ?? 0}</td>
                    <td className={`px-1.5 py-0.5 border border-gray-200 text-center ${(row.extraCount ?? 0) > 0 ? 'text-blue-600 font-medium' : ''}`}>{row.extraCount ?? 0}</td>
                    <td className="px-1.5 py-0.5 border border-gray-200 font-mono whitespace-nowrap text-orange-700">{row.peakHourDisplay}</td>
                    <td className="px-1.5 py-0.5 border border-gray-200 font-mono whitespace-nowrap">{row.peakWaitDisplay}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="px-2 py-1 bg-gray-50 border-t border-gray-100 text-[10px] text-gray-400">
            {stats.length} рядків · Прокрутіть для перегляду
          </div>
        </div>
      )}
    </div>
  );
}
