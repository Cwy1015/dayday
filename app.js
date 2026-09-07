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
  const currentTasks = document.querySelectorAll('.task input');
  const total = currentTasks.length;
  const completed = [...currentTasks].filter((task) => task.checked).length;
  document.querySelector('#planProgress').textContent = `${completed} / ${total}`;
  document.querySelector('#progressBar').style.width = `${(completed / total) * 100}%`;
  document.querySelector('#heroPercent').textContent = `${Math.round((completed / total) * 100)}%`;
  currentTasks.forEach((input) => {
    const row = input.closest('.task');
    const time = row.querySelector('time');
    row.classList.toggle('done', input.checked);
    time.textContent = input.checked ? '已完成' : '待完成';
  });
  localStorage.setItem('exam-plan', JSON.stringify([...currentTasks].map((task) => task.checked)));
}

const savedPlan = JSON.parse(localStorage.getItem('exam-plan') || 'null');
if (savedPlan) tasks.forEach((task, index) => { task.checked = Boolean(savedPlan[index]); });
tasks.forEach((task) => task.addEventListener('change', () => { updatePlan(); showToast('计划进度已更新'); }));
updatePlan();

function switchView(item) {
  const view = item.dataset.view;
  navItems.forEach((nav) => nav.classList.toggle('active', nav === item));
  views.forEach((panel) => panel.classList.toggle('visible', panel.id === `${view}View`));
}
navItems.forEach((item) => item.addEventListener('click', () => switchView(item)));
document.addEventListener('click', (event) => {
  const item = event.target.closest?.('.nav-item');
  if (item) switchView(item);
});

document.querySelectorAll('[data-action="view-mistakes"]').forEach((button) => button.addEventListener('click', () => document.querySelector('[data-view="mistakes"]').click()));
document.querySelectorAll('[data-action="start-focus"]').forEach((button) => button.addEventListener('click', () => document.querySelector('[data-view="practice"]').click()));
document.querySelectorAll('[data-action="start-timer"]').forEach((button) => button.addEventListener('click', () => showToast('训练已开始，专注 25 分钟')));
document.querySelector('[data-action="add-task"]').addEventListener('click', () => {
  const title = window.prompt('输入计划名称，例如：资料分析 · 速算训练');
  if (!title?.trim()) return;
  const row = document.createElement('label');
  row.className = 'task';
  row.innerHTML = `<input type="checkbox" /><span class="check"></span><span class="task-copy"><b contenteditable="true">${title.trim()}</b><small contenteditable="true">自定义计划 · 点击圆圈完成</small></span><button type="button" class="task-edit" aria-label="删除计划">×</button><time>待完成</time>`;
  document.querySelector('#taskList').appendChild(row);
  row.querySelector('input').addEventListener('change', () => { updatePlan(); showToast('计划进度已更新'); });
  row.querySelector('.task-edit').addEventListener('click', () => { row.remove(); updatePlan(); showToast('计划已删除'); });
  showToast('已添加到今日计划');
});
document.querySelectorAll('.review-btn').forEach((button) => button.addEventListener('click', () => { button.textContent = '已加入'; button.style.color = '#6c9a7b'; showToast('已加入今日复盘'); }));
document.querySelectorAll('[data-period]').forEach((button) => button.addEventListener('click', () => { document.querySelectorAll('[data-period]').forEach((item) => item.classList.remove('selected')); button.classList.add('selected'); showToast(button.dataset.period === 'week' ? '已切换到近 7 天' : '已切换到近 30 天'); }));

const bookForm = document.querySelector('#bookForm');
const bookRecords = document.querySelector('#bookRecords');
const emptyBooks = document.querySelector('#emptyBooks');
const recordCount = document.querySelector('#recordCount');
let bookEntries = JSON.parse(localStorage.getItem('question-book-records') || '[]');

