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
const { authenticate } = require("../middleware/auth");

router.get("/", authenticate, getAllBranches);
router.post("/", authenticate, createBranch);
router.put("/:id", authenticate, updateBranch);
router.delete("/:id", authenticate, deleteBranch); // deactivate
router.delete("/:id/hard", authenticate, hardDeleteBranch); // permanent delete
router.get("/:id/stats", authenticate, getBranchStats);

module.exports = router;
