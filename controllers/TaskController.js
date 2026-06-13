const { getDB } = require('../db');
const { ObjectId } = require('mongodb');
const GamificationService = require('../services/GamificationService');

function mapProjectForClient(doc) {
    if (!doc) return null;
    return {
        id: doc._id.toString(),
        ownerUserId: doc.ownerUserId ? doc.ownerUserId.toString() : undefined,
        title: doc.title,
        descriptionShort: doc.descriptionShort || (doc.description ? (doc.description.length > 160 ? doc.description.slice(0, 160) + '…' : doc.description) : ''),
        descriptionFull: doc.description || '',
        city: doc.city || '',
        region: doc.region || '',
        address: doc.address || '',
        categoryId: doc.categoryId || '',
        format: doc.format || '',
        capacity: doc.capacity || doc.volunteersNeeded || 0,
        approved: doc.responsesCount || 0,
        image: doc.imageUrl || '',
        status: doc.status || 'PUBLISHED',
        priority: doc.priority || 'normal',
        isUrgent: !!doc.isUrgent,
        lat: doc.lat || null,
        lng: doc.lng || null,
        coordinates: doc.coordinates || null,
        publishedAt: doc.publishedAt || null
    };
}

class TaskController {
    async getTasks(req, res) {
        try {
            const db = getDB();
            if (!db) return res.status(503).json({ message: 'База данных недоступна' });

            // Гости и обычные пользователи видят только опубликованные проекты
            const docs = await db.collection('projects')
                .find({ status: 'PUBLISHED' })
                .sort({ createdAt: -1 })
                .toArray();

            res.json({ projects: docs.map(mapProjectForClient) });
        } catch (err) {
            console.error('❌ Ошибка получения проектов:', err);
            res.status(500).json({ message: 'Ошибка сервера' });
        }
    }

    async createTask(req, res) {
        const { title, description, city, region, categoryId, format, capacity, address, priority, lat, lng } = req.body;
        if (!title || !description || !capacity || !categoryId || !region || !format || !address) {
            return res.status(400).json({ message: 'Заполните все обязательные поля' });
        }

        const numericCapacity = Number(capacity);
        if (!Number.isFinite(numericCapacity) || numericCapacity <= 0) {
            return res.status(400).json({ message: 'Количество волонтёров должно быть положительным числом' });
        }

        try {
            const db = getDB();
            const imageUrl = req.file ? `/uploads/projects/${req.file.filename}` : '';

            // Check permissions for high priority/urgent tasks
            let isUrgent = false;
            const userRole = String(req.user.role).toUpperCase();
            
            if (priority === 'high') {
                const currentUser = await db.collection('users').findOne({ _id: new ObjectId(req.user.userId) });
                if (!currentUser) return res.status(404).json({ message: 'Пользователь не найден' });
                
                const isModeratorOrAdmin = userRole === 'MODERATOR' || userRole === 'ADMIN';
                const hasUrgentRight = currentUser.canCreateUrgentTasks === true || currentUser.canCreateSosTasks === true;
                
                if (!isModeratorOrAdmin && !hasUrgentRight) {
                    return res.status(403).json({ message: 'У вас нет прав для создания срочных задач' });
                }
                isUrgent = true;
            }

            // Determine if immediately published
            // Urgent tasks created by authorized users (Admin, Moderator, Special Organizers) are published immediately.
            // Regular tasks by Admin/Moderator are published immediately.
            let isPublishedImmediately = false;
            if (userRole === 'ADMIN' || userRole === 'MODERATOR') {
                isPublishedImmediately = true;
            } else if (userRole === 'ORGANIZER') {
                // If they are special organizer creating urgent task, publish it immediately
                if (isUrgent) {
                    isPublishedImmediately = true;
                }
            }

            const doc = {
                title: String(title).trim(),
                description: String(description).trim(),
                city: String(city).trim(),
                region: String(region).trim(),
                address: String(address).trim(),
                categoryId: String(categoryId).trim(),
                format: String(format).trim(),
                capacity: numericCapacity,
                ownerUserId: new ObjectId(req.user.userId),
                imageUrl,
                status: isPublishedImmediately ? 'PUBLISHED' : 'PENDING',
                priority: isUrgent ? 'high' : 'normal',
                isUrgent: isUrgent,
                lat: lat ? Number(lat) : null,
                lng: lng ? Number(lng) : null,
                coordinates: lat && lng ? { lat: Number(lat), lng: Number(lng) } : null,
                publishedAt: isPublishedImmediately ? new Date() : null,
                responsesCount: 0,
                createdAt: new Date()
            };

            const result = await db.collection('projects').insertOne(doc);
            const created = await db.collection('projects').findOne({ _id: result.insertedId });
            
            try {
                await db.collection('userevents').insertOne({
                    userId: new ObjectId(req.user.userId),
                    sessionId: req.headers['x-session-id'] || 'unknown',
                    eventType: 'project_created',
                    eventData: { projectId: created._id },
                    createdAt: new Date()
                });
            } catch(e) {}

            // Trigger targeted notification if published immediately and priority is high
            if (created.status === 'PUBLISHED' && created.priority === 'high') {
                const NotificationService = require('../services/NotificationService');
                NotificationService.sendUrgentTaskNotifications(created).catch(console.error);
            }

            res.status(201).json({ message: 'Проект создан', project: mapProjectForClient(created) });
        } catch (err) {
            console.error('❌ Ошибка создания проекта:', err);
            res.status(500).json({ message: 'Ошибка сервера' });
        }
    }

