const mongoose = require('mongoose');

const SegmentSchema = new mongoose.Schema({
    name: {
        type: String,
        required: [true, 'У сегмента должно быть имя'],
        unique: true,
        trim: true
    },
    criteria: {
        type: mongoose.Schema.Types.Mixed,   // <-- это ключевое
        default: {}
    },
    isDynamic: {
        type: Boolean,
        default: true
    },
    users: [{
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
    }]
}, {
    timestamps: true
});

module.exports = mongoose.model('Segment', SegmentSchema);