const express = require('express');
const router = express.Router();
const { getDB } = require('../db');

router.post('/', async (req, res) => {
    try {
        const db = getDB();
        const { eventType, eventData, path, sessionId } = req.body;

        const newEvent = {
            eventType: eventType || 'unknown',
            eventData: eventData || {},
            path: path || '',
            sessionId: sessionId || 'guest',
            createdAt: new Date()
        };

        await db.collection('user_events').insertOne(newEvent);
        res.status(200).json({ success: true });
    } catch (error) {
        console.error("Ошибка сохранения метрики:", error);
        res.status(500).json({ success: false });
    }
});

router.post('/events', async (req, res) => {
    try {
        const db = getDB();
        const { eventType, sessionId, sourceData, deviceData } = req.body;
        
        const newEvent = {
            eventType: eventType || 'page_view',
            sessionId: sessionId || 'unknown',
            sourceData: {
                utm_source: sourceData?.utm_source || 'direct',
                utm_medium: sourceData?.utm_medium || 'none'
            },
            deviceData: {
                os: deviceData?.os || 'unknown',
                type: deviceData?.type || 'desktop'
            },
            createdAt: new Date()
        };

        await db.collection('user_events').insertOne(newEvent);
        res.status(201).json({ success: true });
    } catch (error) {
        console.error("Ошибка при сохранении события:", error);
        res.status(500).json({ success: false });
    }
});

module.exports = router;