const STORAGE_KEY = 'daily-practice-records';
const MEMORY_STORAGE_KEY = 'daily-memory-cards';
const TARGET_STORAGE_KEY = 'daily-study-targets';
const ACCESS_CODE = 'ccday-7m4k2p';
const accessValue = window.location.hash.replace(/^#\/?/, '').split('?')[0].trim();
const hasAccess = accessValue === ACCESS_CODE;
if (!hasAccess) document.body.classList.add('locked');
const config = window.SUPABASE_CONFIG || {};
const supabaseClient = null;
const form = document.querySelector('#dailyForm');
const recordsEl = document.querySelector('#dailyRecords');
const emptyEl = document.querySelector('#emptyDaily');
const toast = document.querySelector('#toast');
const authButton = document.querySelector('[data-action="sync"]');
const syncStatus = document.querySelector('#syncStatus');
const memoryModal = document.querySelector('#memoryModal');
const memoryLibraryModal = document.querySelector('#memoryLibraryModal');
const memoryForm = document.querySelector('#memoryForm');
const memoryList = document.querySelector('#memoryList');
let records = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]').map(normalizeRecord);
let memoryRecords = JSON.parse(localStorage.getItem(MEMORY_STORAGE_KEY) || '[]');
let editingMemory = false;
let cloudReady = Boolean(supabaseClient);
let calendarMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
let categoryFilter = 'all';
let targets = { accuracy: 80, speed: 1.5, ...JSON.parse(localStorage.getItem(TARGET_STORAGE_KEY) || '{}') };

async function restRequest(path, options = {}) {
  if (!config.url || !config.anonKey) throw new Error('Supabase 配置缺失');
  const response = await fetch(`${config.url}/rest/v1/${path}`, {
    ...options,
    headers: {
      apikey: config.anonKey,
      Authorization: `Bearer ${config.anonKey}`,
      'x-cc-access': accessValue,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
      ...(options.headers || {})
    }
  });
  const body = await response.text();
  if (!response.ok) throw new Error(body || `Supabase ${response.status}`);
  return body ? JSON.parse(body) : null;
}

const today = () => {
  const date = new Date();
  const offset = date.getTimezoneOffset() * 60000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 10);
};
const moneyDate = (value) => value ? value.replaceAll('-', '.') : '--';
const number = (value) => Math.max(0, Number(value) || 0);
const MODULE_SUBMODULES = {
  公基: ['公基'], 资料分析: ['资料分析'], 言语理解: ['综合训练', '片段阅读', '逻辑填空'], 判断推理: ['综合训练', '图形推理', '类比推理', '定义判断', '逻辑判断'], 数量关系: ['综合训练', '数字推理', '数量关系'], 全科套题: ['整套试卷'], 其他: ['综合训练']
};
const MOCK_BREAKDOWN_TYPES = ['公基', '资料分析', '片段阅读', '逻辑填空', '图形推理', '类比推理', '定义判断', '逻辑判断', '数字推理', '数量关系'];
const inferModule = (type) => /图形推理|类比推理|定义判断|逻辑判断/.test(type) ? '判断推理' : /逻辑填空/.test(type) ? '言语理解' : /数字推理/.test(type) ? '数量关系' : type || '其他';
function normalizeRecord(item) {
  const legacyType = item.submodule || item.type || item.module || '综合训练';
  const module = item.module && MODULE_SUBMODULES[item.module] ? item.module : inferModule(legacyType);
  const submodule = item.submodule || (MODULE_SUBMODULES[module]?.includes(legacyType) ? legacyType : legacyType);
  let breakdown = item.breakdown || {};
  if (typeof breakdown === 'string') { try { breakdown = JSON.parse(breakdown); } catch { breakdown = {}; } }
  const rawMode = item.practiceMode || item.practice_mode || (module === '全科套题' ? '套题训练' : submodule === '综合训练' ? '大模块综合' : '专项刷题');
  const practiceMode = rawMode === '综合刷题' ? '大模块综合' : rawMode;
  return { ...item, module, submodule, type: submodule, practiceMode, breakdown };
}
const displayType = (item) => `${item.module || inferModule(item.type)} · ${item.submodule || item.type} · ${item.practiceMode || '专项刷题'}`;
const isPublicBasics = (item) => /公基|公共基础/.test(String(item.module || item.type || ''));
function expandRecord(item) {
  const entries = Object.entries(item.breakdown || {}).filter(([, value]) => Number(value?.total) > 0);
  if (!entries.length) return [item];
  return entries.map(([type, value]) => { const total = Number(value.total) || 0; const correct = Math.min(total, Number(value.correct) || 0); return { ...item, module: inferModule(type), submodule: type, type, minutes: item.total ? item.minutes * total / item.total : 0, total, correct, wrong: total - correct }; });
}

function showToast(message) {
  toast.textContent = message;
  toast.classList.add('show');
  clearTimeout(window.toastTimer);
  window.toastTimer = setTimeout(() => toast.classList.remove('show'), 1800);
}

function saveLocal() { localStorage.setItem(STORAGE_KEY, JSON.stringify(records)); }
function saveMemoryLocal() { localStorage.setItem(MEMORY_STORAGE_KEY, JSON.stringify(memoryRecords)); }

