import jwt from "jsonwebtoken";
import { User } from "../models/User.js";
import { normalizeRole } from "../utils/roles.js";

export const authenticate = async (req, res, next) => {
  try {
    const auth = req.headers.authorization || "";
    const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;
    if (!token) return res.status(401).json({ message: "No token provided" });

    const payload = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(payload.id);
    if (!user || !user.isActive) return res.status(401).json({ message: "Invalid token" });

    req.user = {
      _id: user._id,
      id: user.uid, // numeric for convenience
      role: normalizeRole(user.role),
      name: user.name,
      email: user.email,
    };
    next();
  } catch (err) {
    return res.status(401).json({ message: "Unauthorized", error: err.message });
  }
};