function renderBookEntries() {
  bookRecords.innerHTML = '';
  recordCount.textContent = `${bookEntries.length} 条`;
  emptyBooks.style.display = bookEntries.length ? 'none' : 'block';
  bookEntries.slice().reverse().forEach((entry) => {
    const item = document.createElement('article');
    item.className = 'book-entry';
    item.innerHTML = `<div class="book-entry-top"><div><span class="book-name"></span><span class="chapter-name"></span></div><div class="entry-actions"><button class="entry-edit" data-id="${entry.id}">编辑</button><button class="entry-delete" data-id="${entry.id}">删除</button></div></div><div class="entry-metrics"><b>${entry.total - entry.wrong}<small> 正确</small></b><b class="wrong-num">${entry.wrong}<small> 错题</small></b><span>${entry.date || '未填写日期'}</span></div>${entry.errorContent ? '<p class="error-content"><i>错因记录</i><span></span></p>' : ''}<div class="entry-tags"><span>${entry.reason}</span><span>${entry.book}</span></div>`;
    item.querySelector('.book-name').textContent = entry.book;
    item.querySelector('.chapter-name').textContent = `${entry.chapter} · ${entry.module}`;
    if (entry.errorContent) item.querySelector('.error-content span').textContent = entry.errorContent;
    bookRecords.appendChild(item);
  });
  bookRecords.querySelectorAll('.entry-edit').forEach((button) => button.addEventListener('click', () => editBookEntry(button.dataset.id)));
  bookRecords.querySelectorAll('.entry-delete').forEach((button) => button.addEventListener('click', () => {
    if (!window.confirm('确定删除这条题本记录吗？')) return;
    bookEntries = bookEntries.filter((item) => String(item.id) !== String(button.dataset.id));
    localStorage.setItem('question-book-records', JSON.stringify(bookEntries));
    renderBookEntries();
    showToast('题本记录已删除');
  }));
}

function editBookEntry(id) {
  const entry = bookEntries.find((item) => String(item.id) === String(id));
  if (!entry) return;
  Object.entries(entry).forEach(([key, value]) => { if (bookForm.elements[key]) bookForm.elements[key].value = value; });
  document.querySelector('#bookFormCard').scrollIntoView({ behavior: 'smooth', block: 'start' });
  showToast('已载入记录，可以修改');
}

bookForm.addEventListener('submit', (event) => {
  event.preventDefault();
  const data = Object.fromEntries(new FormData(bookForm));
  const total = Math.max(1, Number(data.total));
  const entry = { ...data, id: data.id || crypto.randomUUID(), total, wrong: Math.min(total, Math.max(0, Number(data.wrong))) };
  bookEntries = bookEntries.filter((item) => String(item.id) !== String(entry.id));
  bookEntries.push(entry);
  localStorage.setItem('question-book-records', JSON.stringify(bookEntries));
  currentUser().then((user) => user && cloudRequest('question_book_records', { method: 'POST', body: JSON.stringify({ user_id: user.id, book: entry.book, chapter: entry.chapter, module: entry.module, total: entry.total, wrong: entry.wrong, error_content: entry.errorContent, reason: entry.reason, record_date: entry.date || null }) })).catch(() => {});
  bookForm.reset();
  renderBookEntries();
  showToast('题本记录已保存');
});

document.querySelector('[data-action="open-book-form"]').addEventListener('click', () => {
  document.querySelector('[data-view="books"]').click();
  document.querySelector('#bookFormCard').scrollIntoView({ behavior: 'smooth', block: 'start' });
});

