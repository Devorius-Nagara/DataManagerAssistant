import React, { useState, useEffect, useMemo } from 'react';
import { Download, Table as TableIcon, Loader2, ChevronDown } from 'lucide-react';
import { getSheetsAccessToken } from '../../sheetsApi.js';

function ExportProgressBar() {
  const [pct, setPct] = useState(0);
  const [phase, setPhase] = useState('filling');

  useEffect(() => {
    const startTime = Date.now();
    const PHASE1_MS = 20000;
    const TARGET = 85;
    const id = setInterval(() => {
      const t = Math.min((Date.now() - startTime) / PHASE1_MS, 1);
      const eased = 1 - Math.pow(1 - t, 3);
      setPct(eased * TARGET);
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
        {phase === 'filling' ? 'Записую в таблицю...' : 'Очікую відповіді від Google...'}
      </p>
    </div>
  );
}

export default function CustomReportsMode() {
  const [selectedCard, setSelectedCard] = useState(null);

  // Form state
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  // Per-report-type sheet IDs
  const [sheetIds, setSheetIds] = useState({ dispute_tasks: '', complains: '' });
  const sheetId = selectedCard ? (sheetIds[selectedCard] || '') : '';

  // Tag selector state
  const [tags, setTags] = useState([]);
  const [loadingTags, setLoadingTags] = useState(false);
  const [tagSearch, setTagSearch] = useState('');
  const [showTagsDropdown, setShowTagsDropdown] = useState(false);
  const [selectedTagId, setSelectedTagId] = useState(null);

  // Fetch state
  const [isFetching, setIsFetching] = useState(false);
  const [fetchedCount, setFetchedCount] = useState(null);
  const [fetchError, setFetchError] = useState('');

  // Export state
  const [isExporting, setIsExporting] = useState(false);
  const [exportError, setExportError] = useState('');
  const [exportSuccess, setExportSuccess] = useState('');

  // Timezone offsets from settings (shared with default mode)
  const [apiOffset, setApiOffset] = useState(2);
  const [trackensureOffset, setTrackensureOffset] = useState(2);

  // Load persisted state on mount
  useEffect(() => {
    chrome.storage.local.get(
      ['apiRangeOffset', 'trackensureOffset', 'crDateFrom', 'crDateTo', 'crSheetId_dispute_tasks', 'crSheetId_complains', 'crSelectedTagId', 'crTagSearch', 'crTags', 'crSelectedCard', 'crFetchedCount'],
      (data) => {
        if (data.apiRangeOffset !== undefined) setApiOffset(Number(data.apiRangeOffset));
        if (data.trackensureOffset !== undefined) setTrackensureOffset(Number(data.trackensureOffset));
        if (data.crDateFrom) setDateFrom(data.crDateFrom);
        if (data.crDateTo) setDateTo(data.crDateTo);
        setSheetIds({
          dispute_tasks: data.crSheetId_dispute_tasks || '',
          complains: data.crSheetId_complains || '',
        });
        if (data.crSelectedTagId != null) setSelectedTagId(Number(data.crSelectedTagId));
        if (data.crTagSearch) setTagSearch(data.crTagSearch);
        if (Array.isArray(data.crTags) && data.crTags.length) setTags(data.crTags);
        // Restore accordion state — key present means user explicitly set it; absent = first launch (stay null/closed)
        if ('crSelectedCard' in data) setSelectedCard(data.crSelectedCard);
        // Restore export-ready state
        if (data.crFetchedCount != null) setFetchedCount(Number(data.crFetchedCount));
      }
    );

    const listener = (changes, area) => {
      if (area !== 'local') return;
      if (changes.apiRangeOffset?.newValue !== undefined) setApiOffset(Number(changes.apiRangeOffset.newValue));
      if (changes.trackensureOffset?.newValue !== undefined) setTrackensureOffset(Number(changes.trackensureOffset.newValue));
    };
    chrome.storage.onChanged.addListener(listener);
    return () => chrome.storage.onChanged.removeListener(listener);
  }, []);

  const saveDateFrom = (val) => { setDateFrom(val); chrome.storage.local.set({ crDateFrom: val }); };
  const saveDateTo = (val) => { setDateTo(val); chrome.storage.local.set({ crDateTo: val }); };
  const saveSheetId = (val) => {
    if (!selectedCard) return;
    setSheetIds((prev) => ({ ...prev, [selectedCard]: val }));
    chrome.storage.local.set({ [`crSheetId_${selectedCard}`]: val });
  };

  const toggleCard = (name) => {
    const next = selectedCard === name ? null : name;
    // Switching to a different report type invalidates the cached fetch result
    if (next !== null && next !== selectedCard) {
      setFetchedCount(null);
      setFetchError('');
      setExportError('');
      setExportSuccess('');
      chrome.storage.local.remove(['crFetchedCount']);
    }
    setSelectedCard(next);
    chrome.storage.local.set({ crSelectedCard: next });
  };

  const loadTags = () => {
    setLoadingTags(true);
    chrome.runtime.sendMessage({ type: 'GET_TRACKENSURE_TAGS' }, (response) => {
      setLoadingTags(false);
      if (response?.ok) {
        const loaded = response.tags || [];
        setTags(loaded);
        chrome.storage.local.set({ crTags: loaded });
        setShowTagsDropdown(true);
      }
    });
  };

  const handleTagClick = (tag) => {
    setSelectedTagId(tag.tagId);
    setTagSearch(tag.tagName);
    setShowTagsDropdown(false);
    chrome.storage.local.set({ crSelectedTagId: tag.tagId, crTagSearch: tag.tagName });
  };

  const clearTag = () => {
    setSelectedTagId(null);
    setTagSearch('');
    setShowTagsDropdown(false);
    chrome.storage.local.remove(['crSelectedTagId', 'crTagSearch']);
  };

  const filteredTags = useMemo(() => {
    const q = tagSearch.trim().toLowerCase();
    if (!q) return tags;
    return tags.filter((t) => `${t.tagName} ${t.tagId}`.toLowerCase().includes(q));
  }, [tags, tagSearch]);

  const handleFetch = () => {
    if (!dateFrom || !dateTo) { setFetchError('Вкажіть діапазон дат'); return; }
    setFetchError('');
    setFetchedCount(null);
    setExportSuccess('');
    setExportError('');
    setIsFetching(true);
    // Clear stale export-ready flag so re-open during fetch doesn't show old count
    chrome.storage.local.remove(['crFetchedCount']);

    chrome.runtime.sendMessage(
      {
        type: 'FETCH_CUSTOM_REPORT',
        payload: { reportType: selectedCard, dateFrom, dateTo, tagId: selectedTagId, apiOffset },
      },
      (response) => {
        setIsFetching(false);
        if (chrome.runtime.lastError) {
          setFetchError(chrome.runtime.lastError.message || "Помилка зв'язку");
          return;
        }
        if (!response?.ok) {
          setFetchError(response?.error || 'Помилка зчитування');
          return;
        }
        setFetchedCount(response.total);
        // Persist so export button survives popup close/reopen
        chrome.storage.local.set({ crFetchedCount: response.total });
      }
    );
  };

  const handleExport = async () => {
    if (!sheetId) { setExportError('Вкажіть ID Google Таблиці'); return; }
    setExportError('');
    setExportSuccess('');
    setIsExporting(true);

    try {
      const token = await getSheetsAccessToken();

      const fromStr = dateFrom ? new Date(dateFrom).toLocaleDateString('uk-UA', { day: '2-digit', month: '2-digit' }) : '';
      const toStr = dateTo ? new Date(dateTo).toLocaleDateString('uk-UA', { day: '2-digit', month: '2-digit' }) : '';
      const dateRangeStr = fromStr && toStr ? `${fromStr} - ${toStr}` : 'Dispute Report';

      chrome.runtime.sendMessage(
        {
          type: 'EXPORT_CUSTOM_REPORT',
          payload: { sheetId, token, trackensureOffset, dateRangeStr },
        },
        (response) => {
          setIsExporting(false);
          if (chrome.runtime.lastError) {
            setExportError(chrome.runtime.lastError.message || "Помилка зв'язку");
            return;
          }
          if (!response?.ok) {
            setExportError(response?.error || 'Помилка експорту');
            return;
          }
          setExportSuccess(`Готово! Записано ${response.rowCount ?? 0} рядків.`);
        }
      );
    } catch (err) {
      setIsExporting(false);
      setExportError('Помилка авторизації: ' + err.message);
    }
  };

  const canExport = fetchedCount != null && fetchedCount > 0 && !isFetching;

  return (
    <div className="space-y-2">

      {/* Report type tiles */}
      <div className="grid grid-cols-2 gap-2">
        {[
          { id: 'dispute_tasks', label: 'Dispute Tasks', desc: 'Задачі з диспутами' },
          { id: 'complains',     label: 'Complains',     desc: 'Скарги з коментарями' },
        ].map(({ id, label, desc }) => (
          <button
            key={id}
            type="button"
            onClick={() => toggleCard(id)}
            className={`text-left p-2.5 rounded-lg border-2 transition-all ${
              selectedCard === id
                ? 'border-blue-500 bg-blue-50 shadow-sm'
                : 'border-gray-200 bg-gray-50 hover:border-blue-300 hover:bg-blue-50/40'
            }`}
          >
            <div className="text-xs font-semibold text-gray-800">{label}</div>
            <div className="text-[10px] text-gray-500 mt-0.5">{desc}</div>
          </button>
        ))}
      </div>

      {selectedCard && (
        <div className="space-y-3 border border-gray-100 rounded-lg p-3 bg-white">

          {/* Date range */}
          <div className="space-y-1">
            <label className="block text-xs font-medium text-gray-700">Дата та час ВІД</label>
            <input
              type="datetime-local"
              value={dateFrom}
              onChange={(e) => saveDateFrom(e.target.value)}
              className="w-full px-2.5 py-1.5 border border-gray-300 rounded-md shadow-sm text-xs focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            />
          </div>
          <div className="space-y-1">
            <label className="block text-xs font-medium text-gray-700">Дата та час ДО</label>
            <input
              type="datetime-local"
              value={dateTo}
              onChange={(e) => saveDateTo(e.target.value)}
              className="w-full px-2.5 py-1.5 border border-gray-300 rounded-md shadow-sm text-xs focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            />
          </div>

          {/* Tag selector */}
          <div className="space-y-1.5">
            <label className="block text-xs font-medium text-gray-700">
              Тег команди <span className="text-gray-400 font-normal">(необов'язково)</span>
            </label>
            <button
              type="button"
              onClick={loadTags}
              disabled={loadingTags}
              className="w-full flex items-center justify-center gap-1.5 bg-slate-900 hover:bg-slate-800 disabled:opacity-60 disabled:cursor-not-allowed text-white px-3 py-1.5 rounded-md text-xs font-medium"
            >
              {loadingTags && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              {loadingTags ? 'Завантаження...' : 'Завантажити доступні теги'}
            </button>
            <div className="relative">
              <input
                type="text"
                value={tagSearch}
                onChange={(e) => { setTagSearch(e.target.value); setShowTagsDropdown(true); }}
                onFocus={() => setShowTagsDropdown(true)}
                placeholder="Пошук тегу..."
                className="w-full px-2.5 py-1.5 border border-gray-300 rounded-md text-xs shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              {selectedTagId && (
                <button
                  type="button"
                  onClick={clearTag}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-700 text-sm leading-none"
                >
                  ×
                </button>
              )}
            </div>
            {showTagsDropdown && (
              <div className="max-h-28 overflow-y-auto border border-gray-200 rounded-md divide-y divide-gray-100 bg-white shadow-sm">
                {filteredTags.length === 0 && (
                  <div className="px-3 py-2 text-xs text-gray-500">
                    {tags.length === 0 ? 'Завантажте теги кнопкою вище' : 'Нічого не знайдено'}
                  </div>
                )}
                {filteredTags.map((tag) => (
                  <button
                    key={tag.tagId}
                    type="button"
                    onClick={() => handleTagClick(tag)}
                    className={`w-full text-left px-2.5 py-1.5 text-xs hover:bg-blue-50 ${selectedTagId === tag.tagId ? 'bg-blue-100' : ''}`}
                  >
                    <div className="text-[12px] font-medium text-gray-800 truncate">{tag.tagName}</div>
                    <div className="text-[10px] text-gray-500">ID: {tag.tagId}</div>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Sheet ID */}
          <div className="space-y-1">
            <label className="block text-xs font-medium text-gray-700">ID Google Таблиці</label>
            <input
              type="text"
              value={sheetId}
              onChange={(e) => saveSheetId(e.target.value.trim())}
              placeholder="Наприклад: 1A2B3C..."
              className="w-full px-2.5 py-1.5 border border-gray-300 rounded-md shadow-sm text-xs focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            />
          </div>

          {/* Status messages */}
          {fetchError && (
            <div className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-md px-2.5 py-1.5">
              {fetchError}
            </div>
          )}
          {fetchedCount != null && !fetchError && (
            <div className="text-xs text-blue-700 bg-blue-50 border border-blue-200 rounded-md px-2.5 py-1.5">
              Зчитано {fetchedCount} задач — готово до експорту
            </div>
          )}
          {exportError && (
            <div className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-md px-2.5 py-1.5">
              {exportError}
            </div>
          )}
          {exportSuccess && (
            <div className="text-xs text-green-700 bg-green-50 border border-green-200 rounded-md px-2.5 py-1.5">
              {exportSuccess}
            </div>
          )}

          {/* Action buttons */}
          {isExporting ? (
            <ExportProgressBar />
          ) : (
            <div className="flex gap-2">
              <button
                type="button"
                onClick={handleFetch}
                disabled={isFetching || !dateFrom || !dateTo}
                className="flex-1 flex items-center justify-center gap-1.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-60 disabled:cursor-not-allowed text-white px-3 py-1.5 rounded-md text-xs font-medium transition-colors"
              >
                {isFetching ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-4 h-4" />}
                {isFetching ? 'Зчитування...' : 'Зчитати'}
              </button>
              <button
                type="button"
                onClick={handleExport}
                disabled={!canExport || !sheetId}
                className="flex-1 flex items-center justify-center gap-1.5 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-60 disabled:cursor-not-allowed text-white px-3 py-1.5 rounded-md text-xs font-medium transition-colors"
              >
                <TableIcon className="w-4 h-4" /> Експортувати
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
