const { getDB } = require('../db');
const { ObjectId } = require('mongodb');

const ACHIEVEMENTS = [
    {
        id: 'reg', name: 'Первый шаг', icon: '🌱', desc: 'Выдаётся каждому участнику за присоединение к сообществу Доброе_дело.by.', xpReward: 0,
        condition: (user, stats) => true
    },
    {
        id: 'profile', name: 'В деталях', icon: '📝', desc: 'Заполните город и телефон в профиле.', xpReward: 20,
        condition: (user, stats) => !!(user.city && user.phone)
    },
    {
        id: 'avatar', name: 'Узнаваемый', icon: '📸', desc: 'Загрузите свой аватар.', xpReward: 15,
        condition: (user, stats) => !!(user.avatarUrl && user.avatarUrl.length > 0)
    },
    {
        id: 'first_project', name: 'Новичок', icon: '🎯', desc: 'Откликнитесь на свой первый волонтёрский проект.', xpReward: 25,
        condition: (user, stats) => stats.completedProjects >= 1
    },
    {
        id: 'hero', name: 'Герой города', icon: '🏙️', desc: 'Успешно завершите 5 волонтерских проектов.', xpReward: 50,
        condition: (user, stats) => stats.completedProjects >= 5
    },
    {
        id: 'veteran', name: 'Ветеран добра', icon: '🎖️', desc: 'Примите участие в 10 волонтёрских проектах.', xpReward: 100,
        condition: (user, stats) => stats.completedProjects >= 10
    },
    {
        id: 'legend', name: 'Легенда', icon: '👑', desc: 'Невероятно! Вы участвовали в 25 проектах!', xpReward: 250,
        condition: (user, stats) => stats.completedProjects >= 25
    },
    {
        id: 'xp_100', name: 'Начинающий', icon: '💫', desc: 'Наберите 100 баллов опыта.', xpReward: 30,
        condition: (user, stats) => user.points >= 100
    },
    {
        id: 'xp_500', name: 'Звезда добра', icon: '⭐', desc: 'Наберите 500 баллов опыта.', xpReward: 100,
        condition: (user, stats) => user.points >= 500
    },
    {
        id: 'xp_1000', name: 'Мастер добра', icon: '🌟', desc: 'Достигните 1000 баллов опыта!', xpReward: 200,
        condition: (user, stats) => user.points >= 1000
    },
    {
        id: 'social', name: 'Общительный', icon: '💬', desc: 'Создайте свой первый пост в сообществе.', xpReward: 20,
        condition: (user, stats) => stats.postsCreated >= 1
    },
    {
        id: 'influencer', name: 'Лидер мнений', icon: '📢', desc: 'Создайте 5 постов в сообществе.', xpReward: 75,
        condition: (user, stats) => stats.postsCreated >= 5
    }
];

class GamificationService {
    getAchievementsList() {
        return ACHIEVEMENTS;
    }

    async checkAchievements(userId) {
        try {
            const db = getDB();
            if (!db) return [];
            
            const usersCollection = db.collection('users');
            const applicationsCollection = db.collection('project_applications');
            const postsCollection = db.collection('community_posts');
            
            const user = await usersCollection.findOne({ _id: new ObjectId(userId) });
            if (!user) return [];
            if (!user.achievements) user.achievements = [];
            
            const completedProjects = await applicationsCollection.countDocuments({
                userId: new ObjectId(userId), status: 'ACTIVE'
            });
            const postsCreated = await postsCollection.countDocuments({ userId: new ObjectId(userId) });
            
            const stats = { completedProjects, postsCreated };
            let totalXpEarned = 0;
            const newAchievements = [];
            
            for (const achievement of ACHIEVEMENTS) {
                const alreadyUnlocked = user.achievements.some(a => a.id === achievement.id);
                if (!alreadyUnlocked && achievement.condition(user, stats)) {
                    newAchievements.push({ id: achievement.id, unlockedAt: new Date() });
                    totalXpEarned += achievement.xpReward;
                }
            }
            
            if (newAchievements.length > 0) {
                await usersCollection.updateOne(
                    { _id: user._id },
                    { $push: { achievements: { $each: newAchievements } }, $inc: { points: totalXpEarned } }
                );
            }
            return newAchievements;
        } catch (err) {
            console.error('Ошибка проверки достижений:', err);
            return [];
        }
    }

    async getLeaderboard() {
        const topUsers = await getDB().collection('users')
            .find({}).sort({ points: -1, _id: 1 }).limit(100).toArray();
        return topUsers.map(user => ({
            id: user._id.toString(),
            name: user.name || user.username || 'Пользователь',
            avatarUrl: user.avatarUrl || '',
            points: Number(user.points) || 0
        }));
    }
    
    async getUserAchievements(userId) {
        const db = getDB();
        const user = await db.collection('users').findOne({ _id: new ObjectId(userId) });
        if (!user) throw new Error('Пользователь не найден');
        
        const completedProjects = await db.collection('project_applications').countDocuments({
            userId: new ObjectId(userId), status: 'ACTIVE'
        });
        const postsCreated = await db.collection('community_posts').countDocuments({ userId: new ObjectId(userId) });
        
        const stats = { completedProjects, postsCreated };
        const userAchievements = user.achievements || [];
        
        return ACHIEVEMENTS.map(achievement => {
            const unlocked = userAchievements.some(a => a.id === achievement.id);
            const unlockedData = userAchievements.find(a => a.id === achievement.id);
            let progress = 0;
            
            if (['first_project', 'hero', 'veteran', 'legend'].includes(achievement.id)) {
                const targets = { first_project: 1, hero: 5, veteran: 10, legend: 25 };
                progress = Math.min((stats.completedProjects / (targets[achievement.id] || 1)) * 100, 100);
            } else if (['xp_100', 'xp_500', 'xp_1000'].includes(achievement.id)) {
                const targets = { xp_100: 100, xp_500: 500, xp_1000: 1000 };
                progress = Math.min(((user.points || 0) / (targets[achievement.id] || 1)) * 100, 100);
            } else if (['social', 'influencer'].includes(achievement.id)) {
                const targets = { social: 1, influencer: 5 };
                progress = Math.min((stats.postsCreated / (targets[achievement.id] || 1)) * 100, 100);
            } else if (unlocked) {
                progress = 100;
            }
            
            return {
                id: achievement.id, name: achievement.name, icon: achievement.icon, desc: achievement.desc,
                xpReward: achievement.xpReward, unlocked, unlockedAt: unlockedData?.unlockedAt || null,
                progress: Math.round(progress)
            };
        });
    }
}
module.exports = new GamificationService();
