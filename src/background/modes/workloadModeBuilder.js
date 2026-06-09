// Shift definitions — hardcoded local-time boundaries (UTC+tzOffset)
const SHIFTS = [
  { key: 'MORNING', label: 'Morning Shift', startH: 7,  startM: 0,  endH: 15, endM: 0,  spansNext: false },
  { key: 'MAIN',    label: 'Main Shift',    startH: 15, startM: 0,  endH: 23, endM: 30, spansNext: false },
  { key: 'NIGHT',   label: 'Night Shift',   startH: 23, startM: 30, endH: 7,  endM: 30, spansNext: true  },
];

// ─── Time helpers ─────────────────────────────────────────────────────────────

function localToUtcMs(dateStr, h, m, tzOffset) {
  const [y, mo, d] = dateStr.split('-').map(Number);
  return Date.UTC(y, mo - 1, d, h, m, 0) - tzOffset * 3600000;
}

function addOneDay(dateStr) {
  const d = new Date(dateStr + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

function getShiftRange(dateStr, shift, tzOffset) {
  const startMs = localToUtcMs(dateStr, shift.startH, shift.startM, tzOffset);
  const endDateStr = shift.spansNext ? addOneDay(dateStr) : dateStr;
  const endMs = localToUtcMs(endDateStr, shift.endH, shift.endM, tzOffset);
  return { start: startMs, end: endMs };
}

function formatTime(utcMs, tzOffset) {
  const d = new Date(Number(utcMs) + tzOffset * 3600000);
  return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
}

function formatMMSS(seconds) {
  const s = Math.round(Math.abs(Number(seconds) || 0));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

// Build a "HH:MM - HH:MM" label of an agent's actual work window for a given shift.
// Considers only records overlapping [start, end); earliest start → latest end.
// Returns "Немає даних" when the agent has no work records in this window.
function formatWorkWindow(records, start, end, tzOffset) {
  if (!Array.isArray(records) || !records.length) return 'Немає даних';
  let minStart = Infinity, maxEnd = 0;
  for (const r of records) {
    const s = r.eventStartDTO?.eventDateMs ?? r.startTime ?? r.dateFrom;
    if (s == null) continue;
    const sNum = Number(s);
    const e = r.eventEndDTO?.eventDateMs ?? r.endTime ?? r.dateTo ?? sNum;
    const eNum = Number(e);
    if (sNum >= end || eNum <= start) continue; // keep only records overlapping this shift
    minStart = Math.min(minStart, sNum);
    maxEnd   = Math.max(maxEnd, eNum);
  }
  if (minStart === Infinity) return 'Немає даних';
  return `${formatTime(minStart, tzOffset)} - ${formatTime(maxEnd, tzOffset)}`;
}

// Normalize any date-like value to "YYYY-MM-DD" string (UTC-based)
function normDate(v) {
  if (!v) return null;
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v)) return v.slice(0, 10);
  const n = Number(v);
  if (!isNaN(n) && n > 946684800000) return new Date(n).toISOString().slice(0, 10);
  const d = new Date(v);
  if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  return null;
}

// ─── Call helpers ─────────────────────────────────────────────────────────────

export function getWaitTime(call) {
  const callDate     = call.callDate ?? call.startDate ?? call.createDate ?? call.dateCreate ?? 0;
  const answeredDate = call.answeredDate ?? call.answerDate ?? call.dateAnswer;
  const hangupDate   = call.hangupDate ?? call.endDate ?? call.dateHangup ?? call.dateEnd;
  if (!callDate) return 0;
  const end = answeredDate || hangupDate;
  if (!end) return 0;
  return Math.max(0, Math.round((Number(end) - Number(callDate)) / 1000));
}

function getCallTime(call) {
  return Number(call.callDate ?? call.startDate ?? call.createDate ?? call.dateCreate ?? 0);
}

// ─── Peak period detection (sliding window) ───────────────────────────────────

export function findPeakPeriods(shiftCalls) {
  if (!shiftCalls || shiftCalls.length === 0) return [];

  const WINDOW_MS    = 5  * 60 * 1000;
  const MIN_CALLS    = 3;
  const MIN_WAIT_SEC = 300;
  const END_GAP_MS   = 10 * 60 * 1000;

  const sorted = [...shiftCalls]
    .filter(c => getCallTime(c) > 0)
    .sort((a, b) => getCallTime(a) - getCallTime(b));

  if (sorted.length < MIN_CALLS) return [];

  const inPeak = new Set();
  let left = 0;
  for (let right = 0; right < sorted.length; right++) {
    while (getCallTime(sorted[right]) - getCallTime(sorted[left]) > WINDOW_MS) left++;
    if (right - left + 1 >= MIN_CALLS) {
      const windowCalls = sorted.slice(left, right + 1);
      if (windowCalls.some(c => getWaitTime(c) >= MIN_WAIT_SEC)) {
        for (let k = left; k <= right; k++) inPeak.add(k);
      }
    }
  }

  if (!inPeak.size) return [];

  const indices = [...inPeak].sort((a, b) => a - b);
  const peaks = [];
  let pStart = indices[0];
  let pEnd   = indices[0];
  let pMax   = getWaitTime(sorted[indices[0]]);

  for (let i = 1; i < indices.length; i++) {
    const curr = indices[i];
    const prev = indices[i - 1];
    if (getCallTime(sorted[curr]) - getCallTime(sorted[prev]) > END_GAP_MS) {
      peaks.push({ start: getCallTime(sorted[pStart]), end: getCallTime(sorted[pEnd]), maxWaitSec: pMax });
      pStart = curr; pEnd = curr; pMax = getWaitTime(sorted[curr]);
    } else {
      pEnd = curr;
      pMax = Math.max(pMax, getWaitTime(sorted[curr]));
    }
  }
  peaks.push({ start: getCallTime(sorted[pStart]), end: getCallTime(sorted[pEnd]), maxWaitSec: pMax });

  return peaks;
}

// ─── Role identification ──────────────────────────────────────────────────────

function nameMatchesTeam(agentName, teamName) {
  if (!agentName || !teamName) return false;
  const words = agentName.split(/\s+/).filter(w => w.length > 2);
  const tLow = teamName.toLowerCase();
  return words.some(w => tLow.includes(w.toLowerCase()));
}

function getAgentId(s) {
  const id = s.agentId ?? s.agentDTO?.userId ?? s.agentDTO?.agentId;
  return id != null ? Number(id) : null;
}

export function identifyRoles(schedules, teams) {
  const managerIds = new Set();
  const tlIds      = new Set();
  const agentIds   = new Set();

  const teamMap = {};
  for (const s of schedules) {
    const teamId  = s._teamId ?? s.teamId ?? s.teamDTO?.teamId;
    const agentId = getAgentId(s);
    const name    = s.agentName ?? s.agentDTO?.fullName ?? '';
    if (agentId == null) continue;
    const key = String(teamId);
    if (!teamMap[key]) teamMap[key] = { name: '', agents: [] };
    if (!teamMap[key].agents.find(a => a.agentId === agentId)) {
      teamMap[key].agents.push({ agentId, agentName: name });
    }
  }
  for (const t of (teams || [])) {
    const tid = String(t.teamId ?? t.id);
    if (teamMap[tid]) teamMap[tid].name = t.teamName ?? t.name ?? '';
  }

  for (const { name, agents } of Object.values(teamMap)) {
    if (!name.toLowerCase().includes('manager')) continue;
    for (const { agentId, agentName } of agents) {
      if (nameMatchesTeam(agentName, name)) managerIds.add(agentId);
      else tlIds.add(agentId);
    }
  }
  for (const id of managerIds) tlIds.delete(id);

  for (const { name, agents } of Object.values(teamMap)) {
    const n = name.toLowerCase();
    if (n.includes('manager')) continue;
    if (!n.includes('support') && !n.includes('team')) continue;
    for (const { agentId } of agents) {
      if (!managerIds.has(agentId) && !tlIds.has(agentId)) agentIds.add(agentId);
    }
  }

  return { managerIds, tlIds, agentIds };
}

// ─── Work hours helper ────────────────────────────────────────────────────────

function calcHoursWorked(records, shiftStart, shiftEnd) {
  if (!Array.isArray(records) || !records.length) return 0;
  let total = 0;
  for (const r of records) {
    const startMs = r.eventStartDTO?.eventDateMs ?? r.startTime ?? r.dateFrom ?? r.workStart;
    const endMs   = r.eventEndDTO?.eventDateMs   ?? r.endTime   ?? r.dateTo   ?? r.workEnd;
    if (startMs && endMs) {
      const s = Math.max(Number(startMs), shiftStart);
      const e = Math.min(Number(endMs),   shiftEnd);
      if (e > s) total += (e - s) / 3600000;
      continue;
    }
    const h = r.workHours ?? r.hours ?? r.totalHours;
    if (h != null) total += Number(h);
  }
  return total;
}

// ─── Main stats calculation ───────────────────────────────────────────────────

// Returns false for Day Off / Vacation / Rest records so they are excluded from counts.
function isWorkShift(item) {
  const tagName = (
    item.shiftDTO?.tagDTO?.tagName ??
    item.tagDTO?.tagName ??
    item.shiftType ??
    item.type ?? ''
  ).toUpperCase();
  return !['OFF', 'VACATION', 'SICK', 'FREE', 'HOLIDAY', 'REST', 'ABSENT', 'LEAVE']
    .some(kw => tagName.includes(kw));
}

// Map a schedule item's tag to a shift key (used for non-standard schedules / day-offs).
function tagToShift(item) {
  const tag = (item.tagName ?? item.tagDTO?.tagName ?? item.shiftDTO?.tagDTO?.tagName ?? '').toUpperCase();
  if (tag.includes('MORNING')) return 'MORNING';
  if (tag.includes('MAIN'))    return 'MAIN';
  if (tag.includes('NIGHT'))   return 'NIGHT';
  return null;
}

// Determine which shift a schedule item belongs to.
// Standard shifts (start ≈ 07:00 / 15:00 / 23:30) are matched by their start time,
// ignoring tags. Only genuinely non-standard schedules (e.g. 12:00–20:00) fall back
// to the tag name. Day-off markers have no meaningful start time → tag only.
function getPlannedShiftType(item, tzOffset) {
  if (item.isDayOff) return tagToShift(item);
  const startMs = Number(item.dateFrom ?? item.startTime);
  if (!startMs || isNaN(startMs)) return tagToShift(item);

  const d = new Date(startMs + tzOffset * 3600000);
  const totalMin = d.getUTCHours() * 60 + d.getUTCMinutes();
  const TOL = 60; // planned starts are clean; 60-min tolerance is safe
  if (Math.abs(totalMin - 7 * 60)  <= TOL) return 'MORNING';
  if (Math.abs(totalMin - 15 * 60) <= TOL) return 'MAIN';
  if (totalMin >= 22 * 60 || totalMin < 2 * 60) return 'NIGHT'; // 22:00–02:00 window
  return tagToShift(item); // non-standard schedule
}

export function buildWorkloadStats({ rawTasks, rawSchedules, rawWorkHours, rawCalls, teams, tzOffset = 2 }) {
  // ── Flatten agent blocks → flat shift items ─────────────────────────────────
  // Day-off / vacation items are KEPT (flagged isDayOff) so those agents can be
  // reported as absent rather than silently dropped. We extract only the small set
  // of fields we actually need — never the full raw item (memory constraint).
  const flatSchedules = (rawSchedules || []).flatMap(agentBlock => {
    const items = agentBlock.agentScheduleShiftCalendarItemDTOList || [];
    return items.map(item => ({
      dateFrom:  item.dateFrom,
      dateTo:    item.dateTo,
      tagName:   item.tagDTO?.tagName ?? item.shiftDTO?.tagDTO?.tagName ?? '',
      isDayOff:  !isWorkShift(item),
      agentId:   agentBlock.agentDTO?.agentId,
      agentName: agentBlock.agentDTO?.fullName,
      _teamId:   agentBlock._teamId,
    }));
  });

  const { managerIds, tlIds, agentIds } = identifyRoles(flatSchedules, teams);

  const scheduleDates = [
    ...new Set(flatSchedules.map(s => normDate(s.dateFrom)).filter(Boolean)),
  ].sort();
  const dates = scheduleDates.length
    ? scheduleDates
    : [...new Set((rawTasks || []).map(t => normDate(t.createDate)).filter(Boolean))].sort();

  const agentNameMap = {};
  for (const block of (rawSchedules || [])) {
    const agId = block.agentDTO?.agentId;
    const name = block.agentDTO?.fullName;
    if (agId != null && name) agentNameMap[Number(agId)] = name;
  }

  const getRecords = (agId) => rawWorkHours?.[agId] ?? rawWorkHours?.[String(agId)] ?? [];

  const rows = [];

  for (const date of dates) {
    // Pre-index this date's planned WORKING shifts per agent (for Extra spill detection).
    const plannedByAgent = new Map();
    for (const s of flatSchedules) {
      if (normDate(s.dateFrom) !== date || s.isDayOff) continue;
      const shiftType = getPlannedShiftType(s, tzOffset);
      if (!shiftType) continue;
      const id = getAgentId(s);
      if (id == null) continue;
      if (!plannedByAgent.has(id)) plannedByAgent.set(id, []);
      plannedByAgent.get(id).push({ dateFrom: Number(s.dateFrom), dateTo: Number(s.dateTo) });
    }

    for (const shift of SHIFTS) {
      const { start, end } = getShiftRange(date, shift, tzOffset);

      // ── Tasks (unchanged) ────────────────────────────────────────────────
      const shiftTasks = (rawTasks || []).filter(t => {
        const cd = Number(t.createDate ?? 0);
        return cd >= start && cd < end;
      });

      // ── Planned items for THIS date + shift (deduplicated by agentId) ─────
      const seen = new Set();
      const plannedItems = flatSchedules.filter(s => {
        if (normDate(s.dateFrom) !== date) return false;
        if (getPlannedShiftType(s, tzOffset) !== shift.key) return false;
        const id = getAgentId(s);
        if (id == null || seen.has(id)) return false;
        seen.add(id);
        return true;
      });

      const plannedTLs    = plannedItems.filter(s => { const id = getAgentId(s); return  tlIds.has(id) && !managerIds.has(id); });
      const plannedAgents = plannedItems.filter(s => { const id = getAgentId(s); return agentIds.has(id) && !tlIds.has(id) && !managerIds.has(id); });

      // ── Present / Absent — strict single-bucket partition ────────────────
      // Present requires: not a day-off, has actual records, and >= 5h worked
      // inside the buffered window (start −30 min, end +60 min).
      const isPresent = (item) => {
        if (item.isDayOff) return false;
        const recs = getRecords(getAgentId(item));
        if (!recs.length) return false;
        const winStart = Number(item.dateFrom) - 30 * 60000;
        const winEnd   = Number(item.dateTo)   + 60 * 60000;
        return calcHoursWorked(recs, winStart, winEnd) >= 5;
      };

      const activeTLs = [], absentTLs = [];
      plannedTLs.forEach(s => (isPresent(s) ? activeTLs : absentTLs).push(s));
      const activeAgents = [], absentAgents = [];
      plannedAgents.forEach(s => (isPresent(s) ? activeAgents : absentAgents).push(s));

      // ── Extra — 3 scenarios (TLs eligible, managers never) ───────────────
      const plannedThisShift = new Set(plannedItems.map(s => getAgentId(s)));
      const extraIds = [];
      const extraSeen = new Set();
      for (const [agIdStr, records] of Object.entries(rawWorkHours || {})) {
        const agId = Number(agIdStr);
        if (managerIds.has(agId)) continue;        // managers are never Extra
        if (plannedThisShift.has(agId)) continue;  // own shift → present/absent, not Extra

        // Agent's actual work window overlapping THIS shift.
        let minStart = Infinity, maxEnd = 0, overlaps = false;
        for (const r of (records || [])) {
          const sN = Number(r.eventStartDTO?.eventDateMs ?? r.startTime ?? r.dateFrom);
          if (!sN) continue;
          const eN = Number(r.eventEndDTO?.eventDateMs ?? r.endTime ?? r.dateTo ?? (sN + 8 * 3600000));
          if (sN >= end || eN <= start) continue;  // record doesn't overlap this shift
          overlaps = true;
          minStart = Math.min(minStart, sN);
          maxEnd   = Math.max(maxEnd, eN);
        }
        if (!overlaps) continue;

        const planned = plannedByAgent.get(agId) || [];
        let isExtra = false;

        if (planned.length === 0) {
          // Scenario 1: no plan at all this day, yet worked a real stint here.
          if (calcHoursWorked(records, start, end) >= 1.5) isExtra = true;
        } else {
          // Scenario 2 (early start): began >30 min before a (later) planned shift,
          // and that early work lands inside this (earlier) shift window.
          const earlySpill = planned.some(p => (p.dateFrom - minStart) > 30 * 60000 && minStart >= start && minStart < end);
          // Scenario 3 (late finish): ended >60 min after an (earlier) planned shift,
          // and that late work lands inside this (later) shift window.
          const lateSpill = planned.some(p => (maxEnd - p.dateTo) > 60 * 60000 && maxEnd > start && maxEnd <= end);
          if (earlySpill || lateSpill) isExtra = true;
        }

        if (isExtra && !extraSeen.has(agId)) { extraSeen.add(agId); extraIds.push(agId); }
      }

      // ── Calls / peaks (unchanged) ────────────────────────────────────────
      const shiftCalls = (rawCalls || []).filter(c => {
        const ct = getCallTime(c);
        return ct >= start && ct < end;
      });
      const peaks = findPeakPeriods(shiftCalls);
      const peakHourDisplay = peaks.length
        ? peaks.map(p => `${formatTime(p.start, tzOffset)} - ${formatTime(p.end, tzOffset)}`).join(', ')
        : '-';
      const peakWaitDisplay = peaks.length
        ? peaks.map(p => formatMMSS(p.maxWaitSec)).join(', ')
        : '-';

      // ── Debug labels: flat strings only ("Name (HH:MM - HH:MM)" etc.) ────
      const labelItem = (item) => {
        const id = getAgentId(item);
        const name = item.agentName || agentNameMap[id] || String(id);
        if (item.isDayOff) return `${name} (Вихідний)`;
        return `${name} (${formatWorkWindow(getRecords(id), start, end, tzOffset)})`;
      };
      const labelId = (id) => {
        const name = agentNameMap[id] || String(id);
        return `${name} (${formatWorkWindow(getRecords(id), start, end, tzOffset)})`;
      };

      rows.push({
        date,
        shiftName:        shift.label,
        taskCount:        shiftTasks.length,
        tlCount:          activeTLs.length,
        agentCount:       activeAgents.length,
        absentTlCount:    absentTLs.length,
        absentAgentCount: absentAgents.length,
        extraCount:       extraIds.length,
        peakHourDisplay,
        peakWaitDisplay,
        details: {
          scheduledAgents: activeAgents.map(labelItem),
          scheduledTLs:    activeTLs.map(labelItem),
          absentAgents:    absentAgents.map(labelItem),
          absentTLs:       absentTLs.map(labelItem),
          extraAgents:     extraIds.map(labelId),
        },
      });
    }
  }

  console.log('[DEBUG WORKLOAD] Final counts:', {
    rawAgentBlocks: (rawSchedules || []).length,
    flatSchedules:  flatSchedules.length,
    totalTasks:     (rawTasks  || []).length,
    totalCalls:     (rawCalls  || []).length,
    managerCount:   managerIds.size,
    tlCount:        tlIds.size,
    agentCount:     agentIds.size,
    rowsGenerated:  rows.length,
  });
  console.log('[DEBUG WORKLOAD] First 3 rows:', rows.slice(0, 3));

  return { rows, managerIds, tlIds, agentIds };
}

// ─── Matrix builder for Sheets export ────────────────────────────────────────

export function buildWorkloadMatrix(rows) {
  const headers = [
    'Date', 'Shift', 'Tasks Count', 'TLs Scheduled', 'Agents Scheduled',
    'TLs Missing', 'Agents Missing', 'Extra Staff',
    'Peak Hour', 'Peak Wait Time',
  ];
  const dataRows = rows.map(r => [
    r.date, r.shiftName, r.taskCount, r.tlCount, r.agentCount,
    r.absentTlCount ?? 0, r.absentAgentCount ?? 0, r.extraCount ?? 0,
    r.peakHourDisplay, r.peakWaitDisplay,
  ]);
  return [headers, ...dataRows];
}
