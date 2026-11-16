const express = require('express');

const router = express.Router();
const API_BASE = process.env.VIBECODE_API_URL || 'https://vibecode.bitrix24.com/v1';

function getSession(req) {
  // Black Hole Gateway forwards the user's session token in this header.
  const sessionToken = req.get('x-vibe-authorization');
  if (!sessionToken || !/^vibe_session_[A-Za-z0-9_-]+$/.test(sessionToken)) {
    const error = new Error('Откройте приложение из интерфейса Битрикс24: сессия сотрудника не найдена или истекла.');
    error.status = 401;
    throw error;
  }
  return sessionToken;
}

async function vibeRequest(req, endpoint, options = {}) {
  const apiKey = process.env.VIBE_APP_KEY;
  if (!apiKey) {
    const error = new Error('Не настроен VIBE_APP_KEY. Добавьте ключ авторизации приложения в секреты сервера.');
    error.status = 503;
    throw error;
  }

  const sessionToken = getSession(req);
  const response = await fetch(API_BASE + endpoint, {
    method: options.method || 'GET',
    headers: {
      'X-Api-Key': apiKey,
      'Authorization': 'Bearer ' + sessionToken,
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
  return payload;
}

router.get('/status', (req, res) => {
  const sessionToken = req.get('x-vibe-authorization') || '';
  res.json({
    configured: Boolean(process.env.VIBE_APP_KEY),
    platform: 'VibeCode',
    sessionPresent: /^vibe_session_[A-Za-z0-9_-]+$/.test(sessionToken)
  });
});

router.get('/me', async (req, res, next) => {
  try {
    const payload = await vibeRequest(req, '/me');
    res.json({
      success: true,
      user: payload.data?.currentUser || null,
      portal: payload.data?.portal || null,
      scopes: payload.data?.scopes || []
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
    for (const field of ['phone', 'email', 'post', 'companyTitle', 'assignedById', 'sourceId', 'stageId']) {
      if (input[field] !== undefined && input[field] !== '') lead[field] = input[field];
    }

    const payload = await vibeRequest(req, '/leads', { method: 'POST', body: lead });
    res.status(201).json({ success: true, lead: payload.data });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
