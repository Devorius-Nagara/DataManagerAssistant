import { readFromStorage, DATA_KEYS } from '../shared.js';
import { CLIENT_REQUEST_TYPES } from '../api/trackensure.js';

export const cleanName = (str = '') => (str || '').toLowerCase().replace(/\s+/g, ' ').trim();

export function shouldIncludeTask(task, includeCancel5 = true) {
  const status = String(task?.status || '').toLowerCase();
  const isCanceled = status.includes('cancel');
  if (!isCanceled) return true;
  if (!includeCancel5) return false;
  const startMs = Number(task?.createDate);
  const endMs = Number(
    task?.endTime ??
      task?.endDate ??
      task?.end_date ??
      (startMs && task?.totalSpentTimeSec ? startMs + Number(task.totalSpentTimeSec) * 1000 : undefined)
  );
  if (Number.isNaN(startMs) || Number.isNaN(endMs)) return false;
  return endMs - startMs >= 300000;
}

export function statusToLetter(statusRaw) {
  const status = String(statusRaw || '').toLowerCase();
  if (status.includes('vacation')) return 'V';
  if (status.includes('day off') || status.includes('dayoff') || status.includes('off')) return 'O';
  if (status.includes('sick')) return 'S';
  return '';
}

// Для цілодобових подій фіксуємо час на 12:00 UTC, щоб зміщення не перекидало дату
export function getSafeFullDay(timestamp) {
  if (!timestamp) return null;
  const d = new Date(Number(timestamp));
  d.setUTCHours(12);
  return d.getUTCDate();
}

export function getDayFromTimestamp(timestamp, offsetHours = 2) {
  if (!timestamp) return null;
  const date = new Date(Number(timestamp) + Number(offsetHours) * 3600000);
  return date.getUTCDate();
}

export function columnToLetter(colIndexZeroBased) {
  let dividend = colIndexZeroBased + 1;
  let columnName = '';
  while (dividend > 0) {
    const modulo = (dividend - 1) % 26;
    columnName = String.fromCharCode(65 + modulo) + columnName;
    dividend = Math.floor((dividend - modulo) / 26);
  }
  return columnName;
}

