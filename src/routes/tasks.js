// routes/tasks.js
import express from "express";
import mongoose from "mongoose";

import { Task } from "../models/Task.js";
import { User } from "../models/User.js";
import { authenticate } from "../middleware/auth.js";
import {
  ROLES,
  PRIORITIES,
  STATUSES,
  canAssign,
  normalizeRole,
  prettyRole,
} from "../utils/roles.js";

const router = express.Router();

/** Scope queries based on the authenticated user's role */
const restrictQueryByRole = (user) => {
  const role = normalizeRole(user?.role);
  if (role === ROLES.ADMIN) return {};
  if (role === ROLES.MANAGER) {
    return { $or: [{ createdBy: user._id }, { assignedTo: user._id }] };
  }
  // worker
  return { assignedTo: user._id };
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

    const { title, description, priority, due, assigneeId, attachments } =
      req.body || {};

    if (!title || !description || !assigneeId) {
      return res
        .status(400)
        .json({ message: "title, description, assigneeId are required" });
    }

    // Validate priority if provided
    if (priority && !PRIORITIES.includes(priority)) {
      return res
        .status(400)
        .json({ message: `priority must be one of ${PRIORITIES.join(", ")}` });
    }

    // Validate ObjectId shape
    if (!mongoose.isValidObjectId(assigneeId)) {
      return res
        .status(400)
        .json({ message: "assigneeId must be a valid user ObjectId" });
    }

    const assignee = await User.findById(assigneeId);
    if (!assignee || !assignee.isActive) {
      return res.status(400).json({ message: "Invalid assignee" });
    }

    if (!canAssign(actorRole, assignee.role)) {
      return res.status(403).json({
        message: `${prettyRole(actorRole)} cannot assign to ${prettyRole(
          assignee.role
        )}`,
      });
    }

    const task = await Task.create({
      title,
      descriptionHtml: description, // store HTML/markup
      priority: priority || "Medium",
      due: due ? new Date(due) : undefined,
      attachments: Array.isArray(attachments) ? attachments.slice(0, 10) : [],
      createdBy: req.user._id, // ObjectId ref
      assignedTo: assignee._id, // ObjectId ref
      history: [
        {
          by: req.user._id,
          action: `CREATED and assigned to ${assignee.email}`,
        },
      ],
    });

    return res.status(201).json(shape(task));
  } catch (e) {
    return res
      .status(500)
      .json({ message: "Create task error", error: e.message });
  }
});

/* -----------------------------------------------------------
 * List tasks (scoped by role) + basic pagination
 * --------------------------------------------------------- */
router.get("/", authenticate, async (req, res) => {
  try {
    const { page = 1, limit = 10, status, priority } = req.query;
    const filter = restrictQueryByRole(req.user);

    if (status) {
      if (!STATUSES.includes(status)) {
        return res
          .status(400)
          .json({ message: `status must be one of ${STATUSES.join(", ")}` });
      }
      filter.status = status;
    }

    if (priority) {
      if (!PRIORITIES.includes(priority)) {
        return res
          .status(400)
          .json({ message: `priority must be one of ${PRIORITIES.join(", ")}` });
      }
      filter.priority = priority;
    }

    const tasks = await Task.find(filter)
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
      task = await Task.findOne({ ...base, tid: +id });
    } else if (mongoose.isValidObjectId(id)) {
      task = await Task.findOne({ ...base, _id: id });
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
 * Update task (fields allowed vary by role)
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
    const isAssignee = String(task.assignedTo) === String(actor._id);

    let allowedFields = [];
    if (actorRole === ROLES.ADMIN) {
      allowedFields = ["title", "descriptionHtml", "status", "priority", "due", "attachments"];
    } else if (actorRole === ROLES.MANAGER) {
      if (!isCreator && !isAssignee) {
        return res.status(403).json({ message: "Not allowed to modify this task" });
      }
      allowedFields = ["title", "descriptionHtml", "status", "priority", "due", "attachments"];
    } else {
      if (!isAssignee) return res.status(403).json({ message: "Not your task" });
      allowedFields = ["status"];
    }

    const payload = { ...req.body };
    if ("description" in payload) payload.descriptionHtml = payload.description;
    if ("due" in payload && payload.due) payload.due = new Date(payload.due);

    const updates = {};
    for (const key of allowedFields) {
      if (key in payload) updates[key] = payload[key];
    }

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ message: "No allowed fields to update" });
    }

    Object.assign(task, updates);
    task.history.push({
      by: actor._id,
      action: `UPDATED: ${Object.keys(updates).join(", ")}`,
    });
    await task.save();

    return res.json(shape(task));
  } catch (e) {
    return res
      .status(500)
      .json({ message: "Update task error", error: e.message });
  }
});

/* -----------------------------------------------------------
 * Reassign task (Admin/Manager) — expects assigneeId as ObjectId
 * --------------------------------------------------------- */
router.patch("/:id/assign", authenticate, async (req, res) => {
  try {
    const actorRole = normalizeRole(req.user.role);
    if (![ROLES.ADMIN, ROLES.MANAGER].includes(actorRole)) {
      return res.status(403).json({ message: "Only admin/manager can reassign" });
    }

    const { id } = req.params;
    const { assigneeId } = req.body || {};
    if (!assigneeId) return res.status(400).json({ message: "assigneeId is required" });
    if (!mongoose.isValidObjectId(assigneeId)) {
      return res.status(400).json({ message: "assigneeId must be a valid user ObjectId" });
    }

    let task =
      /^\d+$/.test(id)
        ? await Task.findOne({ tid: +id })
        : mongoose.isValidObjectId(id)
        ? await Task.findById(id)
        : null;
    if (!task) return res.status(404).json({ message: "Task not found" });

    const assignee = await User.findById(assigneeId);
    if (!assignee || !assignee.isActive) {
      return res.status(400).json({ message: "Invalid assignee" });
    }

    if (!canAssign(actorRole, assignee.role)) {
      return res.status(403).json({
        message: `${prettyRole(actorRole)} cannot assign to ${prettyRole(
          assignee.role
        )}`,
      });
    }

    task.assignedTo = assignee._id;
    task.history.push({
      by: req.user._id,
      action: `REASSIGNED to ${assignee.email}`,
    });
    await task.save();

    return res.json(shape(task));
  } catch (e) {
    return res
      .status(500)
      .json({ message: "Reassign error", error: e.message });
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
