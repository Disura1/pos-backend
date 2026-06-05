const express = require("express");
const router = express.Router();
const pc = require("../controllers/productController");
const { authenticate, authorize } = require("../middleware/auth");

const isOwnerOrManager = authorize("Owner", "Admin", "Manager");
const isOwner = authorize("Owner", "Admin");

router.use(authenticate);
router.get("/search", pc.searchProducts);
router.get("/scan/:barcode", pc.scanProduct);
router.get("/all", pc.getAllProducts);
router.get("/category/:categoryId", pc.getProductsByCategory);
router.get("/:productId/variants", pc.getVariants);
router.post("/", isOwnerOrManager, pc.createProduct);
router.put("/:id", isOwnerOrManager, pc.updateProduct);
router.delete("/:id", isOwnerOrManager, pc.deleteProduct);
router.post("/variant", isOwnerOrManager, pc.addVariant);
router.put("/variant/:id", isOwnerOrManager, pc.updateVariant);
router.delete("/variant/:id", isOwnerOrManager, pc.deleteVariant);

module.exports = router;
