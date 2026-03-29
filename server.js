require('dotenv').config();
const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const { getDB, connectDB } = require('./db');
const mongoose = require('mongoose');
const cors = require('cors');
const { ObjectId } = require('mongodb');
const adminRoutes = require('./routes/admin');
const UserEvent = require('./models/UserEvent');
const User = require('./models/User');

// Проверка обязательных переменных окружения
if (!process.env.JWT_SECRET) {
    console.error('❌ ОШИБКА: JWT_SECRET не установлен в переменных окружения!');
    console.error('   Установите JWT_SECRET в файле .env');
    process.exit(1);
}

const ACCESS_TOKEN_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '1h';
const REFRESH_TOKEN_SECRET = process.env.REFRESH_TOKEN_SECRET || `${process.env.JWT_SECRET}_refresh`;
const REFRESH_TOKEN_EXPIRES_IN = process.env.REFRESH_TOKEN_EXPIRES_IN || '30d';

const app = express();
const PORT = process.env.PORT || 3000;

// Настройка CORS (можно настроить через переменную окружения)
const allowedOrigins = process.env.CORS_ORIGINS
    ? process.env.CORS_ORIGINS.split(',').map(origin => origin.trim())
    : ['*']; // По умолчанию разрешаем все (для разработки)

// 1. ПАРСИНГ И CORS (В самом начале, чтобы запросы читались)
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(cors());

// 2. ПРИЕМ ДАННЫХ АНАЛИТИКИ (УБИРАЕТ ОШИБКУ 404)
app.post('/api/v1/analytics/collect', async (req, res) => {
    try {
        const db = getDB();
        if (!db) return res.status(500).json({ success: false });

        const { eventType, path, email, userAgent } = req.body;

        const event = {
            userId: req.body.userId || 'guest',
            email: email || 'Анонимный гость',
            eventType: eventType || 'click',
            path: path || '/',
            userAgent: userAgent || 'Unknown',
            ip: req.headers['x-forwarded-for'] || req.socket.remoteAddress,
            createdAt: new Date()
        };

        await db.collection('userevents').insertOne(event);
        console.log(`[COLLECTOR] Данные получены: ${event.email} -> ${event.path}`);
        res.status(200).json({ success: true });
    } catch (err) {
        res.status(500).json({ success: false });
    }
});

// 3. ЖЕЛЕЗОБЕТОННЫЙ ЛОГГЕР ПЕРЕХОДОВ (Для автоматического трекинга)
app.use(async (req, res, next) => {
    try {
        const db = getDB();
        if (!db || req.method !== 'GET') return next();

        // Игнорируем статику и системные пути
        const ignored = ['.js', '.css', '.png', '.jpg', '.ico', '/api/admin', '/api/v1/analytics'];
        if (ignored.some(ext => req.path.includes(ext))) return next();

        await db.collection('userevents').insertOne({
            email: 'Посетитель',
            eventType: 'navigation',
            path: req.path,
            ip: req.headers['x-forwarded-for'] || req.socket.remoteAddress,
            createdAt: new Date()
        });
        console.log(`[METRIKA] Авто-запись: ${req.path}`);
    } catch (e) {}
    next();
});

// 4. РОУТЫ АДМИНКИ
app.use('/api/admin', adminRoutes);

// 5. ГЛАВНЫЙ API ДЛЯ ВЫДАЧИ ВСЕХ МЕТРИК В АДМИНКУ
app.get('/api/admin/dashboard-data', authMiddleware, requireAdmin, async (req, res) => {
    try {
        const db = getDB();
        if (!db) return res.status(500).json({ success: false, error: "DB Error" });

        // Агрегация: Популярные страницы
        const pathStats = await db.collection('userevents').aggregate([
            { $match: { eventType: 'navigation' } },
            { $group: { _id: "$path", count: { $sum: 1 } } },
            { $sort: { count: -1 } },
            { $limit: 10 }
        ]).toArray();

        // Агрегация: Топ активных юзеров
        const userActivity = await db.collection('userevents').aggregate([
            { $group: {
                    _id: { $ifNull: ["$email", "Anonymous"] },
                    totalActions: { $sum: 1 }
                }},
            { $sort: { totalActions: -1 } },
            { $limit: 10 }
        ]).toArray();

        // Последние 50 событий для Вебвизора
        const recentEvents = await db.collection('userevents')
            .find({})
            .sort({ timestamp: -1 })
            .limit(50)
            .toArray();

        // Счетчики из основных коллекций
        const [volunteers, projects, news] = await Promise.all([
            db.collection('users').countDocuments({ role: 'VOLUNTEER' }),
            db.collection('projects').countDocuments({ status: { $ne: 'DELETED' } }),
            db.collection('news').countDocuments()
        ]);

        const totalViews = await db.collection('userevents').countDocuments();

        res.json({
            success: true,
            counts: { volunteers, projects, news },
            realtime: {
                totalViews,
                online: Math.max(1, userActivity.length)
            },
            pathStats,
            userActivity,
            recentEvents
        });
    } catch (err) {
        console.error("❌ Dash error:", err);
        res.status(500).json({ success: false, error: err.message });
    }
});

/** * МОДУЛЬ 2: ИНТЕГРАЦИЯ МАРКЕТИНГОВОГО ТРЕКЕРА
 * Мы подключаем роуты именно здесь, чтобы они имели доступ к обработанному JSON в req.body
 */
const trackingRoutes = require('./routes/tracking');
app.use('/api/v1/analytics', trackingRoutes);

// 3. Раздача статических файлов (теперь трекер доступен по пути /js/tracker.js)
app.use(express.static(path.join(__dirname, 'public')));

// === ЗАГРУЗКА ФАЙЛОВ (АВАТАРЫ, ОБЛОЖКИ ПРОЕКТОВ) ===
const AVATARS_DIR = path.join(__dirname, 'public', 'uploads', 'avatars');
const PROJECTS_DIR = path.join(__dirname, 'public', 'uploads', 'projects');
fs.mkdirSync(AVATARS_DIR, { recursive: true });
fs.mkdirSync(PROJECTS_DIR, { recursive: true });

const avatarUpload = multer({
    storage: multer.diskStorage({
        destination: (req, file, cb) => cb(null, AVATARS_DIR),
        filename: (req, file, cb) => {
            const safeExt = path.extname(file.originalname || '').toLowerCase().slice(0, 10);
            const base = `${req.user?.userId || 'anon'}-${Date.now()}`;
            cb(null, `${base}${safeExt || ''}`);
        }
    }),
    limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
    fileFilter: (req, file, cb) => {
        if (!file.mimetype || !file.mimetype.startsWith('image/')) {
            return cb(new Error('Можно загружать только изображения'));
        }
        cb(null, true);
    }
});

const projectImageUpload = multer({
    storage: multer.diskStorage({
        destination: (req, file, cb) => cb(null, PROJECTS_DIR),
        filename: (req, file, cb) => {
            const safeExt = path.extname(file.originalname || '').toLowerCase().slice(0, 10);
            const base = `${req.user?.userId || 'project'}-${Date.now()}`;
            cb(null, `${base}${safeExt || ''}`);
        }
    }),
    limits: { fileSize: 8 * 1024 * 1024 }, // 8MB
    fileFilter: (req, file, cb) => {
        if (!file.mimetype || !file.mimetype.startsWith('image/')) {
            return cb(new Error('Можно загружать только изображения'));
        }
        cb(null, true);
    }
});

function generateAccessToken(user) {
    return jwt.sign(
        {
            userId: user._id ? user._id.toString() : user.userId,
            email: user.email,
            role: user.role
        },
        process.env.JWT_SECRET,
        { expiresIn: ACCESS_TOKEN_EXPIRES_IN }
    );
}



function generateRefreshToken(user) {
    return jwt.sign(
        { userId: user._id ? user._id.toString() : user.userId },
        REFRESH_TOKEN_SECRET,
        { expiresIn: REFRESH_TOKEN_EXPIRES_IN }
    );
}

async function addRefreshToken(usersCollection, userId, refreshToken) {
    const tokenHash = await bcrypt.hash(refreshToken, 10);
    await usersCollection.updateOne(
        { _id: new ObjectId(userId) },
        { $push: { refreshTokens: { tokenHash, createdAt: new Date() } } }
    );
}

