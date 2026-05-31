const express = require('express');
const router = express.Router();
const sc = require('../controllers/saleController');
const { authenticate } = require('../middleware/auth');

router.use(authenticate);
router.post('/checkout', sc.checkout);
router.get('/history', sc.getHistory);
router.get('/:id', sc.getSaleDetail);

module.exports = router;
