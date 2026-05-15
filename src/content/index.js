chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === 'INSERT_TSV_TO_SHEET') {
    (async () => {
      try {
        const rows = Array.isArray(message.rows) ? message.rows : [];
        const tsv = rowsToTsv(rows);
        await navigator.clipboard.writeText(tsv);
        alert('Дані готові! Виділіть клітинку у Google Sheets та натисніть Ctrl+V.');
        sendResponse({ ok: true });
      } catch (err) {
        console.error('TSV insert error', err);
        alert('Не вдалося підготувати дані: ' + (err?.message || 'Unknown'));
        sendResponse({ ok: false, error: err?.message || 'Clipboard error' });
      }
    })();
    return true;
  }
  if (message?.type === 'PARSE_SITE') {
    try {
      const data = scrape(message.selector);
      sendResponse({ ok: true, data });
    } catch (err) {
      sendResponse({ ok: false, error: err?.message || 'Scrape error' });
    }
    return true;
  }
  return false;
});

function scrape(selector) {
  const nodes = Array.from(document.querySelectorAll(selector));
  return nodes
    .map((el) => el.textContent.trim())
    .filter(Boolean);
}

function rowsToTsv(rows = []) {
  return (rows || [])
    .map((row) => (row || []).map((cell) => (cell === undefined || cell === null ? '' : String(cell))).join('\t'))
    .join('\n');
}