async function removeRefreshToken(usersCollection, userId, tokenHash) {
    await usersCollection.updateOne(
        { _id: new ObjectId(userId) },
        { $pull: { refreshTokens: { tokenHash } } }
    );
}

async function findMatchingRefreshToken(user, refreshToken) {
    if (!user.refreshTokens || !Array.isArray(user.refreshTokens)) return null;
    for (const entry of user.refreshTokens) {
        const match = await bcrypt.compare(refreshToken, entry.tokenHash);
        if (match) {
            return entry.tokenHash;
        }
    }
    return null;
}



async function trackEvent(userId, sessionId, eventType, eventData = {}, sourceData = {}, deviceData = {}) {
    try {
        const UserEvent = require('./models/UserEvent');
        await UserEvent.create({
            userId: userId || null,
            sessionId: sessionId || 'system',
            eventType,
            eventData,
            sourceData,
            deviceData
        });
    } catch (err) {R
        console.error('Failed to track event:', err);
    }
}

// === ГЛАВНЫЕ FRONTEND-МАРШРУТЫ (SPA без #) ===
const FRONTEND_ROUTES = ['/', '/projects', '/community', '/news', '/about', '/contacts', '/cabinet'];

FRONTEND_ROUTES.forEach(route => {
    app.get(route, (req, res) => {
        res.sendFile(path.join(__dirname, 'public', 'index1.html'));
    });
});



// === РЕГИСТРАЦИЯ ===
// === РЕГИСТРАЦИЯ (ОБНОВЛЕННАЯ ДЛЯ АДМИНКИ) ===
app.post('/register', async (req, res) => {
    const { username, password, email, role, name, city, phone } = req.body;

    console.log('=== РЕГИСТРАЦИЯ ===', username || email);

    if (!email || !password || !name) {
        return res.status(400).json({ message: 'Email, пароль и имя обязательны' });
    }

    try {
        const db = getDB();
        if (!db) {
            return res.status(503).json({ message: 'База данных недоступна' });
        }
        const usersCollection = db.collection('users');

        // Проверка существования
        const existing = await usersCollection.findOne({ email: email.toLowerCase() });

        if (existing) {
            return res.status(409).json({ message: 'Пользователь с таким email уже существует' });
        }

        // Хеширование пароля
        const passwordHash = await bcrypt.hash(password, 10);

        // Создание пользователя
        const newUser = {
            username: username || email.split('@')[0],
            email: email.toLowerCase(),
            password_hash: passwordHash,
            name: name || '',
            role: role || 'VOLUNTEER',
            city: city || '',
            phone: phone || '',
            points: 0,
            avatarUrl: '',
            privacy: 'public',
            achievements: [],
            created_at: new Date()
        };

        const result = await usersCollection.insertOne(newUser);

        // --- ВОТ ЭТИ 6 СТРОК МЫ ДОБАВИЛИ ДЛЯ РЕАЛЬНОЙ СТАТИСТИКИ ---
        await db.collection('userevents').insertOne({
            userId: result.insertedId,
            sessionId: req.body.sessionId || 'unknown',
            eventType: 'registration',
            eventData: {},
            createdAt: new Date()
        });
        // -------------------------------------------------------

        console.log('✓ Создан пользователь ID:', result.insertedId);

        // Проверяем достижения для нового пользователя
        if (typeof checkAchievements === 'function') {
            await checkAchievements(result.insertedId.toString());
        }

        const token = generateAccessToken({ _id: result.insertedId, email: newUser.email, role: newUser.role });
        const refreshToken = generateRefreshToken({ userId: result.insertedId });
        await addRefreshToken(usersCollection, result.insertedId, refreshToken);

        res.status(201).json({
            message: 'Пользователь зарегистрирован',
            userId: result.insertedId,
            token,
            refreshToken,
            user: {
                id: result.insertedId,
                username: newUser.username,
                email: newUser.email,
                name: newUser.name,
                role: newUser.role,
                city: newUser.city,
                phone: newUser.phone,
                avatarUrl: newUser.avatarUrl,
                points: newUser.points
            }
        });
    } catch (err) {
        console.error('🚨 ОШИБКА РЕГИСТРАЦИИ:', err);
        res.status(500).json({ message: 'Ошибка сервера', error: err.message });
    }
});

// === ЛОГИН ===
app.post('/login', async (req, res) => {
    const { email, password } = req.body;

    console.log('=== ЛОГИН ===', email);

    try {
        const db = getDB();
        if (!db) {
            return res.status(503).json({ message: 'База данных недоступна' });
        }
        const usersCollection = db.collection('users');

        // Поиск по email
        const user = await usersCollection.findOne({ email: email.toLowerCase() });

        if (!user) {
            return res.status(401).json({ message: 'Неверный email или пароль' });
        }

        // Проверка пароля
        const isValid = await bcrypt.compare(password, user.password_hash);
        if (!isValid) {
            return res.status(401).json({ message: 'Неверный email или пароль' });
        }

        await usersCollection.updateOne(
            { _id: user._id },
            { $set: { lastLogin: new Date() } }
        );

        const token = generateAccessToken(user);
        const refreshToken = generateRefreshToken(user);
        await addRefreshToken(usersCollection, user._id, refreshToken);

        console.log('✓ Логин успешен');

        res.json({
            token,
            refreshToken,
            user: {
                id: user._id,
                username: user.username,
                email: user.email,
                name: user.name,
                role: user.role,
                city: user.city,
                phone: user.phone,
                avatarUrl: user.avatarUrl || '',
                points: user.points || 0
            }
        });
    } catch (err) {
        console.error('❌ Ошибка логина:', err);
        res.status(500).json({ message: 'Ошибка сервера' });
    }
});

// === MIDDLEWARE АВТОРИЗАЦИИ ===
function authMiddleware(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
        return res.status(401).json({ message: 'Токен не передан' });
    }

    jwt.verify(token, process.env.JWT_SECRET, (err, payload) => {
        if (err) {
            return res.status(403).json({ message: 'Неверный или истекший токен' });
        }
        req.user = payload;
        next();
    });
}

// Хелпер для проверки роли организатора (или администратора)
function requireOrganizer(req, res, next) {
    if (!req.user || (req.user.role !== 'ORGANIZER' && req.user.role !== 'ADMIN')) {
        return res.status(403).json({ message: 'Доступ только для организаторов или администраторов' });
    }
    next();
}

// Хелпер для проверки роли администратора
function requireAdmin(req, res, next) {
    if (!req.user || req.user.role !== 'ADMIN') {
        return res.status(403).json({ message: 'Доступ только для администраторов' });
    }
    next();
}

function canManageProject(user, project) {
    if (!user || !project) return false;
    if (user.role === 'ADMIN') return true;
    return project.ownerUserId && project.ownerUserId.toString() === user.userId;
}

// Хелпер для приведения проекта к формату фронтенда
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
        status: doc.status || 'PUBLISHED'
    };
}

// === ПРОЕКТЫ (API) ===

// Получить список всех проектов (кроме помеченных как DELETED)
app.get('/api/projects', async (req, res) => {
    try {
        const db = getDB();
        if (!db) {
            return res.status(503).json({ message: 'База данных недоступна' });
        }

        const projectsCollection = db.collection('projects');
        const usersCollection = db.collection('users');
        const docs = await projectsCollection
            .find({ status: { $ne: 'DELETED' } })
            .sort({ createdAt: -1 })
            .toArray();

        const projects = docs.map(mapProjectForClient);
        res.json({ projects });
    } catch (err) {
        console.error('❌ Ошибка получения проектов:', err);
        res.status(500).json({ message: 'Ошибка сервера' });
    }
});

