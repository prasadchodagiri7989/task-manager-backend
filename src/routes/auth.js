import express from "express";
import jwt from "jsonwebtoken";
import { User } from "../models/User.js";
import { ROLES, normalizeRole } from "../utils/roles.js";
import { authenticate } from "../middleware/auth.js";
import { permit } from "../middleware/permit.js";

const router = express.Router();

const sign = (user) =>
  jwt.sign({ id: user._id, role: normalizeRole(user.role) }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || "7d",
  });

// Seed first admin (once)
router.post("/seed-admin", async (req, res) => {
  try {
    const adminExists = await User.exists({ role: ROLES.ADMIN });
    if (adminExists) return res.status(403).json({ message: "Admin already exists" });

    const name = process.env.SEED_ADMIN_NAME || "Super Admin";
    const email = process.env.SEED_ADMIN_EMAIL || "admin@example.com";
    const password = process.env.SEED_ADMIN_PASSWORD || "Admin@123";

    const user = await User.create({ name, email, password, role: ROLES.ADMIN });
    return res.status(201).json({ message: "Seed admin created", email: user.email });
  } catch (e) {
    return res.status(500).json({ message: "Error seeding admin", error: e.message });
  }
});

router.post("/login", async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) {
    return res.status(400).json({ message: "Email and password are required" });
  }

  const user = await User.findOne({ email });
  if (!user) return res.status(400).json({ message: "Invalid credentials" });

  const ok = await user.comparePassword(password);
  if (!ok) return res.status(400).json({ message: "Invalid credentials" });

  return res.json({
    token: sign(user),
    user: user.toClient(),
  });
});


// Admin-only: create any role
router.post("/register", authenticate, permit(ROLES.ADMIN), async (req, res) => {
  try {
    const { name, email, password, role } = req.body || {};
    const normalized = normalizeRole(role);
    if (!Object.values(ROLES).includes(normalized)) {
      return res.status(400).json({ message: "Invalid role" });
    }
    const exists = await User.findOne({ email });
    if (exists) return res.status(409).json({ message: "Email in use" });

    const u = await User.create({ name, email, password, role: normalized });
    return res.status(201).json(u.toClient());
  } catch (e) {
    return res.status(500).json({ message: "Register error", error: e.message });
  }
});

export default router;
