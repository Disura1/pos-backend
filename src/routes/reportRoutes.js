const express = require('express');
const router = express.Router();
const rc = require('../controllers/reportController');
const { authenticate, authorize } = require('../middleware/auth');

const isOwner = authorize('Owner', 'Admin');

router.use(authenticate);
router.get('/daily-summary',     rc.getDailySummary);
router.get('/revenue-by-period', rc.getRevenueByPeriod);
router.get('/top-products',      rc.getTopProducts);
router.get('/branch-comparison', isOwner, rc.getBranchComparison);
router.get('/date-range',        rc.getDateRangeReport);

module.exports = router;
