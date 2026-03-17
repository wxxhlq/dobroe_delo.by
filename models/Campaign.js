const mongoose = require('mongoose');

const CampaignSchema = new mongoose.Schema({
    name: {
        type: String,
        required: true,
        trim: true
    },
    type: {
        type: String,
        enum: ['email', 'push', 'ab_test'],
        required: true
    },
    status: {
        type: String,
        enum: ['draft', 'scheduled', 'active', 'completed'],
        default: 'draft'
    },
    // Для рассылок: кому отправляем
    targetSegmentId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Segment',
        default: null
    },
    // Наполнение кампании
    content: {
        subject: { type: String, default: null }, // Тема письма
        bodyHtml: { type: String, default: null }, // HTML код письма
        // Поля специально для А/Б тестов лендингов
        pageA_url: { type: String, default: null },
        pageB_url: { type: String, default: null },
        trafficSplit: { type: Number, default: 50 } // Процент на вариант А
    },
    // Запланированное время старта и конца
    schedule: {
        startDate: { type: Date, default: null },
        endDate: { type: Date, default: null }
    },
    // Итоговая статистика (кэш для дашборда)
    stats: {
        sent: { type: Number, default: 0 },
        opened: { type: Number, default: 0 },
        clicked: { type: Number, default: 0 },
        conversions: { type: Number, default: 0 }
    },
    // Если это А/Б тест, сюда запишем победителя
    winnerId: { type: String, default: null }
}, {
    timestamps: true
});

module.exports = mongoose.model('Campaign', CampaignSchema);