import React, { useEffect, useMemo, useState } from 'react';
import { Loader2 } from 'lucide-react';

const getHour = (ms, offset) => {
  const date = new Date(Number(ms) + Number(offset) * 3600000);
  return date.getUTCHours() + date.getUTCMinutes() / 60;
};

const toPct = (hour) => (Math.max(0, Math.min(24, hour)) / 24) * 100;

const renderInterval = (startHour, endHour, className) => {
  if (startHour === undefined || endHour === undefined) return null;
  const start = Math.max(0, Math.min(24, startHour));
  const end = Math.max(0, Math.min(24, endHour));
  if (start <= end) {
    return <div className={className} style={{ left: `${toPct(start)}%`, width: `${toPct(end) - toPct(start)}%` }} />;
  }
  return (
    <>
      <div className={className} style={{ left: `${toPct(start)}%`, width: `${100 - toPct(start)}%` }} />
      <div className={className} style={{ left: '0%', width: `${toPct(end)}%` }} />
    </>
  );
};

function CalibrationTimeline({ data, trackensureOffset, orchardOffset, includeShift20, includeCancel5 }) {
  if (!data || !Array.isArray(data.tasks) || !data.tasks.length) {
    return <div className="text-[11px] text-gray-500">Немає даних для графіка. Запустіть збір, щоб побачити шкалу.</div>;
  }

  const hasShift = Boolean(data.shift?.start && data.shift?.end);
  const startHour = hasShift ? getHour(data.shift.start, orchardOffset) : null;
  const endHour = hasShift ? getHour(data.shift.end, orchardOffset) : null;
  const bufferHours = includeShift20 && hasShift ? 20 / 60 : 0;

  const isWithinShift = (hour) => {
    if (!hasShift || startHour === null || endHour === null) return false;
    const start = startHour;
    const end = endHour;
    const startWithBuffer = start - bufferHours;
    const endWithBuffer = end + bufferHours;
    if (startWithBuffer <= endWithBuffer) return hour >= startWithBuffer && hour <= endWithBuffer;
    return hour >= startWithBuffer || hour <= endWithBuffer;
  };

  const renderShiftBlocks = () => {
    if (!hasShift) return null;
    if (startHour <= endHour) {
      const left = (startHour / 24) * 100;
      const width = ((endHour - startHour) / 24) * 100;
      return <div className="absolute top-0 bottom-0 bg-green-400/30 border-x border-green-500/50" style={{ left: `${left}%`, width: `${width}%` }} />;
    }

    const block1Left = (startHour / 24) * 100;
    const block1Width = ((24 - startHour) / 24) * 100;
    const block2Width = (endHour / 24) * 100;

    return (
      <>
        <div className="absolute top-0 bottom-0 bg-green-400/30 border-l border-green-500/50" style={{ left: `${block1Left}%`, width: `${block1Width}%` }} />
        <div className="absolute top-0 bottom-0 bg-green-400/30 border-r border-green-500/50" style={{ left: '0%', width: `${block2Width}%` }} />
      </>
    );
  };

  const renderBufferBlocks = () => {
    if (!includeShift20 || !hasShift) return null;
    const preStartFrom = startHour - bufferHours;
    const preStartTo = startHour;
    const postEndFrom = endHour;
    const postEndTo = endHour + bufferHours;
    return (
      <>
        {renderInterval(preStartFrom, preStartTo, 'absolute top-0 bottom-0 bg-yellow-400/50 border-yellow-500/50')}
        {renderInterval(postEndFrom, postEndTo, 'absolute top-0 bottom-0 bg-yellow-400/50 border-yellow-500/50')}
      </>
    );
  };

  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap items-center gap-2 text-[11px] text-gray-600">
        <span className="inline-flex items-center gap-1"><span className="inline-block w-2.5 h-2.5 rounded-full bg-green-500/70" />🟢 Зміна Orchard</span>
        {includeShift20 && <span className="inline-flex items-center gap-1"><span className="inline-block w-2.5 h-2.5 rounded-full bg-yellow-400/70" />🟡 Буфер 20хв</span>}
        <span className="inline-flex items-center gap-1"><span className="inline-block w-2.5 h-2.5 rounded-full bg-blue-500/70" />🔵 Client</span>
        <span className="inline-flex items-center gap-1"><span className="inline-block w-2.5 h-2.5 rounded-full bg-orange-500/80" />🟠 Org</span>
        <span className="inline-flex items-center gap-1"><span className="inline-block w-2.5 h-2.5 rounded-full bg-teal-500/80" />🔷 Assign</span>
        <span className="inline-flex items-center gap-1"><span className="inline-block w-2.5 h-2.5 rounded-full bg-purple-500" />🟣 Cancel &lt;5хв</span>
        <span className="inline-flex items-center gap-1"><span className="inline-block w-2.5 h-2.5 rounded-full bg-red-500/70" />🔴 Поза зміною</span>
      </div>
      <div className="relative h-10 rounded-md border border-slate-200 bg-slate-100 overflow-hidden">
        {renderShiftBlocks()}
        {renderBufferBlocks()}
        {data.tasks.map((task, idx) => {
          const timeMs = typeof task === 'number' ? task : Number(task?.t ?? task?.time ?? task?.createDate);
          if (!timeMs) return null;
          const taskHour = getHour(timeMs, trackensureOffset);
          const status = typeof task === 'object' ? task?.s || '' : '';
          const duration = typeof task === 'object' ? Number(task?.d || 0) : 0;
          const type = typeof task === 'object' ? String(task?.y || task?.type || '').toLowerCase() : '';
          const pos = Math.max(0, Math.min(100, (taskHour / 24) * 100));
          const isCancelShort = includeCancel5 && status.includes('cancel') && duration > 0 && duration < 300000;
          const withinShift = hasShift ? isWithinShift(taskHour) : false;
          const outsideWork = hasShift ? !withinShift : true;
          let colorClass = 'bg-blue-500';
          if (isCancelShort) colorClass = 'bg-purple-500';
          else if (outsideWork) colorClass = 'bg-red-500';
          else if (type === 'org') colorClass = 'bg-orange-500';
          else if (type === 'assign') colorClass = 'bg-teal-500';
          else colorClass = 'bg-blue-500';
          return <div key={idx} className={`absolute top-1 bottom-1 w-[2px] ${colorClass}`} style={{ left: `calc(${pos}% - 1px)` }} title="Таск Trackensure" />;
        })}
      </div>
      <div className="flex justify-between text-[10px] text-gray-500 px-0.5">
        {[0, 6, 12, 18, 24].map((h) => (
          <span key={h}>{h}:00</span>
        ))}
      </div>
    </div>
  );
}

