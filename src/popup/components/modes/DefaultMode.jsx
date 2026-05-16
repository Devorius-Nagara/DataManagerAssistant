import React from 'react';
import { Download, Trash2, Loader2, Table as TableIcon, AlertTriangle } from 'lucide-react';
import StatusItem from '../StatusItem.jsx';

export default function DefaultMode({
  dateFrom,
  setDateFrom,
  dateTo,
  setDateTo,
  status,
  onFetch,
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
}) {
  return (
    <div className="space-y-3">
      <div className="space-y-1">
        <label className="block text-xs font-medium text-gray-700">Дата та час ВІД</label>
        <input
          type="datetime-local"
          value={dateFrom}
          onChange={(e) => setDateFrom(e.target.value)}
          className="w-full px-2.5 py-1.5 border border-gray-300 rounded-md shadow-sm text-xs focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
        />
      </div>

      <div className="space-y-1">
        <label className="block text-xs font-medium text-gray-700">Дата та час ДО</label>
        <input
          type="datetime-local"
          value={dateTo}
          onChange={(e) => setDateTo(e.target.value)}
          className="w-full px-2.5 py-1.5 border border-gray-300 rounded-md shadow-sm text-xs focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
        />
      </div>

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
          {isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />} {isLoading ? 'Зчитування...' : 'Зчитати'}
        </button>
        <button
          onClick={onClear}
          className="flex-1 flex items-center justify-center gap-1.5 bg-gray-100 hover:bg-gray-200 text-gray-700 px-3 py-1.5 rounded-md text-xs font-medium transition-colors border border-gray-300"
        >
          <Trash2 className="w-4 h-4" /> Очистити
        </button>
      </div>

      <div className="space-y-2 pt-3 border-t border-gray-100">
        <StatusItem label="TrackEnsure" state={status.site1} successText="Скопійовано" errorText="Помилка" pendingText="Не скопійовано" />
        <StatusItem label="Orchard" state={status.site2} successText="Скопійовано" errorText="Помилка" pendingText="Не скопійовано" />
        {missingAgents && missingAgents.length > 0 ? (
          <div className="border border-amber-300 bg-amber-50 text-amber-800 rounded-md p-2 space-y-1.5">
            <div className="flex items-center gap-1.5 text-xs font-semibold">
              <AlertTriangle className="w-4 h-4" /> Наступних агентів не знайдено у таблиці:
            </div>
            <div className="text-xs break-words">{missingAgents.join(', ')}</div>
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
          </div>
        ) : (
          canInsert && (
            <button
              onClick={onInsert}
              disabled={isInserting || !sheetId}
              className="w-full inline-flex items-center justify-center gap-1.5 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-60 disabled:cursor-not-allowed text-white px-3 py-1.5 rounded-md text-xs font-medium transition-colors"
            >
              {isInserting ? <Loader2 className="w-4 h-4 animate-spin" /> : <TableIcon className="w-4 h-4" />} {isInserting ? 'Експортуємо...' : 'Експортувати в Sheets'}
            </button>
          )
        )}
      </div>
    </div>
  );
}
