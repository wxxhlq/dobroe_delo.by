const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const userRepository = require('../repositories/UserRepository');
const GamificationService = require('./GamificationService');

const ACCESS_TOKEN_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '15m';
const REFRESH_TOKEN_SECRET = process.env.REFRESH_TOKEN_SECRET || 'supersecret_refresh_key_123';
const REFRESH_TOKEN_EXPIRES_IN = process.env.REFRESH_TOKEN_EXPIRES_IN || '7d';

class AuthService {
    async register(userData) {
        const { username, password, email, role, name, city, phone, organizationName, organizationType, verificationDocuments } = userData;
        if (!email || !password || !name) throw new Error('Email, пароль и имя обязательны');
        
        const existing = await userRepository.findByEmail(email);
        if (existing) throw new Error('Пользователь с таким email уже существует');

        const password_hash = await bcrypt.hash(password, 10);
        
        // Определяем роль и статус верификации
        const userRole = (role && role.toUpperCase() === 'ORGANIZER') ? 'ORGANIZER' : 'VOLUNTEER';
        
        const newUser = {
            username: username || email.split('@')[0],
            email: email.toLowerCase(),
            password_hash: password_hash,
            name: name || '',
            role: userRole,
            city: city || '',
            phone: phone || '',
            points: 0,
            avatarUrl: '',
            privacy: 'public',
            achievements: [],
            isBlocked: false,
            created_at: new Date()
        };

        // Если организатор — добавляем данные верификации
        if (userRole === 'ORGANIZER') {
            newUser.verificationStatus = 'PENDING';
            newUser.organizationName = organizationName || '';
            newUser.organizationType = organizationType || '';
            newUser.verificationDocuments = verificationDocuments || '';
        } else {
            newUser.verificationStatus = 'NONE';
        }

        const user = await userRepository.createUser(newUser);
        await GamificationService.checkAchievements(user._id.toString());

        const token = this.generateAccessToken(user);
        const refreshToken = this.generateRefreshToken(user);

        return {
            userId: user._id,
            token,
            refreshToken,
            user: this.mapUser(user)
        };
    }

    async login(email, password) {
        const user = await userRepository.findByEmail(email);
        if (!user) throw new Error('Неверный email или пароль');

        // Проверка блокировки
        if (user.isBlocked) {
            throw new Error('Ваш аккаунт заблокирован. Обратитесь к администратору.');
        }

        const isValid = await bcrypt.compare(password, user.password_hash);
        if (!isValid) throw new Error('Неверный email или пароль');

        await userRepository.updateLastLogin(user._id);

        const token = this.generateAccessToken(user);
        const refreshToken = this.generateRefreshToken(user);

        return {
            token,
            refreshToken,
            user: this.mapUser(user)
        };
    }

    async socialLogin(profileData) {
        const { email, name, username, avatarUrl, phone } = profileData;
        if (!email) throw new Error('Email обязателен для авторизации');

        let user = await userRepository.findByEmail(email);
        if (!user) {
            // Создаем нового пользователя через соцсеть
            const randomPassword = Math.random().toString(36).slice(-10);
            const password_hash = await bcrypt.hash(randomPassword, 10);
            
            const newUser = {
                username: username || email.split('@')[0],
                email: email.toLowerCase(),
                password_hash: password_hash,
                name: name || 'Пользователь из соцсети',
                role: 'VOLUNTEER',
                verificationStatus: 'NONE',
                city: '',
                phone: phone || '',
                points: 0,
                avatarUrl: avatarUrl || '',
                privacy: 'public',
                achievements: [],
                isBlocked: false,
                created_at: new Date()
            };
            user = await userRepository.createUser(newUser);
            await GamificationService.checkAchievements(user._id.toString());
        } else {
            // Проверка блокировки
            if (user.isBlocked) {
                throw new Error('Ваш аккаунт заблокирован. Обратитесь к администратору.');
            }
            await userRepository.updateLastLogin(user._id);
        }

        const token = this.generateAccessToken(user);
        const refreshToken = this.generateRefreshToken(user);

        return {
            token,
            refreshToken,
            user: this.mapUser(user)
        };
    }

    mapUser(user) {
        return {
            id: user._id,
            username: user.username,
            email: user.email,
            name: user.name,
            role: user.role,
            city: user.city,
            phone: user.phone,
            avatarUrl: user.avatarUrl || '',
            points: user.points || 0,
            verificationStatus: user.verificationStatus || 'NONE',
            organizationName: user.organizationName || '',
            isBlocked: user.isBlocked || false
        };
    }

    generateAccessToken(user) {
        return jwt.sign(
            { userId: user._id.toString(), email: user.email, role: user.role },
            process.env.JWT_SECRET || 'supersecret_jwt_key_123',
            { expiresIn: ACCESS_TOKEN_EXPIRES_IN }
        );
    }

    generateRefreshToken(user) {
        return jwt.sign(
            { userId: user._id.toString() },
            REFRESH_TOKEN_SECRET,
            { expiresIn: REFRESH_TOKEN_EXPIRES_IN }
        );
    }
}

module.exports = new AuthService();
