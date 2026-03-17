const mongoose = require('mongoose');

const SegmentSchema = new mongoose.Schema({
    name: {
        type: String,
        required: [true, 'У сегмента должно быть имя'],
        unique: true, // Имена сегментов не должны повторяться
        trim: true
    },
    // Условия фильтрации (сохраняем как JSON, чтобы потом парсить в запросы)
    criteria: {
        city: { type: String, default: null },
        interests: [{ type: String }], // Массив интересов
        minEvents: { type: Number, default: 0 },
        isActive: { type: Boolean, default: true }
    },
    isDynamic: {
        type: Boolean,
        default: true // По умолчанию сегмент пересчитывается сам
    },
    // УЛУЧШЕНИЕ: Кэширование пользователей для быстрых рассылок
    // Вместо того чтобы каждый раз искать юзеров, мы храним их ID тут (обновляем кроном раз в сутки)
    users: [{
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
    }]
}, {
    timestamps: true
});

module.exports = mongoose.model('Segment', SegmentSchema);