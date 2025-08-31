
import express from "express";
import { Task } from "../models/Task.js";
import { User } from "../models/User.js";
import { Group } from "../models/Group.js";
import { authenticate } from "../middleware/auth.js";
import { permit } from "../middleware/permit.js";
import mongoose from "mongoose";


const router = express.Router();

// Apply authenticate + permit middleware for all routes
router.use(authenticate, permit("admin")); // only admin can access

/**
 * GET /admin/dashboard/summary
 */
router.get("/summary", async (req, res) => {
  try {
    const { userId } = req.query;
    let userFilter = {};
    if (userId && userId !== 'all') {
      userFilter = { "assignedTo.user": new mongoose.Types.ObjectId(userId) };
    }

    const totalUsers = await User.countDocuments();
    const totalTasks = await Task.countDocuments(userFilter);
    const completedTasks = await Task.countDocuments({ ...userFilter, "status.status": "Completed" });
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
    const { userId } = req.query;
    let match = {};
    if (userId && userId !== 'all') {
      match = { "assignedTo.user": new mongoose.Types.ObjectId(userId) };
    }
    const aggregation = await Task.aggregate([
      { $match: match },
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
    const { userId } = req.query;
    let match = {};
    if (userId && userId !== 'all') {
      match = { "assignedTo.user": new mongoose.Types.ObjectId(userId) };
    }
    const aggregation = await Task.aggregate([
      { $match: match },
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
    const { userId } = req.query;
    const daysAgo = new Date();
    daysAgo.setDate(daysAgo.getDate() - 30);

    let match = { createdAt: { $gte: daysAgo } };
    if (userId && userId !== 'all') {
      match["assignedTo.user"] = new mongoose.Types.ObjectId(userId);
    }

    const aggregation = await Task.aggregate([
      { $match: match },
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
    const { userId } = req.query;
    let match = { "status.status": "Completed" };
    if (userId && userId !== 'all') {
      match["assignedTo.user"] = new mongoose.Types.ObjectId(userId);
    }
    const aggregation = await Task.aggregate([
      { $match: match },
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
    const { userId } = req.query;
    let match = { "status.status": "Completed", "assignedTo.group": { $ne: null } };
    if (userId && userId !== 'all') {
      match["assignedTo.user"] = new mongoose.Types.ObjectId(userId);
    }
    const aggregation = await Task.aggregate([
      { $match: match },
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


/**
 * GET /admin/dashboard/reassignment-stats
 * Returns total tasks and how many have been reassigned (statusHistory contains 'Reassigned')
 */
router.get('/reassignment-stats', async (req, res) => {
  try {
    const { userId } = req.query;
    let match = {};
    if (userId && userId !== 'all') {
      match["assignedTo.user"] = new mongoose.Types.ObjectId(userId);
    }
    // Count tasks that have a non-empty statusHistory with a status of "Reassigned"
    const reassignedTasks = await Task.countDocuments({
      ...match,
      statusHistory: { $elemMatch: { status: "Reassigned" } }
    });

    // Optionally, return more detailed stats
    const totalTasks = await Task.countDocuments(match);

    res.json({
      totalTasks,
      reassignedTasks
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
