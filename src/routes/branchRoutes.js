const express = require('express');
const router = express.Router();
const bc = require('../controllers/branchController');
const { authenticate, authorize } = require('../middleware/auth');

const isOwner = authorize('Owner', 'Admin');

router.use(authenticate);
router.get('/', bc.getAllBranches);
router.get('/:id/stats', bc.getBranchStats);
router.post('/', isOwner, bc.createBranch);
router.put('/:id', isOwner, bc.updateBranch);
router.delete('/:id', isOwner, bc.deleteBranch);

module.exports = router;
