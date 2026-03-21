const mongoose = require('mongoose');

const UserEventSchema = new mongoose.Schema({
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        default: null
    },
    sessionId: {
        type: String,
        required: [true, 'Session ID обязателен для трекинга']
    },
    eventType: {
        type: String,
        required: true,
        enum: [
            'page_view', 'button_click', 'registration',
            'form_abandoned', 'referral_click', 'task_completed',
            'landing_view', 'email_opened',
            'project_apply', 'project_apply_cancel',
            'post_created', 'post_deleted', 'comment_created',
            'news_created', 'news_deleted'   // <-- добавить эти
        ]
    },
    eventData: {
        type: mongoose.Schema.Types.Mixed,
        default: {}
    },
    sourceData: {
        utm_source: { type: String, default: null },
        utm_medium: { type: String, default: null },
        utm_campaign: { type: String, default: null },
        referrer: { type: String, default: null }
    },
    deviceData: {
        userAgent: { type: String, default: null },
        platform: { type: String, default: null },
        isMobile: { type: Boolean, default: false }
    }
}, {
    timestamps: true
});

UserEventSchema.index({ sessionId: 1 });
UserEventSchema.index({ userId: 1 });
UserEventSchema.index({ eventType: 1, createdAt: -1 });
UserEventSchema.index({ 'sourceData.utm_source': 1 });

module.exports = mongoose.model('UserEvent', UserEventSchema);