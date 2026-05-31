const express = require('express');
const router = express.Router();
const { login, changePassword } = require('../controllers/authController');
const { authenticate } = require('../middleware/auth');

router.post('/login', login);
router.put('/change-password', authenticate, changePassword);

module.exports = router;
