const express = require('express');
const authController = require('../controllers/AuthController');
const router = express.Router();

router.post('/register', authController.register.bind(authController));
router.post('/login', authController.login.bind(authController));

module.exports = router;
