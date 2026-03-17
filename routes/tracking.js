const express = require('express');
const router = express.Router();
const UserEvent = require('../models/UserEvent');
const analyticsMiddleware = require('../middleware/analytics');

router.post('/track', analyticsMiddleware, async (req, res) => {
    try {
        const { sessionId, eventType, eventData, userId, timeOnPage, scrollDepth } = req.body;

        const event = new UserEvent({
            userId: userId || null,
            sessionId,
            eventType,
            eventData: { ...eventData, timeOnPage, scrollDepth },
            sourceData: req.analytics.sourceData,
            deviceData: req.analytics.deviceData
        });

        await event.save();
        res.status(201).json({ status: 'success' });
    } // Находим конец файла tracking.js
     catch (err) {
    // Эта строка выведет ошибку прямо в WebStorm
    console.error('!!! ОШИБКА СОХРАНЕНИЯ В БАЗУ:', err.message);

    res.status(500).json({ error: 'Tracking failed', details: err.message });
}
});

module.exports = router;