// Создать новый проект (только организатор)
app.post(
    '/api/projects',
    authMiddleware,
    requireOrganizer,
    projectImageUpload.single('image'),
    async (req, res) => {
        const { title, description, city, region, categoryId, format, capacity, address } = req.body;

        if (!title || !description || !capacity || !categoryId || !region || !format || !address) {
            return res.status(400).json({ message: 'Название, описание, категория, область, формат, адрес и количество волонтёров обязательны' });
        }

        const numericCapacity = Number(capacity);
        if (!Number.isFinite(numericCapacity) || numericCapacity <= 0) {
            return res.status(400).json({ message: 'Количество волонтёров должно быть положительным числом' });
        }

        try {
            const db = getDB();
            if (!db) {
                return res.status(503).json({ message: 'База данных недоступна' });
            }

            const projectsCollection = db.collection('projects');
            const usersCollection = db.collection('users');

            const imageUrl = req.file
                ? `/uploads/projects/${req.file.filename}`
                : '';

            const doc = {
                ownerUserId: new ObjectId(req.user.userId),
                title: String(title).trim(),
                description: String(description).trim(),
                descriptionShort: '',
                city: String(city || '').trim(),
                region: String(region || '').trim(),
                address: String(address || '').trim(),
                categoryId: String(categoryId || '').trim(),
                format: String(format || '').trim(),
                capacity: numericCapacity,
                responsesCount: 0,
                imageUrl,
                status: 'PUBLISHED',
                createdAt: new Date()
            };

            const result = await projectsCollection.insertOne(doc);
            const created = await projectsCollection.findOne({ _id: result.insertedId });

            // XP за создание проекта (только организатор/админ, но значение считаем одинаковым)
            await usersCollection.updateOne(
                { _id: new ObjectId(req.user.userId) },
                { $inc: { points: 25 } }
            );

            res.status(201).json({
                message: 'Проект создан',
                project: mapProjectForClient(created)
            });
        } catch (err) {
            console.error('❌ Ошибка создания проекта:', err);
            res.status(500).json({ message: 'Ошибка сервера' });
        }
    }
);

// Отклик на проект (для волонтёров и организаторов)
app.post('/api/projects/:id/apply', authMiddleware, async (req, res) => {
    const projectId = req.params.id;

    try {
        const db = getDB();
        if (!db) {
            return res.status(503).json({ message: 'База данных недоступна' });
        }

        const projectsCollection = db.collection('projects');
        const usersCollection = db.collection('users');
        const applicationsCollection = db.collection('project_applications');

        const project = await projectsCollection.findOne({ _id: new ObjectId(projectId), status: { $ne: 'DELETED' } });
        if (!project) {
            return res.status(404).json({ message: 'Проект не найден' });
        }

        // Проверяем, не закрыт ли набор
        if (project.status === 'CLOSED') {
            return res.status(400).json({ message: 'Набор по этому проекту завершён, новые отклики невозможны' });
        }

        // Проверка на уникальность отклика
        const userObjectId = new ObjectId(req.user.userId);
        const existing = await applicationsCollection.findOne({
            projectId: project._id,
            userId: { $in: [userObjectId, req.user.userId] },
            status: { $ne: 'CANCELLED' }
        });

        if (existing) {
            return res.status(409).json({ message: 'Вы уже откликались на этот проект' });
        }

        const capacity = project.capacity || project.volunteersNeeded || 0;
        const responsesCount = project.responsesCount || 0;
        if (capacity > 0 && responsesCount >= capacity) {
            return res.status(400).json({ message: 'Набор закрыт, мест больше нет' });
        }

        const appDoc = {
            projectId: project._id,
            userId: new ObjectId(req.user.userId),
            userRole: req.user.role,
            status: 'ACTIVE',
            createdAt: new Date()
        };

        const insertResult = await applicationsCollection.insertOne(appDoc);

        // увеличиваем счётчик откликов
        await projectsCollection.updateOne(
            { _id: project._id },
            { $inc: { responsesCount: 1 } }
        );

        // Запись события отклика
        try {
            const sessionId = req.body?.sessionId || req.headers['x-session-id'] || 'unknown';
            await db.collection('userevents').insertOne({
                userId: new ObjectId(req.user.userId),
                sessionId: sessionId,
                eventType: 'project_apply',
                eventData: { projectId: project._id, projectTitle: project.title },
                createdAt: new Date()
            });
        } catch (err) {
            console.error('Ошибка записи события отклика:', err);
        }

        // Запись события отклика
        await db.collection('userevents').insertOne({
            userId: new ObjectId(req.user.userId),
            sessionId: req.body.sessionId || 'unknown',
            eventType: 'project_apply',
            eventData: { projectId: project._id, projectTitle: project.title },
            createdAt: new Date()
        });

        // XP за отклик
        const xpDelta = req.user.role === 'ORGANIZER' ? 15 : 10; // организатор чуть больше
        await usersCollection.updateOne(
            { _id: new ObjectId(req.user.userId) },
            { $inc: { points: xpDelta } }
        );

        // Проверяем достижения после получения XP
        await checkAchievements(req.user.userId);

        res.status(201).json({
            message: 'Отклик сохранён',
            application: {
                id: insertResult.insertedId.toString(),
                projectId: project._id.toString(),
                userId: req.user.userId,
                status: appDoc.status,
                createdAt: appDoc.createdAt
            }
        });
    } catch (err) {
        console.error('❌ Ошибка отклика на проект:', err);
        res.status(500).json({ message: 'Ошибка сервера' });
    }
});

// Получить отклики текущего пользователя + связанные проекты
app.get('/api/my/applications', authMiddleware, async (req, res) => {
    try {
        const db = getDB();
        if (!db) {
            return res.status(503).json({ message: 'База данных недоступна' });
        }

        const applicationsCollection = db.collection('project_applications');
        const projectsCollection = db.collection('projects');

        const userObjectId = new ObjectId(req.user.userId);

        // Поддерживаем как старые записи с userId-строкой, так и новые с ObjectId
        const apps = await applicationsCollection
            .find({
                userId: { $in: [userObjectId, req.user.userId] },
                status: { $ne: 'CANCELLED' }
            })
            .sort({ createdAt: -1 })
            .toArray();

        const projectIds = [...new Set(apps.map(a => a.projectId.toString()))].map(id => new ObjectId(id));

        const projects = projectIds.length
            ? await projectsCollection
                .find({ _id: { $in: projectIds }, status: { $ne: 'DELETED' } })
                .toArray()
            : [];

        const projectsMap = new Map(projects.map(p => [p._id.toString(), mapProjectForClient(p)]));

        res.json({
            applications: apps.map(a => ({
                id: a._id.toString(),
                projectId: a.projectId.toString(),
                userId: a.userId.toString(),
                status: a.status,
                createdAt: a.createdAt
            })),
            projects: Array.from(projectsMap.values())
        });
    } catch (err) {
        console.error('❌ Ошибка получения откликов:', err);
        res.status(500).json({ message: 'Ошибка сервера' });
    }
});

// Отменить отклик текущего пользователя
app.post('/api/applications/:id/cancel', authMiddleware, async (req, res) => {
    const appId = req.params.id;

    try {
        const db = getDB();
        if (!db) {
            return res.status(503).json({ message: 'База данных недоступна' });
        }

        const applicationsCollection = db.collection('project_applications');
        const projectsCollection = db.collection('projects');
        const usersCollection = db.collection('users');

        const userObjectId = new ObjectId(req.user.userId);

        // Ищем отклик, учитывая как ObjectId, так и строковый userId из старых записей
        const appDoc = await applicationsCollection.findOne({
            _id: new ObjectId(appId),
            $or: [
                { userId: userObjectId },
                { userId: req.user.userId }
            ]
        });

        if (!appDoc) {
            return res.status(404).json({ message: 'Отклик не найден' });
        }

        if (appDoc.status === 'CANCELLED') {
            return res.json({ message: 'Отклик уже отменён' });
        }

        await applicationsCollection.updateOne(
            { _id: appDoc._id },
            { $set: { status: 'CANCELLED', cancelledAt: new Date() } }
        );

        // Запись события отмены отклика
        try {
            const sessionId = req.body?.sessionId || req.headers['x-session-id'] || 'unknown';
            await db.collection('userevents').insertOne({
                userId: new ObjectId(req.user.userId),
                sessionId: sessionId,
                eventType: 'project_apply_cancel',
                eventData: { projectId: appDoc.projectId },
                createdAt: new Date()
            });
        } catch (err) {
            console.error('Ошибка записи события отмены отклика:', err);
        }

        // Запись события отмены отклика
        await db.collection('userevents').insertOne({
            userId: new ObjectId(req.user.userId),
            sessionId: req.body.sessionId || 'unknown',
            eventType: 'project_apply_cancel',
            eventData: { projectId: appDoc.projectId },
            createdAt: new Date()
        });

        // Попробуем уменьшить счётчик откликов у проекта
        await projectsCollection.updateOne(
            { _id: appDoc.projectId },
            { $inc: { responsesCount: -1 } }
        );

        // Снимаем XP за отменённый отклик
        const xpDelta = appDoc.userRole === 'ORGANIZER' ? -15 : -10;
        await usersCollection.updateOne(
            { _id: new ObjectId(req.user.userId) },
            { $inc: { points: xpDelta } }
        );

        res.json({ message: 'Отклик отменён' });
    } catch (err) {
        console.error('❌ Ошибка отмены отклика:', err);
        res.status(500).json({ message: 'Ошибка сервера' });
    }
});