    async apply(req, res) {
        const projectId = req.params.id;
        try {
            const db = getDB();
            const projectsCollection = db.collection('projects');
            const applicationsCollection = db.collection('project_applications');

            const project = await projectsCollection.findOne({ _id: new ObjectId(projectId), status: 'PUBLISHED' });
            if (!project) return res.status(404).json({ message: 'Проект не найден или набор закрыт' });

            const existing = await applicationsCollection.findOne({
                projectId: project._id,
                userId: new ObjectId(req.user.userId),
                status: 'ACTIVE'
            });

            if (existing) return res.status(409).json({ message: 'Вы уже откликнулись на этот проект' });

            const effectiveCapacity = project.capacity || project.volunteersNeeded || 0;
            if ((project.responsesCount || 0) >= effectiveCapacity) {
                return res.status(400).json({ message: 'Набор на проект завершён (нет мест)' });
            }

            const appDoc = {
                projectId: project._id,
                userId: new ObjectId(req.user.userId),
                status: 'ACTIVE',
                appliedAt: new Date()
            };

            const result = await applicationsCollection.insertOne(appDoc);
            await projectsCollection.updateOne({ _id: project._id }, { $inc: { responsesCount: 1 } });
            
            // Начисление XP
            const xpReward = req.user.role === 'ORGANIZER' ? 15 : 10;
            await db.collection('users').updateOne({ _id: new ObjectId(req.user.userId) }, { $inc: { points: xpReward } });
            await GamificationService.checkAchievements(req.user.userId);

            const created = await applicationsCollection.findOne({ _id: result.insertedId });
            created.id = created._id.toString();

            res.status(201).json({ message: 'Отклик сохранён', application: created });
        } catch (err) {
            res.status(500).json({ message: 'Ошибка сервера' });
        }
    }

    async getMyApplications(req, res) {
        try {
            const db = getDB();
            const docs = await db.collection('project_applications')
                .find({ userId: new ObjectId(req.user.userId), status: 'ACTIVE' })
                .toArray();
            
            const applications = docs.map(doc => ({
                id: doc._id.toString(),
                projectId: doc.projectId.toString(),
                userId: doc.userId.toString(),
                status: doc.status,
                appliedAt: doc.appliedAt
            }));
            res.json({ applications });
        } catch (err) {
            res.status(500).json({ message: 'Ошибка сервера' });
        }
    }

