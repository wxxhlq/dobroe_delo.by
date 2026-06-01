const CommunityRepository = require('../repositories/CommunityRepository');
const { ObjectId } = require('mongodb');
const { getDB } = require('../db');
const GamificationService = require('../services/GamificationService');

function mapCommunityPostForClient(doc) {
    return {
        id: doc._id.toString(),
        userId: doc.userId ? doc.userId.toString() : null,
        userName: doc.userName || 'Пользователь',
        userAvatar: doc.userAvatar || '',
        text: doc.text || '',
        media: doc.media || null,
        date:
            doc.createdAt &&
            new Date(doc.createdAt).toLocaleString('ru-RU', {
                hour: '2-digit',
                minute: '2-digit',
                day: 'numeric',
                month: 'short'
            }),
        likes: doc.likes || [],
        comments: (doc.comments || []).map(c => ({
            userId: c.userId ? c.userId.toString() : null,
            userName: c.userName || 'Пользователь',
            userAvatar: c.userAvatar || '',
            text: c.text || '',
            date: c.createdAt ? new Date(c.createdAt).getTime() : Date.now()
        }))
    };
}

class CommunityController {
    async getPosts(req, res) {
        try {
            const docs = await CommunityRepository.findAllPosts();
            res.json({ posts: docs.map(mapCommunityPostForClient) });
        } catch (err) {
            res.status(500).json({ message: 'Ошибка сервера' });
        }
    }

    async createPost(req, res) {
        const { text, media } = req.body || {};
        if (!text && (!media || !media.src)) {
            return res.status(400).json({ message: 'Пост не может быть пустым' });
        }
        try {
            const db = getDB();
            const user = await db.collection('users').findOne({ _id: new ObjectId(req.user.userId) });
            if (!user) return res.status(404).json({ message: 'Пользователь не найден' });

            const doc = {
                userId: user._id,
                userName: user.name || user.email || 'Пользователь',
                userAvatar: user.avatarUrl || '',
                text: String(text || '').trim(),
                media: media || null,
                createdAt: new Date(),
                likes: [],
                comments: []
            };

            const created = await CommunityRepository.createPost(doc);

            try {
                await db.collection('userevents').insertOne({
                    userId: new ObjectId(req.user.userId),
                    sessionId: req.body?.sessionId || req.headers['x-session-id'] || 'unknown',
                    eventType: 'post_created',
                    eventData: { postId: created._id, postText: (text || '').substring(0, 100) },
                    createdAt: new Date()
                });
            } catch(e) {}

            await GamificationService.checkAchievements(req.user.userId);
            res.status(201).json({ message: 'Пост создан', post: mapCommunityPostForClient(created) });
        } catch (err) {
            res.status(500).json({ message: 'Ошибка сервера' });
        }
    }

    async toggleLike(req, res) {
        try {
            if (!ObjectId.isValid(req.params.id)) return res.status(400).json({ message: 'Некорректный ID' });
            const post = await CommunityRepository.findPostById(req.params.id);
            if (!post) return res.status(404).json({ message: 'Пост не найден' });
            
            const userId = req.user.userId;
            const hasLike = (post.likes || []).some(id => id.toString() === userId);
            const updated = await CommunityRepository.toggleLike(post._id, userId, hasLike);
            
            res.json({ message: hasLike ? 'Лайк удалён' : 'Лайк добавлен', post: mapCommunityPostForClient(updated) });
        } catch (err) {
            res.status(500).json({ message: 'Ошибка сервера' });
        }
    }

    async addComment(req, res) {
        const { text } = req.body || {};
        if (!text) return res.status(400).json({ message: 'Текст комментария обязателен' });
        try {
            if (!ObjectId.isValid(req.params.id)) return res.status(400).json({ message: 'Некорректный ID' });
            
            const db = getDB();
            const user = await db.collection('users').findOne({ _id: new ObjectId(req.user.userId) });
            
            const comment = {
                userId: user._id,
                userName: user.name || user.email || 'Пользователь',
                userAvatar: user.avatarUrl || '',
                text: String(text).trim(),
                createdAt: new Date()
            };
            const updated = await CommunityRepository.addComment(req.params.id, comment);
            
            try {
                await db.collection('userevents').insertOne({
                    userId: new ObjectId(req.user.userId),
                    sessionId: req.body?.sessionId || req.headers['x-session-id'] || 'unknown',
                    eventType: 'comment_created',
                    eventData: { postId: req.params.id, commentText: (text || '').substring(0, 100) },
                    createdAt: new Date()
                });
            } catch(e) {}
            
            res.status(201).json({ message: 'Комментарий добавлен', post: mapCommunityPostForClient(updated) });
        } catch (err) {
            res.status(500).json({ message: 'Ошибка сервера' });
        }
    }

    async deletePost(req, res) {
        try {
            const post = await CommunityRepository.findPostById(req.params.id);
            if (!post) return res.status(404).json({ message: 'Пост не найден' });
            if (req.user.role !== 'ADMIN' && (!post.userId || post.userId.toString() !== req.user.userId)) {
                return res.status(403).json({ message: 'Нет прав' });
            }
            await CommunityRepository.deletePost(req.params.id);
            res.json({ message: 'Пост удалён' });
        } catch (err) {
            res.status(500).json({ message: 'Ошибка сервера' });
        }
    }
}
module.exports = new CommunityController();
