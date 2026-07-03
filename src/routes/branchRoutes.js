const express = require("express");
const router = express.Router();
const {
  getAllBranches,
  createBranch,
  updateBranch,
  deleteBranch,
  hardDeleteBranch,
  getBranchStats,
} = require("../controllers/branchController");
const { authenticate, authorize } = require("../middleware/auth");

const isOwner = authorize("Owner", "Admin");

router.get("/",             authenticate,          getAllBranches);
router.post("/",            authenticate, isOwner, createBranch);
router.put("/:id",          authenticate, isOwner, updateBranch);
router.delete("/:id",       authenticate, isOwner, deleteBranch);
router.delete("/:id/hard",  authenticate, isOwner, hardDeleteBranch);
router.get("/:id/stats",    authenticate,          getBranchStats);

module.exports = router;