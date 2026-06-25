const express = require("express");
const router = express.Router();
const cc = require("../controllers/categoryController");
const { authenticate, authorize } = require("../middleware/auth");

const isOwner        = authorize("Owner", "Admin");
const isManagerOnly  = authorize("Manager");

router.use(authenticate);
router.get("/",     cc.getAllCategories);
router.post("/",    isManagerOnly, cc.createCategory);
router.put("/:id",  isManagerOnly, cc.updateCategory);
router.delete("/:id", isOwner,     cc.deleteCategory);

module.exports = router;
