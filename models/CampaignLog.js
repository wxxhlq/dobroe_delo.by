const mongoose = require('mongoose');

const CampaignLogSchema = new mongoose.Schema({
    campaignId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Campaign',
        required: true
    },
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    status: {
        type: String,
        enum: ['sent', 'delivered', 'opened', 'clicked', 'bounced'],
        required: true
    },
    openedAt: { type: Date, default: null },
    clickedAt: { type: Date, default: null }
}, {
    timestamps: true // Дата создания и есть дата отправки (sentAt)
});

// УЛУЧШЕНИЕ: Композитный уникальный индекс.
// Защищает от того, чтобы мы случайно не записали два факта отправки одного письма одному юзеру
CampaignLogSchema.index({ campaignId: 1, userId: 1, status: 1 }, { unique: true });

module.exports = mongoose.model('CampaignLog', CampaignLogSchema);