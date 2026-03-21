const mongoose = require('mongoose');

const LandingPageSchema = new mongoose.Schema({
    name: { type: String, required: true },
    slug: { type: String, required: true, unique: true },
    template: { type: String, default: 'default' },
    content: { type: mongoose.Schema.Types.Mixed, default: {} }, // JSON структура блоков
    status: { type: String, enum: ['draft', 'active', 'archived'], default: 'draft' },
    meta: {
        title: String,
        description: String,
        keywords: String
    },
    pixels: {
        facebook: String,
        vk: String
    }
}, { timestamps: true });

module.exports = mongoose.model('LandingPage', LandingPageSchema);