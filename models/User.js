const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
    // все поля, которые есть в коллекции users
    email: String,
    username: String,
    password_hash: String,
    name: String,
    role: String,
    city: String,
    phone: String,
    points: Number,
    avatarUrl: String,
    privacy: String,
    achievements: Array,
    createdAt: Date,
    updatedAt: Date
}, { strict: false, timestamps: true });

module.exports = mongoose.model('User', userSchema);