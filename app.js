const STORAGE_KEY = 'daily-practice-records';
const MEMORY_STORAGE_KEY = 'daily-memory-cards';
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
const memoryForm = document.querySelector('#memoryForm');
const memoryList = document.querySelector('#memoryList');
let records = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
let memoryRecords = JSON.parse(localStorage.getItem(MEMORY_STORAGE_KEY) || '[]');
let cloudReady = Boolean(supabaseClient);
let calendarMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
let categoryFilter = 'all';

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

function renderMemoryList() {
  document.querySelector('#memoryCount').textContent = `${memoryRecords.length} 条`;
  memoryList.innerHTML = [...memoryRecords].sort((a, b) => `${b.date}-${b.id}`.localeCompare(`${a.date}-${a.id}`)).map((item) => { const content = item.content ? `<h3>${escapeHtml(item.content)}</h3>` : ''; const contentImage = item.contentImage ? `<img class="memory-image" src="${item.contentImage}" alt="记忆内容图片" />` : ''; const answer = item.answer || item.answerImage; return `<article class="memory-card"><div class="memory-card-head"><span>记忆卡片</span><div><button type="button" data-memory-edit="${item.id}">编辑</button><button type="button" data-memory-delete="${item.id}">删除</button></div></div>${content}${contentImage}${answer ? `<button class="answer-toggle" type="button" data-answer-toggle="${item.id}">显示答案</button><div class="memory-answer" data-answer="${item.id}" hidden>${item.answer ? `<p>${escapeHtml(item.answer)}</p>` : ''}${item.answerImage ? `<img class="memory-image" src="${item.answerImage}" alt="答案图片" />` : ''}</div>` : '<small class="no-answer">这是一张无答案记忆卡</small>'}</article>`; }).join('') || '<div class="memory-empty">还没有记忆内容，先添加一张卡片吧。</div>';
}

async function loadMemoryCards() {
  let data;
  try { data = await restRequest('memory_cards?select=id,card_date,category,content,answer,content_image,answer_image,created_at&order=card_date.desc,created_at.desc'); }
  catch { return; }
  if (!data) return;
  const cloudCards = data.map((item) => ({ id: `cloud-${item.id}`, date: item.card_date, category: item.category, content: item.content || '', answer: item.answer || '', contentImage: item.content_image || '', answerImage: item.answer_image || '' }));
  const localOnly = memoryRecords.filter((local) => !cloudCards.some((cloud) => cloud.date === local.date && cloud.category === local.category && cloud.content === local.content));
  memoryRecords = [...cloudCards, ...localOnly];
  saveMemoryLocal();
  renderMemoryList();
}

async function saveMemoryCloud(item) {
  const data = await restRequest('memory_cards', { method: 'POST', body: JSON.stringify({ card_date: item.date, category: item.category, content: item.content || '', answer: item.answer || null, content_image: item.contentImage || null, answer_image: item.answerImage || null }) });
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
  const typeMap = records.reduce((map, item) => { const row = map[item.type] || { total: 0, correct: 0, minutes: 0, errors: {} }; row.total += item.total; row.correct += item.correct; row.minutes += item.minutes; String(item.errorType || '').split(/[、,，/]/).map((value) => value.trim()).filter(Boolean).forEach((error) => { row.errors[error] = (row.errors[error] || 0) + item.wrong; }); map[item.type] = row; return map; }, {});
  const types = Object.entries(typeMap).map(([type, value]) => ({ type, ...value, accuracy: value.correct / value.total * 100, speed: value.minutes / value.total, errorTypes: Object.entries(value.errors).sort((a, b) => b[1] - a[1]).slice(0, 2).map(([name, count]) => `${name} ${count}次`).join(' · ') })).sort((a, b) => b.total - a.total);
  document.querySelector('#typeDashboard').innerHTML = types.length ? types.map((item) => { const level = item.accuracy >= 80 ? 'strong' : item.accuracy >= 60 ? 'steady' : 'weak'; return `<button class="type-dashboard-card ${level}" data-type-filter="${escapeHtml(item.type)}" type="button"><div class="type-dashboard-head"><strong>${escapeHtml(item.type)}</strong><b>${item.accuracy.toFixed(1)}%</b></div><div class="type-dashboard-track"><i style="width:${item.accuracy}%"></i></div><div class="type-dashboard-metrics"><span class="metric-total"><b>${item.total}</b>题</span><span class="metric-correct"><b>${item.correct}</b>对</span><span class="metric-wrong"><b>${item.total - item.correct}</b>错</span><span class="metric-time"><b>${item.minutes}</b>分钟</span><span class="metric-speed"><b>${item.speed.toFixed(2)}</b>分/题</span></div><small class="type-dashboard-errors">${item.errorTypes || '暂未填写错误类型'}</small></button>`; }).join('') : '<span class="required-note">填写记录后显示题型详细数据</span>';
  const errorMap = records.reduce((map, item) => { String(item.errorType || '').split(/[、,，/]/).map((value) => value.trim()).filter(Boolean).forEach((type) => { map[type] = (map[type] || 0) + item.wrong; }); return map; }, {});
  const errors = Object.entries(errorMap).sort((a, b) => b[1] - a[1]).slice(0, 5);
  const errorMax = Math.max(...errors.map((item) => item[1]), 1);
  document.querySelector('#errorTotal').textContent = `${errors.reduce((sum, item) => sum + item[1], 0)} 次`;
  document.querySelector('#errorBars').innerHTML = errors.length ? errors.map(([type, count]) => `<div class="error-row"><span title="${escapeHtml(type)}">${escapeHtml(type)}</span><i><b style="width:${count / errorMax * 100}%"></b></i><span>${count}</span></div>`).join('') : '<span class="required-note">填写错误类型后显示分布</span>';
}

