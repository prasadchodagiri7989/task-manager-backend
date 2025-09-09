
// -----------------------------------------------------------
// Get all notifications for the authenticated user
// -----------------------------------------------------------
import { Notification } from '../models/Notification.js';

import upload from '../utils/localUpload.js';
import nodemailer from 'nodemailer';
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
const restrictQueryByRole = async (user) => {
  const role = normalizeRole(user?.role);
  
  if (role === ROLES.ADMIN) return {};
  
  if (role === ROLES.MANAGER) {
    // Get all groups where manager is lead or member
    const groupIds = await Group.find({
      $or: [{ lead: user._id }, { members: user._id }]
    }).distinct("_id");

    return {
      $or: [
        { createdBy: user._id },
        { "assignedTo.user": user._id },
        { "assignedTo.group": { $in: groupIds } }
      ],
    };
  }
  
  // Employee: tasks assigned directly or via group membership
  const groupIds = await Group.find({ members: user._id }).distinct("_id");
  
  return {
    $or: [
      { "assignedTo.user": user._id },
      { "assignedTo.group": { $in: groupIds } },
    ],
  };
};


const shape = (t) => t.toClient();


router.get('/notifications', authenticate, async (req, res) => {
  try {
    const notifications = await Notification.find({ user: req.user._id }).sort({ createdAt: -1 });
    return res.json({ data: notifications });
  } catch (e) {
    return res.status(500).json({ message: 'Get notifications error', error: e.message });
  }
});

/* -----------------------------------------------------------
 * Reopen a task: set status to 'Todo' and mark isReopened
 * --------------------------------------------------------- */
router.post('/reopen/:taskId', authenticate, async (req, res) => {
  try {
    const { taskId } = req.params;
    if (!mongoose.isValidObjectId(taskId)) {
      return res.status(400).json({ message: 'Invalid task ID' });
    }
    const task = await Task.findById(taskId);
    if (!task) {
      return res.status(404).json({ message: 'Task not found' });
    }
    // Update status to Todo and mark isReopened
    task.status.status = 'Todo';
    task.isReopened = true;
    // Optionally, add to statusHistory
    task.statusHistory.push({
      status: 'Todo',
      updatedAt: new Date(),
      updatedBy: req.user._id,
      comment: 'Task reopened'
    });
    await task.save();
    return res.json({ message: 'Task reopened and set to TODO', task: task.toClient() });
  } catch (e) {
    return res.status(500).json({ message: 'Reopen task error', error: e.message });
  }
});

// -----------------------------------------------------------
// Admin Dashboard Stats
// Support both /admin-dashboard/reassignment-stats and /admin/dashboard/reassignment-stats
router.get('/admin/dashboard/reassignment-stats', authenticate, async (req, res) => {
  try {
    const actorRole = normalizeRole(req.user.role);
    if (actorRole !== ROLES.ADMIN) {
      return res.status(403).json({ message: 'Only admin can view reassignment stats' });
    }

    // Count tasks that have a non-empty statusHistory with a status of "Reassigned"
    const reassignedTasks = await Task.countDocuments({
      statusHistory: { $elemMatch: { status: "Reassigned" } }
    });

    // Optionally, return more detailed stats
    const totalTasks = await Task.countDocuments();

    return res.json({
      totalTasks,
      reassignedTasks
    });
  } catch (e) {
    return res.status(500).json({ message: 'Reassignment stats error', error: e.message });
  }
});
/* -----------------------------------------------------------
 * Admin: Get reassignment stats (how many tasks have been reassigned)
 * --------------------------------------------------------- */
