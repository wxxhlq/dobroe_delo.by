const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const UserEvent = require('../models/UserEvent');
const { getDB } = require('../db'); // Подключаем твой Native Driver

// 3.1. Admin Auth: Middleware для защиты роутов админки
const adminAuthMiddleware = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) return res.status(401).json({ message: 'Доступ запрещен: нет токена' });

    jwt.verify(token, process.env.JWT_SECRET, (err, payload) => {
        if (err) return res.status(403).json({ message: 'Неверный токен' });

        // ДОБАВЬ ЭТУ СТРОКУ:
        console.log('👤 Попытка входа в админку. Роль в токене:', payload.role);

        if (payload.role !== 'ADMIN') {
            return res.status(403).json({ message: 'Доступ разрешен только администраторам' });
        }
        req.user = payload;
        next();
    });
};



// Главный эндпоинт для сбора всех данных дашборда
router.get('/dashboard-data', adminAuthMiddleware, async (req, res) => {
    try {
        const db = getDB();
        const usersCollection = db.collection('users');
        const appsCollection = db.collection('project_applications');

        // ==========================================
        // 3.2. LIVE KPI WIDGETS
        // ==========================================

        // Общее кол-во волонтеров
        const totalVolunteers = await usersCollection.countDocuments({ role: 'VOLUNTEER' });

        // Конверсия (все просмотры страниц / реальные регистрации в БД)
        const totalPageViews = await UserEvent.countDocuments({ eventType: 'page_view' });
        const conversionRate = totalPageViews > 0
            ? ((totalVolunteers / totalPageViews) * 100).toFixed(1)
            : 0;

        // LTV: Среднее количество выполненных задач (активных откликов) на одного волонтера
        const totalActiveApps = await appsCollection.countDocuments({ status: { $ne: 'CANCELLED' } });
        const ltv = totalVolunteers > 0 ? (totalActiveApps / totalVolunteers).toFixed(2) : 0;


        // ==========================================
        // 3.3. ADVANCED FUNNEL VISUALIZATION
        // ==========================================
        const uniqueVisitors = await UserEvent.distinct('sessionId', { eventType: 'page_view' }).then(s => s.length);
        const uniqueAppliedUsers = await appsCollection.distinct('userId').then(s => s.length);

        const funnel = {
            visitors: uniqueVisitors,                  // 1. Гости (уникальные сессии)
            registrations: totalVolunteers,            // 2. Регистрации
            applications: uniqueAppliedUsers,          // 3. Уникальные откликнувшиеся
            tasks: totalActiveApps                     // 4. Всего задач в работе
        };


        // ==========================================
        // 3.4. TRAFFIC SOURCES REPORT
        // ==========================================

        // Агрегация просмотров по UTM-меткам
        const trafficAgg = await UserEvent.aggregate([
            { $match: { eventType: 'page_view' } },
            { $group: {
                    _id: { $ifNull: ["$sourceData.utm_source", "Direct (Прямой заход)"] },
                    views: { $sum: 1 }
                }},
            { $sort: { views: -1 } }
        ]);

        // Расчет конверсии для каждого канала
        const trafficSources = await Promise.all(trafficAgg.map(async (src) => {
            const query = src._id === "Direct (Прямой заход)"
                ? { eventType: 'registration', $or: [ { "sourceData.utm_source": { $exists: false } }, { "sourceData.utm_source": null } ] }
                : { eventType: 'registration', "sourceData.utm_source": src._id };

            const regs = await UserEvent.countDocuments(query);

            return {
                source: src._id,
                views: src.views,
                registrations: regs,
                conversion: src.views > 0 ? ((regs / src.views) * 100).toFixed(1) : 0
            };
        }));

        // Отправка готового пакета данных на клиент
        res.json({
            kpi: { totalVolunteers, conversionRate, ltv },
            funnel,
            trafficSources
        });

    } catch (err) {
        console.error('Ошибка сборки дашборда:', err);
        res.status(500).json({ error: 'Ошибка при формировании отчета' });
    }
});

module.exports = router;