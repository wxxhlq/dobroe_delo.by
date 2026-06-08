const { getDB } = require('../db');
const { ObjectId } = require('mongodb');
const jwt = require('jsonwebtoken');
const GamificationService = require('../services/GamificationService');

class UserController {
    async getMe(req, res) {
        try {
            const db = getDB();
            const user = await db.collection('users').findOne(
                { _id: new ObjectId(req.user.userId) },
                { projection: { password_hash: 0 } }
            );
            if (!user) return res.status(404).json({ message: 'Пользователь не найден' });
            res.json({
                id: user._id, username: user.username, email: user.email, name: user.name, role: user.role,
                city: user.city, phone: user.phone, avatarUrl: user.avatarUrl || '', points: user.points || 0,
                created_at: user.created_at,
                verificationStatus: user.verificationStatus || 'NONE',
                organizationName: user.organizationName || '',
                organizationType: user.organizationType || '',
                verificationDocuments: user.verificationDocuments || '',
                rejectionReason: user.rejectionReason || ''
            });
        } catch (err) { res.status(500).json({ message: 'Ошибка сервера' }); }
    }

    async updateMe(req, res) {
        try {
            const { name, city, phone, privacy, notifications, email, organizationName, organizationType, verificationDocuments, submitVerification } = req.body;
            const db = getDB();
            const usersCollection = db.collection('users');
            const updateData = {};
            
            if (name) updateData.name = name;
            if (city) updateData.city = city;
            if (phone) updateData.phone = phone;
            if (privacy) updateData.privacy = privacy;
            if (notifications !== undefined) updateData.notifications = notifications;
            
            if (organizationName !== undefined) updateData.organizationName = organizationName;
            if (organizationType !== undefined) updateData.organizationType = organizationType;
            if (verificationDocuments !== undefined) updateData.verificationDocuments = verificationDocuments;
            if (submitVerification) {
                updateData.verificationStatus = 'PENDING';
                updateData.rejectionReason = '';
            }

            if (email !== undefined) {
                const normalizedEmail = String(email).trim().toLowerCase();
                const existing = await usersCollection.findOne({ email: normalizedEmail }, { projection: { _id: 1 } });
                if (existing && existing._id.toString() !== req.user.userId) {
                    return res.status(409).json({ message: 'Пользователь с таким email уже существует' });
                }
                updateData.email = normalizedEmail;
            }
            
            await usersCollection.updateOne({ _id: new ObjectId(req.user.userId) }, { $set: updateData });
            await GamificationService.checkAchievements(req.user.userId);
            
            const updatedUser = await usersCollection.findOne({ _id: new ObjectId(req.user.userId) });
            const token = jwt.sign({ userId: updatedUser._id.toString(), role: updatedUser.role, email: updatedUser.email }, process.env.JWT_SECRET || 'supersecret_jwt_key_123', { expiresIn: '15m' });
            
            res.json({
                message: 'Профиль обновлён', token, user: {
                    id: updatedUser._id, username: updatedUser.username, email: updatedUser.email, name: updatedUser.name,
                    role: updatedUser.role, city: updatedUser.city, phone: updatedUser.phone, avatarUrl: updatedUser.avatarUrl || '',
                    privacy: updatedUser.privacy, points: updatedUser.points || 0,
                    verificationStatus: updatedUser.verificationStatus || 'NONE',
                    organizationName: updatedUser.organizationName || '',
                    organizationType: updatedUser.organizationType || '',
                    verificationDocuments: updatedUser.verificationDocuments || '',
                    rejectionReason: updatedUser.rejectionReason || ''
                }
            });
        } catch (err) { res.status(500).json({ message: 'Ошибка сервера' }); }
    }

    async uploadAvatar(req, res) {
        try {
            if (!req.file) return res.status(400).json({ message: 'Файл не передан' });
            const avatarUrl = `/uploads/avatars/${req.file.filename}`;
            const db = getDB();
            await db.collection('users').updateOne({ _id: new ObjectId(req.user.userId) }, { $set: { avatarUrl } });
            await GamificationService.checkAchievements(req.user.userId);
            res.json({ avatarUrl });
        } catch (err) { res.status(500).json({ message: 'Ошибка сервера' }); }
    }

    async checkSession(req, res) {
        try {
            const db = getDB();
            const user = await db.collection('users').findOne({ _id: new ObjectId(req.user.userId) });
            if (!user) return res.status(404).json({ valid: false });
            res.json({
                valid: true, user: {
                    id: user._id, username: user.username, email: user.email, name: user.name, role: user.role,
                    city: user.city, phone: user.phone, avatarUrl: user.avatarUrl || '', points: user.points || 0,
                    verificationStatus: user.verificationStatus || 'NONE',
                    organizationName: user.organizationName || '',
                    organizationType: user.organizationType || '',
                    verificationDocuments: user.verificationDocuments || '',
                    rejectionReason: user.rejectionReason || ''
                }
            });
        } catch (err) { res.status(401).json({ valid: false }); }
    }

    async ping(req, res) {
        try {
            const db = getDB();
            await db.collection('users').updateOne({ _id: new ObjectId(req.user.userId) }, { $set: { lastLogin: new Date() } });
            res.sendStatus(200);
        } catch (err) { res.status(500).send(); }
    }
}
module.exports = new UserController();
