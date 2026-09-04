const navItems = document.querySelectorAll('.nav-item');
const views = document.querySelectorAll('.view');
const toast = document.querySelector('#toast');
const tasks = document.querySelectorAll('.task input');
const recordModal = document.querySelector('#recordModal');
const supabaseConfig = window.SUPABASE_CONFIG;
const supabaseClient = window.supabase?.createClient(supabaseConfig.url, supabaseConfig.anonKey);
const authButton = document.querySelector('[data-action="auth"]');

async function currentUser() {
  if (!supabaseClient) return null;
  const { data } = await supabaseClient.auth.getUser();
  return data.user;
}

async function cloudRequest(table, options = {}) {
  if (!supabaseClient) return null;
  const { data: { session } } = await supabaseClient.auth.getSession();
  if (!session?.user) return null;
  const response = await fetch(`${supabaseConfig.url}/rest/v1/${table}`, {
    ...options,
    headers: { apikey: supabaseConfig.anonKey, Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json', Prefer: 'return=representation', ...(options.headers || {}) }
  });
  if (!response.ok) throw new Error(`Supabase ${response.status}`);
  return response.status === 204 ? null : response.json();
}

async function syncCloudSessions() {
  try {
    const remoteSessions = await cloudRequest('training_sessions?select=total,correct');
    if (!remoteSessions?.length) return;
    const total = remoteSessions.reduce((sum, item) => sum + item.total, 186);
    const correct = remoteSessions.reduce((sum, item) => sum + item.correct, 0);
    document.querySelector('#questionStat').innerHTML = `${total}<small> 题</small>`;
    document.querySelector('#accuracyStat').innerHTML = `${((78.4 * 186 + correct * 100) / total).toFixed(1)}<small>%</small>`;
  } catch { /* Local mode remains available until the SQL schema is installed. */ }
}

async function refreshAuthButton() {
  const user = await currentUser();
  authButton.textContent = user ? '已同步' : '登录同步';
  authButton.classList.toggle('logged', Boolean(user));
}

authButton.addEventListener('click', async () => {
  const user = await currentUser();
  if (user) { showToast(`已登录：${user.email || 'Google 账号'}`); return; }
  const { error } = await supabaseClient.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: window.location.href } });
  if (error) showToast('登录未完成，请检查 Supabase Google 登录配置');
});

function showToast(message) {
  toast.textContent = message;
  toast.classList.add('show');
  window.clearTimeout(window.toastTimer);
  window.toastTimer = window.setTimeout(() => toast.classList.remove('show'), 1800);
}

function updatePlan() {
  const total = tasks.length;
  const completed = [...tasks].filter((task) => task.checked).length;
  document.querySelector('#planProgress').textContent = `${completed} / ${total}`;
  document.querySelector('#progressBar').style.width = `${(completed / total) * 100}%`;
  document.querySelector('#heroPercent').textContent = `${Math.round((completed / total) * 100)}%`;
  tasks.forEach((input) => {
    const row = input.closest('.task');
    const time = row.querySelector('time');
    row.classList.toggle('done', input.checked);
    time.textContent = input.checked ? '已完成' : '待完成';
  });
  localStorage.setItem('exam-plan', JSON.stringify([...tasks].map((task) => task.checked)));
}

const savedPlan = JSON.parse(localStorage.getItem('exam-plan') || 'null');
if (savedPlan) tasks.forEach((task, index) => { task.checked = Boolean(savedPlan[index]); });
tasks.forEach((task) => task.addEventListener('change', () => { updatePlan(); showToast('计划进度已更新'); }));
updatePlan();

navItems.forEach((item) => item.addEventListener('click', () => {
  const view = item.dataset.view;
  navItems.forEach((nav) => nav.classList.toggle('active', nav === item));
  views.forEach((panel) => panel.classList.toggle('visible', panel.id === `${view}View`));
}));

document.querySelectorAll('[data-action="view-mistakes"]').forEach((button) => button.addEventListener('click', () => document.querySelector('[data-view="mistakes"]').click()));
document.querySelectorAll('[data-action="start-focus"]').forEach((button) => button.addEventListener('click', () => document.querySelector('[data-view="practice"]').click()));
document.querySelectorAll('[data-action="start-timer"]').forEach((button) => button.addEventListener('click', () => showToast('训练已开始，专注 25 分钟')));
document.querySelector('[data-action="add-task"]').addEventListener('click', () => {
  const title = window.prompt('输入计划名称，例如：资料分析 · 速算训练');
  if (!title?.trim()) return;
  const row = document.createElement('label');
  row.className = 'task';
  row.innerHTML = `<input type="checkbox" /><span class="check"></span><span><b>${title.trim()}</b><small>自定义计划 · 点击圆圈完成</small></span><time>待完成</time>`;
  document.querySelector('#taskList').appendChild(row);
  row.querySelector('input').addEventListener('change', () => { updatePlan(); showToast('计划进度已更新'); });
  showToast('已添加到今日计划');
});
document.querySelectorAll('.review-btn').forEach((button) => button.addEventListener('click', () => { button.textContent = '已加入'; button.style.color = '#6c9a7b'; showToast('已加入今日复盘'); }));
document.querySelectorAll('[data-period]').forEach((button) => button.addEventListener('click', () => { document.querySelectorAll('[data-period]').forEach((item) => item.classList.remove('selected')); button.classList.add('selected'); showToast(button.dataset.period === 'week' ? '已切换到近 7 天' : '已切换到近 30 天'); }));

function toggleRecordModal(open) {
  recordModal.classList.toggle('open', open);
  recordModal.setAttribute('aria-hidden', String(!open));
}

document.querySelector('[data-action="open-record"]').addEventListener('click', () => toggleRecordModal(true));
document.querySelector('[data-action="close-record"]').addEventListener('click', () => toggleRecordModal(false));
recordModal.addEventListener('click', (event) => { if (event.target === recordModal) toggleRecordModal(false); });
document.querySelector('#recordForm').addEventListener('submit', (event) => {
  event.preventDefault();
  const data = Object.fromEntries(new FormData(event.currentTarget));
  const total = Math.max(1, Number(data.total));
  const correct = Math.min(total, Math.max(0, Number(data.correct)));
  const sessions = JSON.parse(localStorage.getItem('exam-sessions') || '[]');
  sessions.push({ ...data, total, correct, createdAt: new Date().toISOString() });
  localStorage.setItem('exam-sessions', JSON.stringify(sessions));
  currentUser().then((user) => user && cloudRequest('training_sessions', { method: 'POST', body: JSON.stringify({ user_id: user.id, module: data.module, total, correct, minutes: Number(data.minutes), reason: data.reason }) })).catch(() => {});
  const addedQuestions = sessions.reduce((sum, item) => sum + item.total, 0);
  const addedCorrect = sessions.reduce((sum, item) => sum + item.correct, 0);
  document.querySelector('#questionStat').innerHTML = `${186 + addedQuestions}<small> 题</small>`;
  document.querySelector('#accuracyStat').innerHTML = `${((78.4 * 186 + addedCorrect * 100) / (186 + addedQuestions)).toFixed(1)}<small>%</small>`;
  toggleRecordModal(false);
  event.currentTarget.reset();
  showToast('训练记录已保存');
});

syncCloudSessions();
refreshAuthButton();
