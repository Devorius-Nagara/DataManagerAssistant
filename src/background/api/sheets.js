export const getGoogleToken = () => {
  return new Promise((resolve, reject) => {
    chrome.identity.getAuthToken({ interactive: true }, function(token) {
      if (chrome.runtime.lastError || !token) {
        reject(chrome.runtime.lastError);
      } else {
        resolve(token);
      }
    });
  });
};

export async function fetchSheetValuesBg(spreadsheetId, token, range = 'A1:ZZ500') {
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${range}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Sheets GET ${res.status}: ${text.slice(0, 200)}`);
  }
  return JSON.parse(text);
}

export async function executeSheetsBatch(payload = {}) {
  const { sheetId, token, batchUpdateData } = payload || {};
  if (!sheetId || !token || !Array.isArray(batchUpdateData)) throw new Error('Невірні дані для запису');
  if (!batchUpdateData.length) throw new Error('Немає клітинок для оновлення');

  const url = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values:batchUpdate`;
  const body = {
    valueInputOption: 'USER_ENTERED',
    data: batchUpdateData,
  };
  console.time('GoogleSheetsBatch');
  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  console.timeEnd('GoogleSheetsBatch');

  if (!res.ok) {
    if (res.status === 401) {
      chrome.storage.local.remove(['googleAccessToken', 'googleTokenExpiry']);
      try {
        await new Promise((resolve) => chrome.identity.removeCachedAuthToken({ token }, resolve));
      } catch { /* ignore */ }
      throw new Error('Токен авторизації застарів (401). Будь ласка, авторизуйтеся знову.');
    }

    const responseBody = await res.text();
    let errMessage = `Sheets update ${res.status}`;
    try {
      const errJson = JSON.parse(responseBody);
      console.error('Google API error:', errJson);
      errMessage = `Google API відхилив запит: ${errJson.error?.message || 'Невідома помилка'}`;
    } catch {
      console.error('Google API error:', responseBody.slice(0, 200));
      errMessage = `${errMessage}: ${responseBody.slice(0, 200)}`;
    }
    throw new Error(errMessage);
  }

  const text = await res.text();
  try {
    const parsed = JSON.parse(text);
    return { ok: true, result: parsed };
  } catch {
    return { ok: true, raw: text };
  }
}

