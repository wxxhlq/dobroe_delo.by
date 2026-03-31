const mongoose = require('mongoose');

const CampaignLogSchema = new mongoose.Schema({
    campaignId: { type: mongoose.Schema.Types.ObjectId, ref: 'Campaign', required: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    userEmail: { type: String },
    status: { type: String, enum: ['sent', 'failed'], required: true },
    error: { type: String }
}, { timestamps: true });

CampaignLogSchema.index({ campaignId: 1, userId: 1 }, { unique: true });

module.exports = mongoose.model('CampaignLog', CampaignLogSchema);