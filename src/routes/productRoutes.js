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
router.get("/:productId/variants", pc.getVariants);
router.post("/", isManagerOnly, pc.createProduct);
router.put("/:id", isManagerOnly, pc.updateProduct);
router.delete("/:id", isManagerOnly, pc.deleteProduct);
router.post("/variant", isManagerOnly, pc.addVariant);
router.put("/variant/:id", isManagerOnly, pc.updateVariant);
router.delete("/variant/:id", isManagerOnly, pc.deleteVariant);

module.exports = router;
