const express = require("express");
const router = express.Router();
const productController = require("../controllers/productController");

router.get("/scan/:barcode", productController.scanProduct);
router.get("/category/:categoryId", productController.getProductsByCategory); // For Explorer
router.get("/", productController.getAllProducts);
router.post("/", productController.createProduct);
router.put("/:id", productController.updateProduct);
router.delete("/:id", productController.deleteProduct);

module.exports = router;