export function cleanNameBase(raw = '') {
  return raw
    .toString()
    .toLowerCase()
    .replace(/\(eng\)/g, '')
    .replace(/teamleader/g, '')
    .replace(/agent\s*/g, '')
    .replace(/-?\s*ext[^\s]*/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// Strict two-component name match: every word of baseName must appear as a whole word in sheetCell.
// Works for both "First Last" and "Last First" orderings and ignores ext/digits/brackets.
export function isAgentMatch(baseName, sheetCell) {
  const cleanedCell = sheetCell
    .toLowerCase()
    .replace(/ext\.?\s*\d*/g, '')
    .replace(/\(eng\)/g, '')
    .replace(/\d+/g, '')
    .replace(/[-–]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const nameWords = baseName.split(' ').filter(Boolean);
  if (nameWords.length < 2) return cleanedCell.includes(baseName);
  const cellWords = new Set(cleanedCell.split(' ').filter(Boolean));
  return nameWords.every((word) => cellWords.has(word));
}

export function aggregateData(trackTasks = [], orchardSchedules = [], tlCache = [], options = {}) {
  const formatDate = (ms) => {
    if (!ms) return 'невідомо';
    return new Intl.DateTimeFormat('uk-UA', { day: 'numeric', month: 'long' }).format(new Date(ms));
  };

  const offsetHours = Number(options.orchardOffset ?? options.utcOffset ?? 2);
  const calibrationData = {};

  const normalizeName = (name = '') => {
    const lowered = name.toLowerCase();
    return lowered.replace(/ext\.?\s*\d+/g, '').replace(/\s+/g, ' ').trim();
  };

  const includeCanceled = options.includeCancel5Min ?? options.includeCancel5 ?? true;

  const filteredTasks = trackTasks.filter((t) => shouldIncludeTask(t, includeCanceled));

  const trackByOwner = filteredTasks.reduce((acc, t) => {
    const name = t?.ownerDTO?.fullName;
    if (!name) return acc;
    const norm = normalizeName(name);
    if (!acc[norm]) acc[norm] = [];
    acc[norm].push(t);
    return acc;
  }, {});

  const calibrationByOwner = (trackTasks || []).reduce((acc, t) => {
    const name = t?.ownerDTO?.fullName;
    if (!name) return acc;
    const norm = normalizeName(name);
    if (!acc[norm]) acc[norm] = [];
    acc[norm].push(t);
    return acc;
  }, {});

  const agentSections = [];
  orchardSchedules.forEach((entry) => {
    const name = entry?.agentDTO?.fullName || entry?.agentName || 'Невідомий агент';
    const norm = normalizeName(name);
    const agentTasks = trackByOwner[norm] || [];
    const calibrationTasks = calibrationByOwner[norm] || agentTasks;
    const shifts = entry?.agentScheduleShiftCalendarItemDTOList || [];
    const dayOffs = entry?.agentDayOffSchedulingDTOList || [];

    const daySummary = {};
    const isBufferEnabled = options.includeShift20 === true || options.includeShift20 === 'true';
    const bufferMs = isBufferEnabled ? 20 * 60 * 1000 : 0;
    let firstMatchedShift = null;
    const currentAgentName = name;
    if (!calibrationData[currentAgentName]) calibrationData[currentAgentName] = {};

    calibrationTasks.forEach((task) => {
      const taskMs = Number(task?.createDate);
      if (!taskMs) return;

      const matchedShift = shifts.find((shift) => {
        const startMs = Number(shift?.dateFrom) - bufferMs;
        const endMs = Number(shift?.dateTo) + bufferMs;
        return taskMs >= startMs && taskMs <= endMs;
      });

      if (matchedShift) {
        const dayKey = getDayFromTimestamp(Number(matchedShift.dateFrom), offsetHours);
        if (dayKey && dayKey >= 1 && dayKey <= 31) {
          if (!calibrationData[currentAgentName][dayKey]) calibrationData[currentAgentName][dayKey] = { shift: null, tasks: [] };
          calibrationData[currentAgentName][dayKey].shift = { start: Number(matchedShift.dateFrom), end: Number(matchedShift.dateTo) };
        }
      }

      const targetDayForDebug = matchedShift
        ? getDayFromTimestamp(Number(matchedShift.dateFrom), offsetHours)
        : getDayFromTimestamp(taskMs, offsetHours);
      if (!targetDayForDebug || targetDayForDebug < 1 || targetDayForDebug > 31) return;
      if (!calibrationData[currentAgentName][targetDayForDebug]) calibrationData[currentAgentName][targetDayForDebug] = { shift: null, tasks: [] };

      let type = String(task?.type || '').toLowerCase();
      const reqType = (task?.requestType || '').toLowerCase();
      if (!type && (task?.origin || '').toLowerCase().includes('assign')) type = 'assign';
      if (!type && reqType) type = reqType;
      if (!type) type = 'client';

      const compactType = type === 'client' ? 'c' : type;

      calibrationData[currentAgentName][targetDayForDebug].tasks.push({
        t: taskMs,
        s: (task.status || '').toLowerCase().substring(0, 6),
        d: task.endTime ? Number(task.endTime) - Number(task.createDate) : 0,
        y: compactType,
      });
    });

    agentTasks.forEach((task) => {
      const taskMs = Number(task?.createDate);
      if (!taskMs) return;

      const matchedShift = shifts.find((shift) => {
        const startMs = Number(shift?.dateFrom) - bufferMs;
        const endMs = Number(shift?.dateTo) + bufferMs;
        return taskMs >= startMs && taskMs <= endMs;
      });

      if (!matchedShift) return;

      if (!firstMatchedShift) firstMatchedShift = matchedShift;

      const label = formatDate(Number(matchedShift.dateFrom) + offsetHours * 3600000);
      const current = daySummary[label] || { log_editing: 0, log_fix: 0, full_check: 0, lite: 0, drivers_check: 0, other: 0, status: null };
      const aggType = (task?.extraType || '').toLowerCase().trim();
      if (aggType.includes('log_editing')) daySummary[label] = { ...current, log_editing: (current.log_editing || 0) + 1 };
      else if (aggType.includes('log_fix')) daySummary[label] = { ...current, log_fix: (current.log_fix || 0) + 1 };
      else if (aggType.includes('full_check')) daySummary[label] = { ...current, full_check: (current.full_check || 0) + 1 };
      else if (aggType.includes('lite')) daySummary[label] = { ...current, lite: (current.lite || 0) + 1 };
      else if (aggType.includes('drivers_check') || aggType.includes('driver_check')) daySummary[label] = { ...current, drivers_check: (current.drivers_check || 0) + 1 };
      else daySummary[label] = { ...current, other: (current.other || 0) + 1 };
    });

    dayOffs.forEach((off) => {
      let currentMs = Number(off?.dateFrom);
      const endMs = Number(off?.dateTo ?? off?.dateFrom);
      const status = off?.scheduleType || off?.shiftStatus;
      const letter = statusToLetter(status);
      if (!letter) return;

      while (currentMs <= endMs) {
        const day = getSafeFullDay(currentMs);
        if (day && day >= 1 && day <= 31) {
          const label = formatDate(currentMs + offsetHours * 3600000);
          const current = daySummary[label] || { tasks: 0, status: null };
          daySummary[label] = { ...current, status: letter };
        }
        currentMs += 86400000;
      }
    });

    const lines = Object.entries(daySummary).map(([day, info]) => {
      const le = info.log_editing || 0;
      const lf = info.log_fix || 0;
      const lite = info.lite || 0;
      const fc = info.full_check || 0;
      const dc = info.drivers_check || 0;
      const oth = info.other || 0;
      const total = le + lf + lite + fc + dc + oth;
      if (total > 0) return `${day} - LE: ${le} | LF: ${lf} | L: ${lite} | FC: ${fc} | DC: ${dc} | Oth: ${oth}`;
      if (info.status) return `${day} - ${info.status}`;
      return `${day} - 0 тасків`;
    });

    if (lines.length) {
      agentSections.push(`Агент ${name}:`);
      agentSections.push(...lines);
      agentSections.push('');
    }

  });

  console.log('[PMS BACKGROUND] Спроба зберегти ВСІХ агентів у storage...');
  chrome.storage.local.set({ pmsDebugCalibrationData: calibrationData }, () => {
    if (chrome.runtime.lastError) {
      console.error('[PMS BACKGROUND] ПОМИЛКА ЗБЕРЕЖЕННЯ:', chrome.runtime.lastError);
    } else {
      console.log('[PMS BACKGROUND] Збереження всіх агентів успішне!');
    }
  });

  return { agentMessage: agentSections.join('\n').trim(), tlMessage: '' };
}

export function buildSheetMatrix(trackTasks = [], orchardData = [], tlCache = [], options = {}) {
  const timeZone = options.timezone || 'Europe/Kyiv';
  const offsetHours = Number(options.orchardOffset ?? options.utcOffset ?? 2);
  const header = [''].concat(Array.from({ length: 31 }, (_, idx) => String(idx + 1)));
  const rows = [header];

  // КРОК 1: Визначення Головного Місяця (Base Month)
  const baseDate = options.baseDateFromMs ? new Date(options.baseDateFromMs) : (trackTasks[0] ? new Date(Number(trackTasks[0].createDate)) : new Date());
  const baseMonth = baseDate.getMonth();
  const baseYear = baseDate.getFullYear();

  const normalizeName = (name = '') => name.toLowerCase().replace(/ext\.?\s*\d+/g, '').replace(/\s+/g, ' ').trim();
  const orchardNormalized = (orchardData || []).map((entry) => {
    const norm = normalizeName(entry?.agentDTO?.fullName || entry?.agentName || '');
    return { norm, clean: cleanName(norm), entry };
  });

  const findOrchardEntry = (name) => {
    const normTarget = normalizeName(name || '');
    const cleanTarget = cleanName(normTarget);
    if (!cleanTarget) return orchardNormalized.find(({ norm }) => norm === normTarget)?.entry || null;
    return (
      orchardNormalized.find(({ norm, clean }) => norm === normTarget || clean === cleanTarget || norm.includes(cleanTarget) || cleanTarget.includes(norm))
        ?.entry || null
    );
  };

  const includeCanceled = options.includeCancel5Min ?? options.includeCancel5 ?? true;
  const isBufferEnabled = options.includeShift20 === true || options.includeShift20 === 'true';
  const filteredTasks = (trackTasks || []).filter((t) => shouldIncludeTask(t, includeCanceled));

  const trackByOwner = filteredTasks.reduce((acc, t) => {
    const name = t?.ownerDTO?.fullName;
    if (!name) return acc;
    const norm = normalizeName(name);
    if (!acc[norm]) acc[norm] = [];
    acc[norm].push(t);
    return acc;
  }, {});

  const processAgent = (entry) => {
    const nameRaw = entry?.agentDTO?.fullName || entry?.agentName || 'Невідомий агент';
    const norm = normalizeName(nameRaw);
    const dayCats = {
      log_editing:   Array(31).fill(''),
      log_fix:       Array(31).fill(''),
      full_check:    Array(31).fill(''),
      lite:          Array(31).fill(''),
      drivers_check: Array(31).fill(''),
      other:         Array(31).fill(''),
    };
    const dayOffStatuses = {};

    const orchardAgent = findOrchardEntry(nameRaw);
    const shifts = orchardAgent ? orchardAgent.agentScheduleShiftCalendarItemDTOList || [] : [];
    const dayOffs = orchardAgent ? orchardAgent.agentDayOffSchedulingDTOList || [] : [];
    const agentTasks = trackByOwner[norm] || [];

    const dayBuckets = {};
    const prodTimes = {
      log_editing: 0, log_fix: 0, lite: 0, totalNoCharge: 0,
      // O/P/Q metrics
      targetTasksCount: 0,       // count of LE + LF + Lite + FC + Other (excludes driver_check)
      targetInProgressSec: 0,    // inProgress secs for the same 5 types
      targetNoChargeSec: 0,      // noCharge secs for the same 5 types
      totalAllInProgressSec: 0,  // inProgress secs for ALL task types
      totalAllNoChargeSec: 0,    // noCharge secs for ALL task types
    };
    const bufferMs = isBufferEnabled ? 20 * 60 * 1000 : 0;

    if (nameRaw.toLowerCase().includes('magdy')) {
      console.log('=== ДЕБАГ: MUHAMAD MAGDY ===');
      console.log('1. Сирих тасків з Trackensure:', agentTasks.length);

      const orchardAgentDebug = (orchardData || []).find((a) => {
        const orchName = cleanName(a.agentDTO?.fullName || a.agentName);
        const trName = cleanName(nameRaw);
        return orchName === trName || orchName.includes(trName) || trName.includes(orchName);
      });

      console.log('2. Знайдено в Orchard:', orchardAgentDebug ? 'ТАК' : 'НІ', orchardAgentDebug ? orchardAgentDebug.agentDTO?.fullName : '');
      console.log('3. Кількість змін (Shifts):', shifts.length);
      console.log('4. Буфер увімкнено:', isBufferEnabled, '| МС:', bufferMs);

      agentTasks.forEach((task) => {
        const taskMs = Number(task.createDate);
        const taskTimeStr = taskMs ? new Date(taskMs).toISOString() : 'invalid';

        const matchedShiftDebug = shifts.find((shift) => {
          const startMs = Number(shift.dateFrom) - bufferMs;
          const endMs = Number(shift.dateTo) + bufferMs;
          return taskMs >= startMs && taskMs <= endMs;
        });

        let isSkippedByCancel = false;
        const isCancelled = String(task.status || '').toLowerCase().includes('cancel');
        if (isCancelled && includeCanceled) {
          const duration = task.endTime ? Number(task.endTime) - Number(task.createDate) : 0;
          if (duration < 300000) {
            isSkippedByCancel = true;
          }
        }

        console.log(
          `Task ${task.taskId} | Час: ${taskTimeStr} | Статус: ${task.status} | Скасовано <5хв: ${isSkippedByCancel} | Знайдена зміна: ${
            matchedShiftDebug ? matchedShiftDebug.shiftId : 'НЕ ЗНАЙДЕНО'
          }`
        );
      });
      console.log('============================');
    }

    agentTasks.forEach((task) => {
      const taskMs = Number(task?.createDate);
      if (!taskMs) return;

      const matchedShift = shifts.find((shift) => {
        const startMs = Number(shift?.dateFrom) - bufferMs;
        const endMs = Number(shift?.dateTo) + bufferMs;
        return taskMs >= startMs && taskMs <= endMs;
      });

      if (!matchedShift) return;

      const targetDay = getDayFromTimestamp(matchedShift.dateFrom, offsetHours || 2);

      const targetDateObj = new Date(Number(matchedShift.dateFrom) + (offsetHours || 2) * 3600000);
      // КРИТИЧНИЙ ФІКС: Перевіряємо, чи належить подія до нашого місяця експорту
      if (targetDateObj.getUTCMonth() !== baseMonth || targetDateObj.getUTCFullYear() !== baseYear) return;

      if (!targetDay || targetDay < 1 || targetDay > 31) return;

      if (!dayBuckets[targetDay]) {
        dayBuckets[targetDay] = { log_editing: 0, log_fix: 0, full_check: 0, lite: 0, drivers_check: 0, other: 0 };
      }
      const taskType = (task?.extraType || '').toLowerCase().trim();
      if (taskType.includes('log_editing')) dayBuckets[targetDay].log_editing += 1;
      else if (taskType.includes('log_fix')) dayBuckets[targetDay].log_fix += 1;
      else if (taskType.includes('full_check')) dayBuckets[targetDay].full_check += 1;
      else if (taskType.includes('lite')) dayBuckets[targetDay].lite += 1;
      else if (taskType.includes('drivers_check') || taskType.includes('driver_check')) dayBuckets[targetDay].drivers_check += 1;
      else dayBuckets[targetDay].other += 1;

      // Prod.Mod time tracking — parallel to dayBuckets, does not affect PMS logic
      // Fallback chain: inProgressSpendTimeSec may be absent or 0; use totalSpentTimeSec / actualTotalSpentTimeSec as backup
      const timeSpent    = Number(task?.inProgressSpendTimeSec || task?.totalSpentTimeSec || task?.actualTotalSpentTimeSec || 0);
      const noCharge     = Number(task?.totalNoChargeTimeSec || 0);
      const isFullChk = taskType.includes('full_check');

      // Per-category secs for I/J/K avg time columns
      if (taskType.includes('log_editing'))  prodTimes.log_editing += timeSpent;
      else if (taskType.includes('log_fix')) prodTimes.log_fix     += timeSpent;
      else if (taskType.includes('lite'))    prodTimes.lite         += timeSpent;
      prodTimes.totalNoCharge += noCharge;

      // O/P/Q metrics: ALL tasks get totalAll; target = all except full_check
      prodTimes.totalAllInProgressSec += timeSpent;
      prodTimes.totalAllNoChargeSec   += noCharge;
      if (!isFullChk) {
        prodTimes.targetTasksCount    += 1;
        prodTimes.targetInProgressSec += timeSpent;
        prodTimes.targetNoChargeSec   += noCharge;
      }
    });

    dayOffs.forEach((off) => {
      let currentMs = Number(off?.dateFrom);
      const endMs = Number(off?.dateTo ?? off?.dateFrom);
      const letter = statusToLetter(off?.scheduleType || off?.shiftStatus);
      if (!letter) return;

      while (currentMs <= endMs) {
        const d = new Date(currentMs + offsetHours * 3600000);
        if (d.getUTCMonth() === baseMonth && d.getUTCFullYear() === baseYear) {
            const day = getSafeFullDay(currentMs);
            if (day && day >= 1 && day <= 31) {
              dayOffStatuses[day] = letter;
            }
        }
        currentMs += 86400000;
      }
    });

    Object.entries(dayBuckets).forEach(([dayKey, cats]) => {
      const idx = Number(dayKey) - 1;
      Object.keys(dayCats).forEach((cat) => {
        if ((cats[cat] || 0) > 0) dayCats[cat][idx] = (Number(dayCats[cat][idx]) || 0) + cats[cat];
      });
    });

    // КРОК 4: "L" — малі години суворо за графіком (записується у головний рядок)
    const agId = entry?.agentDTO?.userId || entry?.agentDTO?.agentId || entry?.agentId || entry?.candidateId;
    const workHoursArray = options.agentWorkHoursCache?.[agId] || [];

    shifts.forEach(shift => {
      const shiftStartMs = Number(shift.dateFrom);
      const shiftDateObj = new Date(shiftStartMs + (offsetHours || 2) * 3600000);

      if (shiftDateObj.getUTCMonth() !== baseMonth || shiftDateObj.getUTCFullYear() !== baseYear) return;

      const shiftDay = shiftDateObj.getUTCDate();
      if (!shiftDay || shiftDay < 1 || shiftDay > 31) return;

      const matchedWork = workHoursArray.find(wh => {
        const whStart = wh.eventStartDTO?.eventDate || wh.eventDateMs;
        if (!whStart) return false;
        const whDate = new Date(Number(whStart) + (offsetHours || 2) * 3600000);
        const isSameDay = whDate.getUTCFullYear() === baseYear &&
                          whDate.getUTCMonth() === baseMonth &&
                          whDate.getUTCDate() === shiftDay;
        if (!isSameDay) return false;
        const timeDiffMs = Math.abs(Number(whStart) - shiftStartMs);
        return timeDiffMs <= 4 * 60 * 60 * 1000;
      });

      if (matchedWork && matchedWork.workTimeMs != null && Number(matchedWork.workTimeMs) < 18000000) {
        dayCats.other[shiftDay - 1] = 'L';
      }
    });

    // КРОК 4.5: Заповнюємо підрядки нулями для активних змін (без вихідних)
    // Якщо агент мав зміну в цей день і не має маркера вихідного — порожні підрядки стають 0.
    const subCatKeys = ['log_editing', 'log_fix', 'full_check', 'lite', 'drivers_check', 'other'];
    shifts.forEach((shift) => {
      const shiftMs = Number(shift.dateFrom);
      const shiftDateObj = new Date(shiftMs + (offsetHours || 2) * 3600000);
      if (shiftDateObj.getUTCMonth() !== baseMonth || shiftDateObj.getUTCFullYear() !== baseYear) return;
      const shiftDay = shiftDateObj.getUTCDate();
      if (!shiftDay || shiftDay < 1 || shiftDay > 31) return;
      if (dayOffStatuses[shiftDay]) return;
      subCatKeys.forEach((cat) => {
        if (dayCats[cat][shiftDay - 1] === '') dayCats[cat][shiftDay - 1] = 0;
      });
    });

    // КРОК 5: Будуємо рядки матриці PMS (головний + підрядки)
    const mainRow = ['PMS_MAIN:' + nameRaw];
    for (let i = 1; i <= 31; i++) {
      const otherVal = dayCats.other[i - 1];
      const dayOffVal = dayOffStatuses[i] || '';
      mainRow.push(otherVal !== '' ? otherVal : dayOffVal);
    }

    const subRowDefs = [
      { key: 'log_editing',   label: 'PMS_SUB:log editing' },
      { key: 'log_fix',       label: 'PMS_SUB:log fix' },
      { key: 'lite',          label: 'PMS_SUB:lite' },
      { key: 'full_check',    label: 'PMS_SUB:full check' },
      { key: 'drivers_check', label: 'PMS_SUB:drivers check' },
    ];

    rows.push(mainRow);
    subRowDefs.forEach(({ key, label }) => {
      const subRow = [label];
      for (let i = 1; i <= 31; i++) {
        subRow.push(dayCats[key][i - 1] !== '' ? dayCats[key][i - 1] : '');
      }
      rows.push(subRow);
    });
    // Prod.Mod: Standard Working Hours — сума тривалостей змін за місяць (десятковий формат)
    let standardWorkingHours = 0;
    const isDebugAgent = shiftDebugCount < 5;
    if (isDebugAgent) { shiftDebugCount++; }
    if (isDebugAgent) {
      console.log(`\n[SHIFT DEBUG] === Агент: ${nameRaw} | Всього змін у масиві: ${shifts.length} ===`);
    }
    shifts.forEach((shift, index) => {
      if (!shift.dateFrom || !shift.dateTo) return;
      const shiftMs = Number(shift.dateFrom);
      const shiftDateObj = new Date(shiftMs + (offsetHours || 2) * 3600000);
      if (shiftDateObj.getUTCMonth() !== baseMonth || shiftDateObj.getUTCFullYear() !== baseYear) {
        if (isDebugAgent) {
          console.log(`  [${index + 1}] ПРОПУЩЕНО (інший місяць) | ${new Date(shiftMs).toLocaleString()} — місяць: ${shiftDateObj.getUTCMonth() + 1}/${shiftDateObj.getUTCFullYear()}`);
        }
        return;
      }
      const durationHours = (Number(shift.dateTo) - shiftMs) / (1000 * 60 * 60);
      standardWorkingHours += durationHours;
      if (isDebugAgent) {
        const startStr = new Date(shiftMs).toLocaleString();
        const endStr   = new Date(Number(shift.dateTo)).toLocaleString();
        console.log(`  [${index + 1}] ID: ${shift.id || shift.shiftId || '—'} | ${startStr} → ${endStr} | Тривалість: ${durationHours} год`);
      }
    });
    standardWorkingHours = Math.round(standardWorkingHours * 100) / 100;
    if (isDebugAgent) {
      console.log(`[SHIFT DEBUG] ФІНАЛЬНА СУМА для ${nameRaw}: ${standardWorkingHours} год\n`);
    }

    // Prod.Mod time row indices:
    // [0]=label [1]=log_editing [2]=log_fix [3]=lite [4]=totalNoCharge
    // [5]=targetTasksCount [6]=targetInProgressSec [7]=targetNoChargeSec
    // [8]=totalAllInProgressSec [9]=totalAllNoChargeSec [10]=standardWorkingHours
    rows.push(['PMS_TIME:',
      prodTimes.log_editing, prodTimes.log_fix, prodTimes.lite, prodTimes.totalNoCharge,
      prodTimes.targetTasksCount, prodTimes.targetInProgressSec, prodTimes.targetNoChargeSec,
      prodTimes.totalAllInProgressSec, prodTimes.totalAllNoChargeSec,
      standardWorkingHours,
    ]);
  };

  let shiftDebugCount = 0;
  (orchardData || []).forEach(processAgent);

  return rows;
}

export function mapMatrixToUpdatesBg(matrixRows, sheetValues, monthYear = {}, utcOffset = 0) {
  const values = Array.isArray(sheetValues?.values) ? sheetValues.values : sheetValues || [];
  const sheetRows = Array.isArray(sheetValues?.result?.values) ? sheetValues.result.values : values;

  // Extract the sheet tab name from the API response (e.g. "Tasks all!A1:ZZ500" → "Tasks all").
  // Using the same tab name for writes ensures data lands in the correct sheet regardless of tab order.
  const rawRange = sheetValues?.range || '';
  const sheetName = rawRange.split('!')[0].replace(/^'|'$/g, '') || 'Tasks all';
  const rp = `'${sheetName}'!`;
  const dateToCol = {};
  const targetMonth = Number(monthYear.month) || (new Date().getMonth() + 1);
  const targetYear = Number(monthYear.year) || new Date().getFullYear();
  const monthNamesEn = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
  const monthNamesUa = ['січень', 'лютий', 'березень', 'квітень', 'травень', 'червень', 'липень', 'серпень', 'вересень', 'жовтень', 'листопад', 'грудень'];
  const targetNameEn = monthNamesEn[targetMonth - 1];
  const targetNameUa = monthNamesUa[targetMonth - 1];

  const row2 = (sheetRows || [])[1] || [];
  const row3 = (sheetRows || [])[2] || [];
  const headerRowData = row3;

  let startCol = -1;
  let endCol = Math.max(row2.length, row3.length);

  for (let i = 0; i < row2.length; i++) {
    const valRaw = row2[i];
    const val = String(valRaw || '').toLowerCase().trim();
    if (!val) continue;
    const containsMonth = val.includes(targetNameEn) || val.includes(targetNameUa) || val.includes(` ${targetMonth} `) || val.startsWith(`${targetMonth}/`) || val.includes(`.${targetMonth}.`);
    const containsYear = val.includes(String(targetYear));
    if (containsMonth && containsYear) {
      startCol = i;
      for (let j = i + 1; j < row2.length; j++) {
        const nextVal = row2[j];
        if (nextVal && String(nextVal).trim() !== '' && !String(nextVal).includes('=')) {
          endCol = j;
          break;
        }
      }
      break;
    }
  }


  const maxHeaderCol = Math.max(row2.length, row3.length, startCol === -1 ? 0 : startCol + 40);
  if (startCol !== -1 && endCol <= startCol + 1) {
    endCol = Math.min(maxHeaderCol, startCol + 40);
  }

  const parseDayFromHeaderCell = (cell) => {
    const cellValue = String(cell ?? '').trim();
    if (!cellValue) return null;

    const strictDay = cellValue.match(/^(\d{1,2})$/);
    if (strictDay) {
      const day = parseInt(strictDay[1], 10);
      return day >= 1 && day <= 31 ? day : null;
    }

    const dateLikeDay = cellValue.match(/^(\d{1,2})(?:\D|$)/);
    if (dateLikeDay) {
      const day = parseInt(dateLikeDay[1], 10);
      return day >= 1 && day <= 31 ? day : null;
    }

    return null;
  };

  if (startCol !== -1) {
    for (let col = startCol; col < endCol; col++) {
      const rawCell = row3[col];
      const day = parseDayFromHeaderCell(rawCell);
      if (day !== null) {
        dateToCol[day] = col;
      }
    }
  } else {
    console.error(`КРИТИЧНО PMS: Місяць ${targetMonth}/${targetYear} не знайдено в Row 2!`);
  }


  const colA = values.map((row) => (row && row[0] ? row[0].toString().toLowerCase().trim() : ''));

  const updates = [];
  const missing = [];

  const findSubRowIdx = (fromIdx, subLabel) => {
    for (let k = fromIdx + 1; k <= fromIdx + 10 && k < colA.length; k++) {
      if (colA[k].toLowerCase().trim() === subLabel) return k;
    }
    return -1;
  };

  let currentAgentRowIdx = -1;

  for (let i = 1; i < matrixRows.length; i++) {
    const row = matrixRows[i];
    const label = String(row[0] || '');

    if (label.startsWith('PMS_MAIN:')) {
      const agentNameRaw = label.slice('PMS_MAIN:'.length);
      const baseName = cleanNameBase(agentNameRaw);
      currentAgentRowIdx = colA.findIndex((cell) => isAgentMatch(baseName, cell));

      if (currentAgentRowIdx === -1) {
        missing.push(baseName);
        continue;
      }
      for (let day = 1; day <= 31; day++) {
        const colIdx = dateToCol[day];
        const value = row[day];
        if (colIdx === undefined) continue;
        if (value === undefined || value === null || value === '') continue;
        updates.push({ range: `${rp}${columnToLetter(colIdx)}${currentAgentRowIdx + 1}`, values: [[value]] });
      }
      continue;
    }

    if (label.startsWith('PMS_SUB:') && currentAgentRowIdx !== -1) {
      const subLabel = label.slice('PMS_SUB:'.length).toLowerCase().trim();
      const subRowIdx = findSubRowIdx(currentAgentRowIdx, subLabel);
      if (subRowIdx === -1) continue;

      for (let day = 1; day <= 31; day++) {
        const colIdx = dateToCol[day];
        const value = row[day];
        if (colIdx === undefined) continue;
        if (value === undefined || value === null || value === '') continue;
        updates.push({ range: `${rp}${columnToLetter(colIdx)}${subRowIdx + 1}`, values: [[value]] });
      }
    }
  }

  return { updates, missingAgents: missing };
}

export function inferMonthYear(targetMonth, targetYear, site1Cache = [], site2Cache = []) {
  if (targetMonth && targetYear) return { month: targetMonth, year: targetYear };
  const allDates = [];
  site1Cache.forEach((t) => {
    const ts = Number(t?.createDate);
    if (!Number.isNaN(ts)) allDates.push(ts);
  });
  site2Cache.forEach((s) => {
    const ts = Number(s?.shiftDate || s?.dateFrom || s?.shiftDateFrom);
    if (!Number.isNaN(ts)) allDates.push(ts);
  });
  const ts = allDates.length ? Math.min(...allDates) : Date.now();
  const d = new Date(ts);
  return { month: d.getMonth() + 1, year: d.getFullYear() };
}

export async function aggregateTrackensure() {
  const stored = await readFromStorage(DATA_KEYS.site1);
  const tasks = Array.isArray(stored) ? stored : [];
  if (!tasks.length) return { ok: false, error: 'Немає даних для зведення' };

  const tagTasks = tasks.filter((t) => (t.origin || 'tag') === 'tag');
  const simplified = tagTasks.map((t) => ({
    requestType: t.requestType,
    status: t.status,
    totalSpentTimeSec: t.totalSpentTimeSec,
    ownerFullName: t.ownerDTO?.fullName,
  }));

  const tagCounts = simplified.reduce((acc, t) => {
    const key = t.ownerFullName || 'Без імені';
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});

  const tlCounts = tasks
    .filter((t) => t.origin === 'tl')
    .reduce((acc, t) => {
      const key = t.originTLName || t.originTLId || 'unknown';
      acc[key] = (acc[key] || 0) + 1;
      return acc;
    }, {});

  const lines = [
    ...Object.entries(tagCounts).map(([name, count]) => `${name} - ${count}`),
    ...Object.entries(tlCounts).map(([name, count]) => `${name} TL - ${count}`),
  ];

  chrome.runtime.sendMessage({
    type: 'COLLECT_PROGRESS',
    site: 'PMS Сайт 1',
    message: lines.join('\n') || 'Результати порожні',
    code: 200,
  });

  console.log('PMS Tag tasks simplified', simplified);
  return { ok: true, tlCounts, tagTasks: simplified };
}
