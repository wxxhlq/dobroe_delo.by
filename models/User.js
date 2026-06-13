const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
    // Основные поля
    email: String,
    username: String,
    password_hash: String,
    name: String,
    role: { type: String, enum: ['VOLUNTEER', 'ORGANIZER', 'MODERATOR', 'ADMIN'], default: 'VOLUNTEER' },
    city: String,
    phone: String,
    pendingPhone: { type: String, default: null },
    points: { type: Number, default: 0 },
    avatarUrl: String,
    privacy: String,
    achievements: Array,
    telegramId: { type: String, default: null },

    // Новые поля из ТЗ
    lastName: { type: String, default: '' },
    birthDate: { type: Date, default: null },
    bio: { type: String, default: '' },
    interests: { type: [String], default: [] },
    skills: { type: [String], default: [] },
    rating: { type: Number, default: 0 },
    badges: { type: [String], default: [] },
    inn: { type: String, default: '' },
    legalAddress: { type: String, default: '' },

    // Верификация организатора
    verificationStatus: { type: String, enum: ['NONE', 'PENDING', 'VERIFIED', 'REJECTED'], default: 'NONE' },
    verificationDocuments: { type: String, default: '' },
    organizationName: { type: String, default: '' },
    organizationType: { type: String, default: '' }, // НКО, учебное заведение и т.д.
    verifiedAt: { type: Date, default: null },
    verifiedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    rejectionReason: { type: String, default: '' },

    // Блокировка
    isBlocked: { type: Boolean, default: false },
    blockedAt: { type: Date, default: null },
    blockedReason: { type: String, default: '' },
    blockedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },

    // Подтверждение Email и Телефона
    isEmailConfirmed: { type: Boolean, default: false },
    emailConfirmationToken: { type: String, default: null },
    emailConfirmationExpires: { type: Date, default: null },

    isPhoneConfirmed: { type: Boolean, default: false },
    smsCode: { type: String, default: null },
    smsCodeExpires: { type: Date, default: null },

    // Восстановление пароля
    passwordResetToken: { type: String, default: null },
    passwordResetExpires: { type: Date, default: null }
}, { strict: false, timestamps: true });

module.exports = mongoose.model('User', userSchema);