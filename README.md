npm run build  # збірка dist/ (popup.html, background.js, content.js)
# Data Manager Assistant (Chrome MV3)

Розширення збирає таски з Trackensure, мапить їх зі змінами в Orchard22 і експортує звіт у Google Sheets. Нижче — повна технічна логіка, щоб через рік було зрозуміло, чому дані агрегуються саме так.

## 1. Опис проєкту (Introduction)
- Джерело 1: Trackensure — список тасків (support tasks) за тегом або TL.
- Джерело 2: Orchard22 — графік змін (shifts) і вихідних (dayOffs) агентів.
- Мета: зіставити таски зі змінами, застосувати буфер/фільтри, побудувати місячну матрицю та записати її в Google Sheets.

## 2. Збір даних (Data Fetching)
### Trackensure API
- URL першої сторінки: `/supportTask?actionName=getSupportTaskListLTByFilterAndPageNumber` (далі `TASKS_NEXT_URL` для пагінації з `beforeTaskId`).
- Формат body:
```json
{
  "dateFrom": <ms>,
  "limitOnPage": 500,
  "beforeTaskId": null,
  "tagIdSet": [<tagId>],
  "dateTo": <ms>,
  "pageNumber": 1,
  "taskTeamLeaderId": <optional>
}
```
- Перед відправкою логується `=== API PAYLOAD ===` з фактичним body.
- Мілісекунди формуються через UTC-функції, які ігнорують локальну таймзону ПК:
```js
function getApiTimestamp(dateString, timeString, offsetHours) {
  if (!dateString || !timeString) return null;
  const utcDate = new Date(`${dateString}T${timeString}:00Z`); // примусовий UTC
  return utcDate.getTime() - Number(offsetHours) * 3600000;   // віднімаємо вибране зміщення (літо/зима)
}
```
### Orchard API
- Отримуємо shifts і dayOffs POST-запитом (teamId + дата-вікно) з токеном Bearer, що перехоплюється через webRequest і кешується в `orchardToken`.

## 3. Алгоритм мапінгу (Core Mapping Logic)
**Золоте правило:** таск зараховується ТІЛЬКИ якщо він потрапляє у робочу зміну (matchedShift). Будь-які таски поза зміною (овертайм/без зміни) ігноруються.

**Фікс нічних змін:** день для таска беремо за початком зміни, а не за часом таска. Якщо зміна стартувала 19-го о 23:30, а таск зроблений 20-го о 06:00, то він піде в колонку 19-го, бо `targetDay = getDayFromTimestamp(matchedShift.dateFrom, utcOffset)`.

Пошук зміни з буфером (якщо увімкнено):
```js
const isBufferEnabled = includeShift20 === true || includeShift20 === 'true';
const bufferMs = isBufferEnabled ? 20 * 60 * 1000 : 0;

const matchedShift = shifts.find((shift) => {
  const startMs = Number(shift.dateFrom) - bufferMs; // віднімаємо буфер від початку
  const endMs   = Number(shift.dateTo)   + bufferMs; // додаємо буфер до кінця
  return taskMs >= startMs && taskMs <= endMs;
});

if (!matchedShift) return; // сувора ізоляція: таск поза зміною відсікаємо
const targetDay = getDayFromTimestamp(matchedShift.dateFrom, utcOffset);
```

## 4. Фільтрація та Модифікатори (Filters & Modifiers)
### Нормалізація імен (Name Matching)
Щоб поєднати Trackensure з Orchard, імена чистяться та зрівнюються за частковим збігом:
```js
const cleanName = (str = '') => str.toLowerCase().replace(/\s+/g, ' ').trim();
// Збіг: orchName === trName || orchName.includes(trName) || trName.includes(orchName)
```

### 20-хвилинний буфер
Опційно розширює вікно зміни на ±20 хв. Використовується і в TL-рахунках, і в агентських тасках. Якщо чекбокс вимкнено, bufferMs = 0.

### Скасовані таски (Include Cancel 5min+)
Якщо статус містить “cancel” і опція увімкнена — таск лишається тільки коли тривалість ≥ 300000 мс (5 хв):
```js
function shouldIncludeTask(task, includeCancel5) {
  const isCanceled = String(task.status || '').toLowerCase().includes('cancel');
  if (!isCanceled) return true;
  if (!includeCancel5) return false;
  const startMs = Number(task.createDate);
  const endMs = Number(task.endTime ?? (startMs && task.totalSpentTimeSec ? startMs + task.totalSpentTimeSec * 1000 : undefined));
  if (Number.isNaN(startMs) || Number.isNaN(endMs)) return false;
  return endMs - startMs >= 300000;
}
```

## 5. Спеціальні випадки (Special Cases)
- **Багатоденні відпустки / sick / off (V, S, O):** цикл while розтягує статус по днях від `dateFrom` до `dateTo`, записуючи букву в dayBuckets.
- **Тімліди (TL):** у TL-блоці статус дня (V/S/O) ставиться лише в перший ряд (Client Tasks / TL Assigns), другий ряд (Org Tasks) лишається порожнім — щоб не дублювати букву по осі Y.

## 6. Експорт у Google Sheets (Export)
- Авторизація через `chrome.identity` (popup `sheetsApi.js`) отримує OAuth токен для Sheets API.
- `buildSheetMatrix` → `validateSheetsMapping` обчислює `batchUpdateData` з діапазонами й значеннями.
- `EXECUTE_SHEETS_BATCH` виконує POST `values:batchUpdate` з масивом `updates`:
```json
{
  "valueInputOption": "USER_ENTERED",
  "data": [ { "range": "A1", "values": [["..."]] }, ... ]
}
```
- Контент-скрипт також уміє копіювати TSV у буфер для ручного вставлення (повідомлення `INSERT_TSV_TO_SHEET`).

## Корисні поради
- Переконайтеся, що активна вкладка під час збору — trackensure.com або orchard22.com.
- Redirect URI, який друкує попап під час OAuth, має бути доданий у Google Cloud Console.
- Тумблери `Include 20min buffer` і `Include cancel 5min+` зберігаються в `chrome.storage.local` і передаються в бекграунд як boolean.

# DataManagerAssistant
