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
                rejectionReason: user.rejectionReason || '',
                lastName: user.lastName || '',
                birthDate: user.birthDate || null,
                bio: user.bio || '',
                interests: user.interests || [],
                skills: user.skills || [],
                rating: user.rating || 0,
                badges: user.badges || [],
                inn: user.inn || '',
                legalAddress: user.legalAddress || ''
            });
        } catch (err) { res.status(500).json({ message: 'Ошибка сервера' }); }
    }

    async updateMe(req, res) {
        try {
            const { 
                name, city, phone, privacy, notifications, email, 
                organizationName, organizationType, verificationDocuments, submitVerification,
                lastName, birthDate, bio, interests, skills, inn, legalAddress
            } = req.body;
            const db = getDB();
            const usersCollection = db.collection('users');
            
            const currentUserObj = await usersCollection.findOne({ _id: new ObjectId(req.user.userId) });
            if (!currentUserObj) return res.status(404).json({ message: 'Пользователь не найден' });

            const updateData = {};
            
            if (name) updateData.name = name;
            if (city) updateData.city = city;
            if (privacy) updateData.privacy = privacy;
            if (notifications !== undefined) updateData.notifications = notifications;
            
            if (organizationName !== undefined) updateData.organizationName = organizationName;
            if (organizationType !== undefined) updateData.organizationType = organizationType;
            if (verificationDocuments !== undefined) updateData.verificationDocuments = verificationDocuments;
            if (submitVerification) {
                updateData.verificationStatus = 'PENDING';
                updateData.rejectionReason = '';
            }

            if (lastName !== undefined) updateData.lastName = lastName;
            if (birthDate !== undefined) updateData.birthDate = birthDate ? new Date(birthDate) : null;
            if (bio !== undefined) updateData.bio = bio;
            if (interests !== undefined) updateData.interests = Array.isArray(interests) ? interests : [];
            if (skills !== undefined) updateData.skills = Array.isArray(skills) ? skills : [];
            if (inn !== undefined) updateData.inn = inn;
            if (legalAddress !== undefined) updateData.legalAddress = legalAddress;

            if (email !== undefined) {
                const normalizedEmail = String(email).trim().toLowerCase();
                const existing = await usersCollection.findOne({ email: normalizedEmail }, { projection: { _id: 1 } });
                if (existing && existing._id.toString() !== req.user.userId) {
                    return res.status(409).json({ message: 'Пользователь с таким email уже существует' });
                }
                updateData.email = normalizedEmail;
            }

            let verificationRequired = false;
            let verificationMessage = '';

            if (phone !== undefined) {
                const cleanPhone = String(phone).trim();
                if (cleanPhone && cleanPhone !== currentUserObj.phone) {
                    // Check duplicate phone
                    const existingPhone = await usersCollection.findOne({ phone: cleanPhone });
                    if (existingPhone && existingPhone._id.toString() !== req.user.userId) {
                        return res.status(409).json({ message: 'Пользователь с таким номером телефона уже существует' });
                    }
                    
                    // Generate SMS code
                    const smsCode = Math.floor(1000 + Math.random() * 9000).toString();
                    const smsCodeExpires = new Date(Date.now() + 5 * 60 * 1000); // 5 mins
                    
                    await usersCollection.updateOne({ _id: new ObjectId(req.user.userId) }, {
                        $set: {
                            pendingPhone: cleanPhone,
                            smsCode: smsCode,
                            smsCodeExpires: smsCodeExpires
                        }
                    });
                    
                    console.log(`📱 [SMS MOCK] Код подтверждения смены номера на ${cleanPhone}: ${smsCode}`);
                    
                    verificationRequired = true;
                    verificationMessage = 'Код подтверждения отправлен на новый номер';
                } else if (!cleanPhone) {
                    updateData.phone = '';
                    await usersCollection.updateOne({ _id: new ObjectId(req.user.userId) }, {
                        $unset: { pendingPhone: '', smsCode: '', smsCodeExpires: '' }
                    });
                }
            }
            
            await usersCollection.updateOne({ _id: new ObjectId(req.user.userId) }, { $set: updateData });
            await GamificationService.checkAchievements(req.user.userId);
            
            const updatedUser = await usersCollection.findOne({ _id: new ObjectId(req.user.userId) });
            const token = jwt.sign({ userId: updatedUser._id.toString(), role: updatedUser.role, email: updatedUser.email }, process.env.JWT_SECRET, { expiresIn: '15m' });
            
            if (verificationRequired) {
                return res.json({
                    message: verificationMessage,
                    verificationRequired: true,
                    token,
                    user: {
                        id: updatedUser._id, username: updatedUser.username, email: updatedUser.email, name: updatedUser.name,
                        role: updatedUser.role, city: updatedUser.city, phone: updatedUser.phone, avatarUrl: updatedUser.avatarUrl || '',
                        privacy: updatedUser.privacy, points: updatedUser.points || 0,
                        verificationStatus: updatedUser.verificationStatus || 'NONE',
                        organizationName: updatedUser.organizationName || '',
                        organizationType: updatedUser.organizationType || '',
                        verificationDocuments: updatedUser.verificationDocuments || '',
                        rejectionReason: updatedUser.rejectionReason || '',
                        lastName: updatedUser.lastName || '',
                        birthDate: updatedUser.birthDate || null,
                        bio: updatedUser.bio || '',
                        interests: updatedUser.interests || [],
                        skills: updatedUser.skills || [],
                        rating: updatedUser.rating || 0,
                        badges: updatedUser.badges || [],
                        inn: updatedUser.inn || '',
                        legalAddress: updatedUser.legalAddress || ''
                    }
                });
            }

            res.json({
                message: 'Профиль обновлён', token, user: {
                    id: updatedUser._id, username: updatedUser.username, email: updatedUser.email, name: updatedUser.name,
                    role: updatedUser.role, city: updatedUser.city, phone: updatedUser.phone, avatarUrl: updatedUser.avatarUrl || '',
                    privacy: updatedUser.privacy, points: updatedUser.points || 0,
                    verificationStatus: updatedUser.verificationStatus || 'NONE',
                    organizationName: updatedUser.organizationName || '',
                    organizationType: updatedUser.organizationType || '',
                    verificationDocuments: updatedUser.verificationDocuments || '',
                    rejectionReason: updatedUser.rejectionReason || '',
                    lastName: updatedUser.lastName || '',
                    birthDate: updatedUser.birthDate || null,
                    bio: updatedUser.bio || '',
                    interests: updatedUser.interests || [],
                    skills: updatedUser.skills || [],
                    rating: updatedUser.rating || 0,
                    badges: updatedUser.badges || [],
                    inn: updatedUser.inn || '',
                    legalAddress: updatedUser.legalAddress || ''
                }
            });
        } catch (err) { res.status(500).json({ message: 'Ошибка сервера' }); }
    }

    async verifyPhoneChange(req, res) {
        try {
            const { code } = req.body;
            if (!code) return res.status(400).json({ message: 'Код подтверждения обязателен' });

            const db = getDB();
            const usersCollection = db.collection('users');
            const user = await usersCollection.findOne({ _id: new ObjectId(req.user.userId) });

            if (!user) return res.status(404).json({ message: 'Пользователь не найден' });
            if (!user.smsCode || !user.pendingPhone) {
                return res.status(400).json({ message: 'Запрос на смену телефона не найден' });
            }

            if (user.smsCode !== code.trim()) {
                return res.status(400).json({ message: 'Неверный код подтверждения' });
            }

            if (new Date() > new Date(user.smsCodeExpires)) {
                return res.status(400).json({ message: 'Срок действия кода истек' });
            }

            // Double check that the phone number is still unique (not taken by another user in the meantime)
            const existingPhone = await usersCollection.findOne({ phone: user.pendingPhone });
            if (existingPhone && existingPhone._id.toString() !== req.user.userId) {
                return res.status(409).json({ message: 'Пользователь с таким номером телефона уже существует' });
            }

            await usersCollection.updateOne(
                { _id: user._id },
                {
                    $set: { phone: user.pendingPhone },
                    $unset: { smsCode: '', smsCodeExpires: '', pendingPhone: '' }
                }
            );

            const updatedUser = await usersCollection.findOne({ _id: user._id });
            const token = jwt.sign({ userId: updatedUser._id.toString(), role: updatedUser.role, email: updatedUser.email }, process.env.JWT_SECRET, { expiresIn: '15m' });

            res.json({
                message: 'Номер телефона успешно изменен',
                token,
                user: {
                    id: updatedUser._id, username: updatedUser.username, email: updatedUser.email, name: updatedUser.name,
                    role: updatedUser.role, city: updatedUser.city, phone: updatedUser.phone, avatarUrl: updatedUser.avatarUrl || '',
                    privacy: updatedUser.privacy, points: updatedUser.points || 0,
                    verificationStatus: updatedUser.verificationStatus || 'NONE',
                    organizationName: updatedUser.organizationName || '',
                    organizationType: updatedUser.organizationType || '',
                    verificationDocuments: updatedUser.verificationDocuments || '',
                    rejectionReason: updatedUser.rejectionReason || '',
                    lastName: updatedUser.lastName || '',
                    birthDate: updatedUser.birthDate || null,
                    bio: updatedUser.bio || '',
                    interests: updatedUser.interests || [],
                    skills: updatedUser.skills || [],
                    rating: updatedUser.rating || 0,
                    badges: updatedUser.badges || [],
                    inn: updatedUser.inn || '',
                    legalAddress: updatedUser.legalAddress || ''
                }
            });
        } catch (err) {
            res.status(500).json({ message: 'Ошибка сервера' });
        }
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
                    rejectionReason: user.rejectionReason || '',
                    lastName: user.lastName || '',
                    birthDate: user.birthDate || null,
                    bio: user.bio || '',
                    interests: user.interests || [],
                    skills: user.skills || [],
                    rating: user.rating || 0,
                    badges: user.badges || [],
                    inn: user.inn || '',
                    legalAddress: user.legalAddress || ''
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

    async getNotifications(req, res) {
        try {
            const db = getDB();
            const notifications = await db.collection('notifications')
                .find({ userId: new ObjectId(req.user.userId) })
                .sort({ createdAt: -1 })
                .toArray();
            res.json({ notifications: notifications.map(n => ({ ...n, _id: n._id.toString() })) });
        } catch (err) {
            res.status(500).json({ message: 'Ошибка сервера' });
        }
    }

    async openNotification(req, res) {
        try {
            const db = getDB();
            const id = req.params.id;
            const notification = await db.collection('notifications').findOne({ _id: new ObjectId(id) });
            if (notification && !notification.isOpened) {
                await db.collection('notifications').updateOne({ _id: notification._id }, { $set: { isOpened: true } });
                if (notification.campaignId) {
                    await db.collection('urgent_notification_campaigns').updateOne({ _id: notification.campaignId }, { $inc: { openedCount: 1 } });
                }
            }
            res.json({ success: true });
        } catch (err) {
            res.status(500).json({ message: 'Ошибка сервера' });
        }
    }

    async clickNotification(req, res) {
        try {
            const db = getDB();
            const id = req.params.id;
            const notification = await db.collection('notifications').findOne({ _id: new ObjectId(id) });
            if (notification && !notification.isClicked) {
                await db.collection('notifications').updateOne({ _id: notification._id }, { $set: { isClicked: true } });
                if (notification.campaignId) {
                    await db.collection('urgent_notification_campaigns').updateOne({ _id: notification.campaignId }, { $inc: { clickedCount: 1 } });
                }
            }
            res.json({ success: true });
        } catch (err) {
            res.status(500).json({ message: 'Ошибка сервера' });
        }
    }
}
module.exports = new UserController();
