// routes/userTasks.js
import express from "express";
import mongoose from "mongoose";

import { UserTasks } from "../models/User.js";
import { Task } from "../models/Task.js";
import { authenticate } from "../middleware/auth.js";
import { ROLES, normalizeRole, STATUSES } from "../utils/roles.js";

const router = express.Router();

/* -----------------------------------------------------------
 * Get user's assigned tasks
 * --------------------------------------------------------- */
router.get("/:userId", authenticate, async (req, res) => {
  try {
    const { userId } = req.params;
    const { status } = req.query;

    // Permission check - users can only see their own tasks unless admin/manager
    const actorRole = normalizeRole(req.user.role);
    if (actorRole !== ROLES.ADMIN && String(req.user._id) !== userId) {
      return res.status(403).json({ 
        message: "You can only view your own assigned tasks" 
      });
    }

    if (!mongoose.isValidObjectId(userId)) {
      return res.status(400).json({ message: "Invalid user ID" });
    }

    let userTasks = await UserTasks.findOne({ userId }).populate('assignedTasks.taskId');
    
    if (!userTasks) {
      return res.json({
        userId,
        assignedTasks: [],
        total: 0
      });
    }

    let tasks = userTasks.assignedTasks;

    // Filter by status if provided
    if (status && STATUSES.includes(status)) {
      tasks = tasks.filter(task => task.status === status);
    }

    return res.json({
      ...userTasks.toClient(),
      assignedTasks: tasks,
      total: tasks.length
    });
  } catch (e) {
    return res.status(500).json({ 
      message: "Get user tasks error", 
      error: e.message 
    });
  }
});

/* -----------------------------------------------------------
 * Assign task to user
 * --------------------------------------------------------- */
router.post("/:userId/tasks", authenticate, async (req, res) => {
  try {
    const { userId } = req.params;
    const { taskId, status = "Todo" } = req.body;

    const actorRole = normalizeRole(req.user.role);
    if (![ROLES.ADMIN, ROLES.MANAGER].includes(actorRole)) {
      return res.status(403).json({ 
        message: "Only admin/manager can assign tasks" 
      });
    }

    if (!mongoose.isValidObjectId(userId) || !mongoose.isValidObjectId(taskId)) {
      return res.status(400).json({ message: "Invalid user ID or task ID" });
    }

    if (!STATUSES.includes(status)) {
      return res.status(400).json({ 
        message: `Status must be one of: ${STATUSES.join(", ")}` 
      });
    }

    // Check if task exists
    const taskDoc = await Task.findById(taskId);
    if (!taskDoc) {
      return res.status(404).json({ message: "Task not found" });
    }

    // Find or create UserTasks document
    let userTasks = await UserTasks.findOne({ userId });
    if (!userTasks) {
      userTasks = new UserTasks({ userId, assignedTasks: [] });
    }

    await userTasks.addTask(taskId, req.user._id, status);

    // Also update the main Task document
    await taskDoc.assignUsers([userId]);
    if (taskDoc.status.status !== status) {
      await taskDoc.updateStatus(status, req.user._id, `Assigned to user ${userId}`);
    }

    await userTasks.populate('assignedTasks.taskId');
    return res.status(201).json(userTasks.toClient());
  } catch (e) {
    return res.status(500).json({ 
      message: "Assign task error", 
      error: e.message 
    });
  }
});

/* -----------------------------------------------------------
 * Update task status for user
 * --------------------------------------------------------- */
router.patch("/:userId/tasks/:taskId", authenticate, async (req, res) => {
  try {
    const { userId, taskId } = req.params;
    const { status } = req.body;

    if (!status || !STATUSES.includes(status)) {
      return res.status(400).json({ 
        message: `Status is required and must be one of: ${STATUSES.join(", ")}` 
      });
    }

    // Permission check
    const actorRole = normalizeRole(req.user.role);
    const isOwnTask = String(req.user._id) === userId;
    
    if (actorRole !== ROLES.ADMIN && !isOwnTask) {
      return res.status(403).json({ 
        message: "You can only update your own task status" 
      });
    }

    if (!mongoose.isValidObjectId(userId) || !mongoose.isValidObjectId(taskId)) {
      return res.status(400).json({ message: "Invalid user ID or task ID" });
    }

    const userTasks = await UserTasks.findOne({ userId });
    if (!userTasks) {
      return res.status(404).json({ message: "User has no assigned tasks" });
    }

    await userTasks.updateTaskStatus(taskId, status);

    // Also update main Task status
    const taskDoc = await Task.findById(taskId);
    if (taskDoc) {
      await taskDoc.updateStatus(status, req.user._id, `Updated by user ${req.user.email}`);
    }

    await userTasks.populate('assignedTasks.taskId');
    return res.json(userTasks.toClient());
  } catch (e) {
    return res.status(500).json({ 
      message: "Update task status error", 
      error: e.message 
    });
  }
});

/* -----------------------------------------------------------
 * Remove task from user
 * --------------------------------------------------------- */
router.delete("/:userId/tasks/:taskId", authenticate, async (req, res) => {
  try {
    const { userId, taskId } = req.params;

    const actorRole = normalizeRole(req.user.role);
    if (![ROLES.ADMIN, ROLES.MANAGER].includes(actorRole)) {
      return res.status(403).json({ 
        message: "Only admin/manager can remove task assignments" 
      });
    }

    if (!mongoose.isValidObjectId(userId) || !mongoose.isValidObjectId(taskId)) {
      return res.status(400).json({ message: "Invalid user ID or task ID" });
    }

    const userTasks = await UserTasks.findOne({ userId });
    if (!userTasks) {
      return res.status(404).json({ message: "User has no assigned tasks" });
    }

    await userTasks.removeTask(taskId);

    // Also update main Task document
    const taskDoc = await Task.findById(taskId);
    if (taskDoc) {
      await taskDoc.removeUsers([userId]);
    }

    return res.json({ message: "Task removed from user successfully" });
  } catch (e) {
    return res.status(500).json({ 
      message: "Remove task error", 
      error: e.message 
    });
  }
});

export default router;