export default function SettingsTab({
  settings,
  setSettings,
  tags,
  loadingTags,
  onLoadTags,
  selectedTagId,
  onSelectTag,
  trackensureSearch,
  setTrackensureSearch,
  orchardTeams,
  loadingOrchardTeams,
  onLoadOrchardTeams,
  selectedTeamId,
  onSelectTeam,
  orchardSearch,
  setOrchardSearch,
  trackensureUsers,
  loadingTrackUsers,
  onLoadTrackUsers,
  selectedTLs,
  onSelectTLs,
  tlSearch,
  setTlSearch,
  includeShift20,
  setIncludeShift20,
  includeCancel5,
  setIncludeCancel5,
  apiRangeOffset,
  setApiRangeOffset,
  trackensureOffset,
  setTrackensureOffset,
  orchardOffset,
  setOrchardOffset,
  debugCalibrationData
}) {
  const [showTagsDropdown, setShowTagsDropdown] = useState(false);
  const [showTeamsDropdown, setShowTeamsDropdown] = useState(false);
  const [showTLDropdown, setShowTLDropdown] = useState(false);
  const [calibrationData, setCalibrationData] = useState(null);
  const [selectedAgent, setSelectedAgent] = useState('');
  const [selectedDay, setSelectedDay] = useState('');

  const filteredTags = useMemo(() => {
    const q = trackensureSearch.trim().toLowerCase();
    if (!q) return tags;
    return tags.filter((t) => `${t.tagName} ${t.tagId}`.toLowerCase().includes(q));
  }, [tags, trackensureSearch]);

  const filteredTeams = useMemo(() => {
    const q = orchardSearch.trim().toLowerCase();
    if (!q) return orchardTeams;
    return orchardTeams.filter((t) => `${t.teamName} ${t.teamId}`.toLowerCase().includes(q));
  }, [orchardTeams, orchardSearch]);

  const filteredTLs = useMemo(() => {
    const q = tlSearch.trim().toLowerCase();
    if (!q) return trackensureUsers;
    return trackensureUsers.filter((u) => `${u.fullName} ${u.userId}`.toLowerCase().includes(q));
  }, [trackensureUsers, tlSearch]);

  const handleTagClick = (tag) => {
    onSelectTag(tag.tagId);
    setTrackensureSearch(tag.tagName);
    setShowTagsDropdown(false);
  };

  const handleTeamClick = (team) => {
    onSelectTeam(team.teamId);
    setOrchardSearch(team.teamName);
    setShowTeamsDropdown(false);
  };

  const toggleTL = (user) => {
    const exists = selectedTLs.includes(user.userId);
    const next = exists ? selectedTLs.filter((id) => id !== user.userId) : [...selectedTLs, user.userId];
    onSelectTLs(next);
  };

  const availableAgents = useMemo(
    () => Object.keys(calibrationData || {}).filter((k) => !['agentName', 'shift', 'tasks'].includes(k)),
    [calibrationData]
  );
  const availableDays = useMemo(() => {
    if (!selectedAgent) return [];
    return Object.keys((calibrationData || {})[selectedAgent] || {});
  }, [calibrationData, selectedAgent]);

  const handleData = (data) => {
    if (!data || typeof data !== 'object' || Object.keys(data).length === 0) {
      setCalibrationData(null);
      return;
    }

    const safeData = JSON.parse(JSON.stringify(data));
    setCalibrationData(safeData);

    const agents = Object.keys(safeData);
    if (agents.length > 0) {
      setSelectedAgent((prev) => (agents.includes(prev) ? prev : agents[0]));
      const targetAgent = agents.includes(selectedAgent) ? selectedAgent : agents[0];
      const days = Object.keys(safeData[targetAgent] || {});
      setSelectedDay((prevDay) => (days.includes(prevDay) ? prevDay : days[0] || ''));
    }
  };

  useEffect(() => {
    chrome.storage.local.get(['debugCalibrationData'], (result) => {
      handleData(result.debugCalibrationData);
    });

    const listener = (changes, namespace) => {
      if (namespace === 'local' && changes.debugCalibrationData) {
        handleData(changes.debugCalibrationData.newValue);
      }
    };
    chrome.storage.onChanged.addListener(listener);
    return () => chrome.storage.onChanged.removeListener(listener);
  }, []);

  useEffect(() => {
    if (debugCalibrationData && Object.keys(debugCalibrationData).length > 0) {
      handleData(debugCalibrationData);
    }
  }, [debugCalibrationData]);

  const selectedCalibration = selectedAgent && selectedDay ? (calibrationData || {})[selectedAgent]?.[selectedDay] || null : null;

  return (
    <div className="flex flex-col space-y-3 h-full">

      <div className="space-y-1.5">
        <label className="block text-xs font-medium text-gray-700">Теги Trackensure (Сайт 1)</label>
        <div className="flex flex-col gap-1.5">
          <button
            onClick={onLoadTags}
            disabled={loadingTags}
            className="whitespace-nowrap bg-slate-900 hover:bg-slate-800 disabled:opacity-60 disabled:cursor-not-allowed text-white px-3 py-1.5 rounded-md text-xs font-medium w-full"
          >
            {loadingTags ? <Loader2 className="w-4 h-4 animate-spin" /> : null} {loadingTags ? 'Завантаження...' : 'Завантажити доступні теги'}
          </button>
          <input
            type="text"
            value={trackensureSearch}
            onChange={(e) => {
              setTrackensureSearch(e.target.value);
              setShowTagsDropdown(true);
            }}
            onFocus={() => setShowTagsDropdown(true)}
            placeholder="Пошук тегу..."
            className="w-full px-2.5 py-1.5 border border-gray-300 rounded-md text-xs shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          {showTagsDropdown && (
            <div className="max-h-32 overflow-y-auto border border-gray-200 rounded-md divide-y divide-gray-100 bg-white">
              {filteredTags.length === 0 && <div className="px-3 py-2 text-xs text-gray-500">Нічого не знайдено</div>}
              {filteredTags.map((tag) => (
                <button
                  key={tag.tagId}
                  type="button"
                  onClick={() => handleTagClick(tag)}
                  className={`w-full text-left px-2.5 py-1.5 text-xs hover:bg-blue-50 ${selectedTagId === tag.tagId ? 'bg-blue-100' : ''}`}
                >
                  <div className="text-[13px] font-medium text-gray-800 truncate">{tag.tagName}</div>
                  <div className="text-[10px] text-gray-500">ID: {tag.tagId}</div>
                </button>
              ))}
            </div>
          )}
          <p className="text-[11px] text-gray-500">Обраний тег зберігається в chrome.storage.local.</p>
        </div>
      </div>

      <div className="space-y-1.5">
        <label className="block text-xs font-medium text-gray-700">Team Leaders (TL) Trackensure</label>
        <div className="flex flex-col gap-1.5">
          <button
            onClick={onLoadTrackUsers}
            disabled={loadingTrackUsers}
            className="whitespace-nowrap bg-slate-900 hover:bg-slate-800 disabled:opacity-60 disabled:cursor-not-allowed text-white px-3 py-1.5 rounded-md text-xs font-medium w-full"
          >
            {loadingTrackUsers ? <Loader2 className="w-4 h-4 animate-spin" /> : null} {loadingTrackUsers ? 'Завантаження...' : 'Завантажити список TL'}
          </button>
          <input
            type="text"
            value={tlSearch}
            onChange={(e) => {
              setTlSearch(e.target.value);
              setShowTLDropdown(true);
            }}
            onFocus={() => setShowTLDropdown(true)}
            placeholder="Пошук TL..."
            className="w-full px-2.5 py-1.5 border border-gray-300 rounded-md text-xs shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          {showTLDropdown && (
            <div className="max-h-32 overflow-y-auto border border-gray-200 rounded-md divide-y divide-gray-100 bg-white">
              {filteredTLs.length === 0 && <div className="px-3 py-2 text-xs text-gray-500">Нічого не знайдено</div>}
              {filteredTLs.map((user) => {
                const checked = selectedTLs.includes(user.userId);
                return (
                  <button
                    key={user.userId}
                    type="button"
                    onClick={() => toggleTL(user)}
                    className={`w-full text-left px-2.5 py-1.5 text-xs hover:bg-blue-50 ${checked ? 'bg-blue-100' : ''}`}
                  >
                    <div className="text-[13px] font-medium text-gray-800 truncate">{user.fullName}</div>
                    <div className="text-[10px] text-gray-500">ID: {user.userId}</div>
                  </button>
                );
              })}
            </div>
          )}
          {selectedTLs.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {selectedTLs.map((id) => {
                const name = trackensureUsers.find((u) => u.userId === id)?.fullName || id;
                return (
                  <span key={id} className="inline-flex items-center gap-1 px-2 py-0.5 bg-blue-100 text-blue-800 rounded-full text-[11px]">
                    {name}
                    <button onClick={() => onSelectTLs(selectedTLs.filter((x) => x !== id))} className="text-blue-600 hover:text-blue-800">
                      ×
                    </button>
                  </span>
                );
              })}
            </div>
          )}
          <p className="text-[11px] text-gray-500">Обрані TL зберігаються в chrome.storage.local.</p>
        </div>
      </div>

      <div className="space-y-1.5">
        <label className="block text-xs font-medium text-gray-700">Команди Orchard22 (Сайт 2)</label>
        <div className="flex flex-col gap-1.5">
          <button
            onClick={onLoadOrchardTeams}
            disabled={loadingOrchardTeams}
            className="whitespace-nowrap bg-slate-900 hover:bg-slate-800 disabled:opacity-60 disabled:cursor-not-allowed text-white px-3 py-1.5 rounded-md text-xs font-medium w-full"
          >
            {loadingOrchardTeams ? <Loader2 className="w-4 h-4 animate-spin" /> : null} {loadingOrchardTeams ? 'Завантаження...' : 'Завантажити команди'}
          </button>
          <input
            type="text"
            value={orchardSearch}
            onChange={(e) => {
              setOrchardSearch(e.target.value);
              setShowTeamsDropdown(true);
            }}
            onFocus={() => setShowTeamsDropdown(true)}
            placeholder="Пошук команди..."
            className="w-full px-2.5 py-1.5 border border-gray-300 rounded-md text-xs shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          {showTeamsDropdown && (
            <div className="max-h-32 overflow-y-auto border border-gray-200 rounded-md divide-y divide-gray-100 bg-white">
              {filteredTeams.length === 0 && <div className="px-3 py-2 text-xs text-gray-500">Нічого не знайдено</div>}
              {filteredTeams.map((team) => (
                <button
                  key={team.teamId}
                  type="button"
                  onClick={() => handleTeamClick(team)}
                  className={`w-full text-left px-2.5 py-1.5 text-xs hover:bg-blue-50 ${selectedTeamId === team.teamId ? 'bg-blue-100' : ''}`}
                >
                  <div className="text-[13px] font-medium text-gray-800 truncate">{team.teamName}</div>
                  <div className="text-[10px] text-gray-500">ID: {team.teamId}</div>
                </button>
              ))}
            </div>
          )}
          <p className="text-[11px] text-gray-500">Команда зберігається в chrome.storage.local (токен перехоплюємо автоматично).</p>
        </div>
      </div>

      <div className="mt-auto flex flex-col gap-2.5">
        <div className="grid grid-cols-1 gap-1.5">
          <div className="space-y-1">
            <label className="block text-xs font-medium text-gray-700">API діапазон (dateFrom/dateTo)</label>
            <select
              value={apiRangeOffset}
              onChange={(e) => setApiRangeOffset(Number(e.target.value))}
              className="w-full px-2.5 py-1.5 border border-gray-300 rounded-md shadow-sm text-xs focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white font-mono"
            >
              <option value="2">Зимовий час (+2)</option>
              <option value="3">Літній час (+3)</option>
            </select>
          </div>
          <div className="space-y-1">
            <label className="block text-xs font-medium text-gray-700">Таски Trackensure (візуал)</label>
            <select
              value={trackensureOffset}
              onChange={(e) => setTrackensureOffset(Number(e.target.value))}
              className="w-full px-2.5 py-1.5 border border-gray-300 rounded-md shadow-sm text-xs focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white font-mono"
            >
              <option value="2">Зимовий час (+2)</option>
              <option value="3">Літній час (+3)</option>
            </select>
          </div>
          <div className="space-y-1">
            <label className="block text-xs font-medium text-gray-700">Зміни Orchard (мапінг)</label>
            <select
              value={orchardOffset}
              onChange={(e) => setOrchardOffset(Number(e.target.value))}
              className="w-full px-2.5 py-1.5 border border-gray-300 rounded-md shadow-sm text-xs focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white font-mono"
            >
              <option value="2">Зимовий час (+2)</option>
              <option value="3">Літній час (+3)</option>
            </select>
          </div>
        </div>

        <div className="flex flex-col gap-1.5 pt-1">
          <label className="inline-flex items-center gap-1.5 text-xs font-medium text-gray-700">
            <input
              type="checkbox"
              checked={includeShift20}
              onChange={(e) => setIncludeShift20(e.target.checked)}
              className="h-3 w-3 text-blue-600 border-gray-300 rounded"
            />
            Include 20min buffer
          </label>
          <label className="inline-flex items-center gap-1.5 text-xs font-medium text-gray-700">
            <input
              type="checkbox"
              checked={includeCancel5}
              onChange={(e) => setIncludeCancel5(e.target.checked)}
              className="h-3 w-3 text-blue-600 border-gray-300 rounded"
            />
            Include cancel 5min+
          </label>
        </div>

        <div className="border-t pt-2 space-y-2">
          <div className="grid grid-cols-1 gap-1.5">
            <select
              value={selectedAgent}
              onChange={(e) => {
                setSelectedAgent(e.target.value);
                const days = Object.keys((calibrationData || {})[e.target.value] || {}).sort((a, b) => Number(a) - Number(b));
                setSelectedDay(days[0] || '');
              }}
              className="w-full px-2 py-1 text-xs border border-gray-300 rounded-md bg-white"
            >
                          {availableAgents.length === 0 && <option value="">Немає даних для агентів</option>}
                          {availableAgents.map((a) => (
                            <option key={a} value={a}>
                              {a}
                            </option>
                          ))}
            </select>
            <select
              value={selectedDay}
              onChange={(e) => setSelectedDay(e.target.value)}
              className="w-full px-2 py-1 text-xs border border-gray-300 rounded-md bg-white"
            >
                          {availableDays.length === 0 && <option value="">Немає днів</option>}
                          {availableDays.map((d) => (
                            <option key={d} value={d}>
                              День {d}
                            </option>
                          ))}
            </select>
          </div>
          <CalibrationTimeline
            data={selectedCalibration}
            trackensureOffset={trackensureOffset}
            orchardOffset={orchardOffset}
            includeShift20={includeShift20}
            includeCancel5={includeCancel5}
          />
        </div>
      </div>
    </div>
  );
}
