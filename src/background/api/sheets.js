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