// Обновить проект (редактирование полей организатором или админом)
app.put('/api/projects/:id', authMiddleware, async (req, res) => {
    const projectId = req.params.id;
    const { title, description, city, region, address, categoryId, format, capacity } = req.body;

    try {
        const db = getDB();
        if (!db) {
            return res.status(503).json({ message: 'База данных недоступна' });
        }

        const projectsCollection = db.collection('projects');
        const project = await projectsCollection.findOne({ _id: new ObjectId(projectId), status: { $ne: 'DELETED' } });
        if (!project) {
            return res.status(404).json({ message: 'Проект не найден' });
        }

        if (!canManageProject(req.user, project)) {
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
        if (capacity !== undefined) {
            const numericCapacity = Number(capacity);
            if (!Number.isFinite(numericCapacity) || numericCapacity <= 0) {
                return res.status(400).json({ message: 'Количество волонтёров должно быть положительным числом' });
            }
            update.capacity = numericCapacity;
        }

        if (Object.keys(update).length === 0) {
            return res.status(400).json({ message: 'Нет полей для обновления' });
        }

        await projectsCollection.updateOne(
            { _id: project._id },
            { $set: update }
        );

        const updated = await projectsCollection.findOne({ _id: project._id });
        res.json({
            message: 'Проект обновлён',
            project: mapProjectForClient(updated)
        });
    } catch (err) {
        console.error('❌ Ошибка обновления проекта:', err);
        res.status(500).json({ message: 'Ошибка сервера' });
    }
});

// Открыть набор по проекту (меняем статус обратно на PUBLISHED)
app.post('/api/projects/:id/reopen', authMiddleware, async (req, res) => {
    const projectId = req.params.id;

    try {
        const db = getDB();
        if (!db) {
            return res.status(503).json({ message: 'База данных недоступна' });
        }

        const projectsCollection = db.collection('projects');
        const project = await projectsCollection.findOne({ _id: new ObjectId(projectId), status: { $ne: 'DELETED' } });
        if (!project) {
            return res.status(404).json({ message: 'Проект не найден' });
        }

        if (!canManageProject(req.user, project)) {
            return res.status(403).json({ message: 'Нет прав для изменения этого проекта' });
        }

        const updates = {
            status: 'PUBLISHED'
        };

        await projectsCollection.updateOne(
            { _id: project._id },
            { $set: updates }
        );

        const updated = await projectsCollection.findOne({ _id: project._id });
        res.json({
            message: 'Набор по проекту открыт',
            project: mapProjectForClient(updated)
        });
    } catch (err) {
        console.error('❌ Ошибка открытия набора:', err);
        res.status(500).json({ message: 'Ошибка сервера' });
    }
});

// Закончить набор по проекту (меняем статус)
app.post('/api/projects/:id/close', authMiddleware, async (req, res) => {
    const projectId = req.params.id;

    try {
        const db = getDB();
        if (!db) {
            return res.status(503).json({ message: 'База данных недоступна' });
        }

        const projectsCollection = db.collection('projects');
        const project = await projectsCollection.findOne({ _id: new ObjectId(projectId), status: { $ne: 'DELETED' } });
        if (!project) {
            return res.status(404).json({ message: 'Проект не найден' });
        }

        if (!canManageProject(req.user, project)) {
            return res.status(403).json({ message: 'Нет прав для изменения этого проекта' });
        }

        const updates = {
            status: 'CLOSED'
        };

        // Если capacity меньше фактического числа откликов — подравниваем
        const effectiveCapacity = project.capacity || project.volunteersNeeded || 0;
        const responsesCount = project.responsesCount || 0;
        if (responsesCount > effectiveCapacity) {
            updates.capacity = responsesCount;
        }

        await projectsCollection.updateOne(
            { _id: project._id },
            { $set: updates }
        );

        const updated = await projectsCollection.findOne({ _id: project._id });
        res.json({
            message: 'Набор по проекту завершён',
            project: mapProjectForClient(updated)
        });
    } catch (err) {
        console.error('❌ Ошибка завершения набора проекта:', err);
        res.status(500).json({ message: 'Ошибка сервера' });
    }
});

// Удалить проект (мягкое удаление по статусу)
app.post('/api/projects/:id/delete', authMiddleware, async (req, res) => {
    const projectId = req.params.id;

    try {
        const db = getDB();
        if (!db) {
            return res.status(503).json({ message: 'База данных недоступна' });
        }

        const projectsCollection = db.collection('projects');
        const project = await projectsCollection.findOne({ _id: new ObjectId(projectId), status: { $ne: 'DELETED' } });
        if (!project) {
            return res.status(404).json({ message: 'Проект не найден' });
        }

        if (!canManageProject(req.user, project)) {
            return res.status(403).json({ message: 'Нет прав для удаления этого проекта' });
        }

        // Определяем, кто инициатор
        const isAdmin = req.user.role === 'ADMIN';
        const ownerId = project.ownerUserId ? project.ownerUserId.toString() : null;

        // Физически удаляем проект из базы данных
        await projectsCollection.deleteOne({ _id: project._id });

        // Также удаляем все связанные отклики на этот проект
        const applicationsCollection = db.collection('project_applications');
        await applicationsCollection.deleteMany({ projectId: project._id });

        // Если проект удалил сам организатор (не админ) — штрафуем его по XP
        if (!isAdmin && ownerId) {
            await usersCollection.updateOne(
                { _id: new ObjectId(ownerId) },
                { $inc: { points: -25 } }
            );
        }

        res.json({ message: 'Проект удалён' });
    } catch (err) {
        console.error('❌ Ошибка удаления проекта:', err);
        res.status(500).json({ message: 'Ошибка сервера' });
    }
});

// === ПОЛУЧИТЬ ПРОФИЛЬ ===
app.get('/me', authMiddleware, async (req, res) => {
    try {
        const db = getDB();
        if (!db) {
            return res.status(503).json({ message: 'База данных недоступна' });
        }
        const usersCollection = db.collection('users');

        const user = await usersCollection.findOne(
            { _id: new ObjectId(req.user.userId) },
            { projection: { password_hash: 0 } }
        );

        if (!user) {
            return res.status(404).json({ message: 'Пользователь не найден' });
        }

        res.json({
            id: user._id,
            username: user.username,
            email: user.email,
            name: user.name,
            role: user.role,
            city: user.city,
            phone: user.phone,
            avatarUrl: user.avatarUrl || '',
            points: user.points || 0,
            created_at: user.created_at
        });
    } catch (err) {
        console.error('❌ Ошибка получения профиля:', err);
        res.status(500).json({ message: 'Ошибка сервера' });
    }
});

// === ОБНОВИТЬ ПРОФИЛЬ ===
app.put('/me', authMiddleware, async (req, res) => {
    try {
        const { name, city, phone, privacy, notifications, email } = req.body;
        const db = getDB();
        if (!db) {
            return res.status(503).json({ message: 'База данных недоступна' });
        }
        const usersCollection = db.collection('users');

        const updateData = {};
        if (name) updateData.name = name;
        if (city) updateData.city = city;
        if (phone) updateData.phone = phone;
        if (email !== undefined) {
            const normalizedEmail = String(email).trim().toLowerCase();
            if (!normalizedEmail) {
                return res.status(400).json({ message: 'Email обязателен' });
            }
            if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
                return res.status(400).json({ message: 'Некорректный email' });
            }

            const existing = await usersCollection.findOne(
                { email: normalizedEmail },
                { projection: { _id: 1 } }
            );
            if (existing && existing._id.toString() !== req.user.userId) {
                return res.status(409).json({ message: 'Пользователь с таким email уже существует' });
            }
            updateData.email = normalizedEmail;
        }
        if (privacy) updateData.privacy = privacy;
        if (notifications !== undefined) updateData.notifications = notifications;

        await usersCollection.updateOne(
            { _id: new ObjectId(req.user.userId) },
            { $set: updateData }
        );

        // Проверяем достижения (например, за заполнение профиля)
        await checkAchievements(req.user.userId);

        const updatedUser = await usersCollection.findOne(
            { _id: new ObjectId(req.user.userId) },
            { projection: { password_hash: 0 } }
        );

        const token = generateAccessToken(updatedUser);

        res.json({
            message: 'Профиль обновлён',
            token,
            user: {
                id: updatedUser._id,
                username: updatedUser.username,
                email: updatedUser.email,
                name: updatedUser.name,
                role: updatedUser.role,
                city: updatedUser.city,
                phone: updatedUser.phone,
                avatarUrl: updatedUser.avatarUrl || '',
                privacy: updatedUser.privacy,
                points: updatedUser.points || 0
            }
        });
    } catch (err) {
        console.error('❌ Ошибка обновления профиля:', err);
        res.status(500).json({ message: 'Ошибка сервера' });
    }
});

