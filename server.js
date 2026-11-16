const express = require('express');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const HH_API = 'https://api.hh.ru';
const USER_AGENT = process.env.HH_USER_AGENT || 'HH-TZ-Finder/1.0 (vacancy research app)';

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

const clean = (value = '') => String(value).replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, ' ').trim();

function scoreDescription(html = '') {
  const text = clean(html);
  const lower = text.toLowerCase();
  let score = 0;
  const reasons = [];
  if (text.length > 1800) { score += 25; reasons.push('Объёмное описание'); }
  else if (text.length > 900) { score += 15; reasons.push('Достаточно подробное описание'); }
  if (/(обязанност|задач|чем предстоит заниматься|вам предстоит|responsibilit)/i.test(lower)) { score += 15; reasons.push('Есть описание задач'); }
  if (/(требован|необходимые навыки|мы ожидаем|requirements)/i.test(lower)) { score += 15; reasons.push('Есть требования'); }
  if (/(будет плюсом|желательно|дополнительно|условия|мы предлагаем)/i.test(lower)) { score += 10; reasons.push('Есть дополнительные разделы'); }
  const bullets = (html.match(/<li\b/gi) || []).length;
  if (bullets >= 8) { score += 20; reasons.push('Много структурированных пунктов'); }
  else if (bullets >= 3) { score += 10; reasons.push('Есть структурированный список'); }
  if (/(postgres|postgresql|mysql|redis|docker|kubernetes|typescript|react|node\.js|php|api| микросервис|ci\/cd)/i.test(lower)) { score += 15; reasons.push('Указан технический стек'); }
  return { score: Math.min(100, score), reasons, length: text.length, bullets };
}

async function hhGet(endpoint) {
  const response = await fetch(HH_API + endpoint, {
    headers: { 'User-Agent': USER_AGENT, 'Accept': 'application/json' }
  });
  if (!response.ok) {
    const error = new Error('HeadHunter API вернул ошибку ' + response.status);
    error.status = response.status;
    throw error;
  }
  return response.json();
}

app.get('/health', (_req, res) => res.json({ ok: true }));

// Bitrix24 integration via VibeCode Gateway (session is injected on embedded requests).
app.use('/api/bitrix', require('./src/bitrix24'));

app.use((error, _req, res, _next) => {
  console.error('API error:', error);
  res.status(error.status || 500).json({
    error: error.message || 'Внутренняя ошибка сервера',
    code: error.code || 'INTERNAL_ERROR'
  });
});

app.get('/api/search', async (req, res) => {
  try {
    const query = String(req.query.text || 'PHP OR Node.js OR React').slice(0, 200);
    const page = Math.max(0, Math.min(19, Number.parseInt(req.query.page, 10) || 0));
    const perPage = Math.max(5, Math.min(30, Number.parseInt(req.query.per_page, 10) || 20));
    const params = new URLSearchParams({
      text: query,
      page: String(page),
      per_page: String(perPage),
      order_by: 'publication_time',
      period: '30',
      describe_arguments: 'true'
    });
    if (req.query.area) params.set('area', String(req.query.area));
    if (req.query.experience) params.set('experience', String(req.query.experience));
    if (req.query.employment) params.set('employment', String(req.query.employment));
    if (req.query.schedule) params.set('schedule', String(req.query.schedule));
    if (req.query.salary) {
      const salary = Number(req.query.salary);
      if (Number.isFinite(salary) && salary > 0) {
        params.set('salary', String(salary));
        params.set('only_with_salary', 'true');
      }
    }

    const listing = await hhGet('/vacancies?' + params.toString());
    const vacancies = await Promise.all(listing.items.map(async item => {
      try {
        const detail = await hhGet('/vacancies/' + encodeURIComponent(item.id));
        const analysis = scoreDescription(detail.description || '');
        return {
          id: detail.id,
          name: detail.name,
          url: detail.alternate_url,
          company: detail.employer?.name || 'Компания не указана',
          companyUrl: detail.employer?.alternate_url || null,
          salary: detail.salary ? {
            from: detail.salary.from,
            to: detail.salary.to,
            currency: detail.salary.currency,
            gross: detail.salary.gross
          } : null,
          experience: detail.experience?.name || 'Не указан',
          employment: detail.employment?.name || 'Не указан',
          schedule: detail.schedule?.name || 'Не указан',
          area: detail.area?.name || '',
          publishedAt: detail.published_at,
          description: detail.description || '',
          snippet: clean(detail.description || '').slice(0, 520),
          analysis
        };
      } catch (error) {
        return {
          id: item.id, name: item.name, url: item.alternate_url,
          company: item.employer?.name || 'Компания не указана',
          salary: item.salary || null,
          experience: item.experience?.name || 'Не указан',
          employment: item.employment?.name || 'Не указан',
          schedule: item.schedule?.name || 'Не указан',
          area: item.area?.name || '',
          publishedAt: item.published_at,
          description: '', snippet: '',
          analysis: { score: 0, reasons: ['Не удалось получить полное описание'], length: 0, bullets: 0 }
        };
      }
    }));

    const minScore = Math.max(0, Math.min(100, Number(req.query.min_score) || 0));
    const filtered = vacancies.filter(v => v.analysis.score >= minScore);
    res.json({
      items: filtered,
      found: listing.found,
      page: listing.page,
      pages: listing.pages,
      perPage: listing.per_page,
      totalOnPage: vacancies.length,
      filteredOnPage: filtered.length
    });
  } catch (error) {
    console.error('Search error:', error);
    res.status(error.status || 502).json({
      error: error.message || 'Не удалось получить вакансии от HeadHunter',
      hint: 'Попробуйте изменить запрос или повторить поиск позже.'
    });
  }
});

app.listen(PORT, () => console.log('HH ТЗ Finder listening on port ' + PORT));
