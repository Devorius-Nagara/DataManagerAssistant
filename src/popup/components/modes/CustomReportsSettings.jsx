import React, { useState, useEffect } from 'react';

export default function CustomReportsSettings() {
  const [apiRangeOffset, setApiRangeOffset] = useState(2);
  const [trackensureOffset, setTrackensureOffset] = useState(2);

  useEffect(() => {
    chrome.storage.local.get(['apiRangeOffset', 'trackensureOffset'], (data) => {
      if (data.apiRangeOffset !== undefined) setApiRangeOffset(Number(data.apiRangeOffset));
      if (data.trackensureOffset !== undefined) setTrackensureOffset(Number(data.trackensureOffset));
    });
  }, []);

  const handleApiOffset = (val) => {
    const n = Number(val);
    setApiRangeOffset(n);
    chrome.storage.local.set({ apiRangeOffset: n });
  };

  const handleTrackensureOffset = (val) => {
    const n = Number(val);
    setTrackensureOffset(n);
    chrome.storage.local.set({ trackensureOffset: n });
  };

  return (
    <div className="space-y-3">
      <div className="space-y-1">
        <label className="block text-xs font-medium text-gray-700">API діапазон (dateFrom / dateTo)</label>
        <select
          value={apiRangeOffset}
          onChange={(e) => handleApiOffset(e.target.value)}
          className="w-full px-2.5 py-1.5 border border-gray-300 rounded-md shadow-sm text-xs focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white font-mono"
        >
          <option value="2">Зимовий час (+2)</option>
          <option value="3">Літній час (+3)</option>
        </select>
      </div>
      <div className="space-y-1">
        <label className="block text-xs font-medium text-gray-700">Таски Trackensure (відображення дат)</label>
        <select
          value={trackensureOffset}
          onChange={(e) => handleTrackensureOffset(e.target.value)}
          className="w-full px-2.5 py-1.5 border border-gray-300 rounded-md shadow-sm text-xs focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white font-mono"
        >
          <option value="2">Зимовий час (+2)</option>
          <option value="3">Літній час (+3)</option>
        </select>
      </div>
      <p className="text-[11px] text-gray-400">Налаштування таймзон спільні між Default та Custom Reports режимами.</p>
    </div>
  );
}
