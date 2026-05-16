const fs = require('fs');
let bg = fs.readFileSync('src/background/index.js', 'utf8');
// I'll define processAgent modifications
// Finding the `const targetDay = getDayFromTimestamp(matchedShift.dateFrom, offsetHours || 2);`
// Actually, it is better to modify it at the end of processAgent before rows.push
const REPLACE_TARGET = `    if (isTL) {
      const rowClient = ['Agent ' + nameRaw + ' - TeamLeader ext. (ENG)'];`;
const NEW_CODE = `
    // КРОК 3: Підміна результату на "L"
    const agId = entry?.agentDTO?.userId || entry?.agentDTO?.agentId || entry?.agentId || entry?.candidateId;
    const workHoursArray = options.agentWorkHoursCache?.[agId] || [];
    workHoursArray.forEach(wh => {
      if (wh && wh.workTimeMs != null && Number(wh.workTimeMs) < 18000000) {
         const whStartMs = wh.eventStartDTO?.eventDate || wh.eventDateMs;
         if (whStartMs) {
             const offset = Number(offsetHours || 2);
             const whDateObj = new Dateconst fs = require('fs');
le* let bg = fs.readFileSyncf // I'll define processAgent modifications
// Finding the `cul// Finding the `const targetDay = getDay c// Actually, it is better to modify it at the end of processAgent before rows.push
const REPLAC  const REPLACE_TARGET = `    if (isTL) {
      const rowClient = ['Agent ' + nameR        const rowClient = ['Agent ' + na  const NEW_CODE = `
    // КРОК 3: Підміна результату ?     // КРОК 3      const agId = entry?.agentDTO?.userId || entry?.agentDTO?.aow    const workHoursArray = options.agentWorkHoursCache?.[agId] || [];
    workHoursArray.forEach(wh => {
   ep    workHoursArray.forEach(wh => {
      if (wh && wh.workTimeMs != nd      if (wh && wh.workTimeMs != ed         const whStartMs = wh.eventStartDTO?.eventDate || wh.eventDateMs;
  b         if (whStartMs) {
             congit checkout src/background/index.js
