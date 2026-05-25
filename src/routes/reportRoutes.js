const express = require("express");
const router = express.Router();
const reportController = require("../controllers/reportController");

// Route: http://localhost:5000/api/reports/daily-summary
router.get("/daily-summary", reportController.getDailySummary);

module.exports = router;