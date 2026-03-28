const express = require('express');
const router = express.Router();
const UserEvent = require('../models/UserEvent');
const analyticsMiddleware = require('../middleware/analytics');

router.post('/track', analyticsMiddleware, async (req, res) => {
    try {
        // 1. Безопасно достаем данные, даже если req.body пустой
        const data = req.body || {};

        const {
            sessionId,
            eventType = 'page_view',
            eventData = {},
            userId,
            timeOnPage = 0,
            scrollDepth = 0
        } = data;

        // 2. Проверяем наличие sessionId, так как он важен для аналитики
        if (!sessionId) {
            // Если сессии нет, не роняем сервер, а просто выходим
            return res.status(400).json({ error: 'Missing sessionId' });
        }

        const event = new UserEvent({
            userId: userId || (req.user ? req.user.id : null),
            sessionId,
            eventType,
            eventData: { ...eventData, timeOnPage, scrollDepth },
            // Берем данные из middleware, если они там есть (используем опциональную цепочку ?.)
            sourceData: req.analytics?.sourceData || {},
            deviceData: req.analytics?.deviceData || {}
        });

        await event.save();

        // 3. Отправляем успешный ответ и выходим из функции
        return res.status(201).json({ status: 'success' });

    } catch (err) {
        // Выводим ошибку в консоль WebStorm для отладки
        console.error('!!! ОШИБКА СОХРАНЕНИЯ В БАЗУ:', err.message);

        // 4. Проверяем, не был ли ответ уже отправлен (защита от ERR_HTTP_HEADERS_SENT)
        if (!res.headersSent) {
            return res.status(500).json({
                error: 'Tracking failed',
                details: err.message
            });
        }
    }
});

module.exports = router;