const express = require('express');
const router = express.Router();
const dc = require('../controllers/discountController');
const { authenticate, authorize } = require('../middleware/auth');

const isOwner = authorize('Owner', 'Admin');

router.use(authenticate);
router.get('/active', dc.getActiveDiscounts);
router.get('/', isOwner, dc.getAllDiscounts);
router.post('/', isOwner, dc.createDiscount);
router.put('/:id', isOwner, dc.updateDiscount);
router.delete('/:id', isOwner, dc.deleteDiscount);

module.exports = router;
