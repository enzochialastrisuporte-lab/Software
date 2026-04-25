
const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const pool = require("../config/db");
const rateLimit = require("express-rate-limit");

const router = express.Router();

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5
});

router.post("/register", async (req, res) => {
  const { name, email, password } = req.body;
  const hash = await bcrypt.hash(password, 12);

  await pool.query(
    "INSERT INTO users (name,email,password,role,status) VALUES ($1,$2,$3,$4,$5)",
    [name, email, hash, "gestor", "pending"]
  );

  res.json({ message: "Conta criada. Aguarde aprovação." });
});

router.post("/login", limiter, async (req, res) => {
  const { email, password } = req.body;

  const result = await pool.query("SELECT * FROM users WHERE email=$1", [email]);
  const user = result.rows[0];

  if (!user) return res.status(401).json({ message: "Credenciais inválidas" });
  if (user.status !== "approved")
    return res.status(403).json({ message: "Conta não aprovada" });

  const valid = await bcrypt.compare(password, user.password);
  if (!valid) return res.status(401).json({ message: "Credenciais inválidas" });

  const token = jwt.sign(
    { id: user.id, role: user.role },
    process.env.JWT_SECRET,
    { expiresIn: "15m" }
  );

  res.cookie("token", token, { httpOnly: true, sameSite: "lax" });
  res.json({ ok: true });
});

module.exports = router;