router.get('/admin-dashboard/reassignment-stats', authenticate, async (req, res) => {
  try {
    const actorRole = normalizeRole(req.user.role);
    if (actorRole !== ROLES.ADMIN) {
      return res.status(403).json({ message: 'Only admin can view reassignment stats' });
    }

    // Count tasks that have a non-empty statusHistory with a status of "Reassigned"
    const reassignedTasks = await Task.countDocuments({
      statusHistory: { $elemMatch: { status: "Reassigned" } }
    });

    // Optionally, return more detailed stats
    const totalTasks = await Task.countDocuments();

    return res.json({
      totalTasks,
      reassignedTasks
    });
  } catch (e) {
    return res.status(500).json({ message: 'Reassignment stats error', error: e.message });
  }
});
// -----------------------------------------------------------
router.get('/admin-dashboard', authenticate, async (req, res) => {
  try {
    const actorRole = normalizeRole(req.user.role);
    if (actorRole !== ROLES.ADMIN) {
      return res.status(403).json({ message: 'Only admin can view dashboard' });
    }

    const [
      totalTasks,
      completedTasks,
      incompleteTasks,
      totalGroups,
      totalUsers
    ] = await Promise.all([
      Task.countDocuments(),
      Task.countDocuments({ 'status.status': 'Completed' }),
      Task.countDocuments({ 'status.status': { $ne: 'Completed' } }),
      Group.countDocuments(),
      User.countDocuments()
    ]);

    return res.json({
      totalTasks,
      completedTasks,
      incompleteTasks,
      totalGroups,
      totalUsers
    });
  } catch (e) {
    return res.status(500).json({ message: 'Dashboard error', error: e.message });
  }
});


/* -----------------------------------------------------------
 * Create task (Admin, Manager) with file/voice upload
 * --------------------------------------------------------- */
