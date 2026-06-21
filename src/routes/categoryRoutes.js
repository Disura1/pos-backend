const express = require("express");
const router = express.Router();
const cc = require("../controllers/categoryController");
const { authenticate, authorize } = require("../middleware/auth");

const isOwnerOrManager = authorize("Owner", "Admin", "Manager");
const isOwner = authorize("Owner", "Admin");

router.use(authenticate);
router.get("/", cc.getAllCategories);
router.post("/", isOwnerOrManager, cc.createCategory);
router.put("/:id", isOwnerOrManager, cc.updateCategory);
router.delete("/:id", isOwner, cc.deleteCategory);

module.exports = router;
