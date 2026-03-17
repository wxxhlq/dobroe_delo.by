const mongoose = require('mongoose');

const UserEventSchema = new mongoose.Schema({
    // Связь с таблицей пользователей (null, если гость)
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        default: null
    },
    // Сессия гостя (обязательное поле, чтобы склеить историю до регистрации)
    sessionId: {
        type: String,
        required: [true, 'Session ID обязателен для трекинга']
    },
    // Строгий список разрешенных событий
    eventType: {
        type: String,
        required: true,
        enum: [
            'page_view', 'button_click', 'registration',
            'form_abandoned', 'referral_click', 'task_completed',
            'landing_view', 'email_opened' // Добавлено для А/Б тестов и рассылок
        ]
    },
    // Детали события (какая кнопка, какая страница, какой вариант А/Б теста)
    eventData: {
        type: mongoose.Schema.Types.Mixed, // Позволяет хранить любой JSON
        default: {}
    },
    // Маркетинговые метки
    sourceData: {
        utm_source: { type: String, default: null },
        utm_medium: { type: String, default: null },
        utm_campaign: { type: String, default: null },
        referrer: { type: String, default: null }
    },
    // Информация об устройстве
    deviceData: {
        userAgent: { type: String, default: null },
        platform: { type: String, default: null }, // iOS, Windows, Android
        isMobile: { type: Boolean, default: false }
    }
}, {
    timestamps: true // Автоматически создаст поля createdAt и updatedAt
});

// ПРОФЕССИОНАЛЬНАЯ ОПТИМИЗАЦИЯ (Индексы базы данных)
// Эти индексы заставят агрегации (воронку конверсии) работать за миллисекунды
UserEventSchema.index({ sessionId: 1 }); // Быстрый поиск всех действий гостя
UserEventSchema.index({ userId: 1 }); // Быстрый поиск истории конкретного волонтера
UserEventSchema.index({ eventType: 1, createdAt: -1 }); // Для графиков на дашборде
UserEventSchema.index({ 'sourceData.utm_source': 1 }); // Для отчета по источникам трафика

module.exports = mongoose.model('UserEvent', UserEventSchema);