document.querySelectorAll('.task').forEach((row) => {
  const copy = row.querySelector('span:nth-of-type(2)');
  const title = row.querySelector('b');
  const detail = row.querySelector('small');
  if (title) title.contentEditable = 'true';
  if (detail) detail.contentEditable = 'true';
  const remove = document.createElement('button');
  remove.type = 'button';
  remove.className = 'task-edit';
  remove.textContent = '×';
  remove.title = '删除计划';
  row.insertBefore(remove, row.querySelector('time'));
  remove.addEventListener('click', (event) => { event.preventDefault(); row.remove(); updatePlan(); showToast('计划已删除'); });
  [title, detail].forEach((field) => field?.addEventListener('blur', () => { localStorage.setItem('exam-plan-labels', JSON.stringify([...document.querySelectorAll('.task')].map((item) => [item.querySelector('b')?.textContent, item.querySelector('small')?.textContent]))); showToast('计划内容已保存'); }));
});

renderBookEntries();

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

const profileDefaults = JSON.parse(localStorage.getItem('exam-profile') || 'null') || { name: '林同学', exam: '国考', days: 72 };
function renderProfile() {
  document.querySelector('#profileName').textContent = profileDefaults.name;
  document.querySelector('#profileGoal').textContent = `${profileDefaults.exam} · 还有 ${profileDefaults.days} 天`;
  document.querySelector('#profileAvatar').textContent = profileDefaults.name.slice(0, 1);
}
document.querySelectorAll('[data-action="edit-profile"]').forEach((button) => button.addEventListener('click', () => {
  const name = window.prompt('修改昵称', profileDefaults.name);
  if (!name?.trim()) return;
  const exam = window.prompt('修改考试目标', profileDefaults.exam) || profileDefaults.exam;
  const days = Number(window.prompt('修改剩余天数', profileDefaults.days));
  profileDefaults.name = name.trim();
  profileDefaults.exam = exam.trim();
  profileDefaults.days = Number.isFinite(days) && days >= 0 ? days : profileDefaults.days;
  localStorage.setItem('exam-profile', JSON.stringify(profileDefaults));
  renderProfile();
  showToast('个人目标已保存');
}));
renderProfile();

const dailyForm = document.querySelector('#dailyForm');
const dailyRecords = document.querySelector('#dailyRecords');
const dailySummary = document.querySelector('#dailySummary');
const emptyDaily = document.querySelector('#emptyDaily');
const dailyCount = document.querySelector('#dailyCount');
let dailyEntries = JSON.parse(localStorage.getItem('daily-practice-records') || '[]');

function renderDailyEntries() {
  dailyRecords.innerHTML = '';
  dailyCount.textContent = `${dailyEntries.length} 条`;
  emptyDaily.style.display = dailyEntries.length ? 'none' : 'block';
  const total = dailyEntries.reduce((sum, item) => sum + Number(item.total), 0);
  const correct = dailyEntries.reduce((sum, item) => sum + Number(item.correct), 0);
  const minutes = dailyEntries.reduce((sum, item) => sum + Number(item.minutes), 0);
  dailySummary.innerHTML = `<span><b>${total}</b>累计题数</span><span><b>${total ? ((correct / total) * 100).toFixed(1) : '0.0'}%</b>平均正确率</span><span><b>${minutes}</b>累计分钟</span>`;
  if (dailyEntries.length) {
    document.querySelector('#questionStat').innerHTML = `${total}<small> 题</small>`;
    document.querySelector('#accuracyStat').innerHTML = `${((correct / total) * 100).toFixed(1)}<small>%</small>`;
  }
  dailyEntries.slice().sort((a, b) => `${b.date}${b.id}`.localeCompare(`${a.date}${a.id}`)).forEach((entry) => {
    const item = document.createElement('article');
    item.className = 'daily-entry';
    item.innerHTML = `<div class="daily-entry-date"><b>${entry.date}</b><span>${entry.type}</span></div><div class="daily-entry-stats"><b>${entry.total}<small>题</small></b><b class="daily-correct">${entry.correct}<small>对</small></b><b class="daily-wrong">${entry.wrong}<small>错</small></b><span>${entry.minutes} 分钟</span></div>${entry.note ? '<p class="daily-note"></p>' : ''}<div class="entry-actions"><button class="entry-edit" data-daily-edit="${entry.id}">编辑</button><button class="entry-delete" data-daily-delete="${entry.id}">删除</button></div>`;
    if (entry.note) item.querySelector('.daily-note').textContent = entry.note;
    dailyRecords.appendChild(item);
  });
  dailyRecords.querySelectorAll('[data-daily-edit]').forEach((button) => button.addEventListener('click', () => {
    const entry = dailyEntries.find((item) => String(item.id) === String(button.dataset.dailyEdit));
    if (!entry) return;
    Object.entries(entry).forEach(([key, value]) => { if (dailyForm.elements[key]) dailyForm.elements[key].value = value; });
    document.querySelector('[data-view="daily"]').click();
    dailyForm.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }));
  dailyRecords.querySelectorAll('[data-daily-delete]').forEach((button) => button.addEventListener('click', () => {
    if (!window.confirm('确定删除这条每日刷题记录吗？')) return;
    dailyEntries = dailyEntries.filter((item) => String(item.id) !== String(button.dataset.dailyDelete));
    localStorage.setItem('daily-practice-records', JSON.stringify(dailyEntries));
    renderDailyEntries();
    showToast('每日记录已删除');
  }));
}

