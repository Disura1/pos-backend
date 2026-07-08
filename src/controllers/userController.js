const pool = require("../config/db");
const bcrypt = require("bcrypt");

exports.getAllUsers = async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT u.id, u.username, u.full_name, u.is_active, u.created_at,
             r.role_name, b.branch_name, u.branch_id, u.role_id
      FROM users u
      JOIN roles r ON u.role_id = r.id
      LEFT JOIN branches b ON u.branch_id = b.id
      ORDER BY u.created_at DESC
    `);
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Something went wrong. Please try again." });
  }
};

exports.createUser = async (req, res) => {
  const { username, password, full_name, role_id, branch_id } = req.body;
  if (!password || password.length < 6)
    return res.status(400).json({ error: "Password must be at least 6 characters" });
  if (!username || !username.trim())
    return res.status(400).json({ error: "Username is required" });
  if (!role_id) return res.status(400).json({ error: "Role is required" });
  try {
    const roleRes = await pool.query("SELECT role_name FROM roles WHERE id = $1", [role_id]);
    if (!roleRes.rows.length) return res.status(400).json({ error: "Invalid role" });
    const isOwnerRole = ["Owner", "Admin"].includes(roleRes.rows[0].role_name);
    if (!isOwnerRole && !branch_id) {
      return res.status(400).json({ error: "Branch is required for this role" });
    }
    const hash = await bcrypt.hash(password, 10);
    const result = await pool.query(
      `INSERT INTO users (username, password_hash, full_name, role_id, branch_id)
       VALUES ($1, $2, $3, $4, $5) RETURNING id, username, full_name, role_id, branch_id, is_active, created_at`,
      [username, hash, full_name, role_id, isOwnerRole ? null : branch_id],
    );
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    if (err.code === "23505")
      return res.status(400).json({ error: "Username already exists" });
    res.status(500).json({ error: "Something went wrong. Please try again." });
  }
};

exports.updateUser = async (req, res) => {
  const { id } = req.params;
  const { full_name, role_id, branch_id, is_active } = req.body;
  try {
    if (!role_id) return res.status(400).json({ error: "Role is required" });
    if (!id || isNaN(parseInt(id)))
      return res.status(400).json({ error: "Invalid user ID" });

    const roleRes = await pool.query("SELECT role_name FROM roles WHERE id = $1", [role_id]);
    if (!roleRes.rows.length) return res.status(400).json({ error: "Invalid role" });
    const isOwnerRole = ["Owner", "Admin"].includes(roleRes.rows[0].role_name);
    if (!isOwnerRole && !branch_id) {
      return res.status(400).json({ error: "Branch is required for this role" });
    }

    if (req.user.id === parseInt(id) && is_active === false) {
      return res.status(400).json({ error: "You cannot deactivate your own account" });
    }
    if (req.user.id === parseInt(id)) {
      const currentRole = await pool.query("SELECT role_id FROM users WHERE id = $1", [id]);
      if (currentRole.rows[0]?.role_id !== parseInt(role_id)) {
        return res.status(400).json({ error: "You cannot change your own role" });
      }
    }
    const result = await pool.query(
      `UPDATE users SET full_name=$1, role_id=$2, branch_id=$3, is_active=$4
       WHERE id=$5 RETURNING id, username, full_name, role_id, branch_id, is_active`,
      [full_name, role_id, isOwnerRole ? null : branch_id, is_active, parseInt(id)],
    );
    if (!result.rows.length)
      return res.status(404).json({ error: "User not found" });
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Something went wrong. Please try again." });
  }
};

exports.resetUserPassword = async (req, res) => {
  const { id } = req.params;
  const { newPassword } = req.body;
  if (!newPassword || newPassword.length < 6)
    return res
      .status(400)
      .json({ error: "Password must be at least 6 characters" });
  if (!id || isNaN(parseInt(id)))
    return res.status(400).json({ error: "Invalid user ID" });
  try {
    const hash = await bcrypt.hash(newPassword, 10);
    const result = await pool.query(
      "UPDATE users SET password_hash = $1 WHERE id = $2 RETURNING id",
      [hash, id],
    );
    if (!result.rows.length)
      return res.status(404).json({ error: "User not found" });
    res.json({ message: "Password reset successfully" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Something went wrong. Please try again." });
  }
};

exports.getRoles = async (req, res) => {
  try {
    const result = await pool.query("SELECT * FROM roles ORDER BY id");
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Something went wrong. Please try again." });
  }
};
