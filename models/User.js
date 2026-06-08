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
    points: { type: Number, default: 0 },
    avatarUrl: String,
    privacy: String,
    achievements: Array,
    telegramId: { type: String, default: null },

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
    blockedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null }
}, { strict: false, timestamps: true });

module.exports = mongoose.model('User', userSchema);