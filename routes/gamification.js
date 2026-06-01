const express = require('express');
const router = express.Router();
const gamificationController = require('../controllers/GamificationController');

router.get('/community/leaderboard', gamificationController.getLeaderboard);
router.get('/achievements/:userId', gamificationController.getUserAchievements);

module.exports = router;
