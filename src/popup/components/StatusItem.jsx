import React from 'react';
import { CheckCircle2, Clock, XCircle } from 'lucide-react';

export default function StatusItem({ label, state, successText, errorText, pendingText }) {
  return (
    <div className="flex items-center justify-between p-2 bg-gray-50 rounded-lg border border-gray-100">
      <span className="text-xs font-medium text-gray-700 truncate pr-2">{label}</span>
      <div className="flex items-center gap-1.5 shrink-0">
        {state === true && (
          <>
            <CheckCircle2 className="w-4 h-4 text-green-500" /> <span className="text-xs text-green-600">{successText}</span>
          </>
        )}
        {state === false && (
          <>
            <XCircle className="w-4 h-4 text-red-500" /> <span className="text-xs text-red-600">{errorText}</span>
          </>
        )}
        {state === null && (
          <>
            <Clock className="w-4 h-4 text-gray-400" /> <span className="text-xs text-gray-500">{pendingText}</span>
          </>
        )}
      </div>
    </div>
  );
}
