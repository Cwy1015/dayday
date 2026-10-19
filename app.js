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
function normalizePracticeType(type) { return String(type || '').trim() === '言语理解' ? '片段阅读' : type; }
const TRAINING_MODES = ['专项训练', '模块训练', '套题训练'];
const TRAINING_TYPES = ['公基', '资料分析', '片段阅读', '逻辑填空', '图形推理', '类比推理', '定义判断', '逻辑判断', '数量关系', '数字推理'];
const MODE_LABELS = { '专项训练': '专项', '模块训练': '模块', '套题训练': '套题' };

function normalizeTrainingMode(value) {
  const mode = String(value || '').trim();
  if (mode === '模块刷题' || mode === '大模块综合' || mode === '综合刷题') return '模块训练';
  if (mode === '专项刷题') return '专项训练';
  return TRAINING_MODES.includes(mode) ? mode : '专项训练';
}

function inferModule(type) {
  const value = normalizePracticeType(type);
  return value || '其他';
}

function normalizeRecord(item) {
  const type = normalizePracticeType(item.type || item.submodule || item.module || '');
  const mode = normalizeTrainingMode(item.practiceMode || item.practice_mode);
  let breakdown = item.breakdown || null;
  if (typeof breakdown === 'string') { try { breakdown = JSON.parse(breakdown); } catch { breakdown = null; } }
  return {
    ...item,
    type,
    module: normalizePracticeType(item.module || inferModule(type)),
    submodule: normalizePracticeType(item.submodule || type || '综合训练'),
    practiceMode: mode,
    sessionName: item.sessionName || item.session_name || '',
    breakdown
  };
}

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
const isPublicBasics = (item) => /公基|公共基础/.test(String(item.type || ''));

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

function buildMockBreakdown() {
  const container = document.querySelector('.mock-breakdown-grid');
  container.innerHTML = TRAINING_TYPES.map((type) => `<div class="mock-breakdown-row"><span>${type}</span><input type="number" min="0" step="1" placeholder="题数" data-breakdown-total="${type}"><input type="number" min="0" step="1" placeholder="正确" data-breakdown-correct="${type}"></div>`).join('');
  container.addEventListener('input', updateMockTotals);
}

function updateMockTotals() {
  if (form.elements.practiceMode.value !== '套题训练') return;
  const total = [...document.querySelectorAll('[data-breakdown-total]')].reduce((sum, node) => sum + number(node.value), 0);
  const correct = [...document.querySelectorAll('[data-breakdown-correct]')].reduce((sum, node) => sum + number(node.value), 0);
  form.elements.total.value = total || '';
  form.elements.correct.value = total ? Math.min(total, correct) : '';
  updateWrong();
}

function updateModuleOptions() {
  const mode = form.elements.practiceMode.value;
  const module = form.elements.module.value;
  const field = document.querySelector('#submoduleField');
  const select = form.elements.submodule;
  if (mode === '套题训练') { field.hidden = true; select.disabled = true; return; }
  field.hidden = false; select.disabled = false;
  const options = mode === '模块训练' ? ['综合训练'] : [module || ''].filter(Boolean);
  select.innerHTML = options.length ? options.map((item) => `<option value="${escapeHtml(item)}">${escapeHtml(item)}</option>`).join('') : '<option value="" disabled selected>先选择模块</option>';
  select.value = options[0] || '';
}

function updateTrainingMode() {
  const mode = form.elements.practiceMode.value;
  const mock = mode === '套题训练';
  document.querySelector('#sessionNameField').hidden = !mock;
  document.querySelector('#mockBreakdown').hidden = !mock;
  form.elements.module.disabled = mock;
  if (mock) { form.elements.module.value = '套题'; form.elements.submodule.value = '整套试卷'; }
  else if (!form.elements.module.value) form.elements.module.value = '';
  updateModuleOptions();
  if (mock) updateMockTotals();
}

function readMockBreakdown() {
  const result = {};
  document.querySelectorAll('[data-breakdown-total]').forEach((node) => {
    const type = node.dataset.breakdownTotal;
    const total = number(node.value);
    const correct = Math.min(total, number(document.querySelector(`[data-breakdown-correct="${CSS.escape(type)}"]`)?.value));
    if (total) result[type] = { total, correct, minutes: 0 };
  });
  return Object.keys(result).length ? result : null;
}

