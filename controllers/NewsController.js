const NewsRepository = require('../repositories/NewsRepository');
const { ObjectId } = require('mongodb');
const { getDB } = require('../db');

function mapNewsForClient(doc) {
    return {
        id: doc._id.toString(),
        title: doc.title,
        text: doc.text,
        image: doc.imageUrl || '',
        date: doc.createdAt
            ? new Date(doc.createdAt).toLocaleDateString('ru-RU')
            : new Date().toLocaleDateString('ru-RU'),
        authorId: doc.authorId ? doc.authorId.toString() : null,
        authorName: doc.authorName || 'Автор'
    };
}

class NewsController {
    async getNews(req, res) {
        try {
            const docs = await NewsRepository.findAll();
            res.json({ news: docs.map(mapNewsForClient) });
        } catch (err) {
            res.status(500).json({ message: 'Ошибка сервера' });
        }
    }
    
    async createNews(req, res) {
        const { title, text, image } = req.body || {};
        if (!title || !text) return res.status(400).json({ message: 'Заголовок и текст новости обязательны' });
        try {
            const doc = {
                title: String(title).trim(),
                text: String(text).trim(),
                imageUrl: typeof image === 'string' ? image : '',
                authorId: new ObjectId(req.user.userId),
                authorName: req.user.email || 'Автор',
                createdAt: new Date()
            };
            const created = await NewsRepository.create(doc);
            
            try {
                const db = getDB();
                await db.collection('userevents').insertOne({
                    userId: new ObjectId(req.user.userId),
                    sessionId: req.body?.sessionId || req.headers['x-session-id'] || 'unknown',
                    eventType: 'news_created',
                    eventData: { newsId: created._id, newsTitle: title },
                    createdAt: new Date()
                });
            } catch(e) {}
            
            res.status(201).json({ message: 'Новость создана', news: mapNewsForClient(created) });
        } catch (err) {
            res.status(500).json({ message: 'Ошибка сервера' });
        }
    }
    
    async deleteNews(req, res) {
        try {
            const doc = await NewsRepository.findById(req.params.id);
            if (!doc) return res.status(404).json({ message: 'Новость не найдена' });
            if (req.user.role !== 'ADMIN' && (!doc.authorId || doc.authorId.toString() !== req.user.userId)) {
                return res.status(403).json({ message: 'Нет прав для удаления этой новости' });
            }
            await NewsRepository.delete(req.params.id);
            
            try {
                const db = getDB();
                await db.collection('userevents').insertOne({
                    userId: new ObjectId(req.user.userId),
                    sessionId: req.body?.sessionId || req.headers['x-session-id'] || 'unknown',
                    eventType: 'news_deleted',
                    eventData: { newsId: req.params.id },
                    createdAt: new Date()
                });
            } catch(e) {}
            
            res.json({ message: 'Новость удалена' });
        } catch (err) {
            res.status(500).json({ message: 'Ошибка сервера' });
        }
    }
}
module.exports = new NewsController();