export async function exportWorkloadReport(token, spreadsheetId, dataMatrix, sheetTitle) {
  const baseUrl = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}`;
  let title = sheetTitle || `Workload ${new Date().toLocaleDateString('uk-UA')}`;

  const tryAddSheet = async (t) => fetch(`${baseUrl}:batchUpdate`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ requests: [{ addSheet: { properties: { title: t, index: 0 } } }] }),
  });

  let numericSheetId = null;
  let createRes = await tryAddSheet(title);
  if (!createRes.ok) {
    const errText = await createRes.text();
    let errMsg = '';
    try { errMsg = JSON.parse(errText)?.error?.message || ''; } catch { /* ignore */ }
    if (createRes.status === 400 && errMsg.toLowerCase().includes('already exists')) {
      title = `${title} (${Date.now()})`;
      const retry = await tryAddSheet(title);
      if (!retry.ok) { const t2 = await retry.text(); throw new Error(`Не вдалося створити аркуш: ${t2.slice(0, 200)}`); }
      numericSheetId = (await retry.json())?.replies?.[0]?.addSheet?.properties?.sheetId ?? null;
    } else {
      throw new Error(`Не вдалося створити аркуш: ${errMsg || errText.slice(0, 200)}`);
    }
  } else {
    numericSheetId = (await createRes.json())?.replies?.[0]?.addSheet?.properties?.sheetId ?? null;
  }

  // Write data
  const numCols = dataMatrix[0]?.length || 1;
  const endCol  = String.fromCharCode(64 + numCols);
  const numRows = dataMatrix.length;
  const safeTitle = title.replace(/'/g, "''");
  const writeRes = await fetch(`${baseUrl}/values:batchUpdate`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ valueInputOption: 'USER_ENTERED', data: [{ range: `'${safeTitle}'!A1:${endCol}${numRows}`, values: dataMatrix }] }),
  });
  if (!writeRes.ok) {
    const e = await writeRes.text();
    let msg = e.slice(0, 200);
    try { msg = JSON.parse(e)?.error?.message || msg; } catch { /* ignore */ }
    throw new Error(`Не вдалося записати дані: ${msg}`);
  }

  // Format (non-fatal)
  // Columns: 0=Date, 1=Shift, 2=Tasks, 3=TLs, 4=Agents, 5=Absent, 6=Extra, 7=Peak Hour, 8=Peak Wait
  if (numericSheetId != null) {
    try {
      await fetch(`${baseUrl}:batchUpdate`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          requests: [
            {
              repeatCell: {
                range: { sheetId: numericSheetId },
                cell: { userEnteredFormat: { wrapStrategy: 'WRAP', verticalAlignment: 'TOP' } },
                fields: 'userEnteredFormat.wrapStrategy,userEnteredFormat.verticalAlignment',
              },
            },
            {
              repeatCell: {
                range: { sheetId: numericSheetId, startRowIndex: 0, endRowIndex: 1 },
                cell: { userEnteredFormat: { backgroundColor: { red: 0.85, green: 0.93, blue: 1.0 } } },
                fields: 'userEnteredFormat.backgroundColor',
              },
            },
            { updateDimensionProperties: { range: { sheetId: numericSheetId, dimension: 'COLUMNS', startIndex: 0, endIndex: 1 }, properties: { pixelSize: 95 },  fields: 'pixelSize' } },
            { updateDimensionProperties: { range: { sheetId: numericSheetId, dimension: 'COLUMNS', startIndex: 1, endIndex: 2 }, properties: { pixelSize: 115 }, fields: 'pixelSize' } },
            { updateDimensionProperties: { range: { sheetId: numericSheetId, dimension: 'COLUMNS', startIndex: 2, endIndex: 7 }, properties: { pixelSize: 60 },  fields: 'pixelSize' } },
            { updateDimensionProperties: { range: { sheetId: numericSheetId, dimension: 'COLUMNS', startIndex: 7, endIndex: 8 }, properties: { pixelSize: 190 }, fields: 'pixelSize' } },
            { updateDimensionProperties: { range: { sheetId: numericSheetId, dimension: 'COLUMNS', startIndex: 8, endIndex: 9 }, properties: { pixelSize: 100 }, fields: 'pixelSize' } },
          ],
        }),
      });
    } catch { /* formatting errors are non-fatal */ }
  }

  return { ok: true };
}

// ─── PMS vertical report ──────────────────────────────────────────────────────
// dataMatrix: array of [colA, colB] rows
// rowTypes:   parallel array — 'shift_header' | 'agent_name' | 'task_row' | 'empty'

export async function exportPmsReport(token, spreadsheetId, dataMatrix, rowTypes, sheetTitle) {
  const baseUrl = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}`;
  let title = sheetTitle || `PMS ${new Date().toLocaleDateString('uk-UA')}`;

  const tryAddSheet = async (t) => fetch(`${baseUrl}:batchUpdate`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ requests: [{ addSheet: { properties: { title: t, index: 0 } } }] }),
  });

  let numericSheetId = null;
  let createRes = await tryAddSheet(title);
  if (!createRes.ok) {
    const errText = await createRes.text();
    let errMsg = '';
    try { errMsg = JSON.parse(errText)?.error?.message || ''; } catch { /* ignore */ }
    if (createRes.status === 400 && errMsg.toLowerCase().includes('already exists')) {
      title = `${title} (${Date.now()})`;
      const retry = await tryAddSheet(title);
      if (!retry.ok) { const t2 = await retry.text(); throw new Error(`Не вдалося створити аркуш: ${t2.slice(0, 200)}`); }
      numericSheetId = (await retry.json())?.replies?.[0]?.addSheet?.properties?.sheetId ?? null;
    } else {
      throw new Error(`Не вдалося створити аркуш: ${errMsg || errText.slice(0, 200)}`);
    }
  } else {
    numericSheetId = (await createRes.json())?.replies?.[0]?.addSheet?.properties?.sheetId ?? null;
  }

  const numRows   = dataMatrix.length;
  const safeTitle = title.replace(/'/g, "''");
  const writeRes  = await fetch(`${baseUrl}/values:batchUpdate`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      valueInputOption: 'USER_ENTERED',
      data: [{ range: `'${safeTitle}'!A1:B${numRows}`, values: dataMatrix }],
    }),
  });
  if (!writeRes.ok) {
    const e = await writeRes.text();
    let msg = e.slice(0, 200);
    try { msg = JSON.parse(e)?.error?.message || msg; } catch { /* ignore */ }
    throw new Error(`Не вдалося записати дані: ${msg}`);
  }

  if (numericSheetId != null) {
    try {
      const boldRows = (rowTypes || [])
        .map((type, idx) => (type === 'shift_header' || type === 'agent_name') ? idx : -1)
        .filter(idx => idx >= 0);
      const bgRows = (rowTypes || [])
        .map((type, idx) => type === 'shift_header' ? idx : -1)
        .filter(idx => idx >= 0);

      await fetch(`${baseUrl}:batchUpdate`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          requests: [
            {
              repeatCell: {
                range: { sheetId: numericSheetId },
                cell: { userEnteredFormat: { wrapStrategy: 'WRAP', verticalAlignment: 'TOP' } },
                fields: 'userEnteredFormat.wrapStrategy,userEnteredFormat.verticalAlignment',
              },
            },
            { updateDimensionProperties: { range: { sheetId: numericSheetId, dimension: 'COLUMNS', startIndex: 0, endIndex: 1 }, properties: { pixelSize: 220 }, fields: 'pixelSize' } },
            { updateDimensionProperties: { range: { sheetId: numericSheetId, dimension: 'COLUMNS', startIndex: 1, endIndex: 2 }, properties: { pixelSize: 80  }, fields: 'pixelSize' } },
            ...boldRows.map(idx => ({
              repeatCell: {
                range: { sheetId: numericSheetId, startRowIndex: idx, endRowIndex: idx + 1 },
                cell: { userEnteredFormat: { textFormat: { bold: true } } },
                fields: 'userEnteredFormat.textFormat.bold',
              },
            })),
            ...bgRows.map(idx => ({
              repeatCell: {
                range: { sheetId: numericSheetId, startRowIndex: idx, endRowIndex: idx + 1 },
                cell: { userEnteredFormat: { backgroundColor: { red: 0.85, green: 0.93, blue: 1.0 } } },
                fields: 'userEnteredFormat.backgroundColor',
              },
            })),
          ],
        }),
      });
    } catch { /* formatting errors are non-fatal */ }
  }

  return { ok: true };
}