function compressImage(file) {
  return new Promise((resolve, reject) => {
    if (!file || !file.size) return resolve('');
    const reader = new FileReader();
    reader.onload = () => { const image = new Image(); image.onload = () => { const scale = Math.min(1, 1200 / Math.max(image.width, image.height)); const canvas = document.createElement('canvas'); canvas.width = Math.max(1, Math.round(image.width * scale)); canvas.height = Math.max(1, Math.round(image.height * scale)); canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height); resolve(canvas.toDataURL('image/jpeg', .78)); }; image.onerror = reject; image.src = reader.result; };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function resetMemoryForm() {
  memoryForm.reset();
  memoryForm.elements.id.value = '';
  memoryForm.querySelectorAll('[data-upload-name]').forEach((node) => { node.textContent = '未选择'; });
}

function setMemoryModal(modal, open) {
  modal.hidden = !open;
  const anyOpen = !memoryModal.hidden || !memoryLibraryModal.hidden;
  document.body.classList.toggle('memory-open', anyOpen);
}

function memoryOrderValue(item) {
  if (item.createdAt) { const time = Date.parse(item.createdAt); if (!Number.isNaN(time)) return time; }
  if (String(item.id).startsWith('cloud-')) return Number(String(item.id).slice(6)) || 0;
  return Number(item.id) || 0;
}

function memoryQuality(item) {
  return (item.content ? 1 : 0) + (item.contentImage ? 2 : 0) + (item.answer ? 1 : 0) + (item.answerImage ? 2 : 0);
}

function dedupeMemoryRecords(items) {
  const result = new Map();
  items.forEach((item) => {
    const identity = String(item.id).startsWith('cloud-') ? `id:${item.id}` : `local:${item.date}|${item.category}|${item.content}|${item.contentImage || ''}|${item.answer}|${item.answerImage || ''}`;
    const previous = result.get(identity);
    if (!previous || memoryQuality(item) >= memoryQuality(previous)) result.set(identity, item);
  });
  return [...result.values()];
}

function renderMemoryList() {
  document.querySelector('#memoryCount').textContent = `${memoryRecords.length} 条`;
  memoryList.innerHTML = [...memoryRecords].sort((a, b) => memoryOrderValue(a) - memoryOrderValue(b)).map((item) => { const content = item.content ? `<h3>${escapeHtml(item.content)}</h3>` : ''; const contentImage = item.contentImage ? `<img class="memory-image" src="${item.contentImage}" alt="记忆内容图片" />` : ''; const answer = item.answer || item.answerImage; return `<article class="memory-card" data-memory-card="${item.id}"><div class="memory-card-head"><span>记忆卡片</span><div><button type="button" data-memory-edit="${item.id}">编辑</button><button type="button" data-memory-delete="${item.id}">删除</button></div></div>${content}${contentImage}${answer ? `<div class="memory-answer-row"><button class="answer-toggle" type="button" data-answer-toggle="${item.id}">显示答案</button></div><div class="memory-answer" data-answer="${item.id}" hidden>${item.answer ? `<p>${escapeHtml(item.answer)}</p>` : ''}${item.answerImage ? `<img class="memory-image" src="${item.answerImage}" alt="答案图片" />` : ''}</div>` : '<small class="no-answer">这是一张无答案记忆卡</small>'}</article>`; }).join('') || '<div class="memory-empty">还没有记忆内容，先添加一张卡片吧。</div>';
}

async function loadMemoryCards() {
  let data;
  try { data = await restRequest('memory_cards?select=id,card_date,category,content,answer,content_image,answer_image,created_at&order=card_date.desc,created_at.desc'); }
  catch { return; }
  if (!data) return;
  const cloudCards = data.map((item) => ({ id: `cloud-${item.id}`, date: item.card_date, category: item.category, content: item.content || '', answer: item.answer || '', contentImage: item.content_image || '', answerImage: item.answer_image || '', createdAt: item.created_at || '' }));
  const localOnly = memoryRecords.filter((local) => !cloudCards.some((cloud) => cloud.id === local.id || cloud.id === `cloud-${local.id}` || (cloud.createdAt && local.createdAt && cloud.createdAt === local.createdAt) || (cloud.date === local.date && cloud.category === local.category && cloud.content === local.content && cloud.contentImage === local.contentImage)));
  memoryRecords = dedupeMemoryRecords([...cloudCards, ...localOnly]);
  saveMemoryLocal();
  renderMemoryList();
}

async function saveMemoryCloud(item) {
  const data = await restRequest('memory_cards', { method: 'POST', body: JSON.stringify({ card_date: item.date, category: item.category, content: item.content || '', answer: item.answer || null, content_image: item.contentImage || null, answer_image: item.answerImage || null, created_at: item.createdAt }) });
  return data?.[0];
}

async function updateMemoryCloud(item) {
  if (!item.id.startsWith('cloud-')) return;
  await restRequest(`memory_cards?id=eq.${encodeURIComponent(item.id.slice(6))}`, { method: 'PATCH', body: JSON.stringify({ card_date: item.date, category: item.category, content: item.content || '', answer: item.answer || null, content_image: item.contentImage || null, answer_image: item.answerImage || null }) });
}

async function deleteMemoryCloud(item) {
  if (!item.id.startsWith('cloud-')) return;
  await restRequest(`memory_cards?id=eq.${encodeURIComponent(item.id.slice(6))}`, { method: 'DELETE' });
}

function updateWrong() {
  const total = number(form.elements.total.value);
  const correct = number(form.elements.correct.value);
  form.elements.wrong.value = Math.max(0, total - correct);
}

function renderStats() {
  const total = records.reduce((sum, item) => sum + item.total, 0);
  const minutes = records.reduce((sum, item) => sum + item.minutes, 0);
  const generalRecords = records.filter((item) => !isPublicBasics(item));
  const generalTotal = generalRecords.reduce((sum, item) => sum + item.total, 0);
  const correct = generalRecords.reduce((sum, item) => sum + item.correct, 0);
  const days = new Set(records.map((item) => item.date)).size;
  document.querySelector('#totalQuestions').textContent = total;
  document.querySelector('#totalMinutes').textContent = minutes;
  document.querySelector('#recordDays').textContent = days;
  renderInsights(generalTotal, correct);
  renderDiagnosis(generalRecords);
  renderCalendar();
  renderAnalysis();
}

function renderCalendar() {
  const year = calendarMonth.getFullYear();
  const month = calendarMonth.getMonth();
  document.querySelector('#calendarTitle').textContent = `${year}.${String(month + 1).padStart(2, '0')}`;
  const monthRecords = records.filter((item) => { const date = new Date(`${item.date}T00:00:00`); return date.getFullYear() === year && date.getMonth() === month; });
  const totals = monthRecords.reduce((map, item) => { map[item.date] = (map[item.date] || 0) + item.total; return map; }, {});
  const max = Math.max(...Object.values(totals), 1);
  const firstDay = new Date(year, month, 1).getDay();
  const days = new Date(year, month + 1, 0).getDate();
  document.querySelector('#calendarGrid').innerHTML = `${'<span class="calendar-cell empty"></span>'.repeat(firstDay)}${Array.from({ length: days }, (_, index) => { const day = index + 1; const key = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`; const value = totals[key] || 0; const level = value >= max * .75 ? 3 : value >= max * .4 ? 2 : value ? 1 : 0; return `<button class="calendar-cell ${value ? `has-data level-${level}` : ''} ${key === today() ? 'today' : ''}" data-date="${key}" type="button" title="${value ? `${value} 题` : '未记录'}">${day}</button>`; }).join('')}`;
}

function renderDayDetail(date) {
  const dayRecords = records.filter((item) => item.date === date);
  const detail = document.querySelector('#dayDetail');
  if (!dayRecords.length) { detail.innerHTML = '<span>这一天还没有刷题记录</span>'; return; }
  const total = dayRecords.reduce((sum, item) => sum + item.total, 0);
  const minutes = dayRecords.reduce((sum, item) => sum + item.minutes, 0);
  detail.innerHTML = `<strong>${moneyDate(date)}</strong><span>${dayRecords.length} 组 · ${total} 题 · ${minutes} 分钟</span><button type="button" data-day-filter="${date}">查看当天记录 →</button>`;
}

function renderAnalysis() {
  const typeMap = records.flatMap(expandRecord).reduce((map, item) => { const key = `${item.module} · ${item.submodule} · ${item.practiceMode}`; const row = map[key] || { type: key, mode: item.practiceMode, total: 0, correct: 0, minutes: 0 }; row.total += item.total; row.correct += item.correct; row.minutes += item.minutes; map[key] = row; return map; }, {});
  const types = Object.values(typeMap).map((value) => ({ ...value, accuracy: value.correct / value.total * 100, speed: value.minutes / value.total })).sort((a, b) => b.total - a.total);
  const renderType = (item) => { const evaluation = evaluateAbility(item.total, item.accuracy); return `<button class="type-dashboard-card ${evaluation.key}" data-type-filter="${escapeHtml(item.type)}" type="button"><div class="type-dashboard-head"><strong>${escapeHtml(item.type)}</strong><span class="type-level ${evaluation.key}">${evaluation.label}</span><b>${item.accuracy.toFixed(1)}%</b></div><div class="type-dashboard-track"><i style="width:${item.accuracy}%"></i></div><div class="type-dashboard-metrics"><span class="metric-total"><b>${item.total}</b>题</span><span class="metric-correct"><b>${item.correct}</b>对</span><span class="metric-wrong"><b>${item.total - item.correct}</b>错</span><span class="metric-time"><b>${Math.round(item.minutes)}</b>分钟</span><span class="metric-speed"><b>${item.speed.toFixed(2)}</b>分/题</span></div></button>`; };
  document.querySelector('#typeDashboard').innerHTML = types.length ? ['专项刷题', '大模块综合', '套题训练'].map((mode) => { const group = types.filter((item) => item.mode === mode); return group.length ? `<div class="type-dashboard-group"><div class="type-dashboard-group-title">${mode}<span>${group.length} 类</span></div>${group.map(renderType).join('')}</div>` : ''; }).join('') : '<span class="required-note">填写记录后显示题型详细数据</span>';
}

function evaluateAbility(total, accuracy) {
  if (!total || total < 30) return { key: 'insufficient', label: '样本不足' };
  if (accuracy >= 90) return { key: 'excellent', label: '优势' };
  if (accuracy >= 80) return { key: 'strong', label: '稳定' };
  if (accuracy >= 60) return { key: 'steady', label: '基础' };
  return { key: 'weak', label: '薄弱' };
}

function renderInsights(total, correct) {
  const generalMinutes = records.filter((item) => !isPublicBasics(item)).reduce((sum, item) => sum + item.minutes, 0);
  const generalRecords = records.filter((item) => !isPublicBasics(item));
  const accuracy = total ? (correct / total) * 100 : 0;
  const ability = evaluateAbility(total, accuracy);
  const generalTypes = generalRecords.flatMap(expandRecord).reduce((map, item) => { const key = `${item.module} · ${item.submodule} · ${item.practiceMode}`; const row = map[key] || { total: 0, correct: 0 }; row.total += item.total; row.correct += item.correct; map[key] = row; return map; }, {});
  const weakTypes = Object.entries(generalTypes).map(([type, value]) => ({ type, accuracy: value.correct / value.total * 100, total: value.total })).filter((item) => item.total >= 30 && item.accuracy < 80).sort((a, b) => a.accuracy - b.accuracy).slice(0, 2);
  document.querySelector('#abilityLevel').textContent = ability.label;
  document.querySelector('#abilityLevel').className = `ability-level-${ability.key}`;
  document.querySelector('#abilityConfidence').textContent = total >= 100 ? '判断较可靠' : total >= 30 ? '持续积累中' : '样本不足';
  document.querySelector('#abilityLevelHint').textContent = total < 30 ? `还需 ${30 - total} 题进入评估` : `${generalRecords.length} 组非公基训练`;
  document.querySelector('#abilityAccuracy').textContent = `${accuracy.toFixed(1)}%`;
  document.querySelector('#abilitySpeed').textContent = total ? (generalMinutes / total).toFixed(2) : '0';
  document.querySelector('#abilityQuestions').textContent = total;
  document.querySelector('#abilityFocus').textContent = weakTypes.length ? weakTypes.map((item) => `${item.type} ${item.accuracy.toFixed(1)}%`).join('、') : (total < 30 ? '完成更多训练后生成' : '暂无明显短板');
  document.querySelector('#targetAccuracy').value = targets.accuracy;
  document.querySelector('#targetSpeed').value = targets.speed;
  document.querySelector('#targetSummary').textContent = accuracy >= targets.accuracy ? '当前正确率已达到目标' : `还差 ${(targets.accuracy - accuracy).toFixed(1)} 个百分点`;

  const typeTotals = records.flatMap(expandRecord).reduce((map, item) => { const key = `${item.module} · ${item.submodule} · ${item.practiceMode}`; map[key] = (map[key] || 0) + item.total; return map; }, {});
  // Keep every recorded subject visible; the panel itself scrolls as subjects grow.
  const topTypes = Object.entries(typeTotals).sort((a, b) => b[1] - a[1]);
  document.querySelector('#typeBars').innerHTML = topTypes.length
    ? ['专项刷题', '大模块综合', '套题训练'].map((mode) => { const group = topTypes.filter(([type]) => type.endsWith(`· ${mode}`)); const max = Math.max(...group.map((item) => item[1]), 1); return group.length ? `<div class="type-bars-group"><b>${mode}</b>${group.map(([type, value]) => `<button class="type-row" data-type-filter="${escapeHtml(type)}" type="button"><span title="${escapeHtml(type)}">${escapeHtml(type).replace(` · ${mode}`, '')}</span><i class="type-track"><b style="width:${(value / max) * 100}%"></b></i><span>${value} 题</span></button>`).join('')}</div>` : ''; }).join('')
    : '<span class="required-note">填写记录后显示题型分布</span>';
  document.querySelector('#topType').textContent = topTypes[0] ? `最多：${topTypes[0][0]}` : '暂无数据';

  const publicBasics = records.filter(isPublicBasics);
  const publicBasicsTotal = publicBasics.reduce((sum, item) => sum + item.total, 0);
  const publicBasicsCorrect = publicBasics.reduce((sum, item) => sum + item.correct, 0);
  const publicBasicsMinutes = publicBasics.reduce((sum, item) => sum + item.minutes, 0);
  document.querySelector('#publicBasicsMinutes').textContent = publicBasicsMinutes;
  document.querySelector('#publicBasicsTotal').textContent = publicBasicsTotal;
  document.querySelector('#publicBasicsAccuracy').textContent = publicBasicsTotal ? `${((publicBasicsCorrect / publicBasicsTotal) * 100).toFixed(1)}%` : '0%';
  document.querySelector('#publicBasicsSpeed').textContent = publicBasicsTotal ? (publicBasicsMinutes / publicBasicsTotal).toFixed(2) : '0';
  document.querySelector('#publicBasicsHint').textContent = publicBasicsTotal ? `${publicBasics.length} 组记录` : '暂无记录';

  document.querySelector('#panelAccuracy').textContent = `${accuracy.toFixed(1)}%`;
  document.querySelector('#accuracyFill').style.width = `${accuracy}%`;
  document.querySelector('#accuracyHint').textContent = total ? (accuracy >= 80 ? '状态不错' : accuracy >= 60 ? '继续保持' : '重点复盘') : '暂无数据';
  document.querySelector('#accuracyText').textContent = total ? `共完成 ${total} 题，答对 ${correct} 题` : '记录后会显示表现';
  document.querySelector('#generalSpeed').textContent = total ? (generalMinutes / total).toFixed(2) : '0';
}

function summarizeSessions(items) {
  const total = items.reduce((sum, item) => sum + item.total, 0);
  const correct = items.reduce((sum, item) => sum + item.correct, 0);
  const minutes = items.reduce((sum, item) => sum + item.minutes, 0);
  return { total, accuracy: total ? correct / total * 100 : 0, speed: total ? minutes / total : 0 };
}

function renderDiagnosis(generalRecords) {
  const ordered = [...generalRecords].sort((a, b) => `${a.date}-${a.id}`.localeCompare(`${b.date}-${b.id}`));
  const recent = ordered.slice(-7);
  const previous = ordered.slice(-14, -7);
  const current = summarizeSessions(recent);
  const before = summarizeSessions(previous);
  const accuracyDelta = current.accuracy - before.accuracy;
  const speedDelta = before.speed - current.speed;
  const enoughTrend = recent.length >= 3 && previous.length > 0;
  const progressing = enoughTrend && (accuracyDelta >= 2 || speedDelta >= .05);
  const declining = enoughTrend && (accuracyDelta <= -2 || speedDelta <= -.05);
  document.querySelector('#trendLabel').textContent = !enoughTrend ? '样本积累中' : progressing ? '正在进步' : declining ? '需要调整' : '表现稳定';
  document.querySelector('#trendLabel').className = `diagnosis-badge ${progressing ? 'progress' : declining ? 'decline' : 'stable'}`;
  document.querySelector('#trendSummary').textContent = !enoughTrend ? '继续记录，趋势会更准确' : progressing ? '最近阶段表现有所提升' : declining ? '最近阶段需要及时复盘' : '最近阶段保持稳定';
  document.querySelector('#trendHint').textContent = enoughTrend ? '最近 7 组对比上一阶段' : '至少需要前后两个阶段的数据';
  document.querySelector('#trendAccuracy').textContent = enoughTrend ? `${accuracyDelta >= 0 ? '+' : ''}${accuracyDelta.toFixed(1)} 个百分点` : '--';
  document.querySelector('#trendSpeed').textContent = enoughTrend ? `${speedDelta >= 0 ? '+' : ''}${speedDelta.toFixed(2)} 分/题` : '--';
  document.querySelector('#trendSamples').textContent = `${generalRecords.length} 组`;

  const typeMap = generalRecords.flatMap(expandRecord).reduce((map, item) => { const key = `${item.module} · ${item.submodule} · ${item.practiceMode}`; const row = map[key] || { type: key, total: 0, correct: 0, minutes: 0 }; row.total += item.total; row.correct += item.correct; row.minutes += item.minutes; map[key] = row; return map; }, {});
  const types = Object.values(typeMap).map((value) => ({ type: value.type, total: value.total, accuracy: value.correct / value.total * 100, speed: value.minutes / value.total })).filter((item) => item.total >= 30);
  const groups = { strongFast: [], strongSlow: [], weakFast: [], weakSlow: [] };
  types.forEach((item) => { const strong = item.accuracy >= targets.accuracy; const fast = item.speed <= targets.speed; groups[`${strong ? 'strong' : 'weak'}${fast ? 'Fast' : 'Slow'}`].push(item); });
  Object.entries(groups).forEach(([key, items]) => { const node = document.querySelector(`#quadrant${key.charAt(0).toUpperCase()}${key.slice(1)}`); node.textContent = items.length ? items.slice(0, 2).map((item) => `${item.type} ${item.accuracy.toFixed(0)}%`).join('、') : '暂无'; });
  const advice = [];
  if (generalRecords.reduce((sum, item) => sum + item.total, 0) < 30) advice.push('先完成 30 题以上，再判断综合水平。');
  const weak = types.filter((item) => item.accuracy < targets.accuracy).sort((a, b) => a.accuracy - b.accuracy).slice(0, 2);
  const slow = types.filter((item) => item.accuracy >= targets.accuracy && item.speed > targets.speed).sort((a, b) => b.speed - a.speed).slice(0, 2);
  if (weak.length) advice.push(`优先补强：${weak.map((item) => `${item.type}（${item.accuracy.toFixed(1)}%）`).join('、')}。`);
  if (slow.length) advice.push(`重点提速：${slow.map((item) => `${item.type}（${item.speed.toFixed(2)} 分/题）`).join('、')}。`);
  if (!advice.length) advice.push('当前没有明显短板，继续保持训练频率并增加套题练习。');
  document.querySelector('#adviceList').innerHTML = advice.map((item) => `<p>${escapeHtml(item)}</p>`).join('');
}

