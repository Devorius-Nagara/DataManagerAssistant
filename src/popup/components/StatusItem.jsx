import React from 'react';
import { CheckCircle2, Clock, XCircle, Loader2 } from 'lucide-react';

function formatBytes(bytes) {
  if (!bytes) return '';
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1048576).toFixed(2)} MB`;
}

export default function StatusItem({ label, state, successText, errorText, pendingText, isFetching, fetchBytes }) {
  return (
    <div className="flex items-center justify-between p-2 bg-gray-50 rounded-lg border border-gray-100">
      <span className="text-xs font-medium text-gray-700 truncate pr-2">{label}</span>
      <div className="flex items-center gap-1.5 shrink-0">
        {isFetching && (
          <>
            <Loader2 className="w-3.5 h-3.5 text-blue-500 animate-spin" />
            <span className="text-xs text-blue-600">
              {fetchBytes > 0 ? formatBytes(fetchBytes) : 'Завантаження...'}
            </span>
          </>
        )}
        {!isFetching && state === true && (
          <>
            <CheckCircle2 className="w-4 h-4 text-green-500" />
            <span className="text-xs text-green-600">{successText}</span>
          </>
        )}
        {!isFetching && state === false && (
          <>
            <XCircle className="w-4 h-4 text-red-500" />
            <span className="text-xs text-red-600">{errorText}</span>
          </>
        )}
        {!isFetching && state === null && (
          <>
            <Clock className="w-4 h-4 text-gray-400" />
            <span className="text-xs text-gray-500">{pendingText}</span>
          </>
        )}
      </div>
    </div>
  );
}
