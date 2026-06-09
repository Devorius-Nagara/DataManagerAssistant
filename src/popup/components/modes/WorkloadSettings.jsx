import React, { useEffect, useMemo, useState } from 'react';
import { Loader2 } from 'lucide-react';

function OffsetSelect({ label, value, onChange }) {
  return (
    <div className="space-y-1">
      <label className="block text-xs font-medium text-gray-700">{label}</label>
      <select
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full px-2.5 py-1.5 border border-gray-300 rounded-md shadow-sm text-xs focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white font-mono"
      >
        <option value="2">Зимовий час (+2)</option>
        <option value="3">Літній час (+3)</option>
      </select>
    </div>
  );
}

export default function WorkloadSettings() {
  const [apiRangeOffset,     setApiRangeOffset]     = useState(2);
  const [trackensureOffset,  setTrackensureOffset]   = useState(2);
  const [orchardOffset,      setOrchardOffset]       = useState(2);

  const [departments,    setDepartments]    = useState([]);
  const [loadingDepts,   setLoadingDepts]   = useState(false);
  const [deptError,      setDeptError]      = useState('');
  const [selectedDeptId, setSelectedDeptId] = useState(2);

  const [teams,           setTeams]           = useState([]);
  const [loadingTeams,    setLoadingTeams]     = useState(false);
  const [selectedTeamIds, setSelectedTeamIds] = useState([]);
  const [teamSearch,      setTeamSearch]      = useState('');
  const [showTeamsDrop,   setShowTeamsDrop]   = useState(false);

  const [queues,           setQueues]           = useState([]);
  const [loadingQueues,    setLoadingQueues]     = useState(false);
  const [selectedQueueIds, setSelectedQueueIds] = useState([]);
  const [queueSearch,      setQueueSearch]      = useState('');
  const [showQueuesDrop,   setShowQueuesDrop]   = useState(false);

  useEffect(() => {
    chrome.storage.local.get(
      ['apiRangeOffset', 'trackensureOffset', 'orchardOffset',
       'wlDepartmentId', 'wlDepartments', 'wlTeams', 'wlTeamIds',
       'wlQueues', 'wlQueueIds'],
      (data) => {
        if (data.apiRangeOffset    !== undefined) setApiRangeOffset(Number(data.apiRangeOffset));
        if (data.trackensureOffset !== undefined) setTrackensureOffset(Number(data.trackensureOffset));
        if (data.orchardOffset     !== undefined) setOrchardOffset(Number(data.orchardOffset));
        if (data.wlDepartmentId    !== undefined) setSelectedDeptId(Number(data.wlDepartmentId) || 2);
        if (Array.isArray(data.wlDepartments) && data.wlDepartments.length) setDepartments(data.wlDepartments);
        if (Array.isArray(data.wlTeams)        && data.wlTeams.length)       setTeams(data.wlTeams);
        if (Array.isArray(data.wlTeamIds))  setSelectedTeamIds(data.wlTeamIds);
        if (Array.isArray(data.wlQueues)    && data.wlQueues.length)  setQueues(data.wlQueues);
        if (Array.isArray(data.wlQueueIds)) setSelectedQueueIds(data.wlQueueIds);
      }
    );
  }, []);

  // ── Departments ────────────────────────────────────────────────────────────
  const loadDepartments = () => {
    setLoadingDepts(true);
    setDeptError('');
    chrome.runtime.sendMessage({ type: 'GET_WORKLOAD_DEPARTMENTS' }, (response) => {
      setLoadingDepts(false);
      if (chrome.runtime.lastError || !response?.ok) {
        setDeptError(response?.error || chrome.runtime.lastError?.message || 'Помилка завантаження');
        return;
      }
      const depts = response.departments || [];
      setDepartments(depts);
      chrome.storage.local.set({ wlDepartments: depts });
    });
  };

  const handleDeptChange = (val) => {
    const id = Number(val);
    setSelectedDeptId(id);
    setTeams([]);
    setSelectedTeamIds([]);
    setTeamSearch('');
    chrome.storage.local.set({ wlDepartmentId: id, wlTeamIds: [], wlTeams: [] });
  };

  // ── Teams ──────────────────────────────────────────────────────────────────
  const loadTeams = () => {
    setLoadingTeams(true);
    chrome.runtime.sendMessage(
      { type: 'GET_WORKLOAD_TEAMS', payload: { departmentId: selectedDeptId } },
      (response) => {
        setLoadingTeams(false);
        if (!response?.ok) return;
        const loaded = response.teams || [];
        setTeams(loaded);
        chrome.storage.local.set({ wlTeams: loaded });
      }
    );
  };

  const toggleTeam = (teamId) => {
    const next = selectedTeamIds.includes(teamId)
      ? selectedTeamIds.filter((id) => id !== teamId)
      : [...selectedTeamIds, teamId];
    setSelectedTeamIds(next);
    chrome.storage.local.set({ wlTeamIds: next });
  };

  const filteredTeams = useMemo(() => {
    const q = teamSearch.trim().toLowerCase();
    if (!q) return teams;
    return teams.filter((t) =>
      `${t.teamName ?? t.name ?? ''} ${t.teamId ?? t.id ?? ''}`.toLowerCase().includes(q)
    );
  }, [teams, teamSearch]);

  // ── Queues ─────────────────────────────────────────────────────────────────
  const loadQueues = () => {
    setLoadingQueues(true);
    chrome.runtime.sendMessage({ type: 'GET_WORKLOAD_QUEUES' }, (response) => {
      setLoadingQueues(false);
      if (!response?.ok) return;
      const loaded = response.queues || [];
      setQueues(loaded);
      chrome.storage.local.set({ wlQueues: loaded });
    });
  };

  const toggleQueue = (queueId) => {
    const next = selectedQueueIds.includes(queueId)
      ? selectedQueueIds.filter((id) => id !== queueId)
      : [...selectedQueueIds, queueId];
    setSelectedQueueIds(next);
    chrome.storage.local.set({ wlQueueIds: next });
  };

  const filteredQueues = useMemo(() => {
    const q = queueSearch.trim().toLowerCase();
    if (!q) return queues;
    return queues.filter((q_) =>
      `${q_.description ?? q_.name ?? ''} ${q_.queueId ?? q_.id ?? ''}`.toLowerCase().includes(q)
    );
  }, [queues, queueSearch]);

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-3">

      <OffsetSelect
        label="API діапазон (dateFrom / dateTo)"
        value={apiRangeOffset}
        onChange={(n) => { setApiRangeOffset(n); chrome.storage.local.set({ apiRangeOffset: n }); }}
      />
      <OffsetSelect
        label="Таски TrackEnsure (відображення дат)"
        value={trackensureOffset}
        onChange={(n) => { setTrackensureOffset(n); chrome.storage.local.set({ trackensureOffset: n }); }}
      />
      <OffsetSelect
        label="Зміни Orchard22 (відображення дат)"
        value={orchardOffset}
        onChange={(n) => { setOrchardOffset(n); chrome.storage.local.set({ orchardOffset: n }); }}
      />

      {/* ── Departments ── */}
      <div className="border-t border-gray-100 pt-3 space-y-1.5">
        <label className="block text-xs font-medium text-gray-700">Orchard22 — Департамент</label>
        <div className="flex flex-col gap-1.5">
          <button
            type="button"
            onClick={loadDepartments}
            disabled={loadingDepts}
            className="whitespace-nowrap bg-slate-900 hover:bg-slate-800 disabled:opacity-60 disabled:cursor-not-allowed text-white px-3 py-1.5 rounded-md text-xs font-medium w-full"
          >
            {loadingDepts && <Loader2 className="inline w-3.5 h-3.5 animate-spin mr-1" />}
            {loadingDepts ? 'Завантаження...' : 'Завантажити департаменти'}
          </button>
          {deptError && <p className="text-[11px] text-red-500">{deptError}</p>}
          {departments.length > 0 && (
            <select
              value={selectedDeptId}
              onChange={(e) => handleDeptChange(e.target.value)}
              className="w-full px-2.5 py-1.5 border border-gray-300 rounded-md shadow-sm text-xs focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
            >
              {departments.map((d) => (
                <option key={d.departmentId ?? d.id} value={d.departmentId ?? d.id}>
                  {d.departmentName ?? d.name ?? d.label}
                </option>
              ))}
            </select>
          )}
        </div>
      </div>

      {/* ── Teams ── */}
      <div className="space-y-1.5">
        <label className="block text-xs font-medium text-gray-700">Команди Orchard22</label>
        <div className="flex flex-col gap-1.5">
          <button
            type="button"
            onClick={loadTeams}
            disabled={loadingTeams || !selectedDeptId}
            className="whitespace-nowrap bg-slate-900 hover:bg-slate-800 disabled:opacity-60 disabled:cursor-not-allowed text-white px-3 py-1.5 rounded-md text-xs font-medium w-full"
          >
            {loadingTeams && <Loader2 className="inline w-3.5 h-3.5 animate-spin mr-1" />}
            {loadingTeams ? 'Завантаження...' : 'Завантажити команди'}
          </button>
          <input
            type="text"
            value={teamSearch}
            onChange={(e) => { setTeamSearch(e.target.value); setShowTeamsDrop(true); }}
            onFocus={() => setShowTeamsDrop(true)}
            placeholder="Пошук команди..."
            className="w-full px-2.5 py-1.5 border border-gray-300 rounded-md text-xs shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          {showTeamsDrop && teams.length > 0 && (
            <div className="max-h-32 overflow-y-auto border border-gray-200 rounded-md divide-y divide-gray-100 bg-white">
              {filteredTeams.length === 0
                ? <div className="px-3 py-2 text-xs text-gray-500">Нічого не знайдено</div>
                : filteredTeams.map((team) => {
                    const teamId   = team.teamId ?? team.id;
                    const teamName = team.teamName ?? team.name ?? team.label ?? String(teamId);
                    const checked  = selectedTeamIds.includes(teamId);
                    return (
                      <button
                        key={teamId}
                        type="button"
                        onClick={() => toggleTeam(teamId)}
                        className={`w-full text-left px-2.5 py-1.5 text-xs hover:bg-blue-50 ${checked ? 'bg-blue-100' : ''}`}
                      >
                        <div className="text-[13px] font-medium text-gray-800 truncate">{teamName}</div>
                        <div className="text-[10px] text-gray-500">ID: {teamId}</div>
                      </button>
                    );
                  })
              }
            </div>
          )}
          {selectedTeamIds.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {selectedTeamIds.map((id) => {
                const name = teams.find((t) => (t.teamId ?? t.id) === id)?.teamName
                          ?? teams.find((t) => (t.teamId ?? t.id) === id)?.name
                          ?? String(id);
                return (
                  <span key={id} className="inline-flex items-center gap-1 px-2 py-0.5 bg-blue-100 text-blue-800 rounded-full text-[11px]">
                    {name}
                    <button
                      type="button"
                      onClick={() => toggleTeam(id)}
                      className="text-blue-600 hover:text-blue-800"
                    >
                      ×
                    </button>
                  </span>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* ── Queues ── */}
      <div className="border-t border-gray-100 pt-3 space-y-1.5">
        <label className="block text-xs font-medium text-gray-700">Телефонні лінії (Queues)</label>
        <div className="flex flex-col gap-1.5">
          <button
            type="button"
            onClick={loadQueues}
            disabled={loadingQueues}
            className="whitespace-nowrap bg-slate-900 hover:bg-slate-800 disabled:opacity-60 disabled:cursor-not-allowed text-white px-3 py-1.5 rounded-md text-xs font-medium w-full"
          >
            {loadingQueues && <Loader2 className="inline w-3.5 h-3.5 animate-spin mr-1" />}
            {loadingQueues ? 'Завантаження...' : 'Завантажити лінії'}
          </button>
          <input
            type="text"
            value={queueSearch}
            onChange={(e) => { setQueueSearch(e.target.value); setShowQueuesDrop(true); }}
            onFocus={() => setShowQueuesDrop(true)}
            placeholder="Пошук за описом лінії..."
            className="w-full px-2.5 py-1.5 border border-gray-300 rounded-md text-xs shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          {showQueuesDrop && queues.length > 0 && (
            <div className="max-h-32 overflow-y-auto border border-gray-200 rounded-md divide-y divide-gray-100 bg-white">
              {filteredQueues.length === 0
                ? <div className="px-3 py-2 text-xs text-gray-500">Нічого не знайдено</div>
                : filteredQueues.map((q) => {
                    const queueId = q.queueId ?? q.id;
                    const desc    = q.description ?? q.name ?? q.queueName ?? String(queueId);
                    const sub     = q.name && q.name !== desc ? q.name : null;
                    const checked = selectedQueueIds.includes(queueId);
                    return (
                      <button
                        key={queueId}
                        type="button"
                        onClick={() => toggleQueue(queueId)}
                        className={`w-full text-left px-2.5 py-1.5 text-xs hover:bg-blue-50 ${checked ? 'bg-blue-100' : ''}`}
                      >
                        <div className="text-[13px] font-medium text-gray-800 truncate">{desc}</div>
                        <div className="text-[10px] text-gray-500">{sub ? `${sub} · ` : ''}ID: {queueId}</div>
                      </button>
                    );
                  })
              }
            </div>
          )}
          {selectedQueueIds.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {selectedQueueIds.map((id) => {
                const q    = queues.find((q_) => (q_.queueId ?? q_.id) === id);
                const name = q ? (q.description ?? q.name ?? String(id)) : String(id);
                return (
                  <span key={id} className="inline-flex items-center gap-1 px-2 py-0.5 bg-blue-100 text-blue-800 rounded-full text-[11px]">
                    {name}
                    <button
                      type="button"
                      onClick={() => toggleQueue(id)}
                      className="text-blue-600 hover:text-blue-800"
                    >
                      ×
                    </button>
                  </span>
                );
              })}
            </div>
          )}
        </div>
      </div>

      <p className="text-[11px] text-gray-400">Таймзони API та TrackEnsure спільні між усіма режимами.</p>
    </div>
  );
}
