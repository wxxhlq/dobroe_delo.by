const express = require('express');
const router = express.Router();
const newsController = require('../controllers/NewsController');
const { authMiddleware, requireAdmin } = require('../middleware/auth');

router.get('/', newsController.getNews);
router.post('/', authMiddleware, requireAdmin, newsController.createNews);
router.delete('/:id', authMiddleware, newsController.deleteNews);

module.exports = router;
