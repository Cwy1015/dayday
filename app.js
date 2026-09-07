const STORAGE_KEY = 'daily-practice-records';
const config = window.SUPABASE_CONFIG || {};
const supabaseClient = window.supabase && config.url && config.anonKey
  ? window.supabase.createClient(config.url, config.anonKey)
  : null;
const form = document.querySelector('#dailyForm');
const recordsEl = document.querySelector('#dailyRecords');
const emptyEl = document.querySelector('#emptyDaily');
const toast = document.querySelector('#toast');
const authButton = document.querySelector('[data-action="auth"]');
const syncStatus = document.querySelector('#syncStatus');
let records = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
let cloudUser = null;

const today = () => new Date().toISOString().slice(0, 10);
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
  const days = new Set(records.map((item) => item.date)).size;
  document.querySelector('#totalQuestions').textContent = total;
  document.querySelector('#totalMinutes').textContent = minutes;
  document.querySelector('#averageAccuracy').textContent = total ? ((correct / total) * 100).toFixed(1) : '0';
  document.querySelector('#recordDays').textContent = days;
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
  recordsEl.innerHTML = visible.map((item) => {
    const accuracy = item.total ? ((item.correct / item.total) * 100).toFixed(1) : '0.0';
    return `<article class="record">
      <div class="record-top"><span class="record-date">${moneyDate(item.date)}</span><div class="record-actions"><button data-edit="${item.id}">编辑</button><button data-delete="${item.id}">删除</button></div></div>
      <div class="record-type">${escapeHtml(item.type)}</div>
      <div class="record-metrics"><span class="metric"><b>${item.minutes}</b> 分钟</span><span class="metric"><b>${item.total}</b> 题</span><span class="metric good">正确 <b>${item.correct}</b></span><span class="metric">错误 <b>${item.wrong}</b></span><span class="metric">正确率 <b>${accuracy}%</b></span></div>
      ${item.note ? `<p class="record-note">${escapeHtml(item.note)}</p>` : ''}
    </article>`;
  }).join('');
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
  if (!supabaseClient || !cloudUser) return;
  const { error } = await supabaseClient.from('training_sessions').insert({ session_date: item.date, module: item.type, total: item.total, correct: item.correct, minutes: item.minutes, note: item.note || null });
  if (error) throw error;
}

form.addEventListener('input', updateWrong);
form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const data = new FormData(form);
  const total = number(data.get('total'));
  const correct = Math.min(total, number(data.get('correct')));
  const item = { id: data.get('id') || `${Date.now()}`, date: data.get('date'), type: data.get('type').trim(), minutes: number(data.get('minutes')), total, correct, wrong: total - correct, note: data.get('note').trim() };
  if (!item.date || !item.type || !total) return showToast('请填写日期、类型和题数');
  const index = records.findIndex((record) => record.id === item.id);
  const isEdit = index >= 0;
  if (isEdit) records[index] = item; else records.push(item);
  saveLocal(); renderStats(); renderRecords(); resetForm();
  showToast(isEdit ? '记录已修改' : '记录已保存');
  if (!isEdit) { try { await cloudInsert(item); } catch { showToast('已保存本机，云端同步稍后重试'); } }
});

document.querySelector('#resetForm').addEventListener('click', resetForm);
document.querySelector('#searchInput').addEventListener('input', renderRecords);
document.querySelector('#dateFilter').addEventListener('input', renderRecords);
document.querySelector('#clearFilters').addEventListener('click', () => { document.querySelector('#searchInput').value = ''; document.querySelector('#dateFilter').value = ''; renderRecords(); });
recordsEl.addEventListener('click', (event) => {
  const edit = event.target.closest('[data-edit]');
  const remove = event.target.closest('[data-delete]');
  if (edit) editRecord(edit.dataset.edit);
  if (remove) {
    const item = records.find((record) => record.id === remove.dataset.delete);
    if (!item || !window.confirm(`确定删除“${item.type}”这条记录吗？`)) return;
    records = records.filter((record) => record.id !== item.id); saveLocal(); renderStats(); renderRecords(); showToast('记录已删除');
  }
});

async function refreshAuth() {
  if (!supabaseClient) return;
  const { data } = await supabaseClient.auth.getUser();
  cloudUser = data.user || null;
  authButton.textContent = cloudUser ? '已登录 · 云端同步' : '本机记录 · 登录同步';
  authButton.classList.toggle('logged', Boolean(cloudUser));
  syncStatus.textContent = cloudUser ? `云端同步 · ${cloudUser.email || '已登录'}` : '本机保存';
}

authButton.addEventListener('click', async () => {
  if (!supabaseClient) return showToast('云端服务未配置，当前可正常本机使用');
  if (cloudUser) return showToast(`已登录：${cloudUser.email || 'Google 账号'}`);
  const { error } = await supabaseClient.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: window.location.href } });
  if (error) showToast('登录未完成，请检查 Supabase 配置');
});

document.querySelector('#todayLabel').textContent = moneyDate(today());
resetForm();
renderStats();
renderRecords();
refreshAuth();
