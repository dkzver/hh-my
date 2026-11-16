const express = require('express');

const router = express.Router();
const API_BASE = process.env.VIBECODE_API_URL || 'https://vibecode.bitrix24.com/v1';

function getSession(req) {
  const authorization = req.get('x-vibe-authorization');
  const userId = req.get('x-vibe-user-id');
  if (!authorization || !/^Bearer vibe_session_[A-Za-z0-9_-]+$/.test(authorization)) {
    const error = new Error('Откройте приложение из интерфейса Битрикс24: сессия сотрудника не найдена.');
    error.status = 401;
    throw error;
  }
  if (!userId || !/^\\d+$/.test(userId)) {
    const error = new Error('Не удалось определить сотрудника Битрикс24.');
    error.status = 401;
    throw error;
  }
  return { authorization, userId };
}

async function vibeRequest(req, endpoint, options = {}) {
  const apiKey = process.env.VIBE_APP_KEY;
  if (!apiKey) {
    const error = new Error('Не настроен VIBE_APP_KEY. Добавьте ключ авторизации приложения в переменные окружения сервера.');
    error.status = 503;
    throw error;
  }

  const session = getSession(req);
  const response = await fetch(API_BASE + endpoint, {
    method: options.method || 'GET',
    headers: {
      'X-Api-Key': apiKey,
      'Authorization': session.authorization,
      'Accept': 'application/json',
      ...(options.body ? { 'Content-Type': 'application/json' } : {})
    },
    ...(options.body ? { body: JSON.stringify(options.body) } : {})
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.success === false) {
    const error = new Error(payload.error?.message || payload.message || 'Ошибка API Битрикс24');
    error.status = response.status || 502;
    error.code = payload.error?.code || 'BITRIX_API_ERROR';
    throw error;
  }
  return { payload, session };
}

router.get('/status', (req, res) => {
  res.json({
    configured: Boolean(process.env.VIBE_APP_KEY),
    platform: 'VibeCode',
    user: req.get('x-vibe-user-id') ? {
      id: /^\\d+$/.test(req.get('x-vibe-user-id')) ? req.get('x-vibe-user-id') : null,
      name: decodeURIComponent(req.get('x-vibe-user-name-encoded') || ''),
      role: req.get('x-vibe-user-role') || null
    } : null
  });
});

router.get('/me', async (req, res, next) => {
  try {
    const { payload, session } = await vibeRequest(req, '/me');
    res.json({
      success: true,
      user: payload.data?.currentUser || payload.data?.user || null,
      portal: payload.data?.portal || null,
      bitrixUserId: session.userId
    });
  } catch (error) {
    next(error);
  }
});

router.post('/leads', async (req, res, next) => {
  try {
    const input = req.body || {};
    const title = String(input.title || '').trim();
    const name = String(input.name || '').trim();
    const lastName = String(input.lastName || '').trim();
    if (!title || (!name && !lastName)) {
      return res.status(400).json({ error: 'Укажите название лида и имя или фамилию кандидата.' });
    }

    const lead = {
      title: title.slice(0, 255),
      name: name.slice(0, 100),
      lastName: lastName.slice(0, 100),
      sourceDescription: String(input.sourceDescription || 'HH ТЗ Finder').slice(0, 1000),
      comments: String(input.comments || '').slice(0, 5000),
      opened: true
    };
    for (const field of ['phone', 'email', 'post', 'companyTitle', 'assignedById']) {
      if (input[field] !== undefined && input[field] !== '') lead[field] = input[field];
    }

    const { payload } = await vibeRequest(req, '/leads', { method: 'POST', body: lead });
    res.status(201).json({ success: true, lead: payload.data });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
