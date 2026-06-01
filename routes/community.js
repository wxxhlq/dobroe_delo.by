const express = require('express');
const router = express.Router();
const communityController = require('../controllers/CommunityController');
const { authMiddleware } = require('../middleware/auth');

router.get('/posts', communityController.getPosts);
router.post('/posts', authMiddleware, communityController.createPost);
router.post('/posts/:id/like', authMiddleware, communityController.toggleLike);
router.post('/posts/:id/comment', authMiddleware, communityController.addComment);
router.delete('/posts/:id', authMiddleware, communityController.deletePost);

module.exports = router;
