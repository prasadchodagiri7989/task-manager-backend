import express from "express";
import { User } from "../models/User.js";
import { authenticate } from "../middleware/auth.js";
import { permit } from "../middleware/permit.js";
import { ROLES } from "../utils/roles.js";

const router = express.Router();

router.get("/", authenticate, async (req, res) => {
  try {
    const { role } = req.query;
    const query = {};

    if (role) {
      const r = String(role).toLowerCase();
      if (!Object.values(ROLES).includes(r)) {
        return res.status(400).json({ message: "Invalid role filter" });
      }
      if (req.user.role === ROLES.MANAGER && r !== ROLES.WORKER) {
        return res.status(403).json({ message: "Managers can only view workers" });
      }
      query.role = r;
    } else if (req.user.role === ROLES.MANAGER) {
      query.role = ROLES.WORKER;
    }

    const users = await User.find(query).sort({ createdAt: -1 });
    return res.json(users.map((u) => u.toClient())); // <-- includes { id: "<ObjectId>" }
  } catch (e) {
    return res.status(500).json({ message: "List users error", error: e.message });
  }
});

// Admin: toggle active by numeric uid (keep as-is if you use uid)
router.patch("/:id/toggle", authenticate, permit(ROLES.ADMIN), async (req, res) => {
  try {
    const user = await User.findOne({ uid: +req.params.id });
    if (!user) return res.status(404).json({ message: "User not found" });
    user.isActive = !user.isActive;
    await user.save();
    return res.json({ id: user.uid, isActive: user.isActive });
  } catch (e) {
    return res.status(500).json({ message: "Toggle user error", error: e.message });
  }
});

export default router;
