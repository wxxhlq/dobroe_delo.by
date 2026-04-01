const mongoose = require('mongoose');

const CampaignLogSchema = new mongoose.Schema({
    campaignId: { type: mongoose.Schema.Types.ObjectId, ref: 'Campaign', required: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    userEmail: { type: String, default: null },
    status: { type: String, enum: ['sent', 'failed'], required: true },
    error: { type: String, default: null }
}, { timestamps: true });



module.exports = mongoose.model('CampaignLog', CampaignLogSchema);