// === ЗАГРУЗИТЬ АВАТАР И СОХРАНИТЬ URL В БД ===
app.post('/me/avatar', authMiddleware, avatarUpload.single('avatar'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ message: 'Файл не передан' });
        }

        const db = getDB();
        const usersCollection = db.collection('users');

        const avatarUrl = `/uploads/avatars/${req.file.filename}`;

        await usersCollection.updateOne(
            { _id: new ObjectId(req.user.userId) },
            { $set: { avatarUrl } }
        );

        // Проверяем достижения (теперь достижение за аватар засчитается)
        await checkAchievements(req.user.userId);

        return res.json({ avatarUrl });
    } catch (err) {
        console.error('❌ Ошибка загрузки аватара:', err);
        return res.status(500).json({ message: 'Ошибка сервера' });
    }
});

// === ПРОВЕРКА СЕССИИ ===
app.get('/check-session', authMiddleware, async (req, res) => {
    try {
        const db = getDB();
        if (!db) {
            return res.status(503).json({ message: 'База данных недоступна' });
        }
        const usersCollection = db.collection('users');

        const user = await usersCollection.findOne(
            { _id: new ObjectId(req.user.userId) },
            { projection: { password_hash: 0 } }
        );

        if (!user) {
            return res.status(404).json({ valid: false });
        }

        res.json({
            valid: true,
            user: {
                id: user._id,
                username: user.username,
                email: user.email,
                name: user.name,
                role: user.role,
                city: user.city,
                phone: user.phone,
                avatarUrl: user.avatarUrl || '',
                points: user.points || 0
            }
        });
    } catch (err) {
        console.error('❌ Ошибка проверки сессии:', err);
        res.status(401).json({ valid: false });
    }
});

// === ОБНОВЛЕНИЕ ТОКЕНА ===
app.post('/refresh', async (req, res) => {
    const { refreshToken } = req.body;

    if (!refreshToken) {
        return res.status(400).json({ message: 'Refresh token обязателен' });
    }

    try {
        const payload = jwt.verify(refreshToken, REFRESH_TOKEN_SECRET);
        const db = getDB();
        if (!db) {
            return res.status(503).json({ message: 'База данных недоступна' });
        }

        const usersCollection = db.collection('users');
        const user = await usersCollection.findOne(
            { _id: new ObjectId(payload.userId) },
            {
                projection: {
                    refreshTokens: 1,
                    email: 1,
                    role: 1,
                    username: 1,
                    name: 1,
                    city: 1,
                    phone: 1,
                    points: 1
                }
            }
        );

        if (!user) {
            return res.status(401).json({ message: 'Пользователь не найден' });
        }

        const matchedHash = await findMatchingRefreshToken(user, refreshToken);
        if (!matchedHash) {
            return res.status(401).json({ message: 'Неверный refresh token' });
        }

        const newAccessToken = generateAccessToken(user);
        const newRefreshToken = generateRefreshToken(user);

        await removeRefreshToken(usersCollection, user._id, matchedHash);
        await addRefreshToken(usersCollection, user._id, newRefreshToken);

        res.json({
            token: newAccessToken,
            refreshToken: newRefreshToken,
            user: {
                id: user._id,
                username: user.username,
                email: user.email,
                name: user.name,
                role: user.role,
                city: user.city,
                phone: user.phone,
                avatarUrl: user.avatarUrl || '',
                points: user.points || 0
            }
        });
    } catch (err) {
        console.error('❌ Ошибка обновления токена:', err.message);
        if (err.name === 'TokenExpiredError') {
            return res.status(401).json({ message: 'Refresh token истёк' });
        }
        return res.status(401).json({ message: 'Неверный refresh token' });
    }
});

// === НОВОСТИ (API) ===

function mapNewsForClient(doc) {
    return {
        id: doc._id.toString(),
        title: doc.title,
        text: doc.text,
        image: doc.imageUrl || '',
        date: doc.createdAt
            ? new Date(doc.createdAt).toLocaleDateString('ru-RU')
            : new Date().toLocaleDateString('ru-RU'),
        authorId: doc.authorId ? doc.authorId.toString() : null,
        authorName: doc.authorName || 'Автор'
    };
}

app.get('/api/news', async (req, res) => {
    try {
        const db = getDB();
        if (!db) {
            return res.status(503).json({ message: 'База данных недоступна' });
        }

        const newsCollection = db.collection('news');
        const docs = await newsCollection
            .find({ status: { $ne: 'DELETED' } })
            .sort({ createdAt: -1 })
            .toArray();

        res.json({ news: docs.map(mapNewsForClient) });
    } catch (err) {
        console.error('❌ Ошибка получения новостей:', err);
        res.status(500).json({ message: 'Ошибка сервера' });
    }
});

// Роут для приема аналитики с фронтенда
app.post('/api/events', async (req, res) => {
    try {
        const db = getDB();
        const { eventType, sessionId, sourceData, deviceData } = req.body;

        // Создаем документ события
        const newEvent = {
            eventType: eventType || 'page_view',
            sessionId: sessionId || 'unknown',
            // Сохраняем данные об источнике (UTM)
            sourceData: {
                utm_source: sourceData?.utm_source || 'direct',
                utm_medium: sourceData?.utm_medium || 'none'
            },
            // Сохраняем данные об устройстве (ОС и Тип)
            deviceData: {
                os: deviceData?.os || 'unknown',
                type: deviceData?.type || 'desktop'
            },
            createdAt: new Date() // Важно: тип Date для фильтрации в админке
        };

        await db.collection('user_events').insertOne(newEvent);
        res.status(201).json({ success: true });
    } catch (error) {
        console.error("Ошибка при сохранении события:", error);
        res.status(500).json({ success: false });
    }
});

app.post('/api/news', authMiddleware, requireAdmin, async (req, res) => {
    const { title, text, image } = req.body || {};

    if (!title || !text) {
        return res.status(400).json({ message: 'Заголовок и текст новости обязательны' });
    }

    try {
        const db = getDB();
        if (!db) {
            return res.status(503).json({ message: 'База данных недоступна' });
        }

        const usersCollection = db.collection('users');
        const newsCollection = db.collection('news');

        const user = await usersCollection.findOne({ _id: new ObjectId(req.user.userId) });
        if (!user) {
            return res.status(404).json({ message: 'Пользователь не найден' });
        }

        const doc = {
            title: String(title).trim(),
            text: String(text).trim(),
            imageUrl: typeof image === 'string' ? image : '',
            authorId: user._id,
            authorName: user.name || user.email || 'Автор',
            createdAt: new Date()
        };

        const result = await newsCollection.insertOne(doc);

        // Запись события создания новости
        try {
            const sessionId = req.body?.sessionId || req.headers['x-session-id'] || 'unknown';
            await db.collection('userevents').insertOne({
                userId: new ObjectId(req.user.userId),
                sessionId: sessionId,
                eventType: 'news_created',
                eventData: { newsId: result.insertedId, newsTitle: title },
                createdAt: new Date()
            });
        } catch (err) {
            console.error('Ошибка записи события создания новости:', err);
        }
        // Запись события создания новости
        await db.collection('userevents').insertOne({
            userId: new ObjectId(req.user.userId),
            sessionId: req.body.sessionId || 'unknown',
            eventType: 'news_created',
            eventData: { newsId: result.insertedId, newsTitle: title },
            createdAt: new Date()
        });
        const created = await newsCollection.findOne({ _id: result.insertedId });

        res.status(201).json({
            message: 'Новость создана',
            news: mapNewsForClient(created)
        });
    } catch (err) {
        console.error('❌ Ошибка создания новости:', err);
        res.status(500).json({ message: 'Ошибка сервера' });
    }
});

