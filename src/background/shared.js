export const DATA_KEYS = { site1: 'trackensureData', site2: 'orchardData', fetchFlag: 'fetchInProgress' };
export const SUPPORTED_TIMEZONES = ['Europe/Kyiv', 'America/Toronto'];

export const logToPopup = (site, message, code, payload) => {
  chrome.runtime.sendMessage({
    type: 'COLLECT_PROGRESS',
    site,
    message: payload ? `${message} | ${JSON.stringify(payload)}` : message,
    code,
  });
};

export const setFetchFlag = (value) => chrome.storage.local.set({ [DATA_KEYS.fetchFlag]: value });

export function safeParse(text) {
  try {
    return JSON.parse(text);
  } catch (err) {
    console.error('JSON parse error', { textPreview: text?.slice(0, 500), err });
    throw err;
  }
}

export async function readFromStorage(key) {
  return new Promise((resolve) => chrome.storage.local.get([key], (data) => resolve(data?.[key])));
}

export function getApiTimestamp(dateStr, timeStr = '00:00', offsetHours = 0) {
  if (!dateStr || !timeStr) return null;
  const utcDate = new Date(`${dateStr}T${timeStr}:00Z`);
  return utcDate.getTime() - Number(offsetHours) * 3600000;
}

export function convertDateTimeToMs(dateTimeStr, offsetHours = 0) {
  if (!dateTimeStr) return null;
  const [datePart, timePart] = String(dateTimeStr).split('T');
  return getApiTimestamp(datePart, timePart || '00:00', offsetHours);
}
