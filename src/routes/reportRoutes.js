const express = require('express');
const router = express.Router();
const rc = require('../controllers/reportController');
const { authenticate, authorize } = require('../middleware/auth');

const isOwner          = authorize('Owner', 'Admin');
const isOwnerOrManager = authorize('Owner', 'Admin', 'Manager');

router.use(authenticate);
router.get('/daily-summary',     isOwnerOrManager, rc.getDailySummary);
router.get('/revenue-by-period', isOwnerOrManager, rc.getRevenueByPeriod);
router.get('/top-products',      isOwnerOrManager, rc.getTopProducts);
router.get('/branch-comparison', isOwner,          rc.getBranchComparison);
router.get('/date-range', isOwnerOrManager, rc.getDateRangeReport);

module.exports = router;