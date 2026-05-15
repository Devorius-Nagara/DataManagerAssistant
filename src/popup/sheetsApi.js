// Lightweight helpers for Google Sheets API interactions from the popup.

const SHEETS_BASE = 'https://sheets.googleapis.com/v4/spreadsheets';
const GOOGLE_AUTH_BASE = 'https://accounts.google.com/o/oauth2/auth';
// Use the same client_id as in manifest (Chrome extension OAuth client).
const CLIENT_ID = '561573337486-g67mhf0q262heeu2oevcn2pv2p4a2ce8.apps.googleusercontent.com';
const SCOPES = ['https://www.googleapis.com/auth/spreadsheets'];

// Always use launchWebAuthFlow to avoid dependency on Chrome profile sign-in.
export function getSheetsAccessToken() {
  return new Promise((resolve, reject) => {
    chrome.storage.local.get(['googleAccessToken', 'googleTokenExpiry'], (data) => {
      const now = Date.now();
      if (data.googleAccessToken && data.googleTokenExpiry && now < data.googleTokenExpiry) {
        return resolve(data.googleAccessToken);
      }

      const redirectUri = chrome.identity.getRedirectURL('oauth2');
      console.log("УВАГА! Додайте цей URL у розділ 'Authorized redirect URIs' в Google Cloud:", redirectUri);

      const authUrl = `${GOOGLE_AUTH_BASE}?client_id=${encodeURIComponent(CLIENT_ID)}&response_type=token&redirect_uri=${encodeURIComponent(
        redirectUri
      )}&scope=${encodeURIComponent(SCOPES.join(' '))}&prompt=consent`;

      chrome.identity.launchWebAuthFlow({ url: authUrl, interactive: true }, (redirectedTo) => {
        if (chrome.runtime.lastError || !redirectedTo) {
          const errMsg = chrome.runtime.lastError?.message || 'Не вдалося пройти OAuth авторизацію';
          const error = new Error(`${errMsg}. В Google Cloud Console вказуйте redirect URI: ${redirectUri}`);
          error.redirectUri = redirectUri;
          reject(error);
          return;
        }
        const tokenData = extractTokenData(redirectedTo);
        if (!tokenData || !tokenData.token) {
          const error = new Error(`Не вдалося отримати токен з відповіді OAuth. Перевірте redirect URI: ${redirectUri}`);
          error.redirectUri = redirectUri;
          reject(error);
          return;
        }

        // Cache token with a bit of a buffer (minus 5 mins) before it expires
        const expiry = Date.now() + (Number(tokenData.expiresIn) * 1000) - 300000;
        chrome.storage.local.set({
          googleAccessToken: tokenData.token,
          googleTokenExpiry: expiry
        }, () => {
          resolve(tokenData.token);
        });
      });
    });
  });
}

function extractTokenData(redirectUrl) {
  try {
    const fragment = redirectUrl.includes('#') ? redirectUrl.replace('#', '?').split('?')[1] : '';
    const params = new URLSearchParams(fragment);
    return {
      token: params.get('access_token'),
      expiresIn: params.get('expires_in') || 3599
    };
  } catch (e) {
    return null;
  }
}

export async function fetchSheetValues(spreadsheetId, token) {
  const url = `${SHEETS_BASE}/${spreadsheetId}/values/A1:ZZ500`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Sheets GET ${res.status}: ${text.slice(0, 200)}`);
  }
  return res.json();
}

function columnToLetter(colIndex1Based) {
  let dividend = colIndex1Based;
  let columnName = '';
  while (dividend > 0) {
    const modulo = (dividend - 1) % 26;
    columnName = String.fromCharCode(65 + modulo) + columnName;
    dividend = Math.floor((dividend - modulo) / 26);
  }
  return columnName;
}

export function mapMatrixToUpdates(matrixRows, sheetValues) {
  const values = Array.isArray(sheetValues?.values) ? sheetValues.values : sheetValues || [];
  const headerRow = values[0] || [];
  const dateToCol = {};
  for (let day = 1; day <= 31; day++) {
    const idx = headerRow.findIndex((cell) => Number(cell) === day);
    if (idx >= 0) dateToCol[day] = idx + 1; // convert to 1-based
  }

  // Безпечне читання колонки A
  const colA = values.map((row) => {
    return row && row[0] ? row[0].toString().toLowerCase().trim() : '';
  });

  const cleanName = (raw = '') =>
    raw
      .toString()
      .toLowerCase()
      .replace(/\(eng\)/g, '')
      .replace(/teamleader/g, '')
      .replace(/agent\s*/g, '')
      .replace(/-?\s*ext[^\s]*/g, '')
      .replace(/\s+/g, ' ')
      .trim();

  const updates = [];
  const notFound = [];

  // Skip header in matrixRows; iterate with index to handle TL triples.
  for (let i = 1; i < matrixRows.length; i++) {
    const row = matrixRows[i];
    const label = String(row[0] || '');
    const isTL = label.toLowerCase().includes('teamleader');
    const baseName = cleanName(label);

    if (isTL) {
      const assignsRow = matrixRows[i + 1];
      const orgRow = matrixRows[i + 2];
      const tlRowIdx = colA.findIndex((cell) => cell.includes(baseName) && cell.includes('teamleader'));
      if (tlRowIdx === -1 || !assignsRow || !orgRow) {
        notFound.push(baseName);
        i += 2;
        continue;
      }

      const targetRows = [tlRowIdx, tlRowIdx + 1, tlRowIdx + 2];
      [row, assignsRow, orgRow].forEach((srcRow, idx) => {
        for (let day = 1; day <= 31; day++) {
          const colIdx = dateToCol[day];
          if (!colIdx) continue;
          const value = srcRow[day];
          if (value === undefined || value === null || value === '') continue;
          const range = `${columnToLetter(colIdx)}${targetRows[idx] + 1}`;
          updates.push({ range, values: [[value]] });
        }
      });
      i += 2;
      continue;
    }

    // Regular agent row
    const agentRowIdx = colA.findIndex((cell) => cell.includes(baseName) && !cell.includes('teamleader'));
    if (agentRowIdx === -1) {
      notFound.push(baseName);
      continue;
    }
    for (let day = 1; day <= 31; day++) {
      const colIdx = dateToCol[day];
      if (!colIdx) continue;
      const value = row[day];
      if (value === undefined || value === null || value === '') continue;
      const range = `${columnToLetter(colIdx)}${agentRowIdx + 1}`;
      updates.push({ range, values: [[value]] });
    }
  }

  return { updates, notFound };
}

export async function batchUpdateValues(spreadsheetId, token, updates) {
  const url = `${SHEETS_BASE}/${spreadsheetId}/values:batchUpdate`;
  const payload = {
    valueInputOption: 'USER_ENTERED',
    data: updates,
  };
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Sheets update ${res.status}: ${text.slice(0, 200)}`);
  }
  try {
    return JSON.parse(text);
  } catch (err) {
    return { raw: text };
  }
}

