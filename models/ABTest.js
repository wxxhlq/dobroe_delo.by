const mongoose = require('mongoose');

const ABTestSchema = new mongoose.Schema({
    name: { type: String, required: true },
    pageA_id: { type: mongoose.Schema.Types.ObjectId, ref: 'LandingPage' },
    pageB_id: { type: mongoose.Schema.Types.ObjectId, ref: 'LandingPage' },
    trafficSplitA: { type: Number, default: 50 },
    trafficSplitB: { type: Number, default: 50 },
    startDate: { type: Date, default: Date.now },
    endDate: { type: Date },
    winnerId: { type: mongoose.Schema.Types.ObjectId, ref: 'LandingPage' },
    status: { type: String, enum: ['draft', 'active', 'completed'], default: 'draft' }
}, { timestamps: true });

module.exports = mongoose.model('ABTest', ABTestSchema);