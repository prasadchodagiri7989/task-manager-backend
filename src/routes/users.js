import express from "express";
import { User } from "../models/User.js";
import { authenticate } from "../middleware/auth.js";
import { permit } from "../middleware/permit.js";
import { ROLES } from "../utils/roles.js";

const router = express.Router();
// POST /users - admin can create a user
router.post('/', authenticate, permit(ROLES.ADMIN), async (req, res) => {
  try {
    const { name, email, password, role } = req.body;
    if (!name || !email || !password || !role) {
      return res.status(400).json({ message: 'Name, email, password, and role are required' });

    }
    if (!Object.values(ROLES).includes(role)) {
      return res.status(400).json({ message: 'Invalid role' });
    }
    // Check if email already exists
    const existing = await User.findOne({ email });
    if (existing) {
      return res.status(409).json({ message: 'Email already exists' });
    }
    const user = await User.create({ name, email, password, role, isActive: true });
    return res.status(201).json(user.toClient ? user.toClient() : user);
  } catch (e) {
    return res.status(500).json({ message: 'Create user error', error: e.message });
  }
});

    // DELETE /:id - delete user (admin only)
    router.delete('/:id', authenticate, permit(ROLES.ADMIN), async (req, res) => {
      try {
        const user = await User.findByIdAndDelete(req.params.id);
        if (!user) return res.status(404).json({ message: 'User not found' });
        return res.json({ message: 'User deleted', id: req.params.id });
      } catch (e) {
        return res.status(500).json({ message: 'Delete user error', error: e.message });
      }
    });


// PATCH /:id - edit user details (admin only)
router.patch('/:id', authenticate, permit(ROLES.ADMIN), async (req, res) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ message: 'User not found' });
    const allowedFields = ['name', 'email', 'role', 'isActive'];
    for (const key of allowedFields) {
      if (key in req.body) user[key] = req.body[key];
    }
    await user.save();
    return res.json(user.toClient ? user.toClient() : user);
  } catch (e) {
    return res.status(500).json({ message: 'Edit user error', error: e.message });
  }
});

router.get("/", authenticate, async (req, res) => {
  try {
    const { role } = req.query;
    const query = {};

    if (role) {
      const r = String(role).toLowerCase();
      if (!Object.values(ROLES).includes(r)) {
        return res.status(400).json({ message: "Invalid role filter" });
      }
      if (req.user.role === ROLES.MANAGER && r !== ROLES.EMPLOYEE) {
        return res.status(403).json({ message: "Managers can only view workers" });
      }
      query.role = r;
    } else if (req.user.role === ROLES.MANAGER) {   //check -1
      query.role = ROLES.EMPLOYEE;
    }

    const users = await User.find(query).sort({ createdAt: -1 });
    return res.json(users.map((u) => u.toClient())); // <-- includes { id: "<ObjectId>" }
  } catch (e) {
    return res.status(500).json({ message: "List users error", error: e.message });
  }
});

// Admin: toggle active by numeric uid (keep as-is if you use uid)
// Toggle active by MongoDB ObjectId
router.patch("/:id/toggle", authenticate, permit(ROLES.ADMIN), async (req, res) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ message: "User not found" });
    user.isActive = !user.isActive;
    await user.save();
    return res.json({ id: user._id, isActive: user.isActive });
  } catch (e) {
    return res.status(500).json({ message: "Toggle user error", error: e.message });
  }
});

// PATCH /:id/password - update user password
router.patch('/:id/password', authenticate, async (req, res) => {
  try {
    const { password } = req.body;
    if (!password || password.length < 6) {
      return res.status(400).json({ message: 'Password must be at least 6 characters' });
    }
    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ message: 'User not found' });
    user.password = password; // If you hash passwords, use user.setPassword(password) or similar
    await user.save();
    return res.json({ message: 'Password updated' });
  } catch (e) {
    return res.status(500).json({ message: 'Update password error', error: e.message });
  }
});
export default router;
