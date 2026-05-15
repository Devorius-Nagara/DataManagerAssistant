import React from 'react';
import { Trash2 } from 'lucide-react';

export default function LogsTab({ logs, onClear }) {
  return (
    <div className="space-y-1.5">
      <div className="flex justify-end mb-1">
        <button
          onClick={onClear}
          className="inline-flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-medium text-slate-700 bg-gray-100 hover:bg-gray-200 border border-gray-300 rounded-md"
        >
          <Trash2 className="w-4 h-4" /> Очистити логи
        </button>
      </div>
      {logs.length === 0 ? (
        <div className="text-center text-gray-500 mt-4 text-xs">Поки що логів немає</div>
      ) : (
        logs.map((log) => (
          <div key={log.id} className="text-xs p-2 bg-gray-50 border border-gray-200 rounded-md flex flex-col gap-1">
            <div className="flex justify-between items-center text-[11px] text-gray-500">
              <span className="font-semibold text-slate-700 text-xs">{log.site}</span>
              <span>{log.time}</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-gray-800 break-words overflow-wrap-anywhere whitespace-pre-wrap text-[11px] w-full">{log.message}</span>
              {log.code && (
                <span
                  className={`px-1.5 py-0.5 rounded text-[11px] font-bold shrink-0 ${
                    log.code === 200 ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
                  }`}
                >
                  {log.code}
                </span>
              )}
            </div>
          </div>
        ))
      )}
    </div>
  );
}
