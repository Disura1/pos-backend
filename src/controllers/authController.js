const pool = require("../config/db");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const JWT_SECRET =
  process.env.JWT_SECRET || "TeenGirl_Boutique_Security_Key_2026_@789";

exports.login = async (req, res) => {
  const { username, password } = req.body;
  try {
    const result = await pool.query(
      `SELECT u.id, u.username, u.password_hash, u.full_name, u.branch_id,
              r.role_name, b.branch_name
       FROM users u
       JOIN roles r ON u.role_id = r.id
       LEFT JOIN branches b ON u.branch_id = b.id
       WHERE u.username = $1`,
      [username]
    );
    if (result.rows.length === 0)
      return res.status(401).json({ error: "Invalid credentials" });

    // Safely check is_active only if the column exists in the row
    const row = result.rows[0];
    if (row.is_active === false)
      return res.status(401).json({ error: "Account is deactivated" });

    const user = result.rows[0];
    const isMatch = await bcrypt.compare(password, user.password_hash);
    if (!isMatch) return res.status(401).json({ error: "Invalid credentials" });

    const token = jwt.sign(
      { id: user.id, role: user.role_name, branchId: user.branch_id },
      JWT_SECRET,
      { expiresIn: "12h" },
    );

    res.json({
      token,
      user: {
        id: user.id,
        username: user.username,
        fullName: user.full_name || null,
        role: user.role_name,
        branchId: user.branch_id,
        branchName: user.branch_name,
      },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.changePassword = async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  const userId = req.user.id;
  try {
    const result = await pool.query(
      "SELECT password_hash FROM users WHERE id = $1",
      [userId],
    );
    if (result.rows.length === 0)
      return res.status(404).json({ error: "User not found" });

    const isMatch = await bcrypt.compare(
      currentPassword,
      result.rows[0].password_hash,
    );
    if (!isMatch)
      return res.status(400).json({ error: "Current password is incorrect" });

    const hash = await bcrypt.hash(newPassword, 10);
    await pool.query("UPDATE users SET password_hash = $1 WHERE id = $2", [
      hash,
      userId,
    ]);
    res.json({ message: "Password changed successfully" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
