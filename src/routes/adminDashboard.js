import express from "express";
import { Task } from "../models/Task.js";
import { User } from "../models/User.js";
import { Group } from "../models/Group.js";
import { authenticate } from "../middleware/auth.js";
import { permit } from "../middleware/permit.js";

const router = express.Router();

// Apply authenticate + permit middleware for all routes
router.use(authenticate, permit("admin")); // only admin can access

/**
 * GET /admin/dashboard/summary
 */
router.get("/summary", async (req, res) => {
  try {
    const totalUsers = await User.countDocuments();
    const totalTasks = await Task.countDocuments();
    const completedTasks = await Task.countDocuments({ "status.status": "Completed" });
    const activeGroups = await Group.countDocuments({ isActive: true });

    res.json({ totalUsers, totalTasks, completedTasks, activeGroups });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /admin/dashboard/tasks-by-status
 */
router.get("/tasks-by-status", async (req, res) => {
  try {
    const aggregation = await Task.aggregate([
      { $group: { _id: "$status.status", count: { $sum: 1 } } }
    ]);

    const result = aggregation.reduce((acc, cur) => {
      acc[cur._id] = cur.count;
      return acc;
    }, {});

    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /admin/dashboard/tasks-by-priority
 */
router.get("/tasks-by-priority", async (req, res) => {
  try {
    const aggregation = await Task.aggregate([
      { $group: { _id: "$priority", count: { $sum: 1 } } }
    ]);

    const result = aggregation.reduce((acc, cur) => {
      acc[cur._id] = cur.count;
      return acc;
    }, {});

    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /admin/dashboard/tasks-over-time
 */
router.get("/tasks-over-time", async (req, res) => {
  try {
    const daysAgo = new Date();
    daysAgo.setDate(daysAgo.getDate() - 30);

    const aggregation = await Task.aggregate([
      { $match: { createdAt: { $gte: daysAgo } } },
      { $group: { _id: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } }, count: { $sum: 1 } } },
      { $sort: { _id: 1 } }
    ]);

    res.json(aggregation.map(a => ({ date: a._id, count: a.count })));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /admin/dashboard/user-performance
 */
router.get("/user-performance", async (req, res) => {
  try {
    const aggregation = await Task.aggregate([
      { $match: { "status.status": "Completed" } },
      { $group: { _id: "$assignedTo.user", completedTasks: { $sum: 1 } } },
      { $lookup: { from: "users", localField: "_id", foreignField: "_id", as: "user" } },
      { $unwind: "$user" },
      { $project: { userName: "$user.name", completedTasks: 1 } },
      { $sort: { completedTasks: -1 } }
    ]);

    res.json(aggregation);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /admin/dashboard/group-performance
 */
router.get("/group-performance", async (req, res) => {
  try {
    const aggregation = await Task.aggregate([
      { $match: { "status.status": "Completed", "assignedTo.group": { $ne: null } } },
      { $group: { _id: "$assignedTo.group", completedTasks: { $sum: 1 } } },
      { $lookup: { from: "groups", localField: "_id", foreignField: "_id", as: "group" } },
      { $unwind: "$group" },
      { $project: { groupName: "$group.title", completedTasks: 1 } },
      { $sort: { completedTasks: -1 } }
    ]);

    res.json(aggregation);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
