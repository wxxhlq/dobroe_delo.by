const mongoose = require('mongoose');

const ReferralSchema = new mongoose.Schema({
    referrerUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    refereeUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    referralCode: { type: String, required: true }, // unique убран отсюда
    status: { type: String, enum: ['clicked', 'registered', 'completed_first_task'], default: 'clicked' },
    createdAt: { type: Date, default: Date.now },
    convertedAt: { type: Date }
});

// Уникальный индекс создаётся здесь
ReferralSchema.index({ referralCode: 1 }, { unique: true });

module.exports = mongoose.model('Referral', ReferralSchema);