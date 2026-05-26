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

export async function fetchSheetValuesBg(spreadsheetId, token) {
  const readRange = 'A1:ZZ500';
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${readRange}`;
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
