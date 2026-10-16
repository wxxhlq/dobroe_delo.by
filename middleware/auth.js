const jwt = require('jsonwebtoken');

function authMiddleware(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
        return res.status(401).json({ message: 'Токен не передан' });
    }

    jwt.verify(token, process.env.JWT_SECRET, (err, payload) => {
        if (err) {
            return res.status(403).json({ message: 'Неверный или истекший токен' });
        }
        req.user = payload;
        next();
    });
}

function requireOrganizer(req, res, next) {
    if (!req.user) {
        return res.status(401).json({ message: 'Токен не передан или недействителен' });
    }
    const role = String(req.user.role).toUpperCase();
    if (role !== 'ORGANIZER' && role !== 'MODERATOR' && role !== 'ADMIN') {
        return res.status(403).json({ message: 'Доступ только для организаторов, модераторов или администраторов' });
    }
    next();
}

function requireModerator(req, res, next) {
    if (!req.user) {
        return res.status(401).json({ message: 'Токен не передан или недействителен' });
    }
    const role = String(req.user.role).toUpperCase();
    if (role !== 'MODERATOR' && role !== 'ADMIN') {
        return res.status(403).json({ message: 'Доступ только для модераторов или администраторов' });
    }
    next();
}

function requireAdmin(req, res, next) {
    if (!req.user) {
        return res.status(401).json({ message: 'Токен не передан или недействителен' });
    }
    const role = String(req.user.role).toUpperCase();
    if (role !== 'ADMIN') {
        return res.status(403).json({ message: 'Доступ только для администраторов' });
    }
    next();
}

module.exports = { authMiddleware, requireOrganizer, requireModerator, requireAdmin };
