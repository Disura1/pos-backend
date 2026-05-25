const express = require("express");
const router = express.Router();
const saleController = require("../controllers/saleController");

router.post("/checkout", saleController.checkout);
router.get("/history", saleController.getHistory);

module.exports = router;