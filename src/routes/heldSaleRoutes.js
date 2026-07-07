const express = require('express');
const router = express.Router();
const hc = require('../controllers/heldSaleController');
const { authenticate, authorize } = require('../middleware/auth');

const isCashier = authorize('Cashier');

router.use(authenticate);
router.use(isCashier);
router.post('/', hc.holdSale);
router.get('/', hc.getHeldSales);
router.post('/:id/resume', hc.resumeSale);
router.delete('/:id', hc.deleteHeldSale);

module.exports = router;