const express = require("express");
const router = express.Router();
const {
  login,
  changePassword,
  getMe,
} = require("../controllers/authController");
const { authenticate } = require("../middleware/auth");

router.post("/login", login);
router.put("/change-password", authenticate, changePassword);
router.get("/me", authenticate, getMe);

module.exports = router;
