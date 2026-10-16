const authService = require('../services/AuthService');

class AuthController {
    async register(req, res) {
        try {
            const result = await authService.register(req.body, req);
            res.status(201).json({
                message: 'Пользователь зарегистрирован. Пожалуйста, подтвердите email по ссылке, отправленной на вашу почту.',
                ...result
            });
        } catch (err) {
            console.error('🚨 ОШИБКА РЕГИСТРАЦИИ:', err);
            res.status(err.message.includes('уже существует') ? 409 : 500).json({ message: err.message || 'Ошибка сервера' });
        }
    }

    async login(req, res) {
        try {
            const { email, phone, emailOrPhone, password } = req.body;
            const identifier = emailOrPhone || email || phone;
            const result = await authService.login(identifier, password);
            res.json(result);
        } catch (err) {
            console.error('❌ Ошибка логина:', err);
            res.status(401).json({ message: err.message || 'Неверный email или пароль' });
        }
    }

    async registerPhone(req, res) {
        try {
            const result = await authService.registerPhone(req.body);
            res.status(201).json({
                message: 'SMS-код подтверждения отправлен на указанный телефон',
                ...result
            });
        } catch (err) {
            console.error('🚨 ОШИБКА РЕГИСТРАЦИИ ПО ТЕЛЕФОНУ:', err);
            res.status(err.message.includes('уже существует') ? 409 : 500).json({ message: err.message || 'Ошибка сервера' });
        }
    }

    async verifySms(req, res) {
        try {
            const { phone, code } = req.body;
            const result = await authService.verifySms(phone, code);
            res.json({
                message: 'Номер телефона успешно подтвержден',
                ...result
            });
        } catch (err) {
            console.error('❌ Ошибка подтверждения SMS:', err);
            res.status(400).json({ message: err.message || 'Неверный или просроченный код' });
        }
    }

    async forgotPassword(req, res) {
        try {
            const { email } = req.body;
            const result = await authService.forgotPassword(email, req);
            res.json(result);
        } catch (err) {
            console.error('❌ Ошибка сброса пароля:', err);
            res.status(500).json({ message: err.message || 'Ошибка сервера' });
        }
    }

    async resetPassword(req, res) {
        try {
            const { token, password } = req.body;
            const result = await authService.resetPassword(token, password);
            res.json(result);
        } catch (err) {
            console.error('❌ Ошибка установки нового пароля:', err);
            res.status(400).json({ message: err.message || 'Ошибка сервера' });
        }
    }

    async resendConfirmation(req, res) {
        try {
            const { email } = req.body;
            const result = await authService.resendConfirmation(email, req);
            res.json(result);
        } catch (err) {
            console.error('❌ Ошибка повторной отправки подтверждения:', err);
            res.status(500).json({ message: err.message || 'Ошибка сервера' });
        }
    }
}

module.exports = new AuthController();