function updateDailyWrong() {
  const total = Number(dailyForm.elements.total.value) || 0;
  const correct = Math.min(total, Number(dailyForm.elements.correct.value) || 0);
  dailyForm.elements.wrong.value = Math.max(0, total - correct);
}
['total', 'correct'].forEach((name) => dailyForm.elements[name].addEventListener('input', updateDailyWrong));
dailyForm.elements.date.value = new Date().toISOString().slice(0, 10);
dailyForm.addEventListener('submit', (event) => {
  event.preventDefault();
  const data = Object.fromEntries(new FormData(dailyForm));
  const total = Math.max(1, Number(data.total));
  const correct = Math.min(total, Math.max(0, Number(data.correct)));
  const entry = { ...data, id: data.id || crypto.randomUUID(), total, correct, wrong: total - correct, minutes: Math.max(0, Number(data.minutes)) };
  dailyEntries = dailyEntries.filter((item) => String(item.id) !== String(entry.id));
  dailyEntries.push(entry);
  localStorage.setItem('daily-practice-records', JSON.stringify(dailyEntries));
  currentUser().then((user) => user && cloudRequest('training_sessions', { method: 'POST', body: JSON.stringify({ user_id: user.id, module: entry.type, total: entry.total, correct: entry.correct, minutes: entry.minutes, reason: '每日记录', session_date: entry.date, note: entry.note }) })).catch(() => {});
  dailyForm.reset();
  dailyForm.elements.date.value = new Date().toISOString().slice(0, 10);
  renderDailyEntries();
  showToast('每日刷题记录已保存');
});
renderDailyEntries();

document.querySelectorAll('.mistake-item').forEach((item) => {
  const fields = [item.querySelector('.mistake-type'), item.querySelector('.mistake-copy b'), item.querySelector('.mistake-copy span')];
  fields.forEach((field) => { if (field) { field.contentEditable = 'true'; field.title = '点击修改'; field.addEventListener('blur', saveMistakes); } });
  const remove = document.createElement('button');
  remove.type = 'button'; remove.className = 'mistake-delete'; remove.textContent = '删除';
  item.appendChild(remove);
  remove.addEventListener('click', () => { item.remove(); showToast('错题已从队列移除'); });
});

function saveMistakes() {
  const values = [...document.querySelectorAll('.mistake-item')].map((row) => ({
    type: row.querySelector('.mistake-type')?.textContent,
    title: row.querySelector('.mistake-copy b')?.textContent,
    note: row.querySelector('.mistake-copy span')?.textContent
  }));
  localStorage.setItem('mistake-notes', JSON.stringify(values));
  showToast('错题内容已保存');
}