function filteredRecords() {
  const search = document.querySelector('#searchInput').value.trim().toLowerCase();
  const date = document.querySelector('#dateFilter').value;
  return [...records].filter((item) => {
    const matchesSearch = !search || `${item.module} ${item.submodule} ${item.practiceMode}`.toLowerCase().includes(search);
    return matchesSearch && (!date || item.date === date) && (categoryFilter === 'all' || displayType(item) === categoryFilter);
  }).sort((a, b) => `${b.date}-${b.id}`.localeCompare(`${a.date}-${a.id}`));
}

function renderRecords() {
  const visible = filteredRecords();
  document.querySelector('#recordCount').textContent = `${visible.length} 条`;
  emptyEl.hidden = visible.length > 0;
  renderCategoryFilters();
  renderDailyBreakdown(visible);
  recordsEl.innerHTML = visible.map((item) => {
    const accuracy = item.total ? ((item.correct / item.total) * 100).toFixed(1) : '0.0';
    return `<article class="record">
      <div class="record-top"><span class="record-date">${moneyDate(item.date)}</span><div class="record-actions"><button data-edit="${item.id}">编辑</button><button data-delete="${item.id}">删除</button></div></div>
      <div class="record-type">${escapeHtml(displayType(item))}<small class="record-mode">${escapeHtml(item.practiceMode)}</small></div>
      <div class="record-metrics"><span class="metric"><b>${item.minutes}</b> 分钟</span><span class="metric"><b>${item.total}</b> 题</span><span class="metric good">正确 <b>${item.correct}</b></span><span class="metric">错误 <b>${item.wrong}</b></span><span class="metric">正确率 <b>${accuracy}%</b></span></div>${item.breakdown && Object.keys(item.breakdown).length ? `<div class="record-breakdown">${Object.entries(item.breakdown).map(([type, value]) => `<span>${escapeHtml(type)} <b>${Number(value.total) - Number(value.correct)} 错</b></span>`).join('')}</div>` : ''}
    </article>`;
  }).join('');
}

