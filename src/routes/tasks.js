// routes/tasks.js
import express from "express";
import mongoose from "mongoose";

import { Task } from "../models/Task.js";
import { User } from "../models/User.js";
import { Group } from "../models/Group.js";
import { authenticate } from "../middleware/auth.js";
import {
  ROLES,
  PRIORITIES,
  STATUSES,
  normalizeRole,
} from "../utils/roles.js";

const router = express.Router();

/** Scope queries based on the authenticated user's role */
const restrictQueryByRole = (user) => {
  const role = normalizeRole(user?.role);
  if (role === ROLES.ADMIN) return {};
  if (role === ROLES.MANAGER) {
    return { 
      $or: [
        { createdBy: user._id }, 
        { 'assignedTo.user': user._id }
      ] 
    };
  }
  // employee - can only see tasks assigned to them
  return { 'assignedTo.user': user._id };
};

const shape = (t) => t.toClient();

/* -----------------------------------------------------------
 * Create task (Admin, Manager)
 * --------------------------------------------------------- */
router.post("/", authenticate, async (req, res) => {
  try {
    const actorRole = normalizeRole(req.user.role);
    if (![ROLES.ADMIN, ROLES.MANAGER].includes(actorRole)) {
      return res
        .status(403)
        .json({ message: "Only admin/manager can create tasks" });
    }

    const { title, description, priority, due, attachments, assignedUserId, assignedGroupId, status = "Todo" } = req.body || {};

    if (!title || !description) {
      return res
        .status(400)
        .json({ message: "title and description are required" });
    }

    // Validate that only one assignment type is provided
    if (assignedUserId && assignedGroupId) {
      return res
        .status(400)
        .json({ message: "Task can be assigned to either a user OR a group, not both" });
    }

    // Validate priority if provided
    if (priority && !PRIORITIES.includes(priority)) {
      return res
        .status(400)
        .json({ message: `priority must be one of ${PRIORITIES.join(", ")}` });
    }

    // Validate status if provided
    if (status && !STATUSES.includes(status)) {
      return res
        .status(400)
        .json({ message: `status must be one of ${STATUSES.join(", ")}` });
    }

    // Validate assigned user if provided
    let validatedUserId = null;
    if (assignedUserId) {
      if (!mongoose.isValidObjectId(assignedUserId)) {
        return res.status(400).json({ message: `Invalid user ID: ${assignedUserId}` });
      }
      const user = await User.findById(assignedUserId);
      if (!user || !user.isActive) {
        return res.status(400).json({ message: `Invalid or inactive user: ${assignedUserId}` });
      }
      validatedUserId = assignedUserId;
    }

    // Validate assigned group if provided
    let validatedGroupId = null;
    if (assignedGroupId) {
      if (!mongoose.isValidObjectId(assignedGroupId)) {
        return res.status(400).json({ message: `Invalid group ID: ${assignedGroupId}` });
      }
      const group = await Group.findById(assignedGroupId);
      if (!group || !group.isActive) {
        return res.status(400).json({ message: `Invalid or inactive group: ${assignedGroupId}` });
      }
      validatedGroupId = assignedGroupId;
    }

    const task = await Task.create({
      title,
      description,
      priority: priority || "Medium",
      due: due ? new Date(due) : undefined,
      attachments: Array.isArray(attachments) ? attachments.slice(0, 10) : [],
      createdBy: req.user._id,
      comments: [],
      assignedTo: {
        user: validatedUserId,
        group: validatedGroupId
      },
      status: {
        status: status,
        updatedAt: new Date(),
        updatedBy: req.user._id
      }
    });

    await task.populate([
      { path: 'createdBy', select: 'name email' },
      { path: 'assignedTo.user', select: 'name email role' },
      { path: 'assignedTo.group', select: 'title description' },
      { path: 'status.updatedBy', select: 'name email' }
    ]);

    return res.status(201).json(shape(task));
  } catch (e) {
    return res
      .status(500)
      .json({ message: "Create task error", error: e.message });
  }
});

/* -----------------------------------------------------------
 * List tasks + basic pagination (scoped by role)
 * --------------------------------------------------------- */
router.get("/", authenticate, async (req, res) => {
  try {
    const { page = 1, limit = 10, priority, status, createdBy } = req.query;
    const filter = restrictQueryByRole(req.user);

    if (priority) {
      if (!PRIORITIES.includes(priority)) {
        return res
          .status(400)
          .json({ message: `priority must be one of ${PRIORITIES.join(", ")}` });
      }
      filter.priority = priority;
    }

    if (status) {
      if (!STATUSES.includes(status)) {
        return res
          .status(400)
          .json({ message: `status must be one of ${STATUSES.join(", ")}` });
      }
      filter['status.status'] = status;
    }

    if (createdBy && mongoose.isValidObjectId(createdBy)) {
      filter.createdBy = createdBy;
    }

    const tasks = await Task.find(filter)
      .populate('createdBy', 'name email')
      .populate('assignedTo.user', 'name email role')
      .populate('assignedTo.group', 'title description')
      .populate('status.updatedBy', 'name email')
      .populate('comments.user', 'name email')
      .sort({ updatedAt: -1 })
      .skip((+page - 1) * +limit)
      .limit(+limit);

    const total = await Task.countDocuments(filter);

    return res.json({
      data: tasks.map(shape),
      page: +page,
      limit: +limit,
      total,
    });
  } catch (e) {
    return res
      .status(500)
      .json({ message: "List tasks error", error: e.message });
  }
});

