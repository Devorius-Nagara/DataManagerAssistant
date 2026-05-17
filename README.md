# Data Manager Assistant — Chrome Extension (Manifest V3)

Інтелектуальне розширення для збору, агрегації та експорту статистики робочої активності з двох платформ (Trackensure та Orchard22) у Google Sheets з автоматичною валідацією змін через порівняння запланованих графіків з фактичними годинами роботи.

Розширення реалізує складний алгоритм маппінгу агентів із гнучким пошуком імен, фільтрацією за часовими буферами, детектацією нічних змін та статус-маркуванням коротких змін (< 5 годин) як "L". Результат експортується одним кліком у Google Sheets через OAuth2 із автоматичним пошуком колонок за назвами місяців.

---

## ✨ Ключовий функціонал

### Збір даних з двох джерел

**Trackensure:**
- Отримання тасків за тегом ID або за командором (Team Lead)
- Пагінований API (до 500 записів на сторінку)
- Нормалізація типів запитів (мобільна допомога, редагування логів, IFTA та ін.)

**Orchard22:**
- Завантаження графіків змін агентів з точними часовими вікнами
- Автоматичне перехоплення Bearer-токена через `chrome.webRequest`
- Збір записів про вихідні (відпустка V, лікарня S, звичайний вихід O)
- Отримання даних про фактичні години роботи для валідації

### Розумний алгоритм маппінгу агентів

**Основний принцип:** Таск рахується ТІЛЬКИ якщо він потрапляє у запланову роботу агента.

**Кроки алгоритму:**

1. **Нормалізація імен** — видалення префіксів ("ext.", "Agent"), приведення до нижнього регістру, видалення зайвих пропусків:
```javascript
const normalizeName = (name = '') => name.toLowerCase()
  .replace(/ext\.?\s*\d+/g, '')     // видаляємо "ext.123"
  .replace(/\s+/g, ' ')              // нормалізуємо пропуски
  .trim();
```

2. **Гнучкий пошук в Orchard:** частковий збіг імен (точний збіг, contains, includes):
```javascript
const findOrchardEntry = (name) => {
  const normTarget = normalizeName(name);
  const cleanTarget = cleanName(normTarget);
  return orchardNormalized.find(({ norm, clean }) => 
    norm === normTarget || 
    clean === cleanTarget || 
    norm.includes(cleanTarget) || 
    cleanTarget.includes(norm)
  )?.entry || null;
};
```

3. **Пошук зміни з буфером** — задача прив'язується до зміни, якщо часова мітка потрапляє в розширене вікно:
```javascript
const bufferMs = isBufferEnabled ? 20 * 60 * 1000 : 0;
const matchedShift = shifts.find((shift) => {
  const startMs = Number(shift.dateFrom) - bufferMs;
  const endMs = Number(shift.dateTo) + bufferMs;
  return taskMs >= startMs && taskMs <= endMs;
});
if (!matchedShift) return; // Суворе фільтрування
```

4. **Коректна обробка нічних змін** — день для таска визначається за ПОЧАТКОМ зміни, не за часом створення:
```javascript
// Зміна почалась 30 квітня о 23:30, таск виконаний 1 травня о 06:00
// → Таск записується під 30 квітня
const targetDay = getDayFromTimestamp(matchedShift.dateFrom, offsetHours);
```

5. **Перевірка часової дельти (4 години)** — розрізнення між запланованою та фактичною зміною:
```javascript
const timeDiffMs = Math.abs(Number(workStart) - shiftStartMs);
const fourHoursMs = 4 * 60 * 60 * 1000;
if (timeDiffMs <= fourHoursMs) {
  // Фактична зміна відповідає запланованій
  if (workTimeMs < 18000000) { // < 5 годин = 18 млн мс
    result = 'L'; // Коротка зміна
  }
}
```

### Експорт у Google Sheets з OAuth2

