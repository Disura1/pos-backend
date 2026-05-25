const pool = require("../config/db");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");

exports.login = async (req, res) => {
  const { username, password } = req.body;
  console.log("Login attempt for:", username); // DEBUG
  try {
    const result = await pool.query(
      "SELECT u.*, r.role_name FROM users u JOIN roles r ON u.role_id = r.id WHERE u.username = $1",
      [username],
    );

    if (result.rows.length === 0) {
      console.log("User not found or role missing in DB"); // DEBUG
      return res.status(401).json({ error: "Invalid credentials" });
    }

    const user = result.rows[0];
    const isMatch = await bcrypt.compare(password, user.password_hash);

    console.log("Password match:", isMatch); // DEBUG

    if (!isMatch) {
      return res.status(401).json({ error: "Invalid credentials" });
    }

    const token = jwt.sign(
      { id: user.id, role: user.role_name },
      process.env.JWT_SECRET || "TeenGirl_Boutique_Security_Key_2026_@789",
      { expiresIn: "12h" },
    );

    res.json({
      token,
      username: user.username,
      role: user.role_name,
    });
  } catch (err) {
    console.error("Database error:", err.message); // DEBUG
    res.status(500).json({ error: err.message });
  }
};