function renderCategoryFilters() {
  const types = [...new Set(records.map((item) => displayType(item)).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'zh-CN'));
  document.querySelector('#categoryFilters').innerHTML = [['all', '全部'], ...types.map((type) => [type, type])].map(([value, label]) => `<button class="category-filter ${categoryFilter === value ? 'active' : ''}" data-category="${escapeHtml(value)}" type="button">${escapeHtml(label)}</button>`).join('');
}

function renderDailyBreakdown(visible) {
  const groups = visible.reduce((map, item) => {
    const group = map[item.date] || { total: 0, minutes: 0, correct: 0, types: {} };
    group.total += item.total;
    group.minutes += item.minutes;
    group.correct += item.correct;
    const key = displayType(item);
    group.types[key] = group.types[key] || { total: 0, minutes: 0 };
    group.types[key].total += item.total;
    group.types[key].minutes += item.minutes;
    map[item.date] = group;
    return map;
  }, {});
  const breakdown = document.querySelector('#dailyBreakdown');
  breakdown.innerHTML = Object.entries(groups).sort((a, b) => b[0].localeCompare(a[0])).map(([date, group]) => `<div class="day-summary"><div class="day-summary-head"><strong>${moneyDate(date)}</strong><span>完成 ${group.total} 题 · 用时 ${group.minutes} 分钟 · 正确 ${(group.correct / group.total * 100).toFixed(1)}%</span></div><div class="day-types">${Object.entries(group.types).map(([type, value]) => `<span class="day-type">${escapeHtml(type)} <b>${value.total} 题 · ${value.minutes} 分钟</b></span>`).join('')}</div></div>`).join('');
}