- **Автоматична авторизація** через `chrome.identity.getAuthToken()`
- **Інтелектуальний пошук колонок** — виявлення місяців за назвами (Jan, Feb, січень, лютий тощо)
- **Пакетні оновлення** — одночасна заливка даних у кілька діапазонів
- **Резервний TSV-експорт** — копіювання в буфер обміну для ручної вставки

### Модульна архітектура режимів

- **Default Mode** — стандартний збір та експорт
- **Shift Statistic Mode** — аналіз покриття змін та ефективності
- **Workload Mode** — розподіл навантаження по агентах
- **Custom Reports Mode** — користувацькі параметри та фільтри

---

## 🏗️ Архітектура проєкту

### Структура папок

```
src/
├── background/
│   └── index.js           # Service Worker: API-запити, агрегація, storage
├── content/
│   └── index.js           # Content Script: взаємодія з DOM, копіювання TSV
├── popup/
│   ├── main.jsx           # React точка входу
│   ├── sheetsApi.js       # Клієнт Google Sheets API (OAuth + batchUpdate)
│   ├── index.css          # Tailwind CSS стилі
│   └── components/
│       ├── ExtensionPopup.jsx     # Головна UI + управління станом
│       ├── LogsTab.jsx            # Real-time переглядач логів
│       ├── StatusItem.jsx         # Статус-індикатор
│       └── modes/                 # Режими та їхні налаштування
│           ├── DefaultMode.jsx & DefaultSettings.jsx
│           ├── ShiftStatisticMode.jsx & ShiftStatisticSettings.jsx
│           ├── WorkloadMode.jsx & WorkloadSettings.jsx
│           └── CustomReportsMode.jsx & CustomReportsSettings.jsx
public/
└── manifest.json          # Manifest V3: permissions, APIs, oauth2

vite.config.js            # Конфіг: окремі entry-point'и для popup, background, content
tailwind.config.js        # Tailwind CSS конфіг
```

### Потік даних

```
POPUP (React UI)
  ↓ (chrome.runtime.sendMessage)
BACKGROUND (Service Worker)
  ├─ fetchTags() → Trackensure API
  ├─ fetchAllTasks() → Пагінована колекція
  ├─ fetchOrchardShifts() → Зміни & вихідні
  ├─ fetchAgentWorkHours() → Фактична робота
  ├─ buildSheetMatrix() → Агрегація & маппінг
  └─ sendToSheets() → Google Sheets batchUpdate
  ↓ (chrome.runtime.sendMessage)
POPUP (Оновлення логів)
  ↓ (якщо увімкнено)
CONTENT (Копіювання TSV в буфер)

ЗОВНІШНІ API:
  ├─ https://trackensure.com/supportTask
  ├─ https://orchard22.com/api/agent-shift
  └─ https://sheets.googleapis.com/v4/spreadsheets
```

---

## 🔧 Технологічний стек

| Компонент | Технологія | Призначення |
|-----------|-----------|-----------|
| UI | React 18.3 | Компонентна архітектура |
| Збірка | Vite 5.4 | Fast ES модулі bundling |
| Стилізація | Tailwind CSS 3.4 | Утилітарні CSS класи |
| Іконки | Lucide React | Консистентна іконографія |
| Розширення | Manifest V3 | Service Workers, chrome.identity, chrome.webRequest |
| API | Fetch API | HTTP запити |

### Chrome Extension API

- `chrome.runtime.onMessage` — взаємодія popup ↔ background
- `chrome.storage.local` — персистентне збереження налаштувань
- `chrome.identity.getAuthToken()` — OAuth2 для Google
- `chrome.webRequest.onSendHeaders` — перехоплення Bearer-токена Orchard
- `chrome.tabs.query/reload` — керування вкладками для оновлення токена

---

## 🚀 Встановлення та збірка

### Передумови

- Node.js 16+ та npm 8+
- Chrome/Chromium 88+
- Облікові записи: Trackensure, Orchard22, Google Cloud Project

### Крок 1: Встановлення залежностей

```bash
npm install
```

### Крок 2: Збірка для production

```bash
npm run build
```

