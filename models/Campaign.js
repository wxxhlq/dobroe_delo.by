const mongoose = require('mongoose');

const CampaignSchema = new mongoose.Schema({
    name: { type: String, required: true },
    type: { type: String, default: 'email' },
    status: { type: String, enum: ['draft', 'scheduled', 'active', 'completed', 'failed'], default: 'draft' },
    targetSegmentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Segment', default: null },
    content: {
        subject: { type: String, required: true },
        bodyHtml: { type: String, required: true }
    },
    schedule: { startDate: { type: Date, default: null } },
    stats: { sent: { type: Number, default: 0 }, failed: { type: Number, default: 0 } },
    sentAt: { type: Date, default: null },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }
}, { timestamps: true });

module.exports = mongoose.model('Campaign', CampaignSchema);