/* -----------------------------------------------------------
 * Get task by numeric id (tid) or ObjectId (scoped)
 * --------------------------------------------------------- */
router.get("/:id", authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    const base = restrictQueryByRole(req.user);

    let task = null;
    if (/^\d+$/.test(id)) {
      task = await Task.findOne({ ...base, tid: +id })
        .populate('createdBy', 'name email')
        .populate('assignedTo.user', 'name email role')
        .populate('assignedTo.group', 'title description')
        .populate('status.updatedBy', 'name email')
        .populate('statusHistory.updatedBy', 'name email')
        .populate('comments.user', 'name email');
    } else if (mongoose.isValidObjectId(id)) {
      task = await Task.findOne({ ...base, _id: id })
        .populate('createdBy', 'name email')
        .populate('assignedTo.user', 'name email role')
        .populate('assignedTo.group', 'title description')
        .populate('status.updatedBy', 'name email')
        .populate('statusHistory.updatedBy', 'name email')
        .populate('comments.user', 'name email');
    }

    if (!task) return res.status(404).json({ message: "Task not found" });
    return res.json(shape(task));
  } catch (e) {
    return res
      .status(500)
      .json({ message: "Get task error", error: e.message });
  }
});

/* -----------------------------------------------------------
 * Update task (Admin, Manager, or Creator)
 * --------------------------------------------------------- */
router.patch("/:id", authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    let task =
      /^\d+$/.test(id)
        ? await Task.findOne({ tid: +id })
        : mongoose.isValidObjectId(id)
        ? await Task.findById(id)
        : null;

    if (!task) return res.status(404).json({ message: "Task not found" });

    const actor = req.user;
    const actorRole = normalizeRole(actor.role);
    const isCreator = String(task.createdBy) === String(actor._id);

    let allowedFields = [];
    if (actorRole === ROLES.ADMIN) {
      allowedFields = ["title", "description", "priority", "due", "attachments"];
    } else if (actorRole === ROLES.MANAGER || isCreator) {
      allowedFields = ["title", "description", "priority", "due", "attachments"];
    } else {
      return res.status(403).json({ message: "Not allowed to modify this task" });
    }

    const payload = { ...req.body };
    
    // Handle due date conversion
    if ("due" in payload && payload.due) {
      payload.due = new Date(payload.due);
    }
    
    const updates = {};
    for (const key of allowedFields) {
      if (key in payload) updates[key] = payload[key];
    }

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ message: "No allowed fields to update" });
    }

    Object.assign(task, updates);
    await task.save();

    await task.populate([
      { path: 'createdBy', select: 'name email' },
      { path: 'comments.user', select: 'name email' }
    ]);

    return res.json(shape(task));
  } catch (e) {
    return res
      .status(500)
      .json({ message: "Update task error", error: e.message });
  }
});

/* -----------------------------------------------------------
 * Add comment to task
 * --------------------------------------------------------- */
router.post("/:id/comments", authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    const { comment } = req.body;

    if (!comment || comment.trim().length === 0) {
      return res.status(400).json({ message: "Comment is required" });
    }

    const base = restrictQueryByRole(req.user);
    let task =
      /^\d+$/.test(id)
        ? await Task.findOne({ ...base, tid: +id })
        : mongoose.isValidObjectId(id)
        ? await Task.findOne({ ...base, _id: id })
        : null;

    if (!task) return res.status(404).json({ message: "Task not found" });

    await task.addComment(req.user._id, comment.trim());
    await task.populate([
      { path: 'createdBy', select: 'name email' },
      { path: 'assignedTo.users', select: 'name email role' },
      { path: 'assignedTo.groups', select: 'title description' },
      { path: 'status.updatedBy', select: 'name email' },
      { path: 'comments.user', select: 'name email' }
    ]);

    return res.json(shape(task));
  } catch (e) {
    return res
      .status(500)
      .json({ message: "Add comment error", error: e.message });
  }
});

/* -----------------------------------------------------------
 * Update task status
 * --------------------------------------------------------- */