export async function exportCustomReport(token, spreadsheetId, dataMatrix, dateRangeStr) {
  const baseUrl = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}`;
  let sheetTitle = dateRangeStr || `Dispute ${new Date().toLocaleDateString('uk-UA')}`;

  const tryAddSheet = async (title) => {
    return fetch(`${baseUrl}:batchUpdate`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ requests: [{ addSheet: { properties: { title, index: 0 } } }] }),
    });
  };

  // Step 1: Create the sheet, capturing its numeric sheetId for formatting
  let numericSheetId = null;
  let createRes = await tryAddSheet(sheetTitle);

  if (!createRes.ok) {
    const errText = await createRes.text();
    let errMsg = '';
    try { errMsg = JSON.parse(errText)?.error?.message || ''; } catch { /* ignore */ }
    if (createRes.status === 400 && errMsg.toLowerCase().includes('already exists')) {
      sheetTitle = `${sheetTitle} (${Date.now()})`;
      const retryRes = await tryAddSheet(sheetTitle);
      if (!retryRes.ok) {
        const retryText = await retryRes.text();
        throw new Error(`Не вдалося створити аркуш: ${retryText.slice(0, 200)}`);
      }
      const retryJson = await retryRes.json();
      numericSheetId = retryJson?.replies?.[0]?.addSheet?.properties?.sheetId ?? null;
    } else {
      throw new Error(`Не вдалося створити аркуш: ${errMsg || errText.slice(0, 200)}`);
    }
  } else {
    const createJson = await createRes.json();
    numericSheetId = createJson?.replies?.[0]?.addSheet?.properties?.sheetId ?? null;
  }

  // Step 2: Write data via values:batchUpdate
  const numCols = dataMatrix[0]?.length || 1;
  const endCol = String.fromCharCode(64 + numCols);
  const numRows = dataMatrix.length;
  const safeTitle = sheetTitle.replace(/'/g, "''");
  const range = `'${safeTitle}'!A1:${endCol}${numRows}`;

  const writeRes = await fetch(`${baseUrl}/values:batchUpdate`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      valueInputOption: 'USER_ENTERED',
      data: [{ range, values: dataMatrix }],
    }),
  });

  if (!writeRes.ok) {
    const writeErrText = await writeRes.text();
    let writeErrMsg = writeErrText.slice(0, 200);
    try { writeErrMsg = JSON.parse(writeErrText)?.error?.message || writeErrMsg; } catch { /* ignore */ }
    throw new Error(`Не вдалося записати дані: ${writeErrMsg}`);
  }

  // Step 3: Apply visual formatting (non-fatal — data is already written)
  // Column layout: 0=taskId, 1=createDate, 2=status, 3=requestType, 4=eldType,
  //                5=Organization, 6=Driver, 7=inProgressTime, 8=noChargeTime,
  //                9=totalSpentTime, 10=Owner, 11+ = disputeReason or comment columns
  if (numericSheetId != null) {
    const formatRequests = [
      // Wrap all cells + vertical align top
      {
        repeatCell: {
          range: { sheetId: numericSheetId },
          cell: { userEnteredFormat: { wrapStrategy: 'WRAP', verticalAlignment: 'TOP' } },
          fields: 'userEnteredFormat.wrapStrategy,userEnteredFormat.verticalAlignment',
        },
      },
      // Light-blue background for header row (row 0 only)
      {
        repeatCell: {
          range: { sheetId: numericSheetId, startRowIndex: 0, endRowIndex: 1 },
          cell: {
            userEnteredFormat: {
              backgroundColor: { red: 0.85, green: 0.93, blue: 1.0 },
            },
          },
          fields: 'userEnteredFormat.backgroundColor',
        },
      },
      // createDate (index 1) → 150px
      {
        updateDimensionProperties: {
          range: { sheetId: numericSheetId, dimension: 'COLUMNS', startIndex: 1, endIndex: 2 },
          properties: { pixelSize: 150 },
          fields: 'pixelSize',
        },
      },
      // Organization (index 5) → 200px
      {
        updateDimensionProperties: {
          range: { sheetId: numericSheetId, dimension: 'COLUMNS', startIndex: 5, endIndex: 6 },
          properties: { pixelSize: 200 },
          fields: 'pixelSize',
        },
      },
      // Driver (index 6) → 180px
      {
        updateDimensionProperties: {
          range: { sheetId: numericSheetId, dimension: 'COLUMNS', startIndex: 6, endIndex: 7 },
          properties: { pixelSize: 180 },
          fields: 'pixelSize',
        },
      },
      // Owner (index 10) → 150px
      {
        updateDimensionProperties: {
          range: { sheetId: numericSheetId, dimension: 'COLUMNS', startIndex: 10, endIndex: 11 },
          properties: { pixelSize: 150 },
          fields: 'pixelSize',
        },
      },
      // All text columns from index 11 to end (disputeReason or comment 1..N) → 350px
      {
        updateDimensionProperties: {
          range: { sheetId: numericSheetId, dimension: 'COLUMNS', startIndex: 11, endIndex: numCols },
          properties: { pixelSize: 350 },
          fields: 'pixelSize',
        },
      },
    ];

    try {
      await fetch(`${baseUrl}:batchUpdate`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ requests: formatRequests }),
      });
    } catch { /* formatting errors are non-fatal */ }
  }

  return { ok: true };
}

// ─── Private helpers for PMS template-based export ────────────────────────────

function _pmsColLetter(idx) {
  let s = '';
  for (let n = idx; n >= 0; n = Math.floor(n / 26) - 1) {
    s = String.fromCharCode(65 + (n % 26)) + s;
  }
  return s;
}

function _pmsNormalize(str) {
  return String(str || '').toLowerCase().replace(/[^a-z0-9а-яіїєё]/g, ' ').replace(/\s+/g, ' ').trim();
}

function _pmsMatchDate(cell, ourDateSet) {
  const s = String(cell || '').trim();
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s) && ourDateSet.has(s)) return s;
  const m1 = s.match(/^(\d{1,2})[./](\d{1,2})[./](\d{4})$/);
  if (m1) {
    const iso = `${m1[3]}-${m1[2].padStart(2,'0')}-${m1[1].padStart(2,'0')}`;
    if (ourDateSet.has(iso)) return iso;
  }
  const m2 = s.match(/^(\d{1,2})[./](\d{1,2})$/);
  if (m2) {
    const day = m2[1].padStart(2,'0'), mon = m2[2].padStart(2,'0');
    for (const d of ourDateSet) { if (d.slice(8) === day && d.slice(5,7) === mon) return d; }
  }
  const m3 = s.match(/^(\d{1,2})$/);
  if (m3) {
    const day = m3[1].padStart(2,'0');
    const hits = [...ourDateSet].filter(d => d.slice(8) === day);
    if (hits.length === 1) return hits[0];
  }
  return null;
}

const _PMS_TASK_PATTERNS = [
  { pattern: 'log editing',   key: 'log editing'   },
  { pattern: 'log fix',       key: 'log fix'        },
  { pattern: 'lite',          key: 'lite'           },
  { pattern: 'full check',    key: 'full check'     },
  { pattern: 'drivers check', key: 'drivers check'  },
  { pattern: 'driver check',  key: 'drivers check'  },
];

function _pmsFindAgent(agentSheetMap, agentName) {
  const norm = _pmsNormalize(agentName);
  if (agentSheetMap[norm]) return norm;
  const words = norm.split(' ').filter(w => w.length > 2);
  let bestKey = null, bestScore = 0;
  for (const key of Object.keys(agentSheetMap)) {
    if (key === norm || key.includes(norm) || norm.includes(key)) return key;
    const kWords = key.split(' ').filter(w => w.length > 2);
    const hits = words.filter(w => kWords.some(kw => kw.includes(w) || w.includes(kw)));
    if (hits.length >= 2 && hits.length > bestScore) { bestScore = hits.length; bestKey = key; }
  }
  return bestKey;
}

// ─── PMS template-based export ────────────────────────────────────────────────
// Reads an existing Google Sheets template, finds agent name rows and their task
// sub-rows (log editing, log fix, lite, full check, drivers check), matches date
// columns, then writes task counts via values:batchUpdate.
// agentDateMap: { agentName: { 'YYYY-MM-DD': { log_editing, log_fix, ... } } }

export async function exportPmsToSheets(token, spreadsheetId, agentDateMap, dayOffStatuses = {}) {
  const base = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}`;

  const metaRes = await fetch(`${base}?fields=sheets.properties(title,index)`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!metaRes.ok) throw new Error(`Не вдалося прочитати метадані таблиці (${metaRes.status})`);
  const meta = await metaRes.json();
  // Prefer a sheet whose name contains "task" (case-insensitive); fall back to first sheet
  const allSheets = meta.sheets || [];
  const taskSheet  = allSheets.find(s => s.properties?.title?.toLowerCase().includes('task'))
                  ?? allSheets[0];
  const sheetTitle = taskSheet?.properties?.title || 'Sheet1';
  const safeTitle  = sheetTitle.replace(/'/g, "''");
  console.log('[DEBUG PMS SHEET]', sheetTitle);

  // Read the full sheet width so column 72+ date headers are not missed
  const readRes = await fetch(`${base}/values/'${safeTitle}'!A1:ZZ700`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!readRes.ok) throw new Error(`Не вдалося прочитати таблицю (${readRes.status})`);
  const { values: rows = [] } = await readRes.json();

  // Determine target month/year from the dates present in agentDateMap (all YYYY-MM-DD)
  const allExportDates = Object.values(agentDateMap).flatMap(dm => Object.keys(dm));
  const [targetYear, targetMonth] = allExportDates.length
    ? [Number(allExportDates[0].slice(0, 4)), Number(allExportDates[0].slice(5, 7))]
    : [new Date().getFullYear(), new Date().getMonth() + 1];

  const MONTH_EN = ['january','february','march','april','may','june','july','august','september','october','november','december'];
  const MONTH_UA = ['січень','лютий','березень','квітень','травень','червень','липень','серпень','вересень','жовтень','листопад','грудень'];
  const mEn    = MONTH_EN[targetMonth - 1];
  const mUa    = MONTH_UA[targetMonth - 1];
  const mPad   = String(targetMonth).padStart(2, '0');
  const yStr   = String(targetYear);

  // Dump first 4 header rows for diagnostics
  for (let dr = 0; dr < Math.min(4, rows.length); dr++) {
    console.log(`[DEBUG PMS HEADER row${dr}]`, JSON.stringify((rows[dr] || []).slice(0, 10)));
  }

  const _cellMatchesMonth = (cell) => {
    const v = String(cell ?? '').toLowerCase().trim();
    if (!v || !v.includes(yStr)) return false;
    return v.includes(mEn) || v.includes(mUa)
        || v.includes(`/${targetMonth}/`) || v.includes(`/${mPad}/`)
        || v.includes(`.${targetMonth}.`) || v.includes(`.${mPad}.`)
        || v.startsWith(`${targetMonth}/`) || v.startsWith(`${mPad}/`)
        || new RegExp(`\\b${targetMonth}\\b`).test(v);
  };

  const _parseDayCell = (cell) => {
    const s = String(cell ?? '').trim();
    const m = s.match(/^(\d{1,2})(?:\D|$)/);
    if (m) { const d = parseInt(m[1], 10); return d >= 1 && d <= 31 ? d : null; }
    return null;
  };

  // Step 1: scan rows 0-9 for any cell matching this month+year → find startCol
  let monthHeaderRow = -1;
  let startCol = -1;
  let endCol   = 0;

  outer: for (let r = 0; r < Math.min(rows.length, 10); r++) {
    const row = rows[r] || [];
    for (let i = 0; i < row.length; i++) {
      if (_cellMatchesMonth(row[i])) {
        monthHeaderRow = r;
        startCol = i;
        endCol = row.length; // default: until end of row
        // Look for the next month marker in the same row → that's our endCol
        for (let j = i + 1; j < row.length; j++) {
          const nv = String(row[j] ?? '').trim();
          if (!nv) continue;
          // Stop at next month-marker cell OR any non-formula non-empty cell that is NOT a day number
          if (_cellMatchesMonth(row[j])) { endCol = j; break; }
        }
        // Fallback: cap at startCol + 35 if endCol is still the full row length
        if (endCol > startCol + 35) endCol = startCol + 35;
        break outer;
      }
    }
  }

  // Step 2: within [startCol, endCol], try monthHeaderRow and next 3 rows for day numbers
  // → pick the row that yields the most day matches (robust to different sheet layouts)
  const dateColMap = {};
  if (startCol !== -1) {
    let bestCount = 0;
    for (let dr = 0; dr <= 3; dr++) {
      const dayRow = rows[monthHeaderRow + dr] || [];
      const tmpMap = {};
      for (let col = startCol; col < endCol; col++) {
        const day = _parseDayCell(dayRow[col]);
        if (day !== null) {
          const iso = `${targetYear}-${mPad}-${String(day).padStart(2, '0')}`;
          if (!tmpMap[iso]) tmpMap[iso] = col;
        }
      }
      const cnt = Object.keys(tmpMap).length;
      if (cnt > bestCount) {
        bestCount = cnt;
        Object.keys(dateColMap).forEach(k => delete dateColMap[k]);
        Object.assign(dateColMap, tmpMap);
      }
      if (cnt >= 28) break; // found almost all days → stop
    }
  } else {
    console.error(`[PMS EXPORT] Місяць ${targetMonth}/${targetYear} не знайдено у перших 10 рядках шапки!`);
  }

  console.log('[DEBUG PMS DATE COLS] Found:', Object.keys(dateColMap).length,
    '| monthHeaderRow:', monthHeaderRow, '| startCol:', startCol, '| endCol:', endCol,
    '| Sample:', JSON.stringify(Object.entries(dateColMap).slice(0, 3)));

  // Find agent name rows and their task sub-rows
  const agentSheetMap = {};
  for (let r = 0; r < rows.length; r++) {
    const cellA = String(rows[r]?.[0] || '').trim();
    if (!cellA) continue;
    const cellNorm = _pmsNormalize(cellA);
    if (_PMS_TASK_PATTERNS.some(p => cellNorm === p.pattern || cellNorm.includes(p.pattern))) continue;

    const subRowsMap = {};
    for (let off = 1; off <= 8; off++) {
      const nCellA = _pmsNormalize(String(rows[r + off]?.[0] || ''));
      const pat = _PMS_TASK_PATTERNS.find(p => nCellA === p.pattern || nCellA.includes(p.pattern));
      if (pat && !subRowsMap[pat.key]) subRowsMap[pat.key] = r + off;
    }
    if (Object.keys(subRowsMap).length > 0) {
      const normKey = _pmsNormalize(cellA);
      if (!agentSheetMap[normKey]) agentSheetMap[normKey] = { cellA, rowIdx: r, subRowsMap };
    }
  }

  const KEY_TO_LABEL = {
    log_editing:   'log editing',
    log_fix:       'log fix',
    lite:          'lite',
    full_check:    'full check',
    drivers_check: 'drivers check',
  };

  const updates = [];
  const notFoundAgents = [];

  for (const [agentName, dateTasks] of Object.entries(agentDateMap)) {
    const matchKey = _pmsFindAgent(agentSheetMap, agentName);
    if (!matchKey) { notFoundAgents.push(agentName); continue; }
    const { rowIdx: agentRowIdx, subRowsMap } = agentSheetMap[matchKey];

    for (const [date, tasks] of Object.entries(dateTasks)) {
      const colIdx = dateColMap[date];
      if (colIdx == null) continue;
      const col = _pmsColLetter(colIdx);
      for (const [taskKey, label] of Object.entries(KEY_TO_LABEL)) {
        const rowIdx = subRowsMap[label];
        if (rowIdx == null) continue;
        updates.push({
          range:  `'${safeTitle}'!${col}${rowIdx + 1}`,
          values: [[tasks[taskKey] ?? 0]],
        });
      }
      // "other" has no sub-row — write directly to the agent's main row
      if ((tasks.other ?? 0) > 0) {
        const otherRange = `'${safeTitle}'!${col}${agentRowIdx + 1}`;
        console.log(`[DEBUG PMS OTHER] Агент: ${agentName} | Other: ${tasks.other} | Range: ${otherRange}`);
        updates.push({
          range:  otherRange,
          values: [[tasks.other]],
        });
      }
    }
  }

  // Write day-off / low-hours letters (V / O / S / L) — mirrors defaultModeBuilder's dayOffStatuses fallback:
  //   dayCellsAgent[i-1] || dayOffStatuses[i] || ''
  // Skip dates where the agent already has task data written above.
  for (const [agentName, dateLetter] of Object.entries(dayOffStatuses)) {
    console.log('[DEBUG PMS DAYOFF 2] Шукаємо рядок для вихідного агента:', agentName);
    const matchKey = _pmsFindAgent(agentSheetMap, agentName);
    if (!matchKey) continue;
    const { rowIdx: agentRowIdx } = agentSheetMap[matchKey];
    for (const [date, letter] of Object.entries(dateLetter)) {
      if (!letter) continue;
      if (agentDateMap[agentName]?.[date]) continue; // tasks already written → skip (same as default mode)
      const colIdx = dateColMap[date];
      if (colIdx == null) continue;
      const range = `'${safeTitle}'!${_pmsColLetter(colIdx)}${agentRowIdx + 1}`;
      console.log('[DEBUG PMS DAYOFF 3] Записуємо вихідний:', { range, status: letter });
      updates.push({ range, values: [[letter]] });
    }
  }

  console.log('[DEBUG PMS PAYLOAD TOTAL]', updates.length);
  if (updates.length > 0) {
    console.log('[DEBUG PMS PAYLOAD FIRST ITEM]', JSON.stringify(updates[0]));
  }

  if (updates.length === 0) {
    return { notFoundAgents: [...new Set(notFoundAgents)], updatesCount: 0 };
  }

  // Use executeSheetsBatch — same approach as the default mode export
  await executeSheetsBatch({ sheetId: spreadsheetId, token, batchUpdateData: updates });

  return { notFoundAgents: [...new Set(notFoundAgents)], updatesCount: updates.length };
}

