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
  console.log('[ДЕБАГ SHEETS GET] Зчитування діапазону:', readRange);
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
  console.log('ДАНІ ПЕРЕД ВІДПРАВКОЮ В API:', JSON.stringify(batchUpdateData));
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values:batchUpdate`;
  const body = {
    valueInputOption: 'USER_ENTERED',
    data: batchUpdateData,
  };
  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    let errorText = '';
    try {
      const errJson = await res.json();
      errorText = JSON.stringify(errJson, null, 2);
      console.error('GOOGLE API ERROR DETAILS:', errorText);
      throw new Error(`Google API відхилив запит: ${errJson.error?.message || 'Невідома помилка 400'}`);
    } catch (err) {
      if (!errorText) {
        const fallback = await res.text();
        console.error('GOOGLE API ERROR (TEXT):', fallback);
        throw new Error(`Sheets update ${res.status}: ${fallback.slice(0, 200)}`);
      }
      throw err;
    }
  }
  const text = await res.text();
  try {
    const parsed = JSON.parse(text);
    return { ok: true, result: parsed };
  } catch (err) {
    return { ok: true, raw: text };
  }
}
