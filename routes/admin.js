const express = require('express');
const router = express.Router();
const { getDB } = require('../db');
const UserEvent = require('../models/UserEvent');
const Campaign = require('../models/Campaign');
const CampaignLog = require('../models/CampaignLog');
const Segment = require('../models/Segment');
const Referral = require('../models/Referral');
const ABTest = require('../models/ABTest');
const LandingPage = require('../models/LandingPage');
const ErrorLog = require('../models/ErrorLog');
const adminAuthMiddleware = require('../middleware/adminAuth');
const { ObjectId } = require('mongodb');

// ===================== 1. ДАШБОРД (Пульс системы) =====================

/**
 * @route GET /api/admin/dashboard/kpi
 * @desc  Получение KPI для верхней панели дашборда
 * @access Admin
 */
router.get('/dashboard/kpi', adminAuthMiddleware, async (req, res) => {
    try {
        const db = getDB();
        const now = new Date();
        const dayAgo = new Date(now.getTime() - 24*60*60*1000);
        const weekAgo = new Date(now.getTime() - 7*24*60*60*1000);
        const monthAgo = new Date(now.getTime() - 30*24*60*60*1000);

        const totalVolunteers = await db.collection('users').countDocuments({ role: 'VOLUNTEER' });
        const new24h = await db.collection('users').countDocuments({ role: 'VOLUNTEER', createdAt: { $gte: dayAgo } });
        const new7d = await db.collection('users').countDocuments({ role: 'VOLUNTEER', createdAt: { $gte: weekAgo } });

        const sessions = await UserEvent.distinct('sessionId', { eventType: 'page_view' });
        const registrations = await UserEvent.distinct('userId', { eventType: 'registration', userId: { $ne: null } });
        const conversion = sessions.length ? ((registrations.length / sessions.length) * 100).toFixed(1) : 0;

        const volunteers = await db.collection('users').find({ role: 'VOLUNTEER' }).toArray();
        let totalTasks = 0;
        for (const vol of volunteers) {
            const tasks = await db.collection('project_applications').countDocuments({ userId: vol._id, status: 'APPROVED' });
            totalTasks += tasks;
        }
        const ltv = volunteers.length ? (totalTasks / volunteers.length).toFixed(1) : 0;

        const dau = await UserEvent.distinct('userId', { createdAt: { $gte: dayAgo } }).then(arr => arr.filter(id => id).length);
        const wau = await UserEvent.distinct('userId', { createdAt: { $gte: weekAgo } }).then(arr => arr.filter(id => id).length);
        const mau = await UserEvent.distinct('userId', { createdAt: { $gte: monthAgo } }).then(arr => arr.filter(id => id).length);

        res.json({
            success: true,
            totalVolunteers,
            new24h,
            new7d,
            conversion: parseFloat(conversion),
            ltv: parseFloat(ltv),
            dau, wau, mau
        });
    } catch (err) {
        console.error('KPI error:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

/**
 * @route GET /api/admin/dashboard/registrations-timeline
 * @desc  Линейный график регистраций по дням (период: week / month)
 * @access Admin
 */
router.get('/dashboard/registrations-timeline', adminAuthMiddleware, async (req, res) => {
    try {
        const { period = 'week' } = req.query;
        const now = new Date();
        let startDate;
        if (period === 'week') startDate = new Date(now.getTime() - 7*24*60*60*1000);
        else startDate = new Date(now.getTime() - 30*24*60*60*1000);

        const registrations = await UserEvent.aggregate([
            { $match: { eventType: 'registration', createdAt: { $gte: startDate } } },
            {
                $group: {
                    _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
                    count: { $sum: 1 }
                }
            },
            { $sort: { _id: 1 } }
        ]);
        res.json({ success: true, data: registrations });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

/**
 * @route GET /api/admin/dashboard/live-feed
 * @desc  Лента последних событий (реального времени) с обогащёнными данными
 * @access Admin
 */
router.get('/dashboard/live-feed', adminAuthMiddleware, async (req, res) => {
    try {
        const db = getDB();
        const allowedTypes = [
            'registration', 'project_apply', 'project_apply_cancel',
            'post_created', 'post_deleted', 'comment_created',
            'news_created', 'news_deleted'
        ];
        const events = await db.collection('userevents')
            .find({ eventType: { $in: allowedTypes } })
            .sort({ createdAt: -1 })
            .limit(100)
            .toArray();

        const enrichedEvents = await Promise.all(events.map(async (ev) => {
            let user = null;
            if (ev.userId && ev.userId !== 'guest') {
                try {
                    let userIdObj = typeof ev.userId === 'string' ? new ObjectId(ev.userId) : ev.userId;
                    user = await db.collection('users').findOne(
                        { _id: userIdObj },
                        { projection: { name: 1, email: 1 } }
                    );
                } catch (e) {}
            }
            // Убедитесь, что createdAt остаётся в возвращаемом объекте
            return { ...ev, user: user ? { _id: user._id, name: user.name, email: user.email } : null };
        }));

        res.json({ success: true, events: enrichedEvents });
    } catch (err) {
        console.error('❌ Live feed error:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

// ===================== 2. АНАЛИТИКА КАНАЛОВ =====================

/**
 * @route GET /api/admin/analytics/sources
 * @desc  Таблица источников трафика с визитами, регистрациями, конверсией
 * @access Admin
 */
router.get('/analytics/sources', adminAuthMiddleware, async (req, res) => {
    try {
        const sources = await UserEvent.aggregate([
            { $match: { eventType: 'page_view' } },
            {
                $group: {
                    _id: {
                        $ifNull: ['$sourceData.utm_source', { $ifNull: ['$sourceData.referrer', 'direct'] }]
                    },
                    visits: { $sum: 1 },
                    sessions: { $addToSet: '$sessionId' }
                }
            },
            { $project: { _id: 1, visits: 1, sessionsCount: { $size: '$sessions' } } },
            { $sort: { visits: -1 } }
        ]);

        const sourceDetails = await Promise.all(sources.map(async (src) => {
            const registrations = await UserEvent.distinct('sessionId', {
                eventType: 'registration',
                $or: [
                    { 'sourceData.utm_source': src._id },
                    { 'sourceData.referrer': src._id }
                ]
            }).then(arr => arr.length);

            const conversion = src.sessionsCount ? ((registrations / src.sessionsCount) * 100).toFixed(1) : 0;

            const campaigns = await UserEvent.aggregate([
                { $match: { 'sourceData.utm_source': src._id, eventType: 'page_view' } },
                { $group: { _id: '$sourceData.utm_campaign', visits: { $sum: 1 }, sessions: { $addToSet: '$sessionId' } } },
                { $project: { campaign: '$_id', visits: 1, sessionsCount: { $size: '$sessions' } } }
            ]);

            const campaignDetails = await Promise.all(campaigns.map(async (camp) => {
                const regs = await UserEvent.distinct('sessionId', {
                    eventType: 'registration',
                    'sourceData.utm_campaign': camp.campaign,
                    'sourceData.utm_source': src._id
                }).then(arr => arr.length);
                return {
                    name: camp.campaign || 'Без кампании',
                    visits: camp.visits,
                    registrations: regs,
                    conversion: camp.sessionsCount ? ((regs / camp.sessionsCount) * 100).toFixed(1) : 0
                };
            }));

            return {
                source: src._id,
                visits: src.visits,
                uniqueSessions: src.sessionsCount,
                registrations,
                conversion: parseFloat(conversion),
                cac: null,
                campaigns: campaignDetails
            };
        }));

        const pieData = sourceDetails.map(s => ({ name: s.source, value: s.uniqueSessions }));
        res.json({ success: true, sources: sourceDetails, pieData });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

/**
 * @route GET /api/admin/analytics/funnel
 * @desc  Воронка конверсии (5 этапов)
 * @access Admin
 */
router.get('/analytics/funnel', adminAuthMiddleware, async (req, res) => {
    try {
        const db = getDB();

        const visitors = await UserEvent.distinct('sessionId', { eventType: 'page_view' }).then(arr => arr.length);
        const registrationStarts = await UserEvent.countDocuments({
            eventType: 'button_click',
            'eventData.buttonName': { $in: ['Регистрация', 'Зарегистрироваться', 'register'] }
        });
        const registrations = await UserEvent.countDocuments({ eventType: 'registration' });
        const applications = await db.collection('project_applications').countDocuments({ status: { $ne: 'CANCELLED' } });
        const completed = await db.collection('project_applications').countDocuments({ status: 'APPROVED' });

        const funnel = [
            { name: 'Посетили сайт', count: visitors },
            { name: 'Начали регистрацию', count: registrationStarts },
            { name: 'Завершили регистрацию', count: registrations },
            { name: 'Откликнулись на проект', count: applications },
            { name: 'Выполнили задачу', count: completed }
        ];

        res.json({ success: true, funnel });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// ===================== 3. СЕГМЕНТАЦИЯ =====================

/**
 * @route GET /api/admin/segments
 * @desc  Получить список всех сегментов с количеством пользователей
 * @access Admin
 */
router.get('/segments', adminAuthMiddleware, async (req, res) => {
    try {
        const segments = await Segment.find().lean();
        const enriched = await Promise.all(segments.map(async (seg) => {
            const count = await getSegmentUserCount(seg.criteria);
            return { ...seg, count };
        }));
        res.json({ success: true, segments: enriched });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

/**
 * @route POST /api/admin/segments
 * @desc  Создать новый сегмент
 * @access Admin
 */
router.post('/segments', adminAuthMiddleware, async (req, res) => {
    try {
        const { name, criteria, isDynamic } = req.body;
        if (!name) return res.status(400).json({ success: false, error: 'Имя сегмента обязательно' });
        const segment = new Segment({ name, criteria, isDynamic });
        await segment.save();
        res.json({ success: true, segment });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

/**
 * @route PUT /api/admin/segments/:id
 * @desc  Обновить сегмент
 * @access Admin
 */
router.put('/segments/:id', adminAuthMiddleware, async (req, res) => {
    try {
        const { name, criteria, isDynamic } = req.body;
        const segment = await Segment.findByIdAndUpdate(req.params.id, { name, criteria, isDynamic }, { new: true });
        if (!segment) return res.status(404).json({ success: false, error: 'Сегмент не найден' });
        res.json({ success: true, segment });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

/**
 * @route DELETE /api/admin/segments/:id
 * @desc  Удалить сегмент
 * @access Admin
 */
router.delete('/segments/:id', adminAuthMiddleware, async (req, res) => {
    try {
        await Segment.findByIdAndDelete(req.params.id);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

/**
 * @route POST /api/admin/segments/count
 * @desc  Подсчитать количество пользователей, подходящих под переданные критерии (без сохранения сегмента)
 * @access Admin
 */
router.post('/segments/count', adminAuthMiddleware, async (req, res) => {
    try {
        const { criteria } = req.body;
        const count = await getSegmentUserCount(criteria);
        res.json({ success: true, count });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// Вспомогательная функция для подсчёта пользователей по критериям
async function getSegmentUserCount(criteria) {
    const db = getDB();
    const query = {};

    if (criteria.city) query.city = criteria.city;
    if (criteria.role) query.role = criteria.role;
    if (criteria.status) query.status = criteria.status;

    if (criteria.minEvents !== undefined) {
        const usersWithEvents = await UserEvent.aggregate([
            { $group: { _id: '$userId', count: { $sum: 1 } } },
            { $match: { count: { $gte: criteria.minEvents } } },
            { $group: { _id: null, userIds: { $push: '$_id' } } }
        ]);
        const userIds = usersWithEvents[0]?.userIds || [];
        if (userIds.length) query._id = { $in: userIds };
        else return 0;
    }

    if (criteria.interests && criteria.interests.length) {
        query.interests = { $in: criteria.interests };
    }

    if (criteria.isActive !== undefined) {
        const monthAgo = new Date(Date.now() - 30*24*60*60*1000);
        const activeUsers = await UserEvent.distinct('userId', { createdAt: { $gte: monthAgo } });
        if (criteria.isActive) query._id = { $in: activeUsers };
        else query._id = { $nin: activeUsers };
    }

    if (criteria.source) {
        const usersFromSource = await UserEvent.distinct('userId', {
            eventType: 'page_view',
            $or: [
                { 'sourceData.utm_source': criteria.source },
                { 'sourceData.referrer': criteria.source }
            ]
        });
        query._id = { $in: usersFromSource };
    }

    const count = await db.collection('users').countDocuments(query);
    return count;
}

// ===================== 4. КОММУНИКАЦИИ И ТРИГГЕРЫ =====================

/**
 * @route GET /api/admin/communications/campaigns
 * @desc  Список кампаний (рассылок) со статистикой
 * @access Admin
 */
router.get('/communications/campaigns', adminAuthMiddleware, async (req, res) => {
    try {
        const campaigns = await Campaign.find().sort({ createdAt: -1 }).lean();
        const enriched = await Promise.all(campaigns.map(async (camp) => {
            const logs = await CampaignLog.find({ campaignId: camp._id });
            const sent = logs.filter(l => l.status === 'sent').length;
            const delivered = logs.filter(l => l.status === 'delivered').length;
            const opened = logs.filter(l => l.status === 'opened').length;
            const clicked = logs.filter(l => l.status === 'clicked').length;
            return {
                ...camp,
                stats: {
                    sent,
                    delivered,
                    opened,
                    clicked,
                    openRate: sent ? ((opened / sent) * 100).toFixed(1) : 0,
                    clickRate: opened ? ((clicked / opened) * 100).toFixed(1) : 0
                }
            };
        }));
        res.json({ success: true, campaigns: enriched });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

/**
 * @route POST /api/admin/communications/campaigns
 * @desc  Создать рассылку (email/push)
 * @access Admin
 */
router.post('/communications/campaigns', adminAuthMiddleware, async (req, res) => {
    try {
        const { name, type, targetSegmentId, content, schedule } = req.body;
        if (!name || !type || !targetSegmentId || !content) {
            return res.status(400).json({ success: false, error: 'Не все обязательные поля заполнены' });
        }

        const campaign = new Campaign({
            name,
            type,
            targetSegmentId,
            content,
            schedule: schedule ? { startDate: new Date(schedule.startDate), endDate: schedule.endDate ? new Date(schedule.endDate) : null } : null,
            status: schedule?.startDate ? 'scheduled' : 'draft'
        });
        await campaign.save();
        res.json({ success: true, campaign });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

/**
 * @route POST /api/admin/communications/campaigns/:id/send
 * @desc  Отправить рассылку сейчас (запустить немедленно)
 * @access Admin
 */
router.post('/communications/campaigns/:id/send', adminAuthMiddleware, async (req, res) => {
    try {
        const campaign = await Campaign.findById(req.params.id).populate('targetSegmentId');
        if (!campaign) return res.status(404).json({ success: false, error: 'Кампания не найдена' });
        if (campaign.status !== 'draft' && campaign.status !== 'scheduled') {
            return res.status(400).json({ success: false, error: 'Кампания уже активна или завершена' });
        }

        let userIds = [];
        if (campaign.targetSegmentId && campaign.targetSegmentId.users && campaign.targetSegmentId.users.length) {
            userIds = campaign.targetSegmentId.users;
        } else {
            const users = await getSegmentUsers(campaign.targetSegmentId.criteria);
            userIds = users.map(u => u._id);
        }

        if (!userIds.length) {
            return res.status(400).json({ success: false, error: 'Сегмент пуст, некому отправлять' });
        }

        for (const userId of userIds) {
            const log = new CampaignLog({
                campaignId: campaign._id,
                userId,
                status: 'sent'
            });
            await log.save();
            console.log(`[CAMPAIGN] Отправлено ${campaign.type} пользователю ${userId}`);
        }

        campaign.status = 'active';
        campaign.sentAt = new Date();
        await campaign.save();

        res.json({ success: true, message: 'Рассылка запущена' });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

/**
 * @route POST /api/admin/communications/campaigns/:id/schedule
 * @desc  Запланировать рассылку на определённое время (background job)
 * @access Admin
 */
router.post('/communications/campaigns/:id/schedule', adminAuthMiddleware, async (req, res) => {
    try {
        const { scheduledAt } = req.body;
        if (!scheduledAt) return res.status(400).json({ success: false, error: 'Не указано время' });
        const campaign = await Campaign.findById(req.params.id);
        if (!campaign) return res.status(404).json({ success: false, error: 'Кампания не найдена' });
        campaign.schedule = { ...campaign.schedule, startDate: new Date(scheduledAt) };
        campaign.status = 'scheduled';
        await campaign.save();
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

/**
 * @route GET /api/admin/communications/triggers
 * @desc  Получить список автоматических цепочек (триггеров)
 * @access Admin
 */
router.get('/communications/triggers', adminAuthMiddleware, async (req, res) => {
    const triggers = [
        { id: 'welcome', name: 'Welcome-цепочка', enabled: true, steps: [{ delay: 0, type: 'email', subject: 'Добро пожаловать!' }, { delay: 24, type: 'email', subject: 'Как начать помогать?' }, { delay: 72, type: 'push', text: 'Уже нашли проект?' }] },
        { id: 'inactive', name: 'Возвращение неактивных', enabled: false, steps: [{ delay: 30, type: 'email', subject: 'Давно не заходили?' }] },
        { id: 'abandoned_registration', name: 'Брошенная регистрация', enabled: true, steps: [{ delay: 1, type: 'email', subject: 'Завершите регистрацию!' }] },
        { id: 'first_task', name: 'Спасибо за первое задание', enabled: true, steps: [{ delay: 0, type: 'email', subject: 'Спасибо!' }] }
    ];
    res.json({ success: true, triggers });
});

/**
 * @route PUT /api/admin/communications/triggers/:id
 * @desc  Обновить состояние триггера (вкл/выкл)
 * @access Admin
 */
router.put('/communications/triggers/:id', adminAuthMiddleware, async (req, res) => {
    const { enabled } = req.body;
    res.json({ success: true });
});

/**
 * @route GET /api/admin/communications/referrals
 * @desc  Топ рефералов (кто пригласил больше всего друзей)
 * @access Admin
 */
router.get('/communications/referrals', adminAuthMiddleware, async (req, res) => {
    try {
        const topReferrers = await Referral.aggregate([
            { $match: { status: { $in: ['registered', 'completed_first_task'] } } },
            { $group: { _id: '$referrerUserId', invitedCount: { $sum: 1 } } },
            { $sort: { invitedCount: -1 } },
            { $limit: 10 },
            { $lookup: { from: 'users', localField: '_id', foreignField: '_id', as: 'user' } },
            { $unwind: '$user' }
        ]);
        const result = topReferrers.map(r => ({ name: r.user.name, invitedCount: r.invitedCount }));
        res.json({ success: true, topReferrers: result });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// ===================== 5. ЛЕНДИНГИ =====================

/**
 * @route GET /api/admin/landings
 * @desc  Получить список лендингов
 * @access Admin
 */
router.get('/landings', adminAuthMiddleware, async (req, res) => {
    try {
        const landings = await LandingPage.find().sort({ createdAt: -1 }).lean();
        res.json({ success: true, landings });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

/**
 * @route POST /api/admin/landings
 * @desc  Создать новый лендинг
 * @access Admin
 */
router.post('/landings', adminAuthMiddleware, async (req, res) => {
    try {
        const { name, slug, template, content, meta, pixels } = req.body;
        if (!name || !slug) return res.status(400).json({ success: false, error: 'Имя и slug обязательны' });
        const landing = new LandingPage({ name, slug, template, content, meta, pixels });
        await landing.save();
        res.json({ success: true, landing });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

/**
 * @route PUT /api/admin/landings/:id
 * @desc  Обновить лендинг
 * @access Admin
 */
router.put('/landings/:id', adminAuthMiddleware, async (req, res) => {
    try {
        const landing = await LandingPage.findByIdAndUpdate(req.params.id, req.body, { new: true });
        if (!landing) return res.status(404).json({ success: false, error: 'Лендинг не найден' });
        res.json({ success: true, landing });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

/**
 * @route DELETE /api/admin/landings/:id
 * @desc  Удалить лендинг
 * @access Admin
 */
router.delete('/landings/:id', adminAuthMiddleware, async (req, res) => {
    try {
        await LandingPage.findByIdAndDelete(req.params.id);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// ===================== 6. А/Б ТЕСТЫ =====================

/**
 * @route GET /api/admin/abtests
 * @desc  Получить список А/Б тестов
 * @access Admin
 */
router.get('/abtests', adminAuthMiddleware, async (req, res) => {
    try {
        const tests = await ABTest.find().populate('pageA_id pageB_id').lean();
        res.json({ success: true, tests });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

/**
 * @route POST /api/admin/abtests
 * @desc  Создать А/Б тест
 * @access Admin
 */
router.post('/abtests', adminAuthMiddleware, async (req, res) => {
    try {
        const { name, pageA_id, pageB_id, trafficSplitA, trafficSplitB, startDate, endDate } = req.body;
        if (!name || !pageA_id || !pageB_id) return res.status(400).json({ success: false, error: 'Не все обязательные поля заполнены' });
        const test = new ABTest({
            name,
            pageA_id,
            pageB_id,
            trafficSplitA: trafficSplitA || 50,
            trafficSplitB: trafficSplitB || 50,
            startDate: startDate ? new Date(startDate) : new Date(),
            endDate: endDate ? new Date(endDate) : null,
            status: 'active'
        });
        await test.save();
        res.json({ success: true, test });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

/**
 * @route GET /api/admin/abtests/:id/stats
 * @desc  Получить статистику А/Б теста
 * @access Admin
 */
router.get('/abtests/:id/stats', adminAuthMiddleware, async (req, res) => {
    try {
        const test = await ABTest.findById(req.params.id);
        if (!test) return res.status(404).json({ success: false, error: 'Тест не найден' });

        const viewsA = await UserEvent.countDocuments({ eventType: 'landing_view', 'eventData.variant': 'A', 'eventData.testId': test._id.toString() });
        const viewsB = await UserEvent.countDocuments({ eventType: 'landing_view', 'eventData.variant': 'B', 'eventData.testId': test._id.toString() });
        const regA = await UserEvent.countDocuments({ eventType: 'registration', 'eventData.variant': 'A', 'eventData.testId': test._id.toString() });
        const regB = await UserEvent.countDocuments({ eventType: 'registration', 'eventData.variant': 'B', 'eventData.testId': test._id.toString() });

        const convA = viewsA ? ((regA / viewsA) * 100).toFixed(2) : 0;
        const convB = viewsB ? ((regB / viewsB) * 100).toFixed(2) : 0;
        const winner = convA > convB ? 'A' : convB > convA ? 'B' : 'draw';

        res.json({
            success: true,
            stats: {
                variantA: { views: viewsA, registrations: regA, conversion: convA },
                variantB: { views: viewsB, registrations: regB, conversion: convB },
                winner
            }
        });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

/**
 * @route POST /api/admin/abtests/:id/stop
 * @desc  Остановить тест, выбрать победителя
 * @access Admin
 */
router.post('/abtests/:id/stop', adminAuthMiddleware, async (req, res) => {
    try {
        const test = await ABTest.findById(req.params.id);
        if (!test) return res.status(404).json({ success: false, error: 'Тест не найден' });
        if (test.status !== 'active') return res.status(400).json({ success: false, error: 'Тест уже завершён' });

        const stats = await getTestStats(test._id);
        let winnerId = null;
        if (stats.variantA.conversion > stats.variantB.conversion) winnerId = test.pageA_id;
        else if (stats.variantB.conversion > stats.variantA.conversion) winnerId = test.pageB_id;

        test.status = 'completed';
        test.winnerId = winnerId;
        await test.save();

        res.json({ success: true, winner: winnerId });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// ===================== 7. МОНИТОРИНГ =====================

/**
 * @route GET /api/admin/monitoring/errors
 * @desc  Лог ошибок
 * @access Admin
 */
router.get('/monitoring/errors', adminAuthMiddleware, async (req, res) => {
    try {
        const errors = await ErrorLog.find().sort({ createdAt: -1 }).limit(100).lean();
        res.json({ success: true, errors });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// ===================== 8. ДОПОЛНИТЕЛЬНЫЕ МЕТРИКИ =====================

/**
 * @route GET /api/admin/metrics/extra
 * @desc  Дополнительные метрики (проекты, категории и т.д.)
 * @access Admin
 */
router.get('/metrics/extra', adminAuthMiddleware, async (req, res) => {
    try {
        const db = getDB();
        const totalProjects = await db.collection('projects').countDocuments();
        const activeProjects = await db.collection('projects').countDocuments({ status: 'PUBLISHED' });
        const pendingProjects = await db.collection('projects').countDocuments({ status: 'PENDING' });
        const closedProjects = await db.collection('projects').countDocuments({ status: 'CLOSED' });

        const categories = await db.collection('projects').aggregate([
            { $group: { _id: '$categoryId', count: { $sum: 1 } } }
        ]).toArray();

        res.json({
            success: true,
            projects: { total: totalProjects, active: activeProjects, pending: pendingProjects, closed: closedProjects },
            categories
        });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// ===================== 9. ЭКСПОРТ ОТЧЁТОВ =====================

/**
 * @route GET /api/admin/export/events
 * @desc  Экспорт событий в CSV (по фильтрам)
 * @access Admin
 */
router.get('/export/events', adminAuthMiddleware, async (req, res) => {
    try {
        const { startDate, endDate, eventType } = req.query;
        const query = {};
        if (startDate) query.createdAt = { $gte: new Date(startDate) };
        if (endDate) query.createdAt = { ...query.createdAt, $lte: new Date(endDate) };
        if (eventType) query.eventType = eventType;

        const events = await UserEvent.find(query)
            .populate('userId', 'name email')
            .sort({ createdAt: -1 })
            .lean();

        const fields = ['_id', 'userId', 'sessionId', 'eventType', 'eventData', 'sourceData', 'deviceData', 'createdAt'];
        const replacer = (key, value) => (value === null ? '' : value);
        const csv = events.map(row => fields.map(f => JSON.stringify(row[f], replacer)).join(',')).join('\n');
        const header = fields.join(',');
        const csvContent = header + '\n' + csv;

        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', 'attachment; filename=events_export.csv');
        res.send(csvContent);
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

/**
 * @route GET /api/admin/export/segments/:id
 * @desc  Экспорт пользователей сегмента в CSV
 * @access Admin
 */
router.get('/export/segments/:id', adminAuthMiddleware, async (req, res) => {
    try {
        const segment = await Segment.findById(req.params.id);
        if (!segment) return res.status(404).json({ success: false, error: 'Сегмент не найден' });
        const userIds = segment.users || [];
        const users = await getDB().collection('users').find({ _id: { $in: userIds } }).toArray();
        const fields = ['_id', 'name', 'email', 'city', 'role', 'points', 'createdAt'];
        const csv = users.map(u => fields.map(f => JSON.stringify(u[f])).join(',')).join('\n');
        const header = fields.join(',');
        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', `attachment; filename=segment_${segment.name}.csv`);
        res.send(header + '\n' + csv);
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// ===================== ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ =====================

async function getSegmentUsers(criteria) {
    const db = getDB();
    const query = {};
    if (criteria.city) query.city = criteria.city;
    if (criteria.role) query.role = criteria.role;
    if (criteria.status) query.status = criteria.status;
    if (criteria.minEvents !== undefined) {
        const usersWithEvents = await UserEvent.aggregate([
            { $group: { _id: '$userId', count: { $sum: 1 } } },
            { $match: { count: { $gte: criteria.minEvents } } },
            { $group: { _id: null, userIds: { $push: '$_id' } } }
        ]);
        const userIds = usersWithEvents[0]?.userIds || [];
        if (userIds.length) query._id = { $in: userIds };
        else return [];
    }
    if (criteria.interests && criteria.interests.length) {
        query.interests = { $in: criteria.interests };
    }
    if (criteria.isActive !== undefined) {
        const monthAgo = new Date(Date.now() - 30*24*60*60*1000);
        const activeUsers = await UserEvent.distinct('userId', { createdAt: { $gte: monthAgo } });
        if (criteria.isActive) query._id = { $in: activeUsers };
        else query._id = { $nin: activeUsers };
    }
    if (criteria.source) {
        const usersFromSource = await UserEvent.distinct('userId', {
            eventType: 'page_view',
            $or: [
                { 'sourceData.utm_source': criteria.source },
                { 'sourceData.referrer': criteria.source }
            ]
        });
        query._id = { $in: usersFromSource };
    }
    return await db.collection('users').find(query).toArray();
}

async function getTestStats(testId) {
    const viewsA = await UserEvent.countDocuments({ eventType: 'landing_view', 'eventData.variant': 'A', 'eventData.testId': testId.toString() });
    const viewsB = await UserEvent.countDocuments({ eventType: 'landing_view', 'eventData.variant': 'B', 'eventData.testId': testId.toString() });
    const regA = await UserEvent.countDocuments({ eventType: 'registration', 'eventData.variant': 'A', 'eventData.testId': testId.toString() });
    const regB = await UserEvent.countDocuments({ eventType: 'registration', 'eventData.variant': 'B', 'eventData.testId': testId.toString() });
    return {
        variantA: { views: viewsA, registrations: regA, conversion: viewsA ? (regA / viewsA * 100) : 0 },
        variantB: { views: viewsB, registrations: regB, conversion: viewsB ? (regB / viewsB * 100) : 0 }
    };
}

// ===================== МЕТРИКИ ПОЛЬЗОВАТЕЛЕЙ =====================
router.get('/metrics/users', adminAuthMiddleware, async (req, res) => {
    try {
        const db = getDB();
        const now = new Date();
        const dayAgo = new Date(now.getTime() - 24*60*60*1000);
        const weekAgo = new Date(now.getTime() - 7*24*60*60*1000);
        const monthAgo = new Date(now.getTime() - 30*24*60*60*1000);

        const totalVolunteers = await db.collection('users').countDocuments({ role: 'VOLUNTEER' });
        const activeDay = await UserEvent.distinct('userId', { createdAt: { $gte: dayAgo } }).then(arr => arr.filter(id => id).length);
        const activeWeek = await UserEvent.distinct('userId', { createdAt: { $gte: weekAgo } }).then(arr => arr.filter(id => id).length);
        const activeMonth = await UserEvent.distinct('userId', { createdAt: { $gte: monthAgo } }).then(arr => arr.filter(id => id).length);
        const newDay = await db.collection('users').countDocuments({ role: 'VOLUNTEER', createdAt: { $gte: dayAgo } });
        const newWeek = await db.collection('users').countDocuments({ role: 'VOLUNTEER', createdAt: { $gte: weekAgo } });
        const newMonth = await db.collection('users').countDocuments({ role: 'VOLUNTEER', createdAt: { $gte: monthAgo } });

        const monthAgoDate = new Date(Date.now() - 30*24*60*60*1000);
        const usersMonthAgo = await db.collection('users').find({ role: 'VOLUNTEER', createdAt: { $gte: monthAgoDate, $lt: new Date(monthAgoDate.getTime() + 24*60*60*1000) } }).toArray();
        let retention = 0;
        if (usersMonthAgo.length) {
            const activeAmongThem = await UserEvent.distinct('userId', { userId: { $in: usersMonthAgo.map(u => u._id) }, createdAt: { $gte: new Date(Date.now() - 7*24*60*60*1000) } });
            retention = (activeAmongThem.length / usersMonthAgo.length) * 100;
        }

        const volunteers = await db.collection('users').find({ role: 'VOLUNTEER' }).toArray();
        let totalTasks = 0;
        for (const vol of volunteers) {
            const tasks = await db.collection('project_applications').countDocuments({ userId: vol._id, status: 'APPROVED' });
            totalTasks += tasks;
        }
        const avgTasks = volunteers.length ? (totalTasks / volunteers.length).toFixed(1) : 0;

        const geography = await db.collection('users').aggregate([
            { $match: { role: 'VOLUNTEER', city: { $exists: true, $ne: null } } },
            { $group: { _id: '$city', count: { $sum: 1 } } },
            { $sort: { count: -1 } },
            { $limit: 20 }
        ]).toArray();

        const totalOrganizations = await db.collection('users').countDocuments({ role: 'ORGANIZER' });
        const newOrganizations = await db.collection('users').countDocuments({ role: 'ORGANIZER', createdAt: { $gte: weekAgo } });
        const projectsByOrgs = await db.collection('projects').aggregate([
            { $group: { _id: '$ownerUserId', count: { $sum: 1 } } },
            { $lookup: { from: 'users', localField: '_id', foreignField: '_id', as: 'org' } },
            { $unwind: { path: '$org', preserveNullAndEmptyArrays: true } },
            { $project: { name: '$org.name', projectsCount: '$count' } },
            { $sort: { projectsCount: -1 } },
            { $limit: 10 }
        ]).toArray();

        res.json({
            success: true,
            volunteers: { total: totalVolunteers, activeDay, activeWeek, activeMonth, newDay, newWeek, newMonth, retention: retention.toFixed(1), avgTasks },
            geography,
            organizations: { total: totalOrganizations, new: newOrganizations, topByProjects: projectsByOrgs }
        });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// ===================== МЕТРИКИ ПРОЕКТОВ =====================
router.get('/metrics/projects', adminAuthMiddleware, async (req, res) => {
    try {
        const db = getDB();
        const now = new Date();
        const weekAgo = new Date(now.getTime() - 7*24*60*60*1000);

        const totalProjects = await db.collection('projects').countDocuments();
        const activeProjects = await db.collection('projects').countDocuments({ status: 'PUBLISHED' });
        const pendingProjects = await db.collection('projects').countDocuments({ status: 'PENDING' });
        const closedProjects = await db.collection('projects').countDocuments({ status: 'CLOSED' });
        const closedWeek = await db.collection('projects').countDocuments({ status: 'CLOSED', createdAt: { $gte: weekAgo } });

        const closedWithDates = await db.collection('projects').find({ status: 'CLOSED', createdAt: { $exists: true }, updatedAt: { $exists: true } }).toArray();
        let totalDays = 0;
        closedWithDates.forEach(p => {
            const days = (new Date(p.updatedAt) - new Date(p.createdAt)) / (1000*60*60*24);
            if (days > 0) totalDays += days;
        });
        const avgRecruitmentDays = closedWithDates.length ? (totalDays / closedWithDates.length).toFixed(1) : 0;

        const underfilled = await db.collection('projects').countDocuments({
            status: 'CLOSED',
            $expr: { $lt: ['$responsesCount', '$capacity'] }
        });

        const categories = await db.collection('projects').aggregate([
            { $group: { _id: '$categoryId', count: { $sum: 1 } } },
            { $sort: { count: -1 } }
        ]).toArray();

        res.json({
            success: true,
            total: totalProjects,
            active: activeProjects,
            pending: pendingProjects,
            closed: { total: closedProjects, week: closedWeek },
            avgRecruitmentDays,
            underfilled,
            categories
        });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// ===================== МЕТРИКИ УЧАСТИЯ =====================
router.get('/metrics/participation', adminAuthMiddleware, async (req, res) => {
    try {
        const db = getDB();

        const totalApplications = await db.collection('project_applications').countDocuments();
        const confirmed = await db.collection('project_applications').countDocuments({ status: 'APPROVED' });
        const completed = await db.collection('project_applications').countDocuments({ status: 'COMPLETED' });
        const completionRate = totalApplications ? ((completed / totalApplications) * 100).toFixed(1) : 0;

        const users = await db.collection('users').find({ role: 'VOLUNTEER' }).toArray();
        let totalDaysToFirst = 0;
        let usersWithFirst = 0;
        for (const u of users) {
            const firstApplication = await db.collection('project_applications').findOne({ userId: u._id, status: 'APPROVED' }, { sort: { createdAt: 1 } });
            if (firstApplication) {
                const days = (firstApplication.createdAt - u.createdAt) / (1000*60*60*24);
                totalDaysToFirst += days;
                usersWithFirst++;
            }
        }
        const avgDaysToFirst = usersWithFirst ? (totalDaysToFirst / usersWithFirst).toFixed(1) : 0;

        const repeatCount = await db.collection('project_applications').aggregate([
            { $match: { status: 'APPROVED' } },
            { $group: { _id: '$userId', count: { $sum: 1 } } },
            { $match: { count: { $gt: 1 } } },
            { $count: 'repeatVolunteers' }
        ]).toArray();
        const repeatVolunteers = repeatCount[0]?.repeatVolunteers || 0;

        res.json({
            success: true,
            applications: totalApplications,
            confirmed,
            completed,
            completionRate: parseFloat(completionRate),
            avgDaysToFirst,
            repeatVolunteers
        });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// ===================== МЕТРИКИ КАЧЕСТВА =====================
router.get('/metrics/quality', adminAuthMiddleware, async (req, res) => {
    try {
        const db = getDB();

        const ratings = await db.collection('project_applications').aggregate([
            { $match: { rating: { $exists: true } } },
            { $group: { _id: null, avgRating: { $avg: '$rating' }, count: { $sum: 1 } } }
        ]).toArray();
        const avgProjectRating = ratings[0]?.avgRating || 0;
        const complaints = await UserEvent.countDocuments({ eventType: 'complaint' });

        res.json({
            success: true,
            avgProjectRating: avgProjectRating.toFixed(1),
            avgCoordinatorRating: 0,
            complaints,
            avgReactionTime: null
        });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// ===================== МЕТРИКИ АКТИВНОСТИ =====================
router.get('/metrics/activity', adminAuthMiddleware, async (req, res) => {
    try {
        const db = getDB();
        const now = new Date();
        const dayAgo = new Date(now.getTime() - 24*60*60*1000);
        const weekAgo = new Date(now.getTime() - 7*24*60*60*1000);
        const monthAgo = new Date(now.getTime() - 30*24*60*60*1000);

        const dau = await UserEvent.distinct('userId', { createdAt: { $gte: dayAgo } }).then(arr => arr.filter(id => id).length);
        const wau = await UserEvent.distinct('userId', { createdAt: { $gte: weekAgo } }).then(arr => arr.filter(id => id).length);
        const mau = await UserEvent.distinct('userId', { createdAt: { $gte: monthAgo } }).then(arr => arr.filter(id => id).length);

        const projectPageViews = await UserEvent.countDocuments({ eventType: 'page_view', 'eventData.path': { $regex: /\/projects/ } });

        const views = await UserEvent.distinct('sessionId', { eventType: 'page_view', 'eventData.path': { $regex: /\/projects/ } }).then(arr => arr.length);
        const clicks = await UserEvent.distinct('sessionId', { eventType: 'button_click', 'eventData.buttonName': 'Пойду' }).then(arr => arr.length);
        const participations = await db.collection('project_applications').distinct('userId', { status: 'APPROVED' }).then(arr => arr.length);
        const conversionViewToClick = views ? ((clicks / views) * 100).toFixed(1) : 0;
        const conversionClickToParticipation = clicks ? ((participations / clicks) * 100).toFixed(1) : 0;

        res.json({
            success: true,
            dau, wau, mau,
            projectPageViews,
            conversion: { viewToClick: conversionViewToClick, clickToParticipation: conversionClickToParticipation }
        });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// ===================== МЕТРИКИ КОММУНИКАЦИЙ =====================
router.get('/metrics/communications', adminAuthMiddleware, async (req, res) => {
    try {
        const totalNotifications = await CampaignLog.countDocuments();
        const opened = await CampaignLog.countDocuments({ status: 'opened' });
        const clicked = await CampaignLog.countDocuments({ status: 'clicked' });
        const openRate = totalNotifications ? ((opened / totalNotifications) * 100).toFixed(1) : 0;
        const clickRate = opened ? ((clicked / opened) * 100).toFixed(1) : 0;

        const db = getDB();
        const messages = await db.collection('messages')?.countDocuments() || 0;

        res.json({
            success: true,
            sent: totalNotifications,
            opened,
            clicked,
            openRate: parseFloat(openRate),
            clickRate: parseFloat(clickRate),
            messages
        });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// ===================== ОПЕРАЦИОННЫЕ МЕТРИКИ =====================
router.get('/metrics/operational', adminAuthMiddleware, async (req, res) => {
    try {
        const db = getDB();

        const moderatedProjects = await db.collection('projects').find({ status: { $in: ['PUBLISHED', 'CLOSED'] }, createdAt: { $exists: true }, verifiedAt: { $exists: true } }).toArray();
        let totalModerationHours = 0;
        moderatedProjects.forEach(p => {
            const hours = (new Date(p.verifiedAt) - new Date(p.createdAt)) / (1000*60*60);
            if (hours > 0) totalModerationHours += hours;
        });
        const avgModerationHours = moderatedProjects.length ? (totalModerationHours / moderatedProjects.length).toFixed(1) : 0;

        const banned = await db.collection('users').countDocuments({ status: 'banned' });
        const errorsCount = await ErrorLog.countDocuments({ createdAt: { $gte: new Date(Date.now() - 7*24*60*60*1000) } });

        res.json({
            success: true,
            avgModerationHours: parseFloat(avgModerationHours),
            avgVerificationHours: 0,
            banned,
            errorsLastWeek: errorsCount
        });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// ===================== МЕТРИКИ ЭФФЕКТИВНОСТИ =====================
router.get('/metrics/efficiency', adminAuthMiddleware, async (req, res) => {
    try {
        const db = getDB();

        const successfulProjects = await db.collection('projects').countDocuments({
            status: 'CLOSED',
            $expr: { $gte: ['$responsesCount', '$capacity'] }
        });
        const totalClosed = await db.collection('projects').countDocuments({ status: 'CLOSED' });
        const successRate = totalClosed ? ((successfulProjects / totalClosed) * 100).toFixed(1) : 0;

        const projectsWithVolunteers = await db.collection('projects').find({ capacity: { $exists: true } }).toArray();
        let totalCapacity = 0;
        projectsWithVolunteers.forEach(p => totalCapacity += p.capacity);
        const avgVolunteersPerProject = projectsWithVolunteers.length ? (totalCapacity / projectsWithVolunteers.length).toFixed(1) : 0;

        const hoursSum = await db.collection('project_applications').aggregate([
            { $match: { hours: { $exists: true } } },
            { $group: { _id: null, total: { $sum: '$hours' } } }
        ]).toArray();
        const totalHours = hoursSum[0]?.total || 0;
        const avgHours = totalHours ? (totalHours / await db.collection('project_applications').countDocuments({ hours: { $exists: true } })).toFixed(1) : 0;

        const impact = await db.collection('projects').aggregate([
            { $match: { impact: { $exists: true } } },
            { $group: { _id: null, total: { $sum: '$impact' } } }
        ]).toArray();

        res.json({
            success: true,
            successfulProjects,
            totalClosed,
            successRate: parseFloat(successRate),
            avgVolunteersPerProject: parseFloat(avgVolunteersPerProject),
            totalHours,
            avgHours: parseFloat(avgHours),
            socialImpact: impact[0]?.total || 0
        });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// ===================== ПОЛУЧЕНИЕ ПОЛЬЗОВАТЕЛЯ ПО ID =====================
router.get('/user/:userId', adminAuthMiddleware, async (req, res) => {
    try {
        const db = getDB();
        const user = await db.collection('users').findOne(
            { _id: new ObjectId(req.params.userId) },
            { projection: { password_hash: 0 } }
        );
        if (!user) return res.status(404).json({ success: false, error: 'Пользователь не найден' });
        if (user && user.created_at && !user.createdAt) user.createdAt = user.created_at;
        res.json({ success: true, user });
    } catch (err) {
        console.error('❌ Ошибка получения пользователя:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

module.exports = router;