    async cancelApplication(req, res) {
        try {
            const db = getDB();
            const appId = req.params.id;
            const applicationsCollection = db.collection('project_applications');
            const projectsCollection = db.collection('projects');

            const appDoc = await applicationsCollection.findOne({ _id: new ObjectId(appId), status: 'ACTIVE' });
            if (!appDoc) return res.status(404).json({ message: 'Отклик не найден или уже отменён' });
            if (appDoc.userId.toString() !== req.user.userId && req.user.role !== 'ADMIN') {
                return res.status(403).json({ message: 'Нет прав' });
            }

            await applicationsCollection.updateOne({ _id: appDoc._id }, { $set: { status: 'CANCELLED' } });
            await projectsCollection.updateOne({ _id: appDoc.projectId }, { $inc: { responsesCount: -1 } });

            const xpDelta = req.user.role === 'ORGANIZER' ? -15 : -10;
            await db.collection('users').updateOne({ _id: new ObjectId(appDoc.userId) }, { $inc: { points: xpDelta } });

            res.json({ message: 'Отклик отменён' });
        } catch (err) {
            res.status(500).json({ message: 'Ошибка сервера' });
        }
    }

    async updateTask(req, res) {
        try {
            const db = getDB();
            const projectId = req.params.id;
            const { title, description, city, region, address, categoryId, format, capacity } = req.body;

            const project = await db.collection('projects').findOne({ _id: new ObjectId(projectId), status: { $ne: 'DELETED' } });
            if (!project) return res.status(404).json({ message: 'Проект не найден' });
            
            const isOwner = project.ownerUserId && project.ownerUserId.toString() === req.user.userId;
            if (req.user.role !== 'ADMIN' && !isOwner) {
                return res.status(403).json({ message: 'Нет прав для редактирования этого проекта' });
            }

            const update = {};
            if (title !== undefined) update.title = String(title).trim();
            if (description !== undefined) update.description = String(description).trim();
            if (city !== undefined) update.city = String(city).trim();
            if (region !== undefined) update.region = String(region).trim();
            if (address !== undefined) update.address = String(address).trim();
            if (categoryId !== undefined) update.categoryId = String(categoryId).trim();
            if (format !== undefined) update.format = String(format).trim();
            if (capacity !== undefined) update.capacity = Number(capacity);

            await db.collection('projects').updateOne({ _id: project._id }, { $set: update });
            const updated = await db.collection('projects').findOne({ _id: project._id });
            res.json({ message: 'Проект обновлён', project: mapProjectForClient(updated) });
        } catch (err) {
            res.status(500).json({ message: 'Ошибка сервера' });
        }
    }

    async reopenTask(req, res) {
        try {
            const db = getDB();
            const projectId = req.params.id;

            const project = await db.collection('projects').findOne({ _id: new ObjectId(projectId), status: { $ne: 'DELETED' } });
            if (!project) return res.status(404).json({ message: 'Проект не найден' });
            
            const isOwner = project.ownerUserId && project.ownerUserId.toString() === req.user.userId;
            if (req.user.role !== 'ADMIN' && !isOwner) return res.status(403).json({ message: 'Нет прав' });

            await db.collection('projects').updateOne({ _id: project._id }, { $set: { status: 'PUBLISHED' } });
            const updated = await db.collection('projects').findOne({ _id: project._id });
            res.json({ message: 'Набор открыт', project: mapProjectForClient(updated) });
        } catch (err) { res.status(500).json({ message: 'Ошибка сервера' }); }
    }

    async closeTask(req, res) {
        try {
            const db = getDB();
            const projectId = req.params.id;

            const project = await db.collection('projects').findOne({ _id: new ObjectId(projectId), status: { $ne: 'DELETED' } });
            if (!project) return res.status(404).json({ message: 'Проект не найден' });
            
            const isOwner = project.ownerUserId && project.ownerUserId.toString() === req.user.userId;
            if (req.user.role !== 'ADMIN' && !isOwner) return res.status(403).json({ message: 'Нет прав' });

            await db.collection('projects').updateOne({ _id: project._id }, { $set: { status: 'CLOSED' } });
            const updated = await db.collection('projects').findOne({ _id: project._id });
            res.json({ message: 'Набор завершён', project: mapProjectForClient(updated) });
        } catch (err) { res.status(500).json({ message: 'Ошибка сервера' }); }
    }

