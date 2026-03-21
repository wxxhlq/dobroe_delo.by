const mongoose = require('mongoose');

const ErrorLogSchema = new mongoose.Schema({
    message: { type: String, required: true },
    stack: { type: String },
    url: { type: String },
    method: { type: String },
    ip: { type: String },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('ErrorLog', ErrorLogSchema);