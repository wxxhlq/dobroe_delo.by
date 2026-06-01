const GamificationService = require('../services/GamificationService');
const { ObjectId } = require('mongodb');

class GamificationController {
    async getLeaderboard(req, res) {
        try {
            const leaderboard = await GamificationService.getLeaderboard();
            res.json({ leaderboard });
        } catch (err) {
            res.status(500).json({ message: 'Ошибка сервера' });
        }
    }
    
    async getUserAchievements(req, res) {
        try {
            if (!ObjectId.isValid(req.params.userId)) {
                return res.status(400).json({ message: 'Некорректный ID пользователя' });
            }
            const achievements = await GamificationService.getUserAchievements(req.params.userId);
            res.json({ achievements });
        } catch (err) {
            if (err.message === 'Пользователь не найден') {
                return res.status(404).json({ message: err.message });
            }
            res.status(500).json({ message: 'Ошибка сервера' });
        }
    }
}
module.exports = new GamificationController();