app.delete('/api/news/:id', authMiddleware, async (req, res) => {
    const newsId = req.params.id;

    try {
        const db = getDB();
        if (!db) {
            return res.status(503).json({ message: 'База данных недоступна' });
        }

        const newsCollection = db.collection('news');
        const doc = await newsCollection.findOne({ _id: new ObjectId(newsId) });
        if (!doc) {
            return res.status(404).json({ message: 'Новость не найдена' });
        }

        // Удалять может автор или администратор
        if (
            req.user.role !== 'ADMIN' &&
            (!doc.authorId || doc.authorId.toString() !== req.user.userId)
        ) {
            return res.status(403).json({ message: 'Нет прав для удаления этой новости' });
        }

        await newsCollection.deleteOne({ _id: doc._id });

        // Запись события удаления новости
        try {
            const sessionId = req.body?.sessionId || req.headers['x-session-id'] || 'unknown';
            await db.collection('userevents').insertOne({
                userId: new ObjectId(req.user.userId),
                sessionId: sessionId,
                eventType: 'news_deleted',
                eventData: { newsId: req.params.id },
                createdAt: new Date()
            });
        } catch (err) {
            console.error('Ошибка записи события удаления новости:', err);
        }

        res.json({ message: 'Новость удалена' });
        // Запись события удаления новости
        await db.collection('userevents').insertOne({
            userId: new ObjectId(req.user.userId),
            sessionId: req.body.sessionId || 'unknown',
            eventType: 'news_deleted',
            eventData: { newsId: req.params.id },
            createdAt: new Date()
        });
    } catch (err) {
        console.error('❌ Ошибка удаления новости:', err);
        res.status(500).json({ message: 'Ошибка сервера' });
    }
});

// === СООБЩЕСТВО (API) ===

function mapCommunityPostForClient(doc) {
    return {
        id: doc._id.toString(),
        userId: doc.userId ? doc.userId.toString() : null,
        userName: doc.userName || 'Пользователь',
        userAvatar: doc.userAvatar || '',
        text: doc.text || '',
        media: doc.media || null,
        date:
            doc.createdAt &&
            new Date(doc.createdAt).toLocaleString('ru-RU', {
                hour: '2-digit',
                minute: '2-digit',
                day: 'numeric',
                month: 'short'
            }),
        likes: doc.likes || [],
        comments: (doc.comments || []).map(c => ({
            userId: c.userId ? c.userId.toString() : null,
            userName: c.userName || 'Пользователь',
            userAvatar: c.userAvatar || '',
            text: c.text || '',
            date: c.createdAt ? new Date(c.createdAt).getTime() : Date.now()
        }))
    };
}

app.get('/api/community/posts', async (req, res) => {
    try {
        const db = getDB();
        if (!db) {
            return res.status(503).json({ message: 'База данных недоступна' });
        }

        const postsCollection = db.collection('community_posts');
        const docs = await postsCollection
            .find({})
            .sort({ createdAt: -1 })
            .toArray();

        res.json({ posts: docs.map(mapCommunityPostForClient) });
    } catch (err) {
        console.error('❌ Ошибка получения постов сообщества:', err);
        res.status(500).json({ message: 'Ошибка сервера' });
    }
});

app.post('/api/community/posts', authMiddleware, async (req, res) => {
    const { text, media } = req.body || {};

    if (!text && (!media || !media.src)) {
        return res.status(400).json({ message: 'Пост не может быть пустым' });
    }

    try {
        const db = getDB();
        if (!db) {
            return res.status(503).json({ message: 'База данных недоступна' });
        }

        const usersCollection = db.collection('users');
        const postsCollection = db.collection('community_posts');

        const user = await usersCollection.findOne({ _id: new ObjectId(req.user.userId) });
        if (!user) {
            return res.status(404).json({ message: 'Пользователь не найден' });
        }

        const doc = {
            userId: user._id,
            userName: user.name || user.email || 'Пользователь',
            userAvatar: user.avatarUrl || '',
            text: String(text || '').trim(),
            media: media || null,
            createdAt: new Date(),
            likes: [],
            comments: []
        };

        const result = await postsCollection.insertOne(doc);

        // Запись события создания поста
        try {
            const sessionId = req.body?.sessionId || req.headers['x-session-id'] || 'unknown';
            await db.collection('userevents').insertOne({
                userId: new ObjectId(req.user.userId),
                sessionId: sessionId,
                eventType: 'post_created',
                eventData: { postId: result.insertedId, postText: (text || '').substring(0, 100) },
                createdAt: new Date()
            });
        } catch (err) {
            console.error('Ошибка записи события создания поста:', err);
        }
        // Запись события создания поста
        await db.collection('userevents').insertOne({
            userId: new ObjectId(req.user.userId),
            sessionId: req.body.sessionId || 'unknown',
            eventType: 'post_created',
            eventData: { postId: result.insertedId, postText: (text || '').substring(0, 100) },
            createdAt: new Date()
        });
        const created = await postsCollection.findOne({ _id: result.insertedId });

        // Проверяем достижения
        await checkAchievements(req.user.userId);

        res.status(201).json({
            message: 'Пост создан',
            post: mapCommunityPostForClient(created)
        });
    } catch (err) {
        console.error('❌ Ошибка создания поста сообщества:', err);
        res.status(500).json({ message: 'Ошибка сервера' });
    }
});

app.post('/api/community/posts/:id/like', authMiddleware, async (req, res) => {
    const postId = req.params.id;

    try {
        if (!ObjectId.isValid(postId)) {
            return res.status(400).json({ message: 'Некорректный идентификатор поста' });
        }

        const db = getDB();
        if (!db) {
            return res.status(503).json({ message: 'База данных недоступна' });
        }

        const postsCollection = db.collection('community_posts');
        const post = await postsCollection.findOne({ _id: new ObjectId(postId) });
        if (!post) {
            return res.status(404).json({ message: 'Пост не найден' });
        }

        const userId = req.user.userId;
        const hasLike = (post.likes || []).some(id => id.toString() === userId);

        await postsCollection.updateOne(
            { _id: post._id },
            hasLike
                ? { $pull: { likes: new ObjectId(userId) } }
                : { $addToSet: { likes: new ObjectId(userId) } }
        );

        // Запись события комментария
        try {
            const sessionId = req.body?.sessionId || req.headers['x-session-id'] || 'unknown';
            await db.collection('userevents').insertOne({
                userId: new ObjectId(req.user.userId),
                sessionId: sessionId,
                eventType: 'comment_created',
                eventData: { postId: postId, commentText: (text || '').substring(0, 100) },
                createdAt: new Date()
            });
        } catch (err) {
            console.error('Ошибка записи события комментария:', err);
        }

        const updated = await postsCollection.findOne({ _id: post._id });
        res.json({
            message: hasLike ? 'Лайк удалён' : 'Лайк добавлен',
            post: mapCommunityPostForClient(updated)
        });
    } catch (err) {
        console.error('❌ Ошибка лайка поста сообщества:', err);
        res.status(500).json({ message: 'Ошибка сервера' });
    }
});

