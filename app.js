const STORAGE_KEY = 'daily-practice-records';
const config = window.SUPABASE_CONFIG || {};
const supabaseClient = null;
const form = document.querySelector('#dailyForm');
const recordsEl = document.querySelector('#dailyRecords');
const emptyEl = document.querySelector('#emptyDaily');
const toast = document.querySelector('#toast');
const authButton = document.querySelector('[data-action="sync"]');
const syncStatus = document.querySelector('#syncStatus');
let records = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
let cloudReady = Boolean(supabaseClient);
let calendarMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1);

async function restRequest(path, options = {}) {
  if (!config.url || !config.anonKey) throw new Error('Supabase 配置缺失');
  const response = await fetch(`${config.url}/rest/v1/${path}`, {
    ...options,
    headers: {
      apikey: config.anonKey,
      Authorization: `Bearer ${config.anonKey}`,
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

function showToast(message) {
  toast.textContent = message;
  toast.classList.add('show');
  clearTimeout(window.toastTimer);
  window.toastTimer = setTimeout(() => toast.classList.remove('show'), 1800);
}

function saveLocal() { localStorage.setItem(STORAGE_KEY, JSON.stringify(records)); }

function updateWrong() {
  const total = number(form.elements.total.value);
  const correct = number(form.elements.correct.value);
  form.elements.wrong.value = Math.max(0, total - correct);
}

function renderStats() {
  const total = records.reduce((sum, item) => sum + item.total, 0);
  const minutes = records.reduce((sum, item) => sum + item.minutes, 0);
  const correct = records.reduce((sum, item) => sum + item.correct, 0);
  document.querySelector('#totalQuestions').textContent = total;
  document.querySelector('#totalMinutes').textContent = minutes;
  document.querySelector('#averageAccuracy').textContent = total ? ((correct / total) * 100).toFixed(1) : '0';
  renderInsights(total, correct);
  renderControlStats(total);
  renderCalendar();
  renderAnalysis();
}

function renderControlStats(total) {
  const current = today();
  const sevenDays = records.filter((item) => daysBetween(item.date, current) >= 0 && daysBetween(item.date, current) < 7);
  const sevenTotal = sevenDays.reduce((sum, item) => sum + item.total, 0);
  const sevenCorrect = sevenDays.reduce((sum, item) => sum + item.correct, 0);
  const avgSpeed = total ? records.reduce((sum, item) => sum + item.minutes, 0) / total : 0;
  document.querySelector('#streakDays').textContent = calculateStreak();
  document.querySelector('#avgSpeed').textContent = avgSpeed ? avgSpeed.toFixed(2) : '0';
  document.querySelector('#last7Compare').textContent = sevenTotal ? `${((sevenCorrect / sevenTotal) * 100).toFixed(1)}%` : '0%';
}

function daysBetween(from, to) {
  return Math.round((new Date(`${to}T00:00:00`) - new Date(`${from}T00:00:00`)) / 86400000);
}

function calculateStreak() {
  const dates = new Set(records.map((item) => item.date));
  let count = 0;
  let cursor = today();
  if (!dates.has(cursor)) cursor = new Date(new Date(`${cursor}T00:00:00`) - 86400000).toISOString().slice(0, 10);
  while (dates.has(cursor)) { count += 1; cursor = new Date(new Date(`${cursor}T00:00:00`) - 86400000).toISOString().slice(0, 10); }
  return count;
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
  const typeMap = records.reduce((map, item) => { const row = map[item.type] || { total: 0, correct: 0, minutes: 0 }; row.total += item.total; row.correct += item.correct; row.minutes += item.minutes; map[item.type] = row; return map; }, {});
  const types = Object.entries(typeMap).map(([type, value]) => ({ type, ...value, accuracy: value.correct / value.total * 100, speed: value.minutes / value.total })).sort((a, b) => b.accuracy - a.accuracy);
  document.querySelector('#typeAccuracy').innerHTML = types.length ? types.slice(0, 6).map((item) => `<button class="analysis-row" data-type-filter="${escapeHtml(item.type)}" type="button"><span title="${escapeHtml(item.type)}">${escapeHtml(item.type)}</span><i class="analysis-track"><b style="width:${item.accuracy}%"></b></i><span>${item.accuracy.toFixed(1)}%<small>${item.speed.toFixed(2)} 分/题</small></span></button>`).join('') : '<span class="required-note">填写记录后显示题型正确率</span>';
  const errorMap = records.reduce((map, item) => { String(item.errorType || '').split(/[、,，/]/).map((value) => value.trim()).filter(Boolean).forEach((type) => { map[type] = (map[type] || 0) + item.wrong; }); return map; }, {});
  const errors = Object.entries(errorMap).sort((a, b) => b[1] - a[1]).slice(0, 5);
  const errorMax = Math.max(...errors.map((item) => item[1]), 1);
  document.querySelector('#errorTotal').textContent = `${errors.reduce((sum, item) => sum + item[1], 0)} 次`;
  document.querySelector('#errorBars').innerHTML = errors.length ? errors.map(([type, count]) => `<div class="error-row"><span title="${escapeHtml(type)}">${escapeHtml(type)}</span><i><b style="width:${count / errorMax * 100}%"></b></i><span>${count}</span></div>`).join('') : '<span class="required-note">填写错误类型后显示分布</span>';
}

function renderInsights(total, correct) {
  const date = new Date();
  const days = Array.from({ length: 7 }, (_, index) => {
    const current = new Date(date);
    current.setDate(date.getDate() - (6 - index));
    const key = current.toISOString().slice(0, 10);
    const dayRecords = records.filter((item) => item.date === key);
    return { key, label: `${current.getMonth() + 1}/${current.getDate()}`, total: dayRecords.reduce((sum, item) => sum + item.total, 0), minutes: dayRecords.reduce((sum, item) => sum + item.minutes, 0) };
  });
  const max = Math.max(...days.map((item) => item.total), 1);
  document.querySelector('#weeklyBars').className = 'weekly-bars';
  document.querySelector('#weeklyLabels').className = 'weekly-labels';
  document.querySelector('#weeklyBars').innerHTML = days.map((item, index) => `<div class="weekly-bar ${index === days.length - 1 ? 'today' : ''}" style="height:${Math.max(4, (item.total / max) * 100)}%"><span>${item.total || ''}</span></div>`).join('');
  document.querySelector('#weeklyLabels').innerHTML = days.map((item) => `<span>${item.label}</span>`).join('');
  const weekTotal = days.reduce((sum, item) => sum + item.total, 0);
  const weekMinutes = days.reduce((sum, item) => sum + item.minutes, 0);
  document.querySelector('#trendHint').textContent = weekTotal ? `${weekTotal} 题 · ${weekMinutes} 分钟` : '暂无数据';

  const typeTotals = records.reduce((map, item) => { map[item.type] = (map[item.type] || 0) + item.total; return map; }, {});
  const topTypes = Object.entries(typeTotals).sort((a, b) => b[1] - a[1]).slice(0, 4);
  const typeMax = Math.max(...topTypes.map((item) => item[1]), 1);
  document.querySelector('#typeBars').innerHTML = topTypes.length
    ? topTypes.map(([type, value]) => `<button class="type-row" data-type-filter="${escapeHtml(type)}" type="button"><span title="${escapeHtml(type)}">${escapeHtml(type)}</span><i class="type-track"><b style="width:${(value / typeMax) * 100}%"></b></i><span>${value} 题</span></button>`).join('')
    : '<span class="required-note">填写记录后显示题型分布</span>';
  document.querySelector('#topType').textContent = topTypes[0] ? `最多：${topTypes[0][0]}` : '暂无数据';

  const accuracy = total ? (correct / total) * 100 : 0;
  document.querySelector('#panelAccuracy').textContent = `${accuracy.toFixed(1)}%`;
  document.querySelector('#accuracyFill').style.width = `${accuracy}%`;
  document.querySelector('#accuracyHint').textContent = total ? (accuracy >= 80 ? '状态不错' : accuracy >= 60 ? '继续保持' : '重点复盘') : '暂无数据';
  document.querySelector('#accuracyText').textContent = total ? `共完成 ${total} 题，答对 ${correct} 题` : '记录后会显示表现';
}

function filteredRecords() {
  const search = document.querySelector('#searchInput').value.trim().toLowerCase();
  const date = document.querySelector('#dateFilter').value;
  return [...records].filter((item) => {
    const matchesSearch = !search || `${item.type} ${item.note}`.toLowerCase().includes(search);
    return matchesSearch && (!date || item.date === date);
  }).sort((a, b) => `${b.date}-${b.id}`.localeCompare(`${a.date}-${a.id}`));
}

function renderRecords() {
  const visible = filteredRecords();
  document.querySelector('#recordCount').textContent = `${visible.length} 条`;
  emptyEl.hidden = visible.length > 0;
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
document.querySelector('#copyYesterday').addEventListener('click', () => {
  const yesterday = new Date(new Date(`${today()}T00:00:00`) - 86400000).toISOString().slice(0, 10);
  const latest = records.filter((item) => item.date === yesterday).sort((a, b) => b.id.localeCompare(a.id))[0];
  if (!latest) return showToast('昨天还没有记录');
  form.elements.type.value = latest.type;
  form.elements.minutes.value = latest.minutes;
  form.elements.total.value = latest.total;
  form.elements.correct.value = latest.correct;
  form.elements.errorType.value = latest.errorType || '';
  form.elements.note.value = latest.note || '';
  updateWrong();
  showToast('已复制昨天记录，请确认后保存');
});
document.querySelector('#searchInput').addEventListener('input', renderRecords);
document.querySelector('#dateFilter').addEventListener('input', renderRecords);
document.querySelector('.insights-panel').addEventListener('click', (event) => { const button = event.target.closest('[data-type-filter]'); if (button) filterByType(button.dataset.typeFilter); });
document.querySelector('.analysis-panel').addEventListener('click', (event) => { const button = event.target.closest('[data-type-filter]'); if (button) filterByType(button.dataset.typeFilter); });
function filterByType(type) { document.querySelector('#searchInput').value = type; document.querySelector('#dateFilter').value = ''; renderRecords(); document.querySelector('#dailyRecords').scrollIntoView({ behavior: 'smooth', block: 'start' }); showToast(`正在查看：${type}`); }
document.querySelector('#clearFilters').addEventListener('click', () => { document.querySelector('#searchInput').value = ''; document.querySelector('#dateFilter').value = ''; renderRecords(); });
document.querySelector('#retrySync').addEventListener('click', syncCloud);
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
  if (!config.url || !config.anonKey) return showToast('云端服务未配置，当前可正常本机使用');
  syncStatus.textContent = '正在同步...';
  await syncLocalRecords();
  await loadCloudRecords();
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
