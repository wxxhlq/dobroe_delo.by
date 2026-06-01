const express = require('express');
const router = express.Router();
const userController = require('../controllers/UserController');
const { authMiddleware } = require('../middleware/auth');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const avatarsDir = path.join(__dirname, '../public/uploads/avatars');
if (!fs.existsSync(avatarsDir)) {
    fs.mkdirSync(avatarsDir, { recursive: true });
}

const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, avatarsDir),
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, 'avatar-' + uniqueSuffix + path.extname(file.originalname));
    }
});
const avatarUpload = multer({ storage });

router.get('/me', authMiddleware, userController.getMe);
router.put('/me', authMiddleware, userController.updateMe);
router.post('/me/avatar', authMiddleware, avatarUpload.single('avatar'), userController.uploadAvatar);
router.get('/check-session', authMiddleware, userController.checkSession);
router.post('/api/user/ping', authMiddleware, userController.ping);
router.post('/api/user/update-activity', authMiddleware, userController.ping);
router.post('/api/user/logout-ping', (req, res) => res.sendStatus(200));

module.exports = router;
