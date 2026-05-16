const fs = require('fs');
let lines = fs.readFileSync('src/background/index.js', 'utf8').split('\n');
for (let i = 0; i < lines.length; i++) {
  if (lines[i].includes('if (!trackTasks.length') && lines[i].includes('!orchard.length) {')) {
    // Found start of handleGetTsvMatrix check
    let j = i;
    while (!lines[j].includes('const rows = buildSheetMatrix')) {
      j++;
    }
    // Now inject our fetching logic BEFORE line j
    const inject = `
  const agentWorkHoursCache = {};
  console.log('[START_EXPORT] Fetching Work Hours for all unique agents...');
  try {
    const orchardToken = await ensureOrchardToken();
    if (orchardToken) {
      const uniqueAgentIds = new Set();
      orchard.forEach((entry) => {
        const agId = entry?.agentDTO?.userId || entry?.agentDTO?.agentId || entry?.agentId || entry?.candidateId;
        if (agId) uniqueAgentIds.add(agId);
      });
      const fetchFrom = baseDateFromMs || (Date.now() - 30 * 86400000);
      const fetchTo = Datconst fs = require('fs');
letd let lines = fs.readFileS  for (let i = 0; i < lines.length; i++) {
  if (lines[i].includes('if (!traen  if (lines[i].includes('if (!trackTask      // Found start of handleGetTsvMatrix check
    let j = i;
    while (!lines[j].includes('c      let j = i;
    while (!lines[j].includes(ai    while            j++;
    }
    // Now inject our fetching logic BEFORE lin,
    }
         y:    const inject = `
  const agentWorkHoursCache     const agentWorkHoru  console.log('[START_EXPORT] FeFr  try {
    const orchardToken = await ensureOrchardToken();
    if (orchard(r    co)     if (orchardToken) {
      const uniqueAgentI           const uniqueAgenac      orchard.forEach((entry) => {
    ?        const agId = entry?.agentse        if (agId) uniqueAgentIds.add(agId);
      });
      const fetchFrom = baseDateFromMs || (Date.now() - 30        });
      const fetchFrom = baseDatero      coHo      const fetchTo = D  }
`;
    lines.splice(j, 0, inject);
    // Also modify the buildSheetMatrix call at j+1
    lines  if (lines[i].includes('if (!traen  if (lines[i].includes('if (!tracktW    let j = i;
    while (!lines[j].includes('c      let j = i;
    while (!lines[j].includes(ai    while        (let i = 0    while (!len    while (!lines[j].includes(ai    while      {'    }
    // Now inject our fetching logic BEFORE lin,
 ge    '     }
         y:    const inject = `
  const aag     e  const agentWorkHoursCache   y?    const orchardToken = await ensureOrchardToken();
    if (orchard(r    co)     if (orchaon    if (orchard(r    co)     if (orchardToken) {
  rr      const uniqueAgentI           const uniques     ?        const agId = entry?.agentse        if (agId) uniqueAgentIds.add(agId);
  tD      });
      const fetchFrom = baseDateFromMs || (Date.now() - 30        });
  et      cor(      const fetchFrom = baseDatero      coHo      const fetchTo = D St`;
    lines.splice(j, 0, inject);
    // Also modify the buildSheetM==  b    // Also modify the buildShll    lines  if (lines[i].includes('if (!traen  if (y     while (!lines[j].includes('c      let j = i;
    while (!lines[j].includes(ai    while          while (!lines[j].includes(ai    while      li    // Now inject our fetching logic BEFORE lin,
 ge    '     }
         y:    const inject = `
  const aag     e  const agentW   ge    '     }
         y:    const inject = `

          y:  ;
  const aag     e  const agentct    if (orchard(r    co)     if (orchaon    if (orchard(r    co)     if (orchardToken) {
  rr      cli  rr      const uniqueAgentI           connode -e "
const fs = require('fs');
const lines = fs.readFileSync('src/background/index.js', 'utf8').split('\n');
let s1 = '';
for (let i = 0; i < lines.length; i++) {
   if (lines[i].includes('if (!trackTasks.length') && lines[i].includes('orchard.length')) {
      s1 = lines.slice(i, i+6).join('\n');
      console.log('---TARGET1---');
      console.log(s1);
      console.log('-------------');
   }
   if (lines[i].includes('if (isTL) {') && lines[i+1] && lines[i+1].includes('rowClient')) {
      console.log('---TARGET3---');
      console.log(lines.slice(i, i+2).join('\n'));
      console.log('-------------');
   }
}"
