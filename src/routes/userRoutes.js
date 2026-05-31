const express = require('express');
const router = express.Router();
const uc = require('../controllers/userController');
const { authenticate, authorize } = require('../middleware/auth');

const isOwner = authorize('Owner', 'Admin');

router.use(authenticate);
router.get('/roles', uc.getRoles);
router.get('/', isOwner, uc.getAllUsers);
router.post('/', isOwner, uc.createUser);
router.put('/:id', isOwner, uc.updateUser);
router.put('/:id/reset-password', isOwner, uc.resetUserPassword);

module.exports = router;