app.post('/api/community/posts/:id/comment', authMiddleware, async (req, res) => {
    const postId = req.params.id;
    const { text } = req.body || {};

    if (!text) {
        return res.status(400).json({ message: 'Текст комментария обязателен' });
    }

    try {
        if (!ObjectId.isValid(postId)) {
            return res.status(400).json({ message: 'Некорректный идентификатор поста' });
        }

        const db = getDB();
        if (!db) {
            return res.status(503).json({ message: 'База данных недоступна' });
        }

        const usersCollection = db.collection('users');
        const postsCollection = db.collection('community_posts');

        const user = await usersCollection.findOne({ _id: new ObjectId(req.user.userId) });
        if (!user) {
            return res.status(404).json({ message: 'Пользователь не найден' });
        }

        const comment = {
            userId: user._id,
            userName: user.name || user.email || 'Пользователь',
            userAvatar: user.avatarUrl || '',
            text: String(text).trim(),
            createdAt: new Date()
        };

        await postsCollection.updateOne(
            { _id: new ObjectId(postId) },
            { $push: { comments: comment } }
        );

        // Запись события комментария
        await db.collection('userevents').insertOne({
            userId: new ObjectId(req.user.userId),
            sessionId: req.body.sessionId || 'unknown',
            eventType: 'comment_created',
            eventData: { postId: postId, commentText: (text || '').substring(0, 100) },
            createdAt: new Date()
        });

        const updated = await postsCollection.findOne({ _id: new ObjectId(postId) });
        res.status(201).json({
            message: 'Комментарий добавлен',
            post: mapCommunityPostForClient(updated)
        });
    } catch (err) {
        console.error('❌ Ошибка добавления комментария к посту сообщества:', err);
        res.status(500).json({ message: 'Ошибка сервера' });
    }
});

app.delete('/api/community/posts/:id', authMiddleware, async (req, res) => {
    const postId = req.params.id;

    try {
        if (!ObjectId.isValid(postId)) {
            return res.status(400).json({ message: 'Некорректный идентификатор поста' });
        }

        const db = getDB();
        if (!db) {
            return res.status(503).json({ message: 'База данных недоступна' });
        }

        const postsCollection = db.collection('community_posts');
        const post = await postsCollection.findOne({ _id: new ObjectId(postId) });
        if (!post) {
            return res.status(404).json({ message: 'Пост не найден' });
        }

        if (
            req.user.role !== 'ADMIN' &&
            (!post.userId || post.userId.toString() !== req.user.userId)
        ) {
            return res.status(403).json({ message: 'Нет прав для удаления этого поста' });
        }

        await postsCollection.deleteOne({ _id: post._id });
        // Запись события удаления поста
        try {
            const sessionId = req.body?.sessionId || req.headers['x-session-id'] || 'unknown';
            await db.collection('userevents').insertOne({
                userId: new ObjectId(req.user.userId),
                sessionId: sessionId,
                eventType: 'post_deleted',
                eventData: { postId: req.params.id },
                createdAt: new Date()
            });
        } catch (err) {
            console.error('Ошибка записи события удаления поста:', err);
        }
        res.json({ message: 'Пост удалён' });
        // Запись события удаления поста
        await db.collection('userevents').insertOne({
            userId: new ObjectId(req.user.userId),
            sessionId: req.body.sessionId || 'unknown',
            eventType: 'post_deleted',
            eventData: { postId: req.params.id },
            createdAt: new Date()
        });

    } catch (err) {
        console.error('❌ Ошибка удаления поста сообщества:', err);
        res.status(500).json({ message: 'Ошибка сервера' });
    }
});

// === СИСТЕМА ДОСТИЖЕНИЙ ===

// Определение всех доступных достижений
const ACHIEVEMENTS = [
    {
        id: 'reg',
        name: 'Первый шаг',
        icon: '🌱',
        desc: 'Выдаётся каждому участнику за присоединение к сообществу Доброе_дело.by.',
        xpReward: 0,
        condition: (user, stats) => true // Всегда разблокировано
    },
    {
        id: 'profile',
        name: 'В деталях',
        icon: '📝',
        desc: 'Заполните город и телефон в профиле, чтобы организаторы могли быстрее связаться с вами.',
        xpReward: 20,
        condition: (user, stats) => !!(user.city && user.phone)
    },
    {
        id: 'avatar',
        name: 'Узнаваемый',
        icon: '📸',
        desc: 'Загрузите свой аватар, чтобы другие участники могли вас узнать.',
        xpReward: 15,
        condition: (user, stats) => !!(user.avatarUrl && user.avatarUrl.length > 0)
    },
    {
        id: 'first_project',
        name: 'Новичок',
        icon: '🎯',
        desc: 'Откликнитесь на свой первый волонтёрский проект.',
        xpReward: 25,
        condition: (user, stats) => stats.completedProjects >= 1
    },
    {
        id: 'hero',
        name: 'Герой города',
        icon: '🏙️',
        desc: 'Успешно завершите 5 волонтерских проектов.',
        xpReward: 50,
        condition: (user, stats) => stats.completedProjects >= 5
    },
    {
        id: 'veteran',
        name: 'Ветеран добра',
        icon: '🎖️',
        desc: 'Примите участие в 10 волонтёрских проектах.',
        xpReward: 100,
        condition: (user, stats) => stats.completedProjects >= 10
    },
    {
        id: 'legend',
        name: 'Легенда',
        icon: '👑',
        desc: 'Невероятно! Вы участвовали в 25 проектах!',
        xpReward: 250,
        condition: (user, stats) => stats.completedProjects >= 25
    },
    {
        id: 'xp_100',
        name: 'Начинающий',
        icon: '💫',
        desc: 'Наберите 100 баллов опыта.',
        xpReward: 30,
        condition: (user, stats) => user.points >= 100
    },
    {
        id: 'xp_500',
        name: 'Звезда добра',
        icon: '⭐',
        desc: 'Наберите 500 баллов опыта, помогая другим.',
        xpReward: 100,
        condition: (user, stats) => user.points >= 500
    },
    {
        id: 'xp_1000',
        name: 'Мастер добра',
        icon: '🌟',
        desc: 'Достигните 1000 баллов опыта!',
        xpReward: 200,
        condition: (user, stats) => user.points >= 1000
    },
    {
        id: 'social',
        name: 'Общительный',
        icon: '💬',
        desc: 'Создайте свой первый пост в сообществе.',
        xpReward: 20,
        condition: (user, stats) => stats.postsCreated >= 1
    },
    {
        id: 'influencer',
        name: 'Лидер мнений',
        icon: '📢',
        desc: 'Создайте 5 постов в сообществе.',
        xpReward: 75,
        condition: (user, stats) => stats.postsCreated >= 5
    }
];

// Функция проверки и разблокировки достижений
async function checkAchievements(userId) {
    try {
        const db = getDB();
        if (!db) return;

        const usersCollection = db.collection('users');
        const applicationsCollection = db.collection('project_applications');
        const postsCollection = db.collection('community_posts');

        const user = await usersCollection.findOne({ _id: new ObjectId(userId) });
        if (!user) return;

        // Инициализируем массив достижений, если его нет
        if (!user.achievements) {
            user.achievements = [];
        }

        // Получаем статистику пользователя
        const completedProjects = await applicationsCollection.countDocuments({
            userId: new ObjectId(userId),
            status: 'ACTIVE'
        });

        const postsCreated = await postsCollection.countDocuments({
            userId: new ObjectId(userId)
        });

        const stats = { completedProjects, postsCreated };

        let totalXpEarned = 0;
        const newAchievements = [];

        // Проверяем каждое достижение
        for (const achievement of ACHIEVEMENTS) {
            const alreadyUnlocked = user.achievements.some(a => a.id === achievement.id);

            if (!alreadyUnlocked && achievement.condition(user, stats)) {
                // Разблокируем достижение
                newAchievements.push({
                    id: achievement.id,
                    unlockedAt: new Date()
                });
                totalXpEarned += achievement.xpReward;
                console.log(`✨ Пользователь ${user.name} разблокировал достижение: ${achievement.name}`);
            }
        }

        // Обновляем пользователя, если есть новые достижения
        if (newAchievements.length > 0) {
            await usersCollection.updateOne(
                { _id: user._id },
                {
                    $push: { achievements: { $each: newAchievements } },
                    $inc: { points: totalXpEarned }
                }
            );
        }

        return newAchievements;
    } catch (err) {
        console.error('❌ Ошибка проверки достижений:', err);
        return [];
    }
}

