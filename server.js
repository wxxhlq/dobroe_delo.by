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

// === ЗАГРУЗКА АВАТАРА ===
const AVATARS_DIR = path.join(__dirname, 'public', 'uploads', 'avatars');
fs.mkdirSync(AVATARS_DIR, { recursive: true });

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

// === ГЛАВНАЯ СТРАНИЦА ===
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index1.html'));
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
