const express = require('express');
const taskController = require('../controllers/TaskController');
const { authMiddleware } = require('../middleware/auth');
const router = express.Router();

router.get('/my', authMiddleware, taskController.getMyApplications.bind(taskController));
router.post('/:id/cancel', authMiddleware, taskController.cancelApplication.bind(taskController));

module.exports = router;
