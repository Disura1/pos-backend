const express = require('express');
const router = express.Router();
const sc = require('../controllers/stockController');
const { authenticate, authorize } = require('../middleware/auth');

const isOwnerOrManager = authorize('Owner', 'Admin', 'Manager');

router.use(authenticate);
router.get('/inventory',  isOwnerOrManager, sc.getInventory);
router.get('/low-stock',  isOwnerOrManager, sc.getLowStockAlerts);
router.get('/movements',  isOwnerOrManager, sc.getMovements);
router.post('/receive',   isOwnerOrManager, sc.receiveStock);
router.post('/adjust',    isOwnerOrManager, sc.adjustStock);
router.post('/transfer',  isOwnerOrManager, sc.transferStock);
router.put('/threshold',  isOwnerOrManager, sc.updateThreshold);

module.exports = router;