function fillMockBreakdown(breakdown) {
  document.querySelectorAll('[data-breakdown-total]').forEach((node) => {
    const value = breakdown?.[node.dataset.breakdownTotal];
    node.value = value?.total || '';
    const correct = document.querySelector(`[data-breakdown-correct="${CSS.escape(node.dataset.breakdownTotal)}"]`);
    if (correct) correct.value = value?.correct || '';
  });
  updateMockTotals();
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
  renderModeOverview();
  renderCalendar();
  renderAnalysis();
}

function renderModeOverview() {
  const summary = (mode) => summarizeSessions(records.filter((item) => normalizeTrainingMode(item.practiceMode) === mode));
  const values = { special: summary('专项训练'), module: summary('模块训练'), mock: summary('套题训练') };
  Object.entries(values).forEach(([key, value]) => {
    document.querySelector(`#${key}ModeTotal`).textContent = `${value.total} 题`;
    document.querySelector(`#${key}ModeAccuracy`).textContent = `${value.accuracy.toFixed(1)}%`;
  });
  document.querySelector('#specialModeHint').textContent = `${records.filter((item) => item.practiceMode === '专项训练').length} 组 · ${values.special.speed.toFixed(2)} 分/题`;
  document.querySelector('#moduleModeHint').textContent = `${records.filter((item) => item.practiceMode === '模块训练').length} 组 · ${values.module.speed.toFixed(2)} 分/题`;
  document.querySelector('#mockModeHint').textContent = `${records.filter((item) => item.practiceMode === '套题训练').length} 套 · ${values.mock.speed.toFixed(2)} 分/题`;
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
  const sections = TRAINING_MODES.map((mode) => {
    const typeMap = records.filter((item) => normalizeTrainingMode(item.practiceMode) === mode).reduce((map, item) => { const key = mode === '套题训练' ? (item.sessionName || '未命名套题') : (item.submodule || item.type); const row = map[key] || { total: 0, correct: 0, minutes: 0 }; row.total += item.total; row.correct += item.correct; row.minutes += item.minutes; map[key] = row; return map; }, {});
    const types = Object.entries(typeMap).map(([type, value]) => ({ type, ...value, accuracy: value.correct / value.total * 100, speed: value.minutes / value.total })).sort((a, b) => b.total - a.total);
    if (!types.length) return '';
    const cards = types.map((item) => { const evaluation = evaluateAbility(item.total, item.accuracy); return `<button class="type-dashboard-card ${evaluation.key}" data-type-filter="${escapeHtml(item.type)}" type="button"><div class="type-dashboard-head"><strong>${escapeHtml(item.type)}</strong><span class="type-level ${evaluation.key}">${evaluation.label}</span><b>${item.accuracy.toFixed(1)}%</b></div><div class="type-dashboard-track"><i style="width:${item.accuracy}%"></i></div><div class="type-dashboard-metrics"><span class="metric-total"><b>${item.total}</b>题</span><span class="metric-correct"><b>${item.correct}</b>对</span><span class="metric-wrong"><b>${item.total - item.correct}</b>错</span><span class="metric-time"><b>${item.minutes}</b>分钟</span><span class="metric-speed"><b>${item.speed.toFixed(2)}</b>分/题</span></div></button>`; }).join('');
    return `<div class="dashboard-mode-group"><div class="dashboard-mode-title"><b>${MODE_LABELS[mode]}训练</b><span>${types.length} 项</span></div>${cards}</div>`;
  }).join('');
  document.querySelector('#typeDashboard').innerHTML = sections || '<span class="required-note">填写记录后显示题型详细数据</span>';
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
  const generalTypes = generalRecords.reduce((map, item) => { const row = map[item.type] || { total: 0, correct: 0 }; row.total += item.total; row.correct += item.correct; map[item.type] = row; return map; }, {});
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

  const typeTotals = records.reduce((map, item) => { map[item.type] = (map[item.type] || 0) + item.total; return map; }, {});
  // Keep every recorded subject visible; the panel itself scrolls as subjects grow.
  const topTypes = Object.entries(typeTotals).sort((a, b) => b[1] - a[1]);
  const typeMax = Math.max(...topTypes.map((item) => item[1]), 1);
  document.querySelector('#typeBars').innerHTML = topTypes.length
    ? topTypes.map(([type, value]) => `<button class="type-row" data-type-filter="${escapeHtml(type)}" type="button"><span title="${escapeHtml(type)}">${escapeHtml(type)}</span><i class="type-track"><b style="width:${(value / typeMax) * 100}%"></b></i><span>${value} 题</span></button>`).join('')
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

  const typeMap = generalRecords.reduce((map, item) => { const row = map[item.type] || { total: 0, correct: 0, minutes: 0 }; row.total += item.total; row.correct += item.correct; row.minutes += item.minutes; map[item.type] = row; return map; }, {});
  const types = Object.entries(typeMap).map(([type, value]) => ({ type, total: value.total, accuracy: value.correct / value.total * 100, speed: value.minutes / value.total })).filter((item) => item.total >= 30);
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
    const searchable = `${item.type || ''} ${item.module || ''} ${item.submodule || ''} ${item.sessionName || ''} ${item.practiceMode || ''}`.toLowerCase();
    const matchesSearch = !search || searchable.includes(search);
    return matchesSearch && (!date || item.date === date) && (categoryFilter === 'all' || item.type === categoryFilter || item.module === categoryFilter);
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
    const label = item.practiceMode === '套题训练' ? (item.sessionName || '未命名套题') : item.practiceMode === '模块训练' ? `${item.module} · 综合训练` : `${item.module || item.type}${item.submodule && item.submodule !== item.module ? ` · ${item.submodule}` : ''}`;
    const breakdown = item.breakdown ? `<div class="record-breakdown">${Object.entries(item.breakdown).map(([type, value]) => `<span>${escapeHtml(type)} ${value.total}题/${value.correct}对</span>`).join('')}</div>` : '';
    return `<article class="record">
      <div class="record-top"><span class="record-date">${moneyDate(item.date)} · ${MODE_LABELS[item.practiceMode] || '专项'}</span><div class="record-actions"><button data-edit="${item.id}">编辑</button><button data-delete="${item.id}">删除</button></div></div>
      <div class="record-type">${escapeHtml(label)}</div>
      <div class="record-metrics"><span class="metric"><b>${item.minutes}</b> 分钟</span><span class="metric"><b>${item.total}</b> 题</span><span class="metric good">正确 <b>${item.correct}</b></span><span class="metric">错误 <b>${item.wrong}</b></span><span class="metric">正确率 <b>${accuracy}%</b></span></div>
      ${breakdown}
    </article>`;
  }).join('');
}