router.patch("/:id/status", authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    const { status, comment } = req.body;

    if (!status || !STATUSES.includes(status)) {
      return res.status(400).json({ 
        message: `Status is required and must be one of: ${STATUSES.join(", ")}` 
      });
    }

    let task =
      /^\d+$/.test(id)
        ? await Task.findOne({ tid: +id })
        : mongoose.isValidObjectId(id)
        ? await Task.findById(id)
        : null;

    if (!task) return res.status(404).json({ message: "Task not found" });

    // Permission check - only assigned users, managers, admins, or creators can update status
    const actorRole = normalizeRole(req.user.role);
    const isCreator = String(task.createdBy) === String(req.user._id);
    const isAssigned = task.isUserAssigned(req.user._id);

    if (actorRole !== ROLES.ADMIN && actorRole !== ROLES.MANAGER && !isCreator && !isAssigned) {
      return res.status(403).json({ 
        message: "You can only update status for tasks assigned to you or that you created" 
      });
    }

    await task.updateStatus(status, req.user._id, comment);
    await task.populate([
      { path: 'createdBy', select: 'name email' },
      { path: 'assignedTo.users', select: 'name email role' },
      { path: 'assignedTo.groups', select: 'title description' },
      { path: 'status.updatedBy', select: 'name email' },
      { path: 'statusHistory.updatedBy', select: 'name email' }
    ]);

    return res.json(shape(task));
  } catch (e) {
    return res
      .status(500)
      .json({ message: "Update task status error", error: e.message });
  }
});

/* -----------------------------------------------------------
 * Assign task to user or group
 * --------------------------------------------------------- */
router.patch("/:id/assign", authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    const { userId, groupId } = req.body;

    const actorRole = normalizeRole(req.user.role);
    if (![ROLES.ADMIN, ROLES.MANAGER].includes(actorRole)) {
      return res.status(403).json({ 
        message: "Only admin/manager can assign tasks" 
      });
    }

    // Validate that only one assignment type is provided
    if (userId && groupId) {
      return res.status(400).json({ 
        message: "Task can be assigned to either a user OR a group, not both" 
      });
    }

    if (!userId && !groupId) {
      return res.status(400).json({ 
        message: "Either userId or groupId must be provided" 
      });
    }

    let task =
      /^\d+$/.test(id)
        ? await Task.findOne({ tid: +id })
        : mongoose.isValidObjectId(id)
        ? await Task.findById(id)
        : null;

    if (!task) return res.status(404).json({ message: "Task not found" });

    // Validate and assign user
    if (userId) {
      if (!mongoose.isValidObjectId(userId)) {
        return res.status(400).json({ message: `Invalid user ID: ${userId}` });
      }
      const user = await User.findById(userId);
      if (!user || !user.isActive) {
        return res.status(400).json({ message: `Invalid or inactive user: ${userId}` });
      }
      await task.assignUser(userId);
    }

    // Validate and assign group
    if (groupId) {
      if (!mongoose.isValidObjectId(groupId)) {
        return res.status(400).json({ message: `Invalid group ID: ${groupId}` });
      }
      const group = await Group.findById(groupId);
      if (!group || !group.isActive) {
        return res.status(400).json({ message: `Invalid or inactive group: ${groupId}` });
      }
      await task.assignGroup(groupId);
    }

    await task.populate([
      { path: 'createdBy', select: 'name email' },
      { path: 'assignedTo.user', select: 'name email role' },
      { path: 'assignedTo.group', select: 'title description' },
      { path: 'status.updatedBy', select: 'name email' }
    ]);

    return res.json(shape(task));
  } catch (e) {
    return res
      .status(500)
      .json({ message: "Assign task error", error: e.message });
  }
});

/* -----------------------------------------------------------
 * Remove assignment from task
 * --------------------------------------------------------- */
router.patch("/:id/unassign", authenticate, async (req, res) => {
  try {
    const { id } = req.params;

    const actorRole = normalizeRole(req.user.role);
    if (![ROLES.ADMIN, ROLES.MANAGER].includes(actorRole)) {
      return res.status(403).json({ 
        message: "Only admin/manager can remove task assignments" 
      });
    }

    let task =
      /^\d+$/.test(id)
        ? await Task.findOne({ tid: +id })
        : mongoose.isValidObjectId(id)
        ? await Task.findById(id)
        : null;

    if (!task) return res.status(404).json({ message: "Task not found" });

    await task.removeAssignment();

    await task.populate([
      { path: 'createdBy', select: 'name email' },
      { path: 'assignedTo.user', select: 'name email role' },
      { path: 'assignedTo.group', select: 'title description' },
      { path: 'status.updatedBy', select: 'name email' }
    ]);

    return res.json(shape(task));
  } catch (e) {
    return res
      .status(500)
      .json({ message: "Remove assignment error", error: e.message });
  }
});

/* -----------------------------------------------------------
 * Delete task (Admin only)
 * --------------------------------------------------------- */
router.delete("/:id", authenticate, async (req, res) => {
  try {
    const actorRole = normalizeRole(req.user.role);
    if (actorRole !== ROLES.ADMIN)
      return res.status(403).json({ message: "Only admin can delete tasks" });

    const { id } = req.params;
    const deleted =
      /^\d+$/.test(id)
        ? await Task.findOneAndDelete({ tid: +id })
        : mongoose.isValidObjectId(id)
        ? await Task.findByIdAndDelete(id)
        : null;

    if (!deleted) return res.status(404).json({ message: "Task not found" });

    return res.json({ message: "Task deleted" });
  } catch (e) {
    return res
      .status(500)
      .json({ message: "Delete task error", error: e.message });
  }
});

export default router;
