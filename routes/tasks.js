const express = require('express');
const taskController = require('../controllers/TaskController');
const { authMiddleware, requireOrganizer } = require('../middleware/auth');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const PROJECTS_DIR = path.join(__dirname, '../public/uploads/projects');
if (!fs.existsSync(PROJECTS_DIR)) {
    fs.mkdirSync(PROJECTS_DIR, { recursive: true });
}

const projectImageUpload = multer({
    storage: multer.diskStorage({
        destination: (req, file, cb) => cb(null, PROJECTS_DIR),
        filename: (req, file, cb) => {
            const safeExt = path.extname(file.originalname || '').toLowerCase().slice(0, 10);
            const base = `${req.user?.userId || 'project'}-${Date.now()}`;
            cb(null, `${base}${safeExt || ''}`);
        }
    }),
    limits: { fileSize: 8 * 1024 * 1024 }, // 8MB
    fileFilter: (req, file, cb) => {
        if (!file.mimetype || !file.mimetype.startsWith('image/')) {
            return cb(new Error('Можно загружать только изображения'));
        }
        cb(null, true);
    }
});

const router = express.Router();

router.get('/', taskController.getTasks.bind(taskController));
router.post('/', authMiddleware, requireOrganizer, projectImageUpload.single('image'), taskController.createTask.bind(taskController));
router.post('/:id/apply', authMiddleware, taskController.apply.bind(taskController));
router.put('/:id', authMiddleware, taskController.updateTask.bind(taskController));
router.post('/:id/reopen', authMiddleware, taskController.reopenTask.bind(taskController));
router.post('/:id/close', authMiddleware, taskController.closeTask.bind(taskController));
router.post('/:id/delete', authMiddleware, taskController.deleteTask.bind(taskController));

module.exports = router;