function formatSecondsToHHMMSS(totalSeconds) {
  if (!totalSeconds || isNaN(totalSeconds) || totalSeconds <= 0) return '00:00:00';
  const h = Math.floor(totalSeconds / 3600).toString().padStart(2, '0');
  const m = Math.floor((totalSeconds % 3600) / 60).toString().padStart(2, '0');
  const s = Math.floor(totalSeconds % 60).toString().padStart(2, '0');
  return `${h}:${m}:${s}`;
}

// ─── Prod.Mod export ──────────────────────────────────────────────────────────
// Reads the PMS matrix (output of pmsBuildSheetMatrix), sums each agent's monthly
// task counts, then writes log_editing → F, log_fix → G, lite → H in the
// 'Productivity' sheet. If an agent is not found in col A, their name is
// auto-appended to the next free row. 100% isolated from exportPmsToSheets.
export async function exportProdToSheets({ token, spreadsheetId, matrixRows, prodSheetValues, rateMap = {} }) {
  // ── 1. Build column-A index from the Productivity sheet ──────────────────────
  //  Google Sheets returns only rows that have data, so colA.length = last filled row.
  //  Row 1 is reserved for the header; new agents start at row 2 minimum.
  const sheetData = Array.isArray(prodSheetValues?.values) ? prodSheetValues.values : [];
  const colA = sheetData.map((row) => String(row?.[0] || '').toLowerCase().trim());
  // Math.max handles empty sheet (colA.length=0 → nextFreeRow=2) and header-only (length=1 → 2)
  let nextFreeRow = Math.max(colA.length + 1, 2);

  // ── 2. Aggregate monthly totals per agent by parsing PMS_MAIN / PMS_SUB rows ─
  const agentTotals = {};   // { agentNameRaw: { log_editing, log_fix, lite } }
  let currentAgent = null;

  for (const row of matrixRows.slice(1)) {
    const label = String(row[0] || '');

    if (label.startsWith('PMS_MAIN:')) {
      currentAgent = label.slice('PMS_MAIN:'.length);
      agentTotals[currentAgent] = {
        log_editing: 0, log_fix: 0, lite: 0,
        log_editing_secs: 0, log_fix_secs: 0, lite_secs: 0,
        targetTasksCount: 0, targetInProgressSec: 0, targetNoChargeSec: 0,
        totalAllInProgressSec: 0, totalAllNoChargeSec: 0,
        standardWorkingHours: 0,
        prodTotalHours: 0,
      };
      continue;
    }

    if (label.startsWith('PMS_SUB:') && currentAgent) {
      const subLabel = label.slice('PMS_SUB:'.length).toLowerCase().trim();
      if (subLabel !== 'log editing' && subLabel !== 'log fix' && subLabel !== 'lite') continue;

      const monthTotal = row.slice(1).reduce((acc, v) => {
        const n = typeof v === 'number' ? v : Number(v);
        return acc + (Number.isFinite(n) ? n : 0);
      }, 0);

      if (subLabel === 'log editing') agentTotals[currentAgent].log_editing += monthTotal;
      else if (subLabel === 'log fix') agentTotals[currentAgent].log_fix   += monthTotal;
      else if (subLabel === 'lite')    agentTotals[currentAgent].lite       += monthTotal;
    }

    if (label === 'PMS_TIME:' && currentAgent) {
      agentTotals[currentAgent].log_editing_secs      = Number(row[1]) || 0;
      agentTotals[currentAgent].log_fix_secs          = Number(row[2]) || 0;
      agentTotals[currentAgent].lite_secs             = Number(row[3]) || 0;
      // row[4] = totalNoCharge (reserved for future use)
      agentTotals[currentAgent].targetTasksCount      = Number(row[5]) || 0;
      agentTotals[currentAgent].targetInProgressSec   = Number(row[6]) || 0;
      agentTotals[currentAgent].targetNoChargeSec     = Number(row[7]) || 0;
      agentTotals[currentAgent].totalAllInProgressSec = Number(row[8]) || 0;
      agentTotals[currentAgent].totalAllNoChargeSec   = Number(row[9]) || 0;
      agentTotals[currentAgent].standardWorkingHours  = Number(row[10]) || 0;
      agentTotals[currentAgent].prodTotalHours        = Number(row[11]) || 0;
    }
  }

  // ── 3. Sort alphabetically, then match or auto-append ────────────────────────
  const updates = [];
  const sortedEntries = Object.entries(agentTotals).sort(([a], [b]) => a.localeCompare(b));

  for (const [agentNameRaw, totals] of sortedEntries) {
    const baseName = agentNameRaw
      .toLowerCase()
      .replace(/\(eng\)/g, '')
      .replace(/teamleader/g, '')
      .replace(/agent\s*/g, '')
      .replace(/-?\s*ext[^\s]*/g, '')
      .replace(/\s+/g, ' ')
      .trim();

    const rowIdx = colA.findIndex((cell) => {
      const cleanedCell = cell
        .replace(/ext\.?\s*\d*/g, '')
        .replace(/\(eng\)/g, '')
        .replace(/\d+/g, '')
        .replace(/[-–]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
      const nameWords = baseName.split(' ').filter(Boolean);
      if (nameWords.length < 2) return cleanedCell.includes(baseName);
      const cellWords = new Set(cleanedCell.split(' ').filter(Boolean));
      return nameWords.every((w) => cellWords.has(w));
    });

    let sheetRow;
    if (rowIdx === -1) {
      // Agent not in the sheet — claim the next free row and write their name to col A
      sheetRow = nextFreeRow++;
      updates.push({ range: `'Productivity'!A${sheetRow}`, values: [[agentNameRaw]] });
    } else {
      sheetRow = rowIdx + 1; // 1-based sheet row
    }

    // Column B: Standard Working Hours (decimal)
    updates.push({ range: `'Productivity'!B${sheetRow}`, values: [[totals.standardWorkingHours]] });

    // Columns C/D: Extra Hours / Total Hours (injected into PMS_TIME row[11] in index.js)
    const totalHours = totals.prodTotalHours || 0;
    const extraHours = Math.round((totalHours - totals.standardWorkingHours) * 100) / 100;
    updates.push({ range: `'Productivity'!C${sheetRow}`, values: [[extraHours]] });
    updates.push({ range: `'Productivity'!D${sheetRow}`, values: [[totalHours]] });

    // Column E: Rate from Orchard (if available)
    // TODO: тимчасово вимкнено
    // const agentRate = rateMap[agentNameRaw];
    // if (agentRate != null) {
    //   updates.push({ range: `'Productivity'!E${sheetRow}`, values: [[`${agentRate}$`]] });
    // }

    updates.push({ range: `'Productivity'!F${sheetRow}`, values: [[totals.log_editing]] });
    updates.push({ range: `'Productivity'!G${sheetRow}`, values: [[totals.log_fix]]   });
    updates.push({ range: `'Productivity'!H${sheetRow}`, values: [[totals.lite]]       });

    const avgLogEditingSec = totals.log_editing > 0 ? Math.round(totals.log_editing_secs / totals.log_editing) : 0;
    const avgLogFixSec     = totals.log_fix     > 0 ? Math.round(totals.log_fix_secs     / totals.log_fix)     : 0;
    const avgLiteSec       = totals.lite        > 0 ? Math.round(totals.lite_secs        / totals.lite)        : 0;

    if (totals.log_editing > 0 || totals.log_fix > 0 || totals.lite > 0) {
      console.log(`[PROD TIME DEBUG] Агент: ${agentNameRaw}`);
      console.log(`  - Log Editing: ${totals.log_editing_secs} сек / ${totals.log_editing} тасків = ${avgLogEditingSec} сек avg (${formatSecondsToHHMMSS(avgLogEditingSec)})`);
      console.log(`  - Log Fix:     ${totals.log_fix_secs} сек / ${totals.log_fix} тасків = ${avgLogFixSec} сек avg (${formatSecondsToHHMMSS(avgLogFixSec)})`);
      console.log(`  - Lite:        ${totals.lite_secs} сек / ${totals.lite} тасків = ${avgLiteSec} сек avg (${formatSecondsToHHMMSS(avgLiteSec)})`);
    }

    updates.push({ range: `'Productivity'!I${sheetRow}`, values: [[formatSecondsToHHMMSS(avgLogEditingSec)]] });
    updates.push({ range: `'Productivity'!J${sheetRow}`, values: [[formatSecondsToHHMMSS(avgLogFixSec)]]     });
    updates.push({ range: `'Productivity'!K${sheetRow}`, values: [[formatSecondsToHHMMSS(avgLiteSec)]]       });

    // O: Avg Resolution Time (inProgress / count) for LE+LF+Lite+FC+Other
    // P: Avg Handling Time   ((inProgress + noCharge) / count) for same types
    // Q: Total Tasks Time    (inProgress + noCharge) for ALL task types
    const targetCount       = totals.targetTasksCount || 0;
    const avgResolutionSec  = targetCount > 0 ? Math.round(totals.targetInProgressSec / targetCount) : 0;
    const avgHandlingSec    = targetCount > 0 ? Math.round((totals.targetInProgressSec + totals.targetNoChargeSec) / targetCount) : 0;
    const totalTasksTimeSec = Math.round(totals.totalAllInProgressSec);

    if (totals.totalAllInProgressSec > 0) {
      console.log(`[PROD TIME DEBUG КРОК 3] Агент: ${agentNameRaw}`);
      console.log(`  - Target Tasks Count: ${targetCount}`);
      console.log(`  - Avg Resolution (O): ${totals.targetInProgressSec} sec / ${targetCount} = ${avgResolutionSec} sec (${formatSecondsToHHMMSS(avgResolutionSec)})`);
      console.log(`  - Avg Handling (P): (${totals.targetInProgressSec} + ${totals.targetNoChargeSec}) sec / ${targetCount} = ${avgHandlingSec} sec (${formatSecondsToHHMMSS(avgHandlingSec)})`);
      console.log(`  - Total Tasks Time (Q): ${totals.totalAllInProgressSec} + ${totals.totalAllNoChargeSec} = ${totalTasksTimeSec} sec (${formatSecondsToHHMMSS(totalTasksTimeSec)})`);
    }

    updates.push({ range: `'Productivity'!O${sheetRow}`, values: [[formatSecondsToHHMMSS(avgResolutionSec)]]  });
    updates.push({ range: `'Productivity'!P${sheetRow}`, values: [[formatSecondsToHHMMSS(avgHandlingSec)]]    });
    updates.push({ range: `'Productivity'!Q${sheetRow}`, values: [[formatSecondsToHHMMSS(totalTasksTimeSec)]] });

    // Columns R/S: Idle Time = Total Hours - Total Tasks Time
    const totalHoursSec   = Math.round(totalHours * 3600);
    const idleTimeSec     = totalHoursSec - totalTasksTimeSec;
    const idleTimePercent = totalHoursSec > 0 ? (idleTimeSec / totalHoursSec) * 100 : 0;
    const isNegative      = idleTimeSec < 0;
    const formattedIdleTime    = (isNegative ? '-' : '') + formatSecondsToHHMMSS(Math.abs(idleTimeSec));
    const formattedIdlePercent = `${idleTimePercent.toFixed(1)}%`;
    updates.push({ range: `'Productivity'!R${sheetRow}`, values: [[formattedIdleTime]]    });
    updates.push({ range: `'Productivity'!S${sheetRow}`, values: [[formattedIdlePercent]] });
  }

  if (!updates.length) {
    return { notFoundAgents: [], updatesCount: 0 };
  }

  await executeSheetsBatch({ sheetId: spreadsheetId, token, batchUpdateData: updates });
  return { notFoundAgents: [], updatesCount: updates.length };
}
