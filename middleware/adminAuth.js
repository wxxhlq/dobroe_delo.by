const jwt = require('jsonwebtoken');

module.exports = function (req, res, next) {
    try {
        // Достаем токен из заголовка Authorization: Bearer TOKEN
        const authHeader = req.header('Authorization');
        if (!authHeader) {
            return res.status(401).json({ success: false, error: "Доступ запрещен. Войдите в систему." });
        }

        const token = authHeader.split(' ')[1];
        if (!token) {
            return res.status(401).json({ success: false, error: "Токен не найден." });
        }

        // Проверяем токен (используй тот же секрет, что в основной авторизации)
        const decoded = jwt.verify(token, process.env.JWT_SECRET || 'your_jwt_secret');

        // ГЛАВНАЯ ПРОВЕРКА: Если в токене роль не ADMIN — от ворот поворот
        if (decoded.role !== 'ADMIN') {
            return res.status(403).json({ success: false, error: "У вас недостаточно прав для этого действия." });
        }

        req.user = decoded;
        next(); // Всё ок, пропускаем к коду админки
    } catch (err) {
        res.status(401).json({ success: false, error: "Неверный или просроченный токен." });
    }
};