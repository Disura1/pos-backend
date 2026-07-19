const express = require('express');
const router = express.Router();
const rc = require('../controllers/returnController');
const { authenticate, authorize } = require('../middleware/auth');

const isCashier = authorize('Cashier');
const isAnyStaff = authorize('Owner', 'Admin', 'Manager', 'Cashier');

router.use(authenticate);
router.get('/lookup', isAnyStaff, rc.lookupSale);
router.post('/', isCashier, rc.processReturn);
router.get('/history', isAnyStaff, rc.getReturnHistory);

module.exports = router;