router.post("/", authenticate, upload.fields([{ name: 'file' }, { name: 'voice' }]), async (req, res) => {
  try {
    const actorRole = normalizeRole(req.user.role);
    if (![ROLES.ADMIN, ROLES.MANAGER].includes(actorRole)) {
      return res
        .status(403)
        .json({ message: "Only admin/manager can create tasks" });
    }

    const { title, description, priority, due, attachments, assignedUserId, assignedGroupId, status = "Todo" } = req.body || {};

    // Handle file and voice uploads (local)
    let fileUrl = null;
    let voiceUrl = null;
    if (req.files && req.files.file && req.files.file[0]) {
      const fileName = req.files.file[0].filename;
      fileUrl = `http://localhost:4000/uploads/${fileName}`;
    }
    if (req.files && req.files.voice && req.files.voice[0]) {
      const voiceName = req.files.voice[0].filename;
      voiceUrl = `http://localhost:4000/uploads/${voiceName}`;
    }

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

    // Create task
    const task = await Task.create({
      title,
      description,
      priority: priority || "Medium",
      due: due ? new Date(due) : undefined,
      attachments: Array.isArray(attachments) ? attachments.slice(0, 10) : [],
      file: fileUrl,
      voice: voiceUrl,
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

    // Notify assigned user on creation
    if (validatedUserId) {
      await Notification.create({
        user: validatedUserId,
        type: 'task-assigned',
        message: `You have been assigned a new task: ${title}`,
        link: `/tasks/${task._id}`
      });
      
      // ✅ Check for email environment variables before sending mail
      if (process.env.EMAIL_USER && process.env.EMAIL_PASS) {
        try {
          const assignedUser = await User.findById(validatedUserId);
          if (assignedUser && assignedUser.email) {
            const transporter = nodemailer.createTransport({
              service: "gmail",
              auth: {
                user: process.env.EMAIL_USER,
                pass: process.env.EMAIL_PASS
              }
            });

            const taskLink = `http://localhost:8081/tasks/${task._id}`;
            const mailOptions = {
              from: process.env.EMAIL_USER,
              to: assignedUser.email,
              subject: "You have been assigned a new task",
              html: `<p>Hello ${assignedUser.name},</p>
                <p>You have been assigned to a new task:</p>
                <ul>
                  <li><strong>Title:</strong> ${task.title}</li>
                  <li><strong>Description:</strong> ${task.description}</li>
                  <li><strong>Priority:</strong> ${task.priority}</li>
                  <li><strong>Due Date:</strong> ${task.due ? new Date(task.due).toLocaleString() : "N/A"}</li>
                </ul>
                <p>View task: <a href="${taskLink}">${taskLink}</a></p>`
            };

            await transporter.sendMail(mailOptions);
          }
        } catch (mailErr) {
          console.error("Error sending assignment email:", mailErr);
        }
      }
    }

    // Notify creator if task is completed on creation
    if (status === 'Completed' && req.user._id) {
      await Notification.create({
        user: req.user._id,
        type: 'task-completed',
        message: `Your task has been marked as completed: ${title}`,
        link: `/tasks/${task._id}`
      });
    }

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
    const { page = 1, limit = 100, priority, status, createdBy } = req.query;
    const filter = await restrictQueryByRole(req.user);

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
    const base = await restrictQueryByRole(req.user);

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
router.patch("/:id", authenticate, upload.fields([{ name: 'file' }, { name: 'voice' }]), async (req, res) => {
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

    let didChange = false;
    // Handle file and voice uploads (local) for updates
    if (req.files && req.files.file && req.files.file[0]) {
      const fileName = req.files.file[0].filename;
      task.file = `http://localhost:4000/uploads/${fileName}`;
      didChange = true;
    }
    if (req.files && req.files.voice && req.files.voice[0]) {
      const voiceName = req.files.voice[0].filename;
      task.voice = `http://localhost:4000/uploads/${voiceName}`;
      didChange = true;
    }
    const updates = {};
    for (const key of allowedFields) {
      if (key in payload) updates[key] = payload[key];
    }

    // If file/voice uploaded in this request, ignore attachments updates
    if ((req.files && req.files.file) || (req.files && req.files.voice)) {
      if ("attachments" in updates) delete updates.attachments;
    }

    if (Object.keys(updates).length > 0) {
      Object.assign(task, updates);
      await task.save();
      didChange = true;
    }

    // Allow assignment via assigneeId in this endpoint
    if ("assigneeId" in payload) {
      const assigneeId = payload.assigneeId;
      if (!assigneeId) {
        await task.removeAssignment();
        didChange = true;
      } else {
        if (!mongoose.isValidObjectId(assigneeId)) {
          return res.status(400).json({ message: `Invalid user ID: ${assigneeId}` });
        }
        const user = await User.findById(assigneeId);
        if (!user || !user.isActive) {
          return res.status(400).json({ message: `Invalid or inactive user: ${assigneeId}` });
        }
        await task.assignUser(assigneeId);
        didChange = true;
      }
    }

    if (!didChange) {
      return res.status(400).json({ message: "No allowed fields to update" });
    }

    await task.populate([
      { path: 'createdBy', select: 'name email' },
      { path: 'comments.user', select: 'name email' },
      { path: 'assignedTo.user', select: 'name email role' },
      { path: 'assignedTo.group', select: 'title description' }
    ]);

    // Notification logic: notify assigned user and assigner (admin/manager)
    // Notify assigned user if present
    if (task.assignedTo && task.assignedTo.user) {
      await Notification.create({
        user: task.assignedTo.user,
        type: 'task-modified',
        message: `Task updated: ${task.title}`,
        link: `/tasks/${task._id}`
      });
    }
    // Notify assigner (admin/manager who created the task)
    if (task.createdBy) {
      const assigner = await User.findById(task.createdBy);
      if (assigner && (assigner.role === ROLES.ADMIN || assigner.role === ROLES.MANAGER)) {
        await Notification.create({
          user: assigner._id,
          type: 'task-modified',
          message: `Task you assigned has been updated: ${task.title}`,
          link: `/tasks/${task._id}`
        });
      }
    }

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
      { path: 'assignedTo.user', select: 'name email role' },
      { path: 'assignedTo.group', select: 'title description' },
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
      { path: 'assignedTo.user', select: 'name email role' },
      { path: 'assignedTo.group', select: 'title description' },
      { path: 'status.updatedBy', select: 'name email' },
      { path: 'statusHistory.updatedBy', select: 'name email' }
    ]);

    // Notify admin or manager who assigned the task
    if (task.createdBy) {
      const assigner = await User.findById(task.createdBy);
      console.log(assigner);
      if (assigner && (assigner.role ==="ADMIN" || assigner.role === ROLES.MANAGER)) {
        await Notification.create({
          user: assigner._id,
          type: 'task-status-updated',
          message: `Status updated for task: ${task.title} (${status})`,
          link: `/tasks/${task._id}`
        });
      }
    }

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
