const express = require('express');
const router = express.Router();
const { getDB } = require('../db');
const { ObjectId } = require('mongodb');
const { authMiddleware, requireModerator } = require('../middleware/auth');

// Все роуты модератора защищены авторизацией + проверкой роли
router.use(authMiddleware, requireModerator);

// ===================== ВЕРИФИКАЦИЯ ОРГАНИЗАТОРОВ =====================

/**
 * @route GET /api/moderator/verification-requests
 * @desc  Список заявок на верификацию организаторов (status: PENDING)
 */
router.get('/verification-requests', async (req, res) => {
    try {
        const db = getDB();
        const requests = await db.collection('users').find({
            role: 'ORGANIZER',
            verificationStatus: 'PENDING'
        }, {
            projection: { password_hash: 0 }
        }).sort({ created_at: -1 }).toArray();

        res.json({
            success: true,
            requests: requests.map(u => ({
                _id: u._id,
                name: u.name,
                email: u.email,
                phone: u.phone || '',
                city: u.city || '',
                organizationName: u.organizationName || '',
                organizationType: u.organizationType || '',
                verificationDocuments: u.verificationDocuments || '',
                created_at: u.created_at || u.createdAt
            }))
        });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

/**
 * @route GET /api/moderator/verified-organizers
 * @desc  Список верифицированных организаторов (verificationStatus: VERIFIED)
 */
router.get('/verified-organizers', async (req, res) => {
    try {
        const db = getDB();
        const organizers = await db.collection('users').aggregate([
            {
                $match: {
                    role: 'ORGANIZER',
                    verificationStatus: 'VERIFIED'
                }
            },
            {
                $lookup: {
                    from: 'users',
                    localField: 'verifiedBy',
                    foreignField: '_id',
                    as: 'verifier'
                }
            },
            {
                $unwind: {
                    path: '$verifier',
                    preserveNullAndEmptyArrays: true
                }
            },
            {
                $sort: { verifiedAt: -1, created_at: -1 }
            },
            {
                $project: {
                    name: 1,
                    email: 1,
                    phone: 1,
                    city: 1,
                    organizationName: 1,
                    organizationType: 1,
                    verificationDocuments: 1,
                    verifiedAt: 1,
                    verifierName: '$verifier.name',
                    verifierEmail: '$verifier.email'
                }
            }
        ]).toArray();

        res.json({ success: true, organizers });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

/**
 * @route POST /api/moderator/verify/:userId
 * @desc  Одобрить или отклонить заявку организатора
 * @body  { action: 'approve' | 'reject', reason: '...' }
 */
router.post('/verify/:userId', async (req, res) => {
    try {
        const db = getDB();
        const { action, reason } = req.body;
        const userId = new ObjectId(req.params.userId);

        const user = await db.collection('users').findOne({ _id: userId });
        if (!user) return res.status(404).json({ success: false, error: 'Пользователь не найден' });
        if (user.role !== 'ORGANIZER') return res.status(400).json({ success: false, error: 'Пользователь не является организатором' });
        if (user.verificationStatus !== 'PENDING') return res.status(400).json({ success: false, error: 'Заявка уже обработана' });

        if (action === 'approve') {
            await db.collection('users').updateOne({ _id: userId }, {
                $set: {
                    verificationStatus: 'VERIFIED',
                    verifiedAt: new Date(),
                    verifiedBy: new ObjectId(req.user.userId)
                }
            });

            // Логируем событие
            await db.collection('userevents').insertOne({
                userId: new ObjectId(req.user.userId),
                eventType: 'organizer_verified',
                eventData: { targetUserId: userId, userName: user.name },
                createdAt: new Date()
            });

            res.json({ success: true, message: 'Организатор верифицирован' });
        } else if (action === 'reject') {
            await db.collection('users').updateOne({ _id: userId }, {
                $set: {
                    verificationStatus: 'REJECTED',
                    rejectionReason: reason || 'Без указания причины'
                }
            });

            await db.collection('userevents').insertOne({
                userId: new ObjectId(req.user.userId),
                eventType: 'organizer_rejected',
                eventData: { targetUserId: userId, userName: user.name, reason: reason || '' },
                createdAt: new Date()
            });

            res.json({ success: true, message: 'Заявка организатора отклонена' });
        } else {
            res.status(400).json({ success: false, error: 'Действие должно быть approve или reject' });
        }
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// ===================== МОДЕРАЦИЯ ЗАДАЧ =====================

/**
 * @route GET /api/moderator/pending-tasks
 * @desc  Список задач на модерации (status: PENDING)
 */
router.get('/pending-tasks', async (req, res) => {
    try {
        const db = getDB();
        const tasks = await db.collection('projects').aggregate([
            { $match: { status: 'PENDING' } },
            { $lookup: { from: 'users', localField: 'ownerUserId', foreignField: '_id', as: 'owner' } },
            { $unwind: { path: '$owner', preserveNullAndEmptyArrays: true } },
            { $sort: { createdAt: -1 } },
            { $project: {
                title: 1, description: 1, city: 1, region: 1, address: 1,
                categoryId: 1, format: 1, capacity: 1, imageUrl: 1,
                status: 1, createdAt: 1,
                ownerName: '$owner.name',
                ownerEmail: '$owner.email',
                ownerOrganization: '$owner.organizationName'
            }}
        ]).toArray();

        res.json({ success: true, tasks });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

/**
 * @route GET /api/moderator/moderated-tasks
 * @desc  Список модерированных задач (status: PUBLISHED или REJECTED)
 */
router.get('/moderated-tasks', async (req, res) => {
    try {
        const db = getDB();
        const tasks = await db.collection('projects').aggregate([
            { $match: { status: { $in: ['PUBLISHED', 'REJECTED'] } } },
            { $lookup: { from: 'users', localField: 'ownerUserId', foreignField: '_id', as: 'owner' } },
            { $unwind: { path: '$owner', preserveNullAndEmptyArrays: true } },
            { $sort: { moderatedAt: -1, createdAt: -1 } },
            { $project: {
                title: 1, description: 1, city: 1, region: 1, address: 1,
                categoryId: 1, format: 1, capacity: 1, imageUrl: 1,
                status: 1, createdAt: 1, moderatedAt: 1, rejectionReason: 1,
                ownerName: '$owner.name',
                ownerEmail: '$owner.email',
                ownerOrganization: '$owner.organizationName'
            }}
        ]).toArray();

        res.json({ success: true, tasks });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

/**
 * @route POST /api/moderator/task/:id/approve
 * @desc  Одобрить задачу (PENDING → PUBLISHED)
 */
router.post('/task/:id/approve', async (req, res) => {
    try {
        const db = getDB();
        const projectId = new ObjectId(req.params.id);

        const project = await db.collection('projects').findOne({ _id: projectId });
        if (!project) return res.status(404).json({ success: false, error: 'Проект не найден' });
        if (project.status !== 'PENDING') return res.status(400).json({ success: false, error: 'Проект не на модерации' });

        await db.collection('projects').updateOne({ _id: projectId }, {
            $set: { status: 'PUBLISHED', moderatedBy: new ObjectId(req.user.userId), moderatedAt: new Date() }
        });

        await db.collection('userevents').insertOne({
            userId: new ObjectId(req.user.userId),
            eventType: 'task_moderation_approved',
            eventData: { projectId, projectTitle: project.title },
            createdAt: new Date()
        });

        res.json({ success: true, message: 'Проект одобрен и опубликован' });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

/**
 * @route POST /api/moderator/task/:id/reject
 * @desc  Отклонить задачу (PENDING → REJECTED)
 * @body  { reason: '...' }
 */
router.post('/task/:id/reject', async (req, res) => {
    try {
        const db = getDB();
        const projectId = new ObjectId(req.params.id);
        const { reason } = req.body;

        const project = await db.collection('projects').findOne({ _id: projectId });
        if (!project) return res.status(404).json({ success: false, error: 'Проект не найден' });
        if (project.status !== 'PENDING') return res.status(400).json({ success: false, error: 'Проект не на модерации' });

        await db.collection('projects').updateOne({ _id: projectId }, {
            $set: {
                status: 'REJECTED',
                rejectionReason: reason || 'Без указания причины',
                moderatedBy: new ObjectId(req.user.userId),
                moderatedAt: new Date()
            }
        });

        await db.collection('userevents').insertOne({
            userId: new ObjectId(req.user.userId),
            eventType: 'task_moderation_rejected',
            eventData: { projectId, projectTitle: project.title, reason: reason || '' },
            createdAt: new Date()
        });

        res.json({ success: true, message: 'Проект отклонён' });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// ===================== БЛОКИРОВКА ПОЛЬЗОВАТЕЛЕЙ =====================

/**
 * @route POST /api/moderator/block/:userId
 * @desc  Заблокировать нарушителя
 * @body  { reason: '...' }
 */
router.post('/block/:userId', async (req, res) => {
    try {
        const db = getDB();
        const { reason } = req.body;
        const userId = new ObjectId(req.params.userId);

        const user = await db.collection('users').findOne({ _id: userId });
        if (!user) return res.status(404).json({ success: false, error: 'Пользователь не найден' });
        if (req.user.userId === req.params.userId) return res.status(400).json({ success: false, error: 'Нельзя заблокировать самого себя' });
        if (user.role === 'ADMIN') return res.status(403).json({ success: false, error: 'Нельзя заблокировать администратора' });
        if (user.isBlocked) return res.status(400).json({ success: false, error: 'Пользователь уже заблокирован' });

        await db.collection('users').updateOne({ _id: userId }, {
            $set: {
                isBlocked: true,
                blockedAt: new Date(),
                blockedBy: new ObjectId(req.user.userId),
                blockedReason: reason || 'Нарушение правил платформы'
            }
        });

        await db.collection('userevents').insertOne({
            userId: new ObjectId(req.user.userId),
            eventType: 'user_blocked',
            eventData: { targetUserId: userId, userName: user.name, reason: reason || '' },
            createdAt: new Date()
        });

        res.json({ success: true, message: `Пользователь ${user.name || user.email} заблокирован` });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

/**
 * @route POST /api/moderator/unblock/:userId
 * @desc  Разблокировать пользователя
 */
router.post('/unblock/:userId', async (req, res) => {
    try {
        const db = getDB();
        const userId = new ObjectId(req.params.userId);

        const user = await db.collection('users').findOne({ _id: userId });
        if (!user) return res.status(404).json({ success: false, error: 'Пользователь не найден' });
        if (!user.isBlocked) return res.status(400).json({ success: false, error: 'Пользователь не заблокирован' });

        await db.collection('users').updateOne({ _id: userId }, {
            $set: { isBlocked: false },
            $unset: { blockedAt: '', blockedBy: '', blockedReason: '' }
        });

        await db.collection('userevents').insertOne({
            userId: new ObjectId(req.user.userId),
            eventType: 'user_unblocked',
            eventData: { targetUserId: userId, userName: user.name },
            createdAt: new Date()
        });

        res.json({ success: true, message: `Пользователь ${user.name || user.email} разблокирован` });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

/**
 * @route GET /api/moderator/blocked-users
 * @desc  Список заблокированных пользователей
 */
router.get('/blocked-users', async (req, res) => {
    try {
        const db = getDB();
        const users = await db.collection('users').find(
            { isBlocked: true },
            { projection: { password_hash: 0 } }
        ).sort({ blockedAt: -1 }).toArray();

        res.json({
            success: true,
            users: users.map(u => ({
                _id: u._id,
                name: u.name,
                email: u.email,
                role: u.role,
                blockedAt: u.blockedAt,
                blockedReason: u.blockedReason || ''
            }))
        });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// ===================== СТАТИСТИКА МОДЕРАЦИИ =====================

/**
 * @route GET /api/moderator/stats
 * @desc  Статистика модерации
 */
router.get('/stats', async (req, res) => {
    try {
        const db = getDB();
        const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

        const [pendingVerifications, pendingTasks, blockedUsers, actionsThisWeek] = await Promise.all([
            db.collection('users').countDocuments({ role: 'ORGANIZER', verificationStatus: 'PENDING' }),
            db.collection('projects').countDocuments({ status: 'PENDING' }),
            db.collection('users').countDocuments({ isBlocked: true }),
            db.collection('userevents').countDocuments({
                eventType: { $in: ['organizer_verified', 'organizer_rejected', 'task_moderation_approved', 'task_moderation_rejected', 'user_blocked', 'user_unblocked'] },
                createdAt: { $gte: weekAgo }
            })
        ]);

        const verifiedTotal = await db.collection('users').countDocuments({ role: 'ORGANIZER', verificationStatus: 'VERIFIED' });
        const rejectedTotal = await db.collection('users').countDocuments({ role: 'ORGANIZER', verificationStatus: 'REJECTED' });
        const approvedTasks = await db.collection('projects').countDocuments({ moderatedAt: { $exists: true }, status: 'PUBLISHED' });
        const rejectedTasks = await db.collection('projects').countDocuments({ status: 'REJECTED' });

        res.json({
            success: true,
            pendingVerifications,
            pendingTasks,
            blockedUsers,
            actionsThisWeek,
            organizers: { verified: verifiedTotal, rejected: rejectedTotal },
            tasks: { approved: approvedTasks, rejected: rejectedTasks }
        });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

module.exports = router;
