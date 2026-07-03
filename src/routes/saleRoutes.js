const express = require('express');
const router = express.Router();
const sc = require('../controllers/saleController');
const { authenticate, authorize } = require('../middleware/auth');

const isCashier        = authorize('Cashier');
const isOwnerOrManager = authorize('Owner', 'Admin', 'Manager');

router.use(authenticate);
router.post('/checkout', isCashier,        sc.checkout);
router.get('/history',                     sc.getHistory);
router.get('/:id',                         sc.getSaleDetail);

module.exports = router;