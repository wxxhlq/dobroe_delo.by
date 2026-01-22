require('dotenv').config();
const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const path = require('path');
const { getDB } = require('./db');
const { ObjectId } = require('mongodb');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    if (req.method === 'OPTIONS') {
        return res.sendStatus(200);
    }
    next();
});

app.use(express.static(path.join(__dirname, 'public')));

setTimeout(() => {
    app.listen(PORT, () => {
        console.log(`✓ Server running on http://localhost:${PORT}`);
    });
}, 2000);

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
            privacy: 'public',
            created_at: new Date()
        };

        const result = await usersCollection.insertOne(newUser);

        console.log('✓ Создан пользователь ID:', result.insertedId);

        // Создать JWT сразу после регистрации
        const token = jwt.sign(
            {
                userId: result.insertedId.toString(),
                email: newUser.email,
                role: newUser.role
            },
            process.env.JWT_SECRET,
            { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
        );

        res.status(201).json({
            message: 'Пользователь зарегистрирован',
            userId: result.insertedId,
            token,
            user: {
                id: result.insertedId,
                username: newUser.username,
                email: newUser.email,
                name: newUser.name,
                role: newUser.role,
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

        // Создание JWT
        const token = jwt.sign(
            {
                userId: user._id.toString(),
                email: user.email,
                role: user.role
            },
            process.env.JWT_SECRET,
            { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
        );

        console.log('✓ Логин успешен');

        res.json({
            token,
            user: {
                id: user._id,
                username: user.username,
                email: user.email,
                name: user.name,
                role: user.role,
                city: user.city,
                phone: user.phone,
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
        const { name, city, phone, privacy, notifications } = req.body;
        const db = getDB();
        const usersCollection = db.collection('users');

        const updateData = {};
        if (name) updateData.name = name;
        if (city) updateData.city = city;
        if (phone) updateData.phone = phone;
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

        res.json({
            message: 'Профиль обновлён',
            user: {
                id: updatedUser._id,
                username: updatedUser.username,
                email: updatedUser.email,
                name: updatedUser.name,
                role: updatedUser.role,
                city: updatedUser.city,
                phone: updatedUser.phone,
                privacy: updatedUser.privacy,
                points: updatedUser.points || 0
            }
        });
    } catch (err) {
        console.error('❌ Ошибка обновления профиля:', err);
        res.status(500).json({ message: 'Ошибка сервера' });
    }
});

// === ПРОВЕРКА СЕССИИ ===
app.get('/check-session', authMiddleware, async (req, res) => {
    try {
        const db = getDB();
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
                points: user.points || 0
            }
        });
    } catch (err) {
        res.status(401).json({ valid: false });
    }
});
