require('dotenv').config();
const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const { getDB, connectDB } = require('./db');
const { ObjectId } = require('mongodb');

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

app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use((req, res, next) => {
    const origin = req.headers.origin;
    if (allowedOrigins.includes('*') || (origin && allowedOrigins.includes(origin))) {
        res.header('Access-Control-Allow-Origin', origin || '*');
    }
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    if (req.method === 'OPTIONS') {
        return res.sendStatus(200);
    }
    next();
});

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

// === ГЛАВНЫЕ FRONTEND-МАРШРУТЫ (SPA без #) ===
const FRONTEND_ROUTES = ['/', '/projects', '/community', '/news', '/about', '/contacts', '/cabinet'];

FRONTEND_ROUTES.forEach(route => {
    app.get(route, (req, res) => {
        res.sendFile(path.join(__dirname, 'public', 'index1.html'));
    });
});

// === РЕГИСТРАЦИЯ ===
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
            created_at: new Date()
        };

        const result = await usersCollection.insertOne(newUser);

        console.log('✓ Создан пользователь ID:', result.insertedId);

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
        const applicationsCollection = db.collection('project_applications');

        const project = await projectsCollection.findOne({ _id: new ObjectId(projectId), status: { $ne: 'DELETED' } });
        if (!project) {
            return res.status(404).json({ message: 'Проект не найден' });
        }

        // Проверка на уникальность отклика
        const existing = await applicationsCollection.findOne({
            projectId: project._id,
            userId: new ObjectId(req.user.userId),
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

        await projectsCollection.updateOne(
            { _id: project._id },
            { $inc: { responsesCount: 1 } }
        );

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

        const apps = await applicationsCollection
            .find({
                userId: new ObjectId(req.user.userId),
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

        const appDoc = await applicationsCollection.findOne({
            _id: new ObjectId(appId),
            userId: new ObjectId(req.user.userId)
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

        // Попробуем уменьшить счётчик откликов у проекта
        await projectsCollection.updateOne(
            { _id: appDoc.projectId },
            { $inc: { responsesCount: -1 } }
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

        await projectsCollection.updateOne(
            { _id: project._id },
            { $set: { status: 'DELETED', deletedAt: new Date() } }
        );

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

// === ЗАПУСК СЕРВЕРА ===
async function startServer() {
    try {
        // Ждём подключения к базе данных перед запуском сервера
        console.log('⏳ Ожидание подключения к MongoDB...');
        await connectDB();
        console.log('✓ База данных готова');

        app.listen(PORT, () => {
            console.log(`✓ Server running on http://localhost:${PORT}`);
        });
    } catch (err) {
        console.error('❌ Ошибка запуска сервера:', err);
        process.exit(1);
    }
}

startServer();
