const authService = require('../services/AuthService');

class AuthController {
    async register(req, res) {
        try {
            const result = await authService.register(req.body);
            res.status(201).json({
                message: 'Пользователь зарегистрирован',
                ...result
            });
        } catch (err) {
            console.error('🚨 ОШИБКА РЕГИСТРАЦИИ:', err);
            res.status(err.message.includes('уже существует') ? 409 : 500).json({ message: err.message || 'Ошибка сервера' });
        }
    }

    async login(req, res) {
        try {
            const { email, password } = req.body;
            const result = await authService.login(email, password);
            res.json(result);
        } catch (err) {
            console.error('❌ Ошибка логина:', err);
            res.status(401).json({ message: err.message || 'Неверный email или пароль' });
        }
    }
}

module.exports = new AuthController();
