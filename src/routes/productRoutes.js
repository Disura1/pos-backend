const express = require("express");
const router = express.Router();
const pc = require("../controllers/productController");
const { authenticate, authorize } = require("../middleware/auth");

const isOwnerOrManager = authorize("Owner", "Admin", "Manager");
const isOwner = authorize("Owner", "Admin");
const isManagerOnly = authorize("Manager");

router.use(authenticate);
router.get("/search", pc.searchProducts);
router.get("/scan/:barcode", pc.scanProduct);
router.get("/all", pc.getAllProducts);
router.get("/category/:categoryId", pc.getProductsByCategory);
router.get("/category/:categoryId/branch", pc.getProductsByCategoryAndBranch);
router.get("/category/:categoryId/with-stock", isOwnerOrManager, pc.getProductsByCategoryWithStock);
router.get("/:productId/variants",             isOwnerOrManager, pc.getVariants);
router.get("/:productId/variants/branch",      isOwnerOrManager, pc.getVariantsByBranch);
router.post("/", isManagerOnly, pc.createProduct);
router.put("/:id", isManagerOnly, pc.updateProduct);
router.delete("/:id", isOwner, pc.deleteProduct);
router.post("/variant", isManagerOnly, pc.addVariant);
router.put("/variant/:id", isManagerOnly, pc.updateVariant);
router.delete("/variant/:id", isOwner, pc.deleteVariant);

module.exports = router;
