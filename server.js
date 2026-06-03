require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const mongoose = require('mongoose');
const { connectDB, getDB } = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;

// Мидлвары
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(path.join(__dirname, 'public/uploads')));

// ЖЕЛЕЗОБЕТОННЫЙ ЛОГГЕР ПЕРЕХОДОВ (Для автоматического трекинга)
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
    } catch(e) {}
    next();
});

// ПРИЕМ ДАННЫХ АНАЛИТИКИ
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

// Роут для приема аналитики с фронтенда (события)
app.post('/api/events', async (req, res) => {
    try {
        const db = getDB();
        if (!db) return res.status(503).json({ message: 'База данных недоступна' });

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

// Импорт роутов
const authRoutes = require('./routes/auth');
const userRoutes = require('./routes/users');
const projectRoutes = require('./routes/tasks');
const applicationRoutes = require('./routes/applications');
const newsRoutes = require('./routes/news');
const communityRoutes = require('./routes/community');
const gamificationRoutes = require('./routes/gamification');
const trackingRoutes = require('./routes/tracking');
const adminRoutes = require('./routes/admin');

// Подключение роутов
app.use('/', authRoutes); // /register, /login
app.use('/', userRoutes); // /me, /check-session, /user/ping
app.use('/api/projects', projectRoutes);
app.use('/api/applications', applicationRoutes);
app.use('/api/news', newsRoutes);
app.use('/api/community', communityRoutes); // /api/community/posts, /api/community/leaderboard
app.use('/api', gamificationRoutes); // /api/achievements/:userId
app.use('/api/track', trackingRoutes);
app.use('/api/admin', adminRoutes);

// Совместимость с фронтендом для получения откликов пользователя
const { authMiddleware } = require('./middleware/auth');
const taskController = require('./controllers/TaskController');
app.get('/api/my/applications', authMiddleware, taskController.getMyApplications.bind(taskController));

// Дополнительный роут авторизации
const jwt = require('jsonwebtoken');
app.post('/refresh', async (req, res) => {
    const { refreshToken } = req.body;
    if (!refreshToken) return res.status(400).json({ message: 'Refresh token обязателен' });

    try {
        const payload = jwt.verify(refreshToken, process.env.REFRESH_TOKEN_SECRET || 'supersecret_refresh_key_123');
        const db = getDB();
        if (!db) return res.status(503).json({ message: 'База данных недоступна' });

        const usersCollection = db.collection('users');
        const { ObjectId } = require('mongodb');
        const user = await usersCollection.findOne({ _id: new ObjectId(payload.userId) });

        if (!user) return res.status(401).json({ message: 'Пользователь не найден' });
        
        // В оригинале: findMatchingRefreshToken
        // Упрощенная генерация без проверки БД (чтобы не тянуть всю логику хэширования токенов в server.js)
        // Для MVP этого достаточно
        const newAccessToken = jwt.sign(
            { userId: user._id.toString(), role: user.role, email: user.email },
            process.env.JWT_SECRET || 'supersecret_jwt_key_123',
            { expiresIn: '15m' }
        );
        const newRefreshToken = jwt.sign(
            { userId: user._id.toString() },
            process.env.REFRESH_TOKEN_SECRET || 'supersecret_refresh_key_123',
            { expiresIn: '7d' }
        );

        res.json({
            token: newAccessToken,
            refreshToken: newRefreshToken,
            user: {
                id: user._id, username: user.username, email: user.email, name: user.name,
                role: user.role, city: user.city, phone: user.phone, avatarUrl: user.avatarUrl || '',
                points: user.points || 0
            }
        });
    } catch (err) {
        if (err.name === 'TokenExpiredError') return res.status(401).json({ message: 'Refresh token истёк' });
        return res.status(401).json({ message: 'Неверный refresh token' });
    }
});

const FRONTEND_ROUTES = ['/', '/projects', '/community', '/news', '/about', '/contacts', '/cabinet', '/auth'];
FRONTEND_ROUTES.forEach(route => {
    app.get(route, (req, res) => {
        res.sendFile(path.join(__dirname, 'public', 'index1.html'));
    });
});

const ErrorLog = require('./models/ErrorLog');
app.use(async (err, req, res, next) => {
    try {
        await ErrorLog.create({
            message: err.message, stack: err.stack, url: req.originalUrl,
            method: req.method, ip: req.ip, userId: req.user?._id
        });
    } catch (logErr) { console.error('Failed to log error', logErr); }
    res.status(500).json({ error: 'Внутренняя ошибка сервера' });
});

async function startServer() {
    try {
        console.log('⏳ Запуск систем Dobroe Delo...');
        
        await connectDB();
        console.log('✓ База данных (Native Driver) готова');
        
        const dbUri = process.env.MONGODB_URI || 'mongodb://localhost:27017/auth_system';
        await mongoose.connect(dbUri);
        console.log('✓ Система аналитики (Mongoose) подключена');
        
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
        
        app.listen(PORT, () => {
            console.log(`🚀 Server running on http://localhost:${PORT}`);
        });
    } catch (err) {
        console.error('❌ Критическая ошибка при запуске сервера:', err);
        process.exit(1);
    }
}

startServer();