// === ЭНДПОИНТ ЛИДЕРБОРДА ===
app.get('/api/community/leaderboard', async (req, res) => {
    try {
        const db = getDB();
        if (!db) {
            return res.status(503).json({ message: 'База данных недоступна' });
        }

        const usersCollection = db.collection('users');

        // Получаем всех пользователей, сортируем по очкам (те, у кого нет поля, будут внизу)
        const topUsers = await usersCollection
            .find({})
            .sort({ points: -1, _id: 1 })
            .limit(100)
            .toArray();

        const leaderboard = topUsers.map(user => ({
            id: user._id.toString(),
            name: user.name || user.username || 'Пользователь',
            avatarUrl: user.avatarUrl || '',
            points: Number(user.points) || 0
        }));

        const totalInDb = await usersCollection.countDocuments();
        console.log(`📊 Лидерборд: отправлено ${leaderboard.length} пользователей (всего в базе: ${totalInDb})`);

        res.json({ leaderboard });
    } catch (err) {
        console.error('❌ Ошибка получения лидерборда:', err);
        res.status(500).json({ message: 'Ошибка сервера' });
    }
});

// === ЭНДПОИНТ ДОСТИЖЕНИЙ ПОЛЬЗОВАТЕЛЯ ===
app.get('/api/achievements/:userId', async (req, res) => {
    try {
        const db = getDB();
        if (!db) {
            return res.status(503).json({ message: 'База данных недоступна' });
        }

        const userId = req.params.userId;
        if (!ObjectId.isValid(userId)) {
            return res.status(400).json({ message: 'Некорректный ID пользователя' });
        }

        const usersCollection = db.collection('users');
        const applicationsCollection = db.collection('project_applications');
        const postsCollection = db.collection('community_posts');

        const user = await usersCollection.findOne({ _id: new ObjectId(userId) });
        if (!user) {
            return res.status(404).json({ message: 'Пользователь не найден' });
        }

        // Получаем статистику
        const completedProjects = await applicationsCollection.countDocuments({
            userId: new ObjectId(userId),
            status: 'ACTIVE'
        });

        const postsCreated = await postsCollection.countDocuments({
            userId: new ObjectId(userId)
        });

        const stats = { completedProjects, postsCreated };
        const userAchievements = user.achievements || [];

        // Формируем список всех достижений с их статусом
        const achievementsWithStatus = ACHIEVEMENTS.map(achievement => {
            const unlocked = userAchievements.some(a => a.id === achievement.id);
            const unlockedData = userAchievements.find(a => a.id === achievement.id);

            // Вычисляем прогресс
            let progress = 0;
            if (achievement.id === 'first_project' || achievement.id === 'hero' || achievement.id === 'veteran' || achievement.id === 'legend') {
                const targets = { first_project: 1, hero: 5, veteran: 10, legend: 25 };
                progress = Math.min((stats.completedProjects / (targets[achievement.id] || 1)) * 100, 100);
            } else if (achievement.id === 'xp_100' || achievement.id === 'xp_500' || achievement.id === 'xp_1000') {
                const targets = { xp_100: 100, xp_500: 500, xp_1000: 1000 };
                progress = Math.min(((user.points || 0) / (targets[achievement.id] || 1)) * 100, 100);
            } else if (achievement.id === 'social' || achievement.id === 'influencer') {
                const targets = { social: 1, influencer: 5 };
                progress = Math.min((stats.postsCreated / (targets[achievement.id] || 1)) * 100, 100);
            } else if (unlocked) {
                progress = 100;
            }

            return {
                id: achievement.id,
                name: achievement.name,
                icon: achievement.icon,
                desc: achievement.desc,
                xpReward: achievement.xpReward,
                unlocked,
                unlockedAt: unlockedData?.unlockedAt || null,
                progress: Math.round(progress)
            };
        });

        res.json({ achievements: achievementsWithStatus });
    } catch (err) {
        console.error('❌ Ошибка получения достижений:', err);
        res.status(500).json({ message: 'Ошибка сервера' });
    }
});


// Обновление статуса "в сети" без перезагрузки сессии
// Это остается в server.js
app.post('/api/user/ping', authMiddleware, async (req, res) => {
    try {
        const db = getDB();
        await db.collection('users').updateOne(
            { _id: req.user._id },
            { $set: { lastLogin: new Date() } }
        );
        res.sendStatus(200);
    } catch (err) {
        res.status(500).send();
    }
});

async function sendPing() {
    const token = localStorage.getItem('token');
    if (!token) return;

    try {
        await fetch('/api/user/ping', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${token}` }
        });
    } catch (e) {
        console.log('Ping lost');
    }
}

// Добавь это в server.js
app.post('/api/user/update-activity', authMiddleware, async (req, res) => {
    try {
        const db = getDB();
        await db.collection('users').updateOne(
            { _id: req.user._id },
            { $set: { lastLogin: new Date() } }
        );
        res.sendStatus(200);
    } catch (err) {
        res.status(500).send();
    }
});

// Обработка закрытия вкладки (Beacon)
app.post('/api/user/logout-ping', async (req, res) => {
    try {
        // В Beacon API сложнее прокинуть authMiddleware,
        // поэтому здесь мы просто гасим статус последнего активного (опционально)
        // Но проще всего дождаться истечения 3-х минут в админке.
        res.sendStatus(200);
    } catch (err) {
        res.sendStatus(500);
    }
});

// Твой основной роут (убедись, что он такой)
app.post('/api/user/update-activity', authMiddleware, async (req, res) => {
    const db = getDB();
    await db.collection('users').updateOne(
        { _id: req.user._id },
        { $set: { lastLogin: new Date() } }
    );
    res.sendStatus(200);
});

app.post('/api/track', async (req, res) => {
    try {
        const db = getDB(); // Убедись, что функция получения БД называется так
        const { eventType, eventData, path, sessionId } = req.body;

        // Создаем запись в коллекции user_events
        const newEvent = {
            eventType: eventType || 'unknown',
            eventData: eventData || {},
            path: path || '',
            sessionId: sessionId || 'guest',
            createdAt: new Date() // Важно для фильтрации в Хабе!
        };

        await db.collection('user_events').insertOne(newEvent);

        // Отправляем пустой успешный ответ
        res.status(200).json({ success: true });

        // Для отладки в терминале WebStorm:
        console.log(`[METRIKA] Событие: ${eventType} на пути: ${path}`);

    } catch (error) {
        console.error("Ошибка сохранения метрики:", error);
        res.status(500).json({ success: false });
    }
});

// === ЗАПУСК СЕРВЕРА (ГИБРИДНЫЙ: NATIVE + MONGOOSE) ===
async function startServer() {
    try {
        console.log('⏳ Запуск систем Dobroe Delo...');

        // 1. Подключаем старый Native Driver (через твой db.js)
        await connectDB();
        console.log('✓ База данных (Native Driver) готова');

        // 2. Подключаем Mongoose (специально для маркетинга и аналитики)
        // Используем MONGODB_URI из твоего .env
        const dbUri = process.env.MONGODB_URI || 'mongodb://localhost:27017/auth_system';
        await mongoose.connect(dbUri);
        console.log('✓ Система аналитики (Mongoose) подключена');

        // 3. Миграция: Проверяем, что у всех пользователей есть поле points
        const db = getDB();
        if (db) {
            const usersCollection = db.collection('users');
            const result = await usersCollection.updateMany(
                { points: { $exists: false } },
                { $set: { points: 0 } }
            );
            if (result.modifiedCount > 0) {
                console.log(`🛠️ Миграция: Обновлено ${result.modifiedCount} пользователей`);
            }
        }
        // Роут для получения РЕАЛЬНОЙ статистики в админку
        // Обновленный роут статистики

        const ErrorLog = require('./models/ErrorLog');

// Глобальный обработчик ошибок
        app.use(async (err, req, res, next) => {
            try {
                await ErrorLog.create({
                    message: err.message,
                    stack: err.stack,
                    url: req.originalUrl,
                    method: req.method,
                    ip: req.ip,
                    userId: req.user?._id
                });
            } catch (logErr) { console.error('Failed to log error', logErr); }
            res.status(500).json({ error: 'Внутренняя ошибка сервера' });
        });

        // 4. Запуск прослушивания порта
        app.listen(PORT, () => {
            console.log(`🚀 Server running on http://localhost:${PORT}`);
        });
    } catch (err) {
        console.error('❌ Критическая ошибка при запуске сервера:', err);
        process.exit(1);
    }
}

startServer();