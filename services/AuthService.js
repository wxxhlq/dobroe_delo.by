const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const userRepository = require('../repositories/UserRepository');
const GamificationService = require('./GamificationService');
const emailService = require('./emailService');

const ACCESS_TOKEN_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '15m';
const REFRESH_TOKEN_SECRET = process.env.REFRESH_TOKEN_SECRET;
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
        
        const emailConfirmationToken = crypto.randomBytes(32).toString('hex');
        const emailConfirmationExpires = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 часа

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
            isEmailConfirmed: false,
            emailConfirmationToken,
            emailConfirmationExpires,
            isPhoneConfirmed: true, // Для регистрации по почте телефон по умолчанию подтвержден
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

        // Отправка письма подтверждения
        const confirmUrl = `http://localhost:3000/confirm-email?token=${emailConfirmationToken}`;
        await emailService.sendEmail({
            to: user.email,
            subject: 'Подтверждение регистрации на Доброе_дело.by',
            html: `
                <div style="font-family: sans-serif; padding: 20px; color: #2c3e50;">
                    <h2>Добро пожаловать, ${user.name}!</h2>
                    <p>Благодарим вас за регистрацию на платформе добрых дел <b>Dobroe_delo.by</b>.</p>
                    <p>Пожалуйста, подтвердите ваш адрес электронной почты, перейдя по ссылке:</p>
                    <p style="margin: 20px 0;">
                        <a href="${confirmUrl}" style="background: #4F46E5; color: white; padding: 12px 24px; border-radius: 8px; text-decoration: none; font-weight: bold;">Подтвердить email</a>
                    </p>
                    <p>Или скопируйте ссылку: <a href="${confirmUrl}">${confirmUrl}</a></p>
                    <p style="color: #7f8c8d; font-size: 12px; margin-top: 30px;">Ссылка действительна в течение 24 часов.</p>
                </div>
            `
        });
        console.log(`📧 [EMAIL CONFIRMATION MOCK] Ссылка для ${user.email}: ${confirmUrl}`);

        return {
            userId: user._id,
            emailConfirmationRequired: true,
            user: this.mapUser(user)
        };
    }

    async login(emailOrPhone, password) {
        let user;
        const trimmed = emailOrPhone.trim();
        // Проверяем, является ли ввод телефоном (например, содержит + или состоит только из цифр)
        const isPhone = trimmed.startsWith('+') || /^\d+$/.test(trimmed.replace(/[\s\-\(\)]/g, ''));
        
        if (isPhone) {
            const db = require('../db').getDB();
            user = await db.collection('users').findOne({ phone: trimmed });
            if (!user) throw new Error('Пользователь с таким номером телефона не найден');
        } else {
            user = await userRepository.findByEmail(trimmed);
            if (!user) throw new Error('Неверный email или пароль');
        }

        // Проверка блокировки
        if (user.isBlocked) {
            throw new Error('Ваш аккаунт заблокирован. Обратитесь к администратору.');
        }

        // Проверка подтверждения
        if (!isPhone && user.isEmailConfirmed === false) {
            throw new Error('Ваш email не подтвержден. Пожалуйста, подтвердите его по ссылке, отправленной на почту.');
        }
        if (isPhone && user.isPhoneConfirmed === false) {
            throw new Error('Ваш номер телефона не подтвержден. Пожалуйста, подтвердите его с помощью SMS-кода.');
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

    async registerPhone(userData) {
        const { username, password, phone, role, name } = userData;
        if (!phone || !password || !name) throw new Error('Телефон, пароль и имя обязательны');

        const db = require('../db').getDB();
        
        // Проверка уникальности телефона
        const existingPhone = await db.collection('users').findOne({ phone: phone.trim() });
        if (existingPhone) throw new Error('Пользователь с таким номером телефона уже существует');

        const password_hash = await bcrypt.hash(password, 10);
        const userRole = (role && role.toUpperCase() === 'ORGANIZER') ? 'ORGANIZER' : 'VOLUNTEER';

        // Генерируем 4-значный SMS-код
        const smsCode = Math.floor(1000 + Math.random() * 9000).toString(); // e.g. "5742"
        const smsCodeExpires = new Date(Date.now() + 5 * 60 * 1000); // 5 минут

        // Создаем совместимый уникальный email
        const digitsOnly = phone.replace(/\D/g, '');
        const mockEmail = `phone_${digitsOnly}@phone.dobroe_delo.by`;

        const newUser = {
            username: username || `user_${digitsOnly}`,
            email: mockEmail,
            password_hash,
            name,
            role: userRole,
            city: '',
            phone: phone.trim(),
            points: 0,
            avatarUrl: '',
            privacy: 'public',
            achievements: [],
            isBlocked: false,
            isEmailConfirmed: true, // Для регистрации по телефону email считается подтвержденным
            isPhoneConfirmed: false,
            smsCode,
            smsCodeExpires,
            created_at: new Date()
        };

        if (userRole === 'ORGANIZER') {
            newUser.verificationStatus = 'PENDING';
            newUser.organizationName = '';
            newUser.organizationType = '';
            newUser.verificationDocuments = '';
        } else {
            newUser.verificationStatus = 'NONE';
        }

        const user = await userRepository.createUser(newUser);
        await GamificationService.checkAchievements(user._id.toString());

        console.log(`📱 [SMS MOCK] Код подтверждения для телефона ${phone}: ${smsCode}`);

        return {
            userId: user._id,
            phone: user.phone,
            phoneConfirmationRequired: true,
            user: this.mapUser(user)
        };
    }

    async verifySms(phone, code) {
        if (!phone || !code) throw new Error('Телефон и код подтверждения обязательны');
        
        const db = require('../db').getDB();
        const user = await db.collection('users').findOne({ phone: phone.trim() });
        if (!user) throw new Error('Пользователь с таким номером телефона не найден');

        if (user.isPhoneConfirmed) {
            throw new Error('Телефон уже подтвержден');
        }

        if (user.smsCode !== code.trim()) {
            throw new Error('Неверный код подтверждения');
        }

        if (new Date() > new Date(user.smsCodeExpires)) {
            throw new Error('Срок действия кода подтверждения истек. Пожалуйста, запросите новый.');
        }

        // Подтверждаем телефон
        await db.collection('users').updateOne(
            { _id: user._id },
            { 
                $set: { isPhoneConfirmed: true },
                $unset: { smsCode: '', smsCodeExpires: '' }
            }
        );

        user.isPhoneConfirmed = true;
        const token = this.generateAccessToken(user);
        const refreshToken = this.generateRefreshToken(user);

        return {
            token,
            refreshToken,
            user: this.mapUser(user)
        };
    }

    async forgotPassword(email) {
        if (!email) throw new Error('Email обязателен');
        const user = await userRepository.findByEmail(email.trim());
        if (!user) {
            // Не выдаем существование пользователя из соображений безопасности
            return { success: true, message: 'Инструкции по восстановлению пароля отправлены на ваш email' };
        }

        const token = crypto.randomBytes(32).toString('hex');
        const expires = new Date(Date.now() + 60 * 60 * 1000); // 1 час

        const db = require('../db').getDB();
        await db.collection('users').updateOne(
            { _id: user._id },
            { 
                $set: { 
                    passwordResetToken: token,
                    passwordResetExpires: expires
                }
            }
        );

        const resetUrl = `http://localhost:3000/reset-password?token=${token}`;
        await emailService.sendEmail({
            to: user.email,
            subject: 'Восстановление пароля на Доброе_дело.by',
            html: `
                <div style="font-family: sans-serif; padding: 20px; color: #2c3e50;">
                    <h2>Восстановление пароля</h2>
                    <p>Вы получили это письмо, так как запросили сброс пароля на платформе <b>Dobroe_delo.by</b>.</p>
                    <p>Для восстановления пароля перейдите по ссылке ниже:</p>
                    <p style="margin: 20px 0;">
                        <a href="${resetUrl}" style="background: #ef4444; color: white; padding: 12px 24px; border-radius: 8px; text-decoration: none; font-weight: bold;">Сбросить пароль</a>
                    </p>
                    <p>Или скопируйте ссылку: <a href="${resetUrl}">${resetUrl}</a></p>
                    <p style="color: #7f8c8d; font-size: 12px; margin-top: 30px;">Ссылка действительна в течение 1 часа.</p>
                </div>
            `
        });
        console.log(`📧 [PASSWORD RESET MOCK] Ссылка для сброса пароля ${user.email}: ${resetUrl}`);

        return { success: true, message: 'Инструкции по восстановлению пароля отправлены на ваш email' };
    }

    async resetPassword(token, newPassword) {
        if (!token || !newPassword) throw new Error('Токен и новый пароль обязательны');
        
        const db = require('../db').getDB();
        const user = await db.collection('users').findOne({
            passwordResetToken: token,
            passwordResetExpires: { $gt: new Date() }
        });

        if (!user) {
            throw new Error('Недействительный или просроченный токен восстановления');
        }

        const password_hash = await bcrypt.hash(newPassword, 10);
        await db.collection('users').updateOne(
            { _id: user._id },
            { 
                $set: { password_hash },
                $unset: { passwordResetToken: '', passwordResetExpires: '' }
            }
        );

        return { success: true, message: 'Пароль успешно обновлен' };
    }

    async resendConfirmation(email) {
        if (!email) throw new Error('Email обязателен');
        const user = await userRepository.findByEmail(email.trim());
        if (!user) throw new Error('Пользователь не найден');

        if (user.isEmailConfirmed) {
            throw new Error('Email уже подтвержден');
        }

        const token = crypto.randomBytes(32).toString('hex');
        const expires = new Date(Date.now() + 24 * 60 * 60 * 1000);

        const db = require('../db').getDB();
        await db.collection('users').updateOne(
            { _id: user._id },
            { 
                $set: { 
                    emailConfirmationToken: token,
                    emailConfirmationExpires: expires
                }
            }
        );

        const confirmUrl = `http://localhost:3000/confirm-email?token=${token}`;
        await emailService.sendEmail({
            to: user.email,
            subject: 'Повторное подтверждение регистрации на Доброе_дело.by',
            html: `
                <div style="font-family: sans-serif; padding: 20px; color: #2c3e50;">
                    <h2>Подтверждение адреса электронной почты</h2>
                    <p>Пожалуйста, подтвердите ваш email, перейдя по ссылке:</p>
                    <p style="margin: 20px 0;">
                        <a href="${confirmUrl}" style="background: #4F46E5; color: white; padding: 12px 24px; border-radius: 8px; text-decoration: none; font-weight: bold;">Подтвердить email</a>
                    </p>
                    <p>Ссылка действительна в течение 24 часов.</p>
                </div>
            `
        });
        console.log(`📧 [EMAIL RESEND MOCK] Ссылка для ${user.email}: ${confirmUrl}`);

        return { success: true, message: 'Ссылка подтверждения успешно отправлена повторно' };
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
                isEmailConfirmed: true, // Соцсети уже верифицированы
                isPhoneConfirmed: true,
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
            isBlocked: user.isBlocked || false,
            isEmailConfirmed: user.isEmailConfirmed !== false, // default to true for old users
            isPhoneConfirmed: user.isPhoneConfirmed !== false,  // default to true for old users
            lastName: user.lastName || '',
            birthDate: user.birthDate || null,
            bio: user.bio || '',
            interests: user.interests || [],
            skills: user.skills || [],
            rating: user.rating || 0,
            badges: user.badges || [],
            inn: user.inn || '',
            legalAddress: user.legalAddress || '',
            organizationType: user.organizationType || '',
            verificationDocuments: user.verificationDocuments || '',
            rejectionReason: user.rejectionReason || ''
        };
    }

    generateAccessToken(user) {
        return jwt.sign(
            { userId: user._id.toString(), email: user.email, role: user.role },
            process.env.JWT_SECRET,
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