function renderCategoryFilters() {
  const types = [...new Set(records.map((item) => item.type).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'zh-CN'));
  document.querySelector('#categoryFilters').innerHTML = [['all', '全部'], ...types.map((type) => [type, type])].map(([value, label]) => `<button class="category-filter ${categoryFilter === value ? 'active' : ''}" data-category="${escapeHtml(value)}" type="button">${escapeHtml(label)}</button>`).join('');
}

function renderDailyBreakdown(visible) {
  const groups = visible.reduce((map, item) => {
    const group = map[item.date] || { total: 0, minutes: 0, correct: 0, types: {} };
    group.total += item.total;
    group.minutes += item.minutes;
    group.correct += item.correct;
    group.types[item.type] = group.types[item.type] || { total: 0, minutes: 0 };
    group.types[item.type].total += item.total;
    group.types[item.type].minutes += item.minutes;
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
  form.elements.practiceMode.value = '专项训练';
  form.elements.module.value = '';
  document.querySelector('#sessionNameField').hidden = true;
  document.querySelector('#mockBreakdown').hidden = true;
  updateModuleOptions();
  form.elements.wrong.value = '';
  document.querySelector('#formTitle').textContent = '记录今天';
  document.querySelector('.save-btn').textContent = '保存记录';
}

function editRecord(id) {
  const item = records.find((record) => record.id === id);
  if (!item) return;
  form.elements.id.value = item.id;
  form.elements.date.value = item.date;
  form.elements.practiceMode.value = normalizeTrainingMode(item.practiceMode);
  form.elements.module.value = item.practiceMode === '套题训练' ? '' : item.module || item.type;
  form.elements.sessionName.value = item.sessionName || '';
  updateTrainingMode();
  if (item.practiceMode === '套题训练') fillMockBreakdown(item.breakdown);
  else { form.elements.submodule.value = item.submodule || item.type; updateModuleOptions(); }
  form.elements.minutes.value = item.minutes;
  form.elements.total.value = item.total;
  form.elements.correct.value = item.correct;
  updateWrong();
  document.querySelector('#formTitle').textContent = '修改记录';
  document.querySelector('.save-btn').textContent = '保存修改';
  form.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

async function cloudInsert(item) {
  const data = await restRequest('training_sessions', { method: 'POST', body: JSON.stringify({ session_date: item.date, module: item.module || item.type, submodule: item.submodule || item.type, practice_mode: item.practiceMode || '专项训练', note: item.sessionName || null, breakdown: item.breakdown || null, total: item.total, correct: item.correct, minutes: item.minutes }) });
  return data?.[0];
}

async function cloudUpdate(item) {
  if (!item.id.startsWith('cloud-')) return;
  const id = item.id.slice(6);
  await restRequest(`training_sessions?id=eq.${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify({ session_date: item.date, module: item.module || item.type, submodule: item.submodule || item.type, practice_mode: item.practiceMode || '专项训练', note: item.sessionName || null, breakdown: item.breakdown || null, total: item.total, correct: item.correct, minutes: item.minutes }) });
}

async function cloudDelete(item) {
  if (!item.id.startsWith('cloud-')) return;
  await restRequest(`training_sessions?id=eq.${encodeURIComponent(item.id.slice(6))}`, { method: 'DELETE' });
}

async function loadCloudRecords() {
  let data;
    try { data = await restRequest('training_sessions?select=id,module,submodule,practice_mode,note,breakdown,total,correct,minutes,session_date,created_at&order=session_date.desc'); }
  catch (error) { cloudReady = false; syncStatus.textContent = `云端错误：${error.message.slice(0, 40)}`; return; }
  if (!data) { cloudReady = false; syncStatus.textContent = '云端不可用，本机数据保留'; return; }
  cloudReady = true;
    const legacyRecords = data.filter((item) => item.module === '言语理解');
    await Promise.all(legacyRecords.map((item) => restRequest(`training_sessions?id=eq.${encodeURIComponent(item.id)}`, { method: 'PATCH', body: JSON.stringify({ module: '片段阅读' }) }).catch(() => null)));
    const cloudRecords = data.map((item) => normalizeRecord({ id: `cloud-${item.id}`, date: item.session_date, type: item.submodule || item.module, module: item.module, submodule: item.submodule, practice_mode: item.practice_mode, session_name: item.note, breakdown: item.breakdown, minutes: item.minutes, total: item.total, correct: item.correct, wrong: item.total - item.correct }));
  const localOnly = records.filter((local) => !cloudRecords.some((cloud) => cloud.date === local.date && cloud.type === local.type && cloud.total === local.total && cloud.correct === local.correct));
  // Never replace local data with an empty or incomplete cloud response.
  records = [...cloudRecords, ...localOnly];
  saveLocal();
  renderStats();
  renderRecords();
}

async function syncLocalRecords() {
  let cloudData;
    try { cloudData = await restRequest('training_sessions?select=id,module,submodule,practice_mode,note,breakdown,total,correct,minutes,session_date'); }
  catch { return; }
  const cloudRecords = (cloudData || []).map((item) => normalizeRecord({ ...item, session_name: item.note }));
  const pending = records.filter((local) => !String(local.id).startsWith('cloud-') && !cloudRecords.some((remote) => remote.date === local.date && remote.module === local.module && remote.submodule === local.submodule && remote.total === local.total && remote.correct === local.correct));
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
document.querySelector('#practiceMode').addEventListener('change', updateTrainingMode);
document.querySelector('#trainingModule').addEventListener('change', updateModuleOptions);
form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const data = new FormData(form);
  const total = number(data.get('total'));
  const correct = Math.min(total, number(data.get('correct')));
  const practiceMode = normalizeTrainingMode(data.get('practiceMode'));
  const module = practiceMode === '套题训练' ? '套题' : String(data.get('module') || '').trim();
  const submodule = practiceMode === '套题训练' ? '整套试卷' : practiceMode === '模块训练' ? '综合训练' : String(data.get('submodule') || '').trim();
  const breakdown = practiceMode === '套题训练' ? readMockBreakdown() : null;
  const item = normalizeRecord({ id: data.get('id') || `${Date.now()}`, date: data.get('date'), type: submodule, module, submodule, practiceMode, sessionName: data.get('sessionName').trim(), breakdown, minutes: number(data.get('minutes')), total, correct, wrong: total - correct });
  const breakdownTotal = breakdown ? Object.values(breakdown).reduce((sum, value) => sum + value.total, 0) : total;
  if (!item.date || !module || !total) return showToast('请填写日期、模块和题数');
  if (practiceMode === '套题训练' && breakdownTotal !== total) return showToast('套题总题数需要由分题型明细自动汇总');
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
  await syncLocalRecords();
  await loadCloudRecords();
  await loadMemoryCards();
  syncStatus.textContent = cloudReady ? '已自动同步云端' : '云端策略未开启';
  showToast(cloudReady ? '云端同步完成' : '请先执行同步策略 SQL');
}

authButton.addEventListener('click', syncCloud);

document.querySelector('#todayLabel').textContent = moneyDate(today());
buildMockBreakdown();
resetForm();
renderStats();
renderRecords();
syncCloud();
if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(() => {});