function escapeHtml(value) {
  return String(value || '').replace(/[&<>'"]/g, (character) => ({ '&:': '&amp;', '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#039;', '"': '&quot;' }[character] || character));
}

function resetForm() {
  form.reset();
  form.elements.id.value = '';
  form.elements.date.value = today();
  form.elements.practiceMode.value = '专项刷题';
  updatePracticeMode();
  form.elements.wrong.value = '';
  document.querySelector('#formTitle').textContent = '记录今天';
  document.querySelector('.save-btn').textContent = '保存记录';
}

function updateSubmoduleOptions() {
  const module = form.elements.module.value;
  const submodule = form.elements.submodule;
  const options = MODULE_SUBMODULES[module] || ['综合训练'];
  const previous = submodule.value;
  submodule.innerHTML = options.map((item) => `<option value="${escapeHtml(item)}">${escapeHtml(item)}</option>`).join('');
  submodule.value = options.includes(previous) ? previous : options[0];
}

function updatePracticeMode() {
  const isMock = form.elements.practiceMode.value === '套题训练';
  const isModuleTraining = form.elements.practiceMode.value === '大模块综合';
  if (isMock) form.elements.module.value = '全科套题';
  if (!isMock && form.elements.module.value === '全科套题') form.elements.module.value = '';
  form.elements.module.disabled = isMock;
  form.elements.submodule.disabled = isMock || isModuleTraining;
  updateSubmoduleOptions();
  if (isModuleTraining) form.elements.submodule.value = MODULE_SUBMODULES[form.elements.module.value]?.includes('综合训练') ? '综合训练' : (MODULE_SUBMODULES[form.elements.module.value] || ['综合训练'])[0];
  renderMockBreakdown();
}

function renderMockBreakdown() {
  const panel = document.querySelector('#mockBreakdown');
  const fields = document.querySelector('#mockBreakdownFields');
  const visible = form.elements.practiceMode.value === '套题训练';
  panel.hidden = !visible;
  if (!visible) { fields.innerHTML = ''; return; }
  const current = records.find((item) => item.id === form.elements.id.value)?.breakdown || {};
  fields.innerHTML = MOCK_BREAKDOWN_TYPES.map((type) => `<label><span>${type}</span><input type="number" min="0" data-breakdown-total="${type}" value="${current[type]?.total || ''}" placeholder="题数" /><input type="number" min="0" data-breakdown-correct="${type}" value="${current[type]?.correct || ''}" placeholder="正确" /></label>`).join('');
}

function readMockBreakdown() {
  return Object.fromEntries(MOCK_BREAKDOWN_TYPES.map((type) => [type, { total: number(document.querySelector(`[data-breakdown-total="${type}"]`)?.value), correct: number(document.querySelector(`[data-breakdown-correct="${type}"]`)?.value) }]).filter(([, value]) => value.total > 0));
}

function editRecord(id) {
  const item = records.find((record) => record.id === id);
  if (!item) return;
  Object.entries(item).forEach(([key, value]) => { if (form.elements[key]) form.elements[key].value = value; });
  updatePracticeMode();
  document.querySelector('#formTitle').textContent = '修改记录';
  document.querySelector('.save-btn').textContent = '保存修改';
  form.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

async function cloudInsert(item) {
  const data = await restRequest('training_sessions', { method: 'POST', body: JSON.stringify({ session_date: item.date, module: item.module, submodule: item.submodule, practice_mode: item.practiceMode, breakdown: item.breakdown || null, total: item.total, correct: item.correct, minutes: item.minutes }) });
  return data?.[0];
}

async function cloudUpdate(item) {
  if (!item.id.startsWith('cloud-')) return;
  const id = item.id.slice(6);
  await restRequest(`training_sessions?id=eq.${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify({ session_date: item.date, module: item.module, submodule: item.submodule, practice_mode: item.practiceMode, breakdown: item.breakdown || null, total: item.total, correct: item.correct, minutes: item.minutes }) });
}

async function cloudDelete(item) {
  if (!item.id.startsWith('cloud-')) return;
  await restRequest(`training_sessions?id=eq.${encodeURIComponent(item.id.slice(6))}`, { method: 'DELETE' });
}

async function loadCloudRecords() {
  let data;
  try { data = await restRequest('training_sessions?select=id,module,submodule,practice_mode,breakdown,total,correct,minutes,session_date,created_at&order=session_date.desc'); }
  catch (error) {
    try { data = await restRequest('training_sessions?select=id,module,total,correct,minutes,session_date,created_at&order=session_date.desc'); }
    catch (fallbackError) { cloudReady = false; syncStatus.textContent = `云端错误：${fallbackError.message.slice(0, 40)}`; return; }
  }
  if (!data) { cloudReady = false; syncStatus.textContent = '云端不可用，本机数据保留'; return; }
  if (!Array.isArray(data)) { cloudReady = false; syncStatus.textContent = '云端返回异常，本机数据保留'; return; }
  if (!data.length && records.length) {
    cloudReady = true;
    syncStatus.textContent = '云端暂无返回，本机数据保留';
    saveLocal();
    renderStats();
    renderRecords();
    return;
  }
  cloudReady = true;
  const cloudRecords = data.map((item) => normalizeRecord({ id: `cloud-${item.id}`, date: item.session_date, type: item.submodule || item.module, module: item.module, submodule: item.submodule, practiceMode: item.practice_mode, breakdown: item.breakdown, minutes: item.minutes, total: item.total, correct: item.correct, wrong: item.total - item.correct }));
  const localOnly = records.filter((local) => !cloudRecords.some((cloud) => cloud.date === local.date && cloud.module === local.module && cloud.submodule === local.submodule && cloud.practiceMode === local.practiceMode && cloud.total === local.total && cloud.correct === local.correct));
  // Never replace local data with an empty or incomplete cloud response.
  records = [...cloudRecords, ...localOnly];
  saveLocal();
  renderStats();
  renderRecords();
}

async function syncLocalRecords() {
  let cloudData;
  try { cloudData = await restRequest('training_sessions?select=id,module,submodule,practice_mode,breakdown,total,correct,minutes,session_date'); }
  catch { try { cloudData = await restRequest('training_sessions?select=id,module,total,correct,minutes,session_date'); } catch { return; } }
  const cloudRecords = (cloudData || []).map((item) => normalizeRecord({ ...item, date: item.session_date, type: item.submodule || item.module, practiceMode: item.practice_mode }));
  const pending = records.filter((local) => !local.id.startsWith('cloud-') && !cloudRecords.some((remote) => remote.date === local.date && remote.module === local.module && remote.submodule === local.submodule && remote.practiceMode === local.practiceMode && remote.total === local.total && remote.correct === local.correct));
  for (const item of pending) {
    try {
      const created = await cloudInsert(item);
      item.id = `cloud-${created.id}`;
    } catch {
      showToast('部分记录暂未同步，请稍后重试');
    }
  }
  saveLocal();
}

form.addEventListener('input', updateWrong);
form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const data = new FormData(form);
  const total = number(data.get('total'));
  const correct = Math.min(total, number(data.get('correct')));
  const module = String(data.get('module') || '').trim();
  const submodule = String(data.get('submodule') || '').trim();
  const practiceMode = data.get('practiceMode') || '专项刷题';
  const breakdown = practiceMode === '套题训练' ? readMockBreakdown() : {};
  const breakdownTotal = Object.values(breakdown).reduce((sum, value) => sum + value.total, 0);
  const breakdownCorrect = Object.values(breakdown).reduce((sum, value) => sum + Math.min(value.total, value.correct), 0);
  if (practiceMode === '套题训练' && (!breakdownTotal || breakdownTotal !== total || breakdownCorrect !== correct)) return showToast('套题明细的题数和正确数必须与上方总数一致');
  const item = { id: data.get('id') || `${Date.now()}`, date: data.get('date'), module, submodule, type: submodule, practiceMode, breakdown, minutes: number(data.get('minutes')), total, correct, wrong: total - correct };
  if (!item.date || !item.module || !item.submodule || !total) return showToast('请填写日期、大模块、小模块和题数');
  const index = records.findIndex((record) => record.id === item.id);
  const isEdit = index >= 0;
  if (isEdit) records[index] = item; else records.push(item);
  saveLocal(); renderStats(); renderRecords(); resetForm();
  showToast(isEdit ? '记录已修改' : '记录已保存');
  try {
    if (isEdit) await cloudUpdate(item);
    else {
      const created = await cloudInsert(item);
      if (created?.id) {
        const saved = records.find((record) => record.id === item.id);
        if (saved) saved.id = `cloud-${created.id}`;
        saveLocal();
      }
    }
  } catch { showToast('已保存本机，云端同步稍后重试'); }
});

document.querySelector('#resetForm').addEventListener('click', resetForm);
document.querySelector('#mockBreakdownFields').addEventListener('input', () => {
  if (form.elements.practiceMode.value !== '套题训练') return;
  const breakdown = readMockBreakdown();
  form.elements.total.value = Object.values(breakdown).reduce((sum, value) => sum + value.total, 0) || '';
  form.elements.correct.value = Object.values(breakdown).reduce((sum, value) => sum + Math.min(value.total, value.correct), 0) || '';
  updateWrong();
});
form.elements.module.addEventListener('change', () => { if (form.elements.module.value === '全科套题') form.elements.practiceMode.value = '套题训练'; updatePracticeMode(); });
form.elements.practiceMode.addEventListener('change', updatePracticeMode);
document.querySelector('#prevMonth').addEventListener('click', () => { calendarMonth = new Date(calendarMonth.getFullYear(), calendarMonth.getMonth() - 1, 1); renderCalendar(); });
document.querySelector('#nextMonth').addEventListener('click', () => { calendarMonth = new Date(calendarMonth.getFullYear(), calendarMonth.getMonth() + 1, 1); renderCalendar(); });
document.querySelector('#calendarGrid').addEventListener('click', (event) => { const cell = event.target.closest('[data-date]'); if (cell) renderDayDetail(cell.dataset.date); });
document.querySelector('#dayDetail').addEventListener('click', (event) => { const button = event.target.closest('[data-day-filter]'); if (!button) return; document.querySelector('#dateFilter').value = button.dataset.dayFilter; renderRecords(); document.querySelector('#dailyRecords').scrollIntoView({ behavior: 'smooth', block: 'start' }); });
document.querySelector('#searchInput').addEventListener('input', renderRecords);
document.querySelector('#dateFilter').addEventListener('input', renderRecords);
document.querySelector('.insights-panel').addEventListener('click', (event) => { const button = event.target.closest('[data-type-filter]'); if (button) filterByType(button.dataset.typeFilter); });
document.querySelector('.analysis-panel').addEventListener('click', (event) => { const button = event.target.closest('[data-type-filter]'); if (button) filterByType(button.dataset.typeFilter); });
function filterByType(type) { categoryFilter = type; document.querySelector('#searchInput').value = ''; document.querySelector('#dateFilter').value = ''; renderRecords(); document.querySelector('#dailyRecords').scrollIntoView({ behavior: 'smooth', block: 'start' }); showToast(`正在查看：${type}`); }
document.querySelector('#categoryFilters').addEventListener('click', (event) => { const button = event.target.closest('[data-category]'); if (!button) return; categoryFilter = button.dataset.category; renderRecords(); });
document.querySelector('#clearFilters').addEventListener('click', () => { categoryFilter = 'all'; document.querySelector('#searchInput').value = ''; document.querySelector('#dateFilter').value = ''; renderRecords(); });
['targetAccuracy', 'targetSpeed'].forEach((id) => document.querySelector(`#${id}`).addEventListener('change', (event) => {
  const value = Number(event.target.value);
  targets[id === 'targetAccuracy' ? 'accuracy' : 'speed'] = id === 'targetAccuracy' ? Math.min(100, Math.max(1, value || 80)) : Math.max(.01, value || 1.5);
  localStorage.setItem(TARGET_STORAGE_KEY, JSON.stringify(targets));
  renderStats();
  showToast('目标已更新');
}));
document.querySelector('#retrySync').addEventListener('click', syncCloud);
document.querySelector('#openMemory').addEventListener('click', () => { editingMemory = false; setMemoryModal(memoryModal, true); resetMemoryForm(); });
document.querySelector('#openMemoryLibrary').addEventListener('click', () => { setMemoryModal(memoryLibraryModal, true); renderMemoryList(); });
document.querySelector('#closeMemory').addEventListener('click', () => { setMemoryModal(memoryModal, false); });
document.querySelector('#closeMemoryLibrary').addEventListener('click', () => { setMemoryModal(memoryLibraryModal, false); });
memoryModal.addEventListener('click', (event) => { if (event.target === memoryModal) setMemoryModal(memoryModal, false); });
memoryLibraryModal.addEventListener('click', (event) => { if (event.target === memoryLibraryModal) setMemoryModal(memoryLibraryModal, false); });
memoryList.addEventListener('click', (event) => {
  const toggle = event.target.closest('[data-answer-toggle]');
  const card = event.target.closest('[data-memory-card]');
  if (toggle || (card && !event.target.closest('[data-memory-edit],[data-memory-delete]'))) { const id = toggle?.dataset.answerToggle || card.dataset.memoryCard; const answer = memoryList.querySelector(`[data-answer="${id}"]`); if (!answer) return; answer.hidden = !answer.hidden; const button = memoryList.querySelector(`[data-answer-toggle="${id}"]`); if (button) button.textContent = answer.hidden ? '显示答案' : '隐藏答案'; return; }
  const edit = event.target.closest('[data-memory-edit]');
  if (edit) { const item = memoryRecords.find((card) => card.id === edit.dataset.memoryEdit); if (!item) return; editingMemory = true; setMemoryModal(memoryLibraryModal, false); setMemoryModal(memoryModal, true); Object.entries(item).forEach(([key, value]) => { if (memoryForm.elements[key] && !String(key).endsWith('File')) memoryForm.elements[key].value = value; }); memoryForm.querySelectorAll('[data-upload-name]').forEach((node) => { node.textContent = '原图片已保留'; }); memoryForm.scrollIntoView({ behavior: 'smooth', block: 'start' }); return; }
  const remove = event.target.closest('[data-memory-delete]');
  if (remove) { const item = memoryRecords.find((card) => card.id === remove.dataset.memoryDelete); if (!item || !window.confirm('确定删除这张记忆卡吗？')) return; memoryRecords = memoryRecords.filter((card) => card.id !== item.id); saveMemoryLocal(); renderMemoryList(); deleteMemoryCloud(item).catch(() => showToast('已删除本机，云端删除稍后重试')); }
});
memoryForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const saveButton = memoryForm.querySelector('button[type="submit"]');
  saveButton.disabled = true;
  saveButton.textContent = '保存中...';
  try {
    const data = new FormData(memoryForm);
    const contentImage = await compressImage(data.get('contentImageFile'));
    const answerImage = await compressImage(data.get('answerImageFile'));
  const existing = memoryRecords.find((card) => card.id === data.get('id'));
  const item = { id: data.get('id') || `${Date.now()}`, date: today(), category: '记忆', content: data.get('content').trim(), answer: data.get('answer').trim(), contentImage: contentImage || data.get('contentImage') || '', answerImage: answerImage || data.get('answerImage') || '', createdAt: existing?.createdAt || new Date().toISOString() };
    if (!item.content && !item.contentImage) return showToast('请填写记忆内容或上传内容图片');
    const index = memoryRecords.findIndex((card) => card.id === item.id);
    const isEdit = index >= 0;
    if (isEdit) memoryRecords[index] = item; else memoryRecords.push(item);
    saveMemoryLocal(); renderMemoryList(); resetMemoryForm();
    if (isEdit || editingMemory) { editingMemory = false; setMemoryModal(memoryModal, false); setMemoryModal(memoryLibraryModal, true); renderMemoryList(); showToast('记忆已修改'); } else { showToast('记忆已保存'); }
    try { if (isEdit) await updateMemoryCloud(item); else { const created = await saveMemoryCloud(item); if (created?.id) { const saved = memoryRecords.find((card) => card.id === item.id); if (saved) { saved.id = `cloud-${created.id}`; saved.createdAt = created.created_at || saved.createdAt; } saveMemoryLocal(); renderMemoryList(); } } } catch { showToast('已保存本机，云端同步稍后重试'); }
  } catch { showToast('图片读取失败，请重新选择图片'); }
  finally { saveButton.disabled = false; saveButton.textContent = '保存记忆'; }
});
memoryForm.querySelectorAll('input[type="file"]').forEach((input) => input.addEventListener('change', () => { const name = memoryForm.querySelector(`[data-upload-name="${input.name}"]`); if (name) name.textContent = input.files[0]?.name || '未选择'; }));
document.querySelector('#quickAdd').addEventListener('click', () => { resetForm(); form.scrollIntoView({ behavior: 'smooth', block: 'start' }); form.elements.module.focus(); });
recordsEl.addEventListener('click', (event) => {
  const edit = event.target.closest('[data-edit]');
  const remove = event.target.closest('[data-delete]');
  if (edit) editRecord(edit.dataset.edit);
  if (remove) {
    const item = records.find((record) => record.id === remove.dataset.delete);
    if (!item || !window.confirm(`确定删除“${item.type}”这条记录吗？`)) return;
    records = records.filter((record) => record.id !== item.id); saveLocal(); renderStats(); renderRecords(); showToast('记录已删除');
    cloudDelete(item).catch(() => showToast('已删除本机，云端删除稍后重试'));
  }
});

async function syncCloud() {
  if (!hasAccess) return;
  if (!config.url || !config.anonKey) return showToast('云端服务未配置，当前可正常本机使用');
  syncStatus.textContent = '正在同步...';
  try { await loadCloudRecords(); } catch (error) { syncStatus.textContent = `读取失败：${error.message.slice(0, 32)}`; return; }
  try { await syncLocalRecords(); } catch { syncStatus.textContent = '记录已读取，部分本机数据待同步'; }
  try { await loadMemoryCards(); } catch { /* memory sync should not block practice records */ }
  syncStatus.textContent = cloudReady ? '已自动同步云端' : '云端策略未开启';
  showToast(cloudReady ? '云端同步完成' : '请先执行同步策略 SQL');
}

authButton.addEventListener('click', syncCloud);

document.querySelector('#todayLabel').textContent = moneyDate(today());
resetForm();
renderStats();
renderRecords();
syncCloud();
if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(() => {});
