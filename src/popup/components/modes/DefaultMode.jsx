import React, { useEffect, useState } from 'react';
import { Download, Trash2, Table as TableIcon, AlertTriangle, X, Loader2, Info } from 'lucide-react';

function formatBytes(b) {
  if (!b) return '';
  if (b < 1024) return `${b} B`;
  if (b < 1048576) return `${(b / 1024).toFixed(1)} KB`;
  return `${(b / 1048576).toFixed(2)} MB`;
}

function FetchStatusItem({ label, status, bytes }) {
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

function ExportProgressBar({ label }) {
  const [pct, setPct] = useState(0);
  const [phase, setPhase] = useState('filling');

  useEffect(() => {
    const startTime = Date.now();
    const PHASE1_MS = 20000;
    const TARGET = 85;
    const id = setInterval(() => {
      const t = Math.min((Date.now() - startTime) / PHASE1_MS, 1);
      setPct((1 - Math.pow(1 - t, 3)) * TARGET);
      if (t >= 1) { clearInterval(id); setPhase('waiting'); }
    }, 80);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="w-full space-y-1.5 py-0.5">
      <div className="w-full bg-gray-200 rounded-full h-2 overflow-hidden">
        <div
          className={`h-full bg-emerald-500 rounded-full transition-all duration-300 ease-out${phase === 'waiting' ? ' animate-pulse' : ''}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <p className="text-center text-[10px] text-gray-500 leading-tight">
        {phase === 'filling' ? (label || 'Записую в таблицю...') : 'Очікую відповіді від Google...'}
      </p>
    </div>
  );
}

export default function DefaultMode({
  dateFrom,
  setDateFrom,
  dateTo,
  setDateTo,
  status,
  onFetch,
  onStop,
  onClear,
  isLoading,
  canInsert,
  onInsert,
  isInserting,
  sheetId,
  setSheetId,
  missingAgents,
  onConfirmMissing,
  onCancelMissing,
  isFetchingTrackensure,
  isFetchingOrchard,
  site1FetchBytes,
  site2FetchBytes,
  fetchError,
  needsTabs,
  isProdMod = false,
  onToggleProdMod,
  prodMonth,
  onProdMonthChange,
}) {
  const teStatus      = isFetchingTrackensure ? 'loading' : status.site1 === true ? 'done' : status.site1 === false ? 'error' : 'idle';
  const orchardStatus = isFetchingOrchard     ? 'loading' : status.site2 === true ? 'done' : status.site2 === false ? 'error' : 'idle';
  const showStatus    = isLoading || teStatus !== 'idle' || orchardStatus !== 'idle';

  return (
    <div className="space-y-3">
      <div className="space-y-1">
        <div className="flex items-center justify-between">
          <label className="block text-xs font-medium text-gray-700">
            {isProdMod ? 'Місяць' : 'Дата та час ВІД'}
          </label>
          {onToggleProdMod && (
            <button
              onClick={onToggleProdMod}
              className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border transition-colors ${
                isProdMod
                  ? 'bg-emerald-100 text-emerald-700 border-emerald-300 hover:bg-emerald-200'
                  : 'bg-gray-100 text-gray-500 border-gray-200 hover:bg-gray-200'
              }`}
            >
              Prod.Mod
            </button>
          )}
        </div>
        {isProdMod ? (
          <input
            type="month"
            value={prodMonth || ''}
            onChange={(e) => onProdMonthChange?.(e.target.value)}
            className="w-full px-2.5 py-1.5 border border-gray-300 rounded-md shadow-sm text-xs focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
          />
        ) : (
          <input
            type="datetime-local"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
            className="w-full px-2.5 py-1.5 border border-gray-300 rounded-md shadow-sm text-xs focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
          />
        )}
      </div>

      {!isProdMod && (
        <div className="space-y-1">
          <label className="block text-xs font-medium text-gray-700">Дата та час ДО</label>
          <input
            type="datetime-local"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
            className="w-full px-2.5 py-1.5 border border-gray-300 rounded-md shadow-sm text-xs focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
          />
        </div>
      )}

      <div className="space-y-1">
        <label className="block text-xs font-medium text-gray-700">ID Google Таблиці</label>
        <input
          type="text"
          value={sheetId}
          onChange={(e) => setSheetId(e.target.value.trim())}
          placeholder="Наприклад: 1A2B3C..."
          className="w-full px-2.5 py-1.5 border border-gray-300 rounded-md shadow-sm text-xs focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
        />
      </div>

      <div className="flex gap-2">
        <button
          onClick={onFetch}
          disabled={isLoading}
          className="flex-1 flex items-center justify-center gap-1.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-60 disabled:cursor-not-allowed text-white px-3 py-1.5 rounded-md text-xs font-medium transition-colors"
        >
          {isLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-4 h-4" />}
          {isLoading ? 'Зчитування...' : 'Зчитати'}
        </button>
        {isLoading ? (
          <button
            onClick={onStop}
            className="flex-1 flex items-center justify-center gap-1.5 bg-red-600 hover:bg-red-700 text-white px-3 py-1.5 rounded-md text-xs font-medium transition-colors"
          >
            <X className="w-4 h-4" /> Зупинити
          </button>
        ) : (
          <button
            onClick={onClear}
            className="flex-1 flex items-center justify-center gap-1.5 bg-gray-100 hover:bg-gray-200 text-gray-700 px-3 py-1.5 rounded-md text-xs font-medium transition-colors border border-gray-300"
          >
            <Trash2 className="w-4 h-4" /> Очистити
          </button>
        )}
      </div>

      {needsTabs && fetchError && (
        <div className="flex items-start gap-2 bg-amber-50 border border-amber-300 text-amber-800 rounded-md px-2.5 py-2">
          <Info className="w-4 h-4 shrink-0 mt-0.5" />
          <p className="text-xs leading-snug">{fetchError}</p>
        </div>
      )}
      {!needsTabs && fetchError && (
        <div className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-md px-2.5 py-1.5">{fetchError}</div>
      )}

      {showStatus && (
        <div className="border border-gray-100 rounded-lg p-2.5 bg-gray-50 space-y-1.5">
          <FetchStatusItem label="TrackEnsure" status={teStatus}      bytes={site1FetchBytes} />
          <FetchStatusItem label="Orchard"     status={orchardStatus} bytes={site2FetchBytes} />
        </div>
      )}

      {!isLoading && missingAgents && missingAgents.length > 0 ? (
        <div className="border border-amber-300 bg-amber-50 text-amber-800 rounded-md p-2 space-y-1.5">
          <div className="flex items-center gap-1.5 text-xs font-semibold">
            <AlertTriangle className="w-4 h-4" /> Наступних агентів не знайдено у таблиці:
          </div>
          <div className="text-xs break-words">{missingAgents.join(', ')}</div>
          {isInserting ? (
            <ExportProgressBar label="Записую без пропущених агентів..." />
          ) : (
            <div className="flex gap-1.5">
              <button
                onClick={onConfirmMissing}
                className="flex-1 inline-flex items-center justify-center gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white px-2.5 py-1.5 rounded-md text-xs font-medium"
              >
                Продовжити без них
              </button>
              <button
                onClick={onCancelMissing}
                className="flex-1 inline-flex items-center justify-center gap-1.5 bg-gray-100 hover:bg-gray-200 text-gray-800 px-2.5 py-1.5 rounded-md text-xs font-medium border"
              >
                Скасувати
              </button>
            </div>
          )}
        </div>
      ) : (
        canInsert && !isLoading && (
          isInserting ? (
            <ExportProgressBar />
          ) : (
            <button
              onClick={onInsert}
              disabled={!sheetId}
              className="w-full inline-flex items-center justify-center gap-1.5 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-60 disabled:cursor-not-allowed text-white px-3 py-1.5 rounded-md text-xs font-medium transition-colors"
            >
              <TableIcon className="w-4 h-4" /> Експортувати в Sheets
            </button>
          )
        )
      )}
    </div>
  );
}
