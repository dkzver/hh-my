const form = document.querySelector('#search-form');
const results = document.querySelector('#results');
const message = document.querySelector('#message');
const count = document.querySelector('#result-count');
const button = document.querySelector('#search-button');
const prev = document.querySelector('#prev');
const next = document.querySelector('#next');
const pageLabel = document.querySelector('#page-label');
let currentPage = 0;
let lastPages = 0;
let lastQuery = {};

function escapeHtml(value = '') {
  return String(value).replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
}
function salaryText(salary) {
  if (!salary) return 'Зарплата не указана';
  const fmt = n => new Intl.NumberFormat('ru-RU').format(n);
  const range = salary.from && salary.to ? fmt(salary.from) + '–' + fmt(salary.to) : salary.from ? 'от ' + fmt(salary.from) : salary.to ? 'до ' + fmt(salary.to) : '';
  return range ? range + ' ' + (salary.currency || '') : 'Зарплата не указана';
}
function dateText(value) {
  if (!value) return '';
  return new Intl.DateTimeFormat('ru-RU', {day:'numeric',month:'long'}).format(new Date(value));
}
function card(v) {
  const a = v.analysis || {score:0,reasons:[]};
  return `<article class="vacancy">
    <div class="vacancy-top"><div><h3><a href="${escapeHtml(v.url)}" target="_blank" rel="noopener">${escapeHtml(v.name)}</a></h3><div class="company">${escapeHtml(v.company)} · ${escapeHtml(v.area || '')}</div></div>
    <div class="score"><strong>${a.score}</strong><small>ИЗ 100</small></div></div>
    <div class="meta"><span>${escapeHtml(v.experience)}</span><span>${escapeHtml(v.employment)}</span><span>${escapeHtml(v.schedule)}</span>${v.publishedAt ? '<span>' + dateText(v.publishedAt) + '</span>' : ''}</div>
    <p class="snippet">${escapeHtml(v.snippet || 'Полное описание временно недоступно.')}${v.analysis?.length > 520 ? '…' : ''}</p>
    <div class="reasons">${(a.reasons || []).map(r => '<span class="reason">✓ ' + escapeHtml(r) + '</span>').join('')}</div>
    <div class="vacancy-bottom"><span class="salary">${escapeHtml(salaryText(v.salary))}</span><a class="details" href="${escapeHtml(v.url)}" target="_blank" rel="noopener">Открыть на HH.ru ↗</a></div>
  </article>`;
}
async function search(page = 0) {
  currentPage = page;
  const params = new URLSearchParams({...lastQuery, page:String(page), per_page:'20'});
  button.disabled = true;
  button.querySelector('span').textContent = 'Ищем…';
  message.hidden = false;
  message.innerHTML = '<div class="loading"><i class="spinner"></i> Загружаем вакансии и анализируем полные описания…</div>';
  results.innerHTML = '';
  try {
    const response = await fetch('/api/search?' + params);
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Ошибка поиска');
    results.innerHTML = data.items.map(card).join('');
    message.hidden = data.items.length > 0;
    if (!data.items.length) message.textContent = 'Вакансии не найдены. Попробуйте изменить запрос или снизить порог подробности ТЗ.';
    count.textContent = 'Найдено: ' + (data.found || 0) + ' · На странице: ' + data.items.length;
    lastPages = data.pages || 0;
    pageLabel.textContent = 'Страница ' + (currentPage + 1) + (lastPages ? ' из ' + lastPages : '');
    prev.disabled = currentPage <= 0;
    next.disabled = currentPage + 1 >= lastPages;
  } catch (error) {
    message.hidden = false;
    message.textContent = error.message + '. Проверьте подключение и повторите попытку.';
    count.textContent = 'Поиск не выполнен';
  } finally {
    button.disabled = false;
    button.querySelector('span').textContent = 'Найти вакансии';
  }
}
form.addEventListener('submit', event => {
  event.preventDefault();
  const data = new FormData(form);
  lastQuery = Object.fromEntries([...data.entries()].filter(([key,value]) => value !== ''));
  currentPage = 0;
  search(0);
});
prev.addEventListener('click', () => search(currentPage - 1));
next.addEventListener('click', () => search(currentPage + 1));