function renderInsights(total, correct) {
  const generalMinutes = records.filter((item) => !isPublicBasics(item)).reduce((sum, item) => sum + item.minutes, 0);

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

  const accuracy = total ? (correct / total) * 100 : 0;
  document.querySelector('#panelAccuracy').textContent = `${accuracy.toFixed(1)}%`;
  document.querySelector('#accuracyFill').style.width = `${accuracy}%`;
  document.querySelector('#accuracyHint').textContent = total ? (accuracy >= 80 ? '状态不错' : accuracy >= 60 ? '继续保持' : '重点复盘') : '暂无数据';
  document.querySelector('#accuracyText').textContent = total ? `共完成 ${total} 题，答对 ${correct} 题` : '记录后会显示表现';
  document.querySelector('#generalSpeed').textContent = total ? (generalMinutes / total).toFixed(2) : '0';
}

function filteredRecords() {
  const search = document.querySelector('#searchInput').value.trim().toLowerCase();
  const date = document.querySelector('#dateFilter').value;
  return [...records].filter((item) => {
    const matchesSearch = !search || `${item.type} ${item.note}`.toLowerCase().includes(search);
    return matchesSearch && (!date || item.date === date) && (categoryFilter === 'all' || item.type === categoryFilter);
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
      <div class="record-type">${escapeHtml(item.type)}</div>
      <div class="record-metrics"><span class="metric"><b>${item.minutes}</b> 分钟</span><span class="metric"><b>${item.total}</b> 题</span><span class="metric good">正确 <b>${item.correct}</b></span><span class="metric">错误 <b>${item.wrong}</b></span><span class="metric">正确率 <b>${accuracy}%</b></span></div>
      ${item.errorType ? `<div class="record-error">错误类型：${escapeHtml(item.errorType)}</div>` : ''}
      ${item.note ? `<p class="record-note">${escapeHtml(item.note)}</p>` : ''}
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
  form.elements.wrong.value = '';
  document.querySelector('#formTitle').textContent = '记录今天';
  document.querySelector('.save-btn').textContent = '保存记录';
}

function editRecord(id) {
  const item = records.find((record) => record.id === id);
  if (!item) return;
  Object.entries(item).forEach(([key, value]) => { if (form.elements[key]) form.elements[key].value = value; });
  document.querySelector('#formTitle').textContent = '修改记录';
  document.querySelector('.save-btn').textContent = '保存修改';
  form.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

async function cloudInsert(item) {
  const data = await restRequest('training_sessions', { method: 'POST', body: JSON.stringify({ session_date: item.date, module: item.type, total: item.total, correct: item.correct, minutes: item.minutes, note: item.note || null, error_type: item.errorType || null }) });
  return data?.[0];
}

async function cloudUpdate(item) {
  if (!item.id.startsWith('cloud-')) return;
  const id = item.id.slice(6);
  await restRequest(`training_sessions?id=eq.${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify({ session_date: item.date, module: item.type, total: item.total, correct: item.correct, minutes: item.minutes, note: item.note || null, error_type: item.errorType || null }) });
}

async function cloudDelete(item) {
  if (!item.id.startsWith('cloud-')) return;
  await restRequest(`training_sessions?id=eq.${encodeURIComponent(item.id.slice(6))}`, { method: 'DELETE' });
}

async function loadCloudRecords() {
  let data;
  try { data = await restRequest('training_sessions?select=id,module,total,correct,minutes,session_date,note,error_type,created_at&order=session_date.desc'); }
  catch (error) { cloudReady = false; syncStatus.textContent = `云端错误：${error.message.slice(0, 40)}`; return; }
  if (!data) { cloudReady = false; syncStatus.textContent = '云端不可用，本机数据保留'; return; }
  cloudReady = true;
  const cloudRecords = data.map((item) => ({ id: `cloud-${item.id}`, date: item.session_date, type: item.module, minutes: item.minutes, total: item.total, correct: item.correct, wrong: item.total - item.correct, errorType: item.error_type || '', note: item.note || '' }));
  const localOnly = records.filter((local) => !cloudRecords.some((cloud) => cloud.date === local.date && cloud.type === local.type && cloud.total === local.total && cloud.correct === local.correct));
  // Never replace local data with an empty or incomplete cloud response.
  records = [...cloudRecords, ...localOnly];
  saveLocal();
  renderStats();
  renderRecords();
}

async function syncLocalRecords() {
  let cloudData;
    try { cloudData = await restRequest('training_sessions?select=id,module,total,correct,minutes,session_date,note,error_type'); }
  catch { return; }
  const cloudRecords = cloudData || [];
  const pending = records.filter((local) => !local.id.startsWith('cloud-') && !cloudRecords.some((remote) => remote.session_date === local.date && remote.module === local.type && remote.total === local.total && remote.correct === local.correct));
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
  const item = { id: data.get('id') || `${Date.now()}`, date: data.get('date'), type: data.get('type').trim(), minutes: number(data.get('minutes')), total, correct, wrong: total - correct, errorType: data.get('errorType').trim(), note: data.get('note').trim() };
  if (!item.date || !item.type || !total) return showToast('请填写日期、类型和题数');
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
document.querySelector('#retrySync').addEventListener('click', syncCloud);
document.querySelector('#openMemory').addEventListener('click', () => { memoryModal.hidden = false; resetMemoryForm(); renderMemoryList(); });
document.querySelector('#closeMemory').addEventListener('click', () => { memoryModal.hidden = true; });
memoryModal.addEventListener('click', (event) => { if (event.target === memoryModal) memoryModal.hidden = true; });
memoryList.addEventListener('click', (event) => {
  const toggle = event.target.closest('[data-answer-toggle]');
  if (toggle) { const answer = memoryList.querySelector(`[data-answer="${toggle.dataset.answerToggle}"]`); answer.hidden = !answer.hidden; toggle.textContent = answer.hidden ? '显示答案' : '隐藏答案'; return; }
  const edit = event.target.closest('[data-memory-edit]');
  if (edit) { const item = memoryRecords.find((card) => card.id === edit.dataset.memoryEdit); if (!item) return; Object.entries(item).forEach(([key, value]) => { if (memoryForm.elements[key]) memoryForm.elements[key].value = value; }); memoryForm.scrollIntoView({ behavior: 'smooth', block: 'start' }); return; }
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
    const item = { id: data.get('id') || `${Date.now()}`, date: today(), category: '记忆', content: data.get('content').trim(), answer: data.get('answer').trim(), contentImage: contentImage || data.get('contentImage') || '', answerImage: answerImage || data.get('answerImage') || '' };
    if (!item.content && !item.contentImage) return showToast('请填写记忆内容或上传内容图片');
    const index = memoryRecords.findIndex((card) => card.id === item.id);
    const isEdit = index >= 0;
    if (isEdit) memoryRecords[index] = item; else memoryRecords.push(item);
    saveMemoryLocal(); renderMemoryList(); resetMemoryForm(); showToast(isEdit ? '记忆已修改' : '记忆已保存');
    try { if (isEdit) await updateMemoryCloud(item); else { const created = await saveMemoryCloud(item); if (created?.id) { const saved = memoryRecords.find((card) => card.id === item.id); if (saved) saved.id = `cloud-${created.id}`; saveMemoryLocal(); renderMemoryList(); } } } catch { showToast('已保存本机，云端同步稍后重试'); }
  } catch { showToast('图片读取失败，请重新选择图片'); }
  finally { saveButton.disabled = false; saveButton.textContent = '保存记忆'; }
});
memoryForm.querySelectorAll('input[type="file"]').forEach((input) => input.addEventListener('change', () => { const name = memoryForm.querySelector(`[data-upload-name="${input.name}"]`); if (name) name.textContent = input.files[0]?.name || '未选择'; }));
document.querySelector('#quickAdd').addEventListener('click', () => { resetForm(); form.scrollIntoView({ behavior: 'smooth', block: 'start' }); form.elements.type.focus(); });
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
resetForm();
renderStats();
renderRecords();
syncCloud();
if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(() => {});