**Результат:** папка `dist/` містить:
- `popup.html` — UI розширення
- `popup-*.js` — React bundle
- `background.js` — Service Worker
- `content.js` — Content Script
- `assets/` — CSS, іконки, chunks

### Крок 3: Завантаження в Chrome

1. Відкрийте `chrome://extensions/`
2. Увімкніть **"Developer mode"** (верхній правий кут)
3. Клікніть **"Load unpacked"**
4. Виберіть папку `/dist`
5. Дозвольте необхідні дозволи

### Крок 4: Налаштування Google Sheets OAuth

1. Перейдіть у [Google Cloud Console](https://console.cloud.google.com/)
2. Створіть проєкт та увімкніть Google Sheets API
3. Створіть OAuth2 credentials (Chrome App)
4. Додайте Redirect URI: `https://<EXTENSION_ID>.chromiumapp.org/`
5. Оновіть `public/manifest.json`:

```json
{
  "oauth2": {
    "client_id": "YOUR_CLIENT_ID_HERE.apps.googleusercontent.com",
    "scopes": ["https://www.googleapis.com/auth/spreadsheets"]
  }
}
```

6. Пересоберіть: `npm run build` і перезавантажте розширення

---

## 📖 Як користуватися

### Базовий робочий процес

1. **Збір даних:** Виберіть теги/команди, дати, часовий пояс в UI
2. **Активація фільтрів:** Увімкніть буфер (±20 хв) та правила скасованих тасків
3. **Клік "Fetch":** Завантажте дані з обох сайтів
4. **Об'єднання:** Клік "Merge" для агрегації та маппінгу
5. **Експорт:** Клік "Export to Sheets" та підтвердіть Google OAuth

Результат: Місячна матриця в Google Sheets з числами тасків, статусами "L", "V", "S", "O".

---

## 🎯 Детальний опис логіки маппінгу

### Фаза 1: Завантаження та нормалізація

Trackensure та Orchard повертають дані в різних форматах. Розширення приводить імена агентів до єдиного виду:

```javascript
const normalizeName = (name = '') => name
  .toLowerCase()                 // john doe
  .replace(/ext\.?\s*\d+/g, '')  // john doe (видалено ext.123)
  .replace(/\s+/g, ' ')          // john doe (нормалізовано пропуски)
  .trim();
```

### Фаза 2: Прив'язка таска до зміни

Для кожного таска система знаходить, до якої зміни він належить:

```javascript
const taskMs = Number(task.createDate);
const bufferMs = isBufferEnabled ? 20 * 60 * 1000 : 0;

const matchedShift = shifts.find((shift) => {
  const start = Number(shift.dateFrom) - bufferMs;
  const end = Number(shift.dateTo) + bufferMs;
  return taskMs >= start && taskMs <= end;
});

if (!matchedShift) return; // Таск поза зміною → ігноруємо
```

### Фаза 3: Визначення дня для запису

Критично важливо: використовуємо ДЕНЬ ПОЧАТКУ зміни, не дату таска:

```
Сценарій: Нічна зміна 30 апреля 23:30 → 1 травня 07:00
Таск виконаний 1 травня о 06:00

Шо має статися:
✓ Таск записується під 30 апреля
✗ НЕ під 1 травня (коли його створили)

Причина: Місячна звітність базується на змінах, не на датах створення.
```

### Фаза 4: Класифікація типів запитів

Для Team Lead'ів дані розділяються на:
- **Client Tasks** — мобільна допомога, редагування логів, IFTA тощо
- **Org Tasks** — внутрішня організаційна робота

Для звичайних агентів просто рахується кількість тасків.

### Фаза 5: Валідація за фактичною роботою

Система перевіряє, чи агент реально працював у запланований час:

```javascript
// 1. Знайди запис про роботу в базі (work hours)
// 2. Перевір, чи він в той же день (UTC + offset)
// 3. Перевір часову дельту: | фактичний старт - запланований | ≤ 4 години
// 4. Якщо фактична робота < 5 годин → помітити як "L"

if (Math.abs(workStart - shiftStart) <= 4 * 60 * 60 * 1000) {
  if (workTimeMs < 18000000) { // < 5 годин
    cellValue = 'L';
  }
}
```

### Фаза 6: Багатоденні вихідні

Вихідні (V/S/O) розтягуються на весь період:

```javascript
dayOffs.forEach(off => {
  let currentMs = Number(off.dateFrom);
  const endMs = Number(off.dateTo);
  const letter = statusToLetter(off.scheduleType); // V, S, або O
  
  while (currentMs <= endMs) {
    const day = getSafeFullDay(currentMs);
    dayOffStatuses[day] = letter;
    currentMs += 86400000; // +1 день
  }
});
```

---

## 💡 Фільтри та налаштування

### 20-хвилинний буфер

Розширює вікно зміни на ±20 хвилин для врахування граничних ситуацій:

```
Без буфера:    Зміна: 09:00-17:00
               Таск о 08:55 → ❌ Ігноруємо

З буфером:     Зміна: 08:40-17:20 (±20 хв)
               Таск о 08:55 → ✅ Рахуємо
```

### Фільтр скасованих тасків (5+ хвилин)

Скасовані таски < 5 хвилин ігноруються (якщо фільтр увімкнено):

```javascript
const isCanceled = String(task.status || '').toLowerCase().includes('cancel');
if (isCanceled) {
  const duration = Number(task.endTime) - Number(task.createDate);
  if (duration < 300000) return; // < 5 хвилин → пропустити
}
```

---

## 🔐 Дозволи і безпека

| Дозвіл | Причина |
|--------|--------|
| `storage` | Збереження налаштувань та кешованих даних |
| `identity` | OAuth2 для Google Sheets |
| `webRequest` | Перехоплення Bearer-токена |
| `scripting` | Інжекція контент-скриптів |
| `activeTab` | Читання контексту поточної вкладки |

**Безпека:**
- ✅ Всі дані в `chrome.storage.local` (зашифровані Chrome)
- ✅ Токени сесійні, видаляються при виході
- ⚠️ Клієнт ID зберігається в маніфесті — не комітити в публічне сховище
- ⚠️ Bearer-токен захоплюється з Orchard — використовується тільки для API

---

## 🐛 Налагодження

### Включення debug-логів

Відкрийте `F12` в Chrome → Console. Спеціальні агенти мають розширене логування:

```
=== ДЕБАГ: MUHAMAD MAGDY ===
1. Сирих тасків з Trackensure: 42
2. Знайдено в Orchard: ТАК
3. Кількість змін (Shifts): 8
4. Буфер увімкнено: true | МС: 1200000
```

### Розробка з live-reload

```bash
npm run dev
```

Стартує dev-сервер на `http://localhost:5173/`. Для live-reload:
1. Запустіть `npm run dev`
2. Вручну перезавантажте розширення (`chrome://extensions/`)
3. Редагуйте файли; вони відбудуються автоматично

### Типові проблеми

| Проблема | Причина | Розв'язання |
|----------|--------|-----------|
| Bearer-токен не знайдено | Не залогінені в Orchard | Увійдіть в Orchard, оновіть сторінку |
| 0 результатів маппінгу | Імена не збігаються | Перевірте консоль; коригуйте нормалізацію |
| Google Sheets 401 | Токен застарів | Перезавторизуйтеся в попапі |

---

## 📝 Розширення

### Додавання нового режиму

1. Створіть `/src/popup/components/modes/MyMode.jsx`
2. Додайте до `ExtensionPopup.jsx`:
```javascript
case 'mymode':
  return <MyMode {...props} />;
```
3. Якщо потрібна своя логіка агрегації — модифікуйте `buildSheetMatrix()` в background
4. Пересоберіть: `npm run build`

---

## 📄 Ліцензія

Private/Proprietary. All rights reserved.

---

**Побудовано з ❤️ за допомогою React, Vite, Tailwind CSS та Chrome Manifest V3.**