    async deleteTask(req, res) {
        try {
            const db = getDB();
            const projectId = req.params.id;

            const project = await db.collection('projects').findOne({ _id: new ObjectId(projectId), status: { $ne: 'DELETED' } });
            if (!project) return res.status(404).json({ message: 'Проект не найден' });
            
            const isOwner = project.ownerUserId && project.ownerUserId.toString() === req.user.userId;
            const isAdmin = req.user.role === 'ADMIN';
            const isModerator = req.user.role === 'MODERATOR';
            if (!isAdmin && !isModerator && !isOwner) return res.status(403).json({ message: 'Нет прав' });

            await db.collection('projects').deleteOne({ _id: project._id });
            await db.collection('project_applications').deleteMany({ projectId: project._id });

            if (!isAdmin && !isModerator && isOwner) {
                await db.collection('users').updateOne({ _id: new ObjectId(project.ownerUserId) }, { $inc: { points: -25 } });
            }

            res.json({ message: 'Проект удалён' });
        } catch (err) { res.status(500).json({ message: 'Ошибка сервера' }); }
    }

    // Модератор одобряет задачу (PENDING → PUBLISHED)
    async approveTask(req, res) {
        try {
            const db = getDB();
            const projectId = req.params.id;

            const project = await db.collection('projects').findOne({ _id: new ObjectId(projectId) });
            if (!project) return res.status(404).json({ message: 'Проект не найден' });
            if (project.status !== 'PENDING') return res.status(400).json({ message: 'Проект не на модерации' });

            await db.collection('projects').updateOne(
                { _id: project._id },
                { $set: { status: 'PUBLISHED', moderatedBy: new ObjectId(req.user.userId), moderatedAt: new Date(), publishedAt: new Date() } }
            );

            // Логируем событие
            try {
                await db.collection('userevents').insertOne({
                    userId: new ObjectId(req.user.userId),
                    eventType: 'task_approved',
                    eventData: { projectId: project._id, projectTitle: project.title },
                    createdAt: new Date()
                });
            } catch(e) {}

            const updated = await db.collection('projects').findOne({ _id: project._id });

            // Trigger targeted notification if priority is high
            if (updated.priority === 'high') {
                const NotificationService = require('../services/NotificationService');
                NotificationService.sendUrgentTaskNotifications(updated).catch(console.error);
            }

            res.json({ message: 'Проект одобрен и опубликован', project: mapProjectForClient(updated) });
        } catch (err) {
            res.status(500).json({ message: 'Ошибка сервера' });
        }
    }

    // Модератор отклоняет задачу (PENDING → REJECTED)
    async rejectTask(req, res) {
        try {
            const db = getDB();
            const projectId = req.params.id;
            const { reason } = req.body;

            const project = await db.collection('projects').findOne({ _id: new ObjectId(projectId) });
            if (!project) return res.status(404).json({ message: 'Проект не найден' });
            if (project.status !== 'PENDING') return res.status(400).json({ message: 'Проект не на модерации' });

            await db.collection('projects').updateOne(
                { _id: project._id },
                { $set: { status: 'REJECTED', rejectionReason: reason || '', moderatedBy: new ObjectId(req.user.userId), moderatedAt: new Date() } }
            );

            // Логируем событие
            try {
                await db.collection('userevents').insertOne({
                    userId: new ObjectId(req.user.userId),
                    eventType: 'task_rejected',
                    eventData: { projectId: project._id, projectTitle: project.title, reason: reason || '' },
                    createdAt: new Date()
                });
            } catch(e) {}

            res.json({ message: 'Проект отклонён' });
        } catch (err) {
            res.status(500).json({ message: 'Ошибка сервера' });
        }
    }
}

module.exports = new TaskController();
