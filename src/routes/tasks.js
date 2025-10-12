
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
        { 
          "assignedTo.group": { $in: groupIds },
          // For managers, show all group tasks regardless of claim status
        }
      ],
    };
  }
  
  // Employee: tasks assigned directly or via group membership
  const groupIds = await Group.find({ members: user._id }).distinct("_id");
  const userId = user._id;
  
  const query = {
    $or: [
      // Tasks assigned directly to the user
      { "assignedTo.user": userId },
      // Group tasks that are either:
      // 1. Not claimed by anyone (available for claiming)
      // 2. Already claimed by THIS user (they can continue working on it)
      { 
        $and: [
          { "assignedTo.group": { $in: groupIds } },
          {
            $or: [
              // Unclaimed tasks - available for any group member to claim
              { "claimedBy": { $exists: false } },
              { "claimedBy": null },
              // Tasks claimed by this specific user - they continue to see it
              { "claimedBy": userId }
            ]
          }
        ]
      }
    ]
  };
  
  return query;
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
 * Debug endpoint to check query filtering
 * --------------------------------------------------------- */
router.get('/debug/filter', authenticate, async (req, res) => {
  try {
    const filter = await restrictQueryByRole(req.user);
    const userRole = normalizeRole(req.user.role);
    
    // Get group membership info
    const groupIds = await Group.find({ members: req.user._id }).distinct("_id");
    const groups = await Group.find({ members: req.user._id }).select('title members');
    
    // Get sample tasks to see what's happening
    const allGroupTasks = await Task.find({ "assignedTo.group": { $in: groupIds } })
      .select('title claimedBy assignedTo')
      .populate('claimedBy', 'name email');
    
    return res.json({
      userId: req.user._id,
      userRole: userRole,
      userGroups: groups,
      filter: JSON.stringify(filter, null, 2),
      allGroupTasks: allGroupTasks,
      message: 'Debug info for task filtering'
    });
  } catch (e) {
    return res.status(500).json({ message: 'Debug error', error: e.message });
  }
});

/* -----------------------------------------------------------
 * Test endpoint to verify group task filtering
 * --------------------------------------------------------- */
router.get('/debug/group-tasks', authenticate, async (req, res) => {
  try {
    const userRole = normalizeRole(req.user.role);
    
    if (userRole !== ROLES.EMPLOYEE) {
      return res.status(403).json({ message: 'This debug endpoint is for employees only' });
    }
    
    // Get user's groups
    const groupIds = await Group.find({ members: req.user._id }).distinct("_id");
    
    // Get all group tasks
    const allGroupTasks = await Task.find({ "assignedTo.group": { $in: groupIds } })
      .populate('claimedBy', 'name email')
      .populate('assignedTo.group', 'title');
    
    // Manually filter to see what should be shown
    const shouldSee = allGroupTasks.filter(task => {
      return !task.claimedBy || task.claimedBy._id.toString() === req.user._id.toString();
    });
    
    return res.json({
      currentUserId: req.user._id.toString(),
      currentUserName: req.user.name,
      userGroups: groupIds,
      allGroupTasks: allGroupTasks.map(t => ({
        id: t.tid,
        title: t.title,
        claimedBy: t.claimedBy ? {
          id: t.claimedBy._id.toString(),
          name: t.claimedBy.name
        } : null,
        shouldCurrentUserSee: !t.claimedBy || t.claimedBy._id.toString() === req.user._id.toString()
      })),
      tasksShouldSee: shouldSee.map(t => ({ id: t.tid, title: t.title }))
    });
  } catch (e) {
    return res.status(500).json({ message: 'Debug error', error: e.message });
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
    console.log(task);
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

    // Count tasks using the isReassigned boolean field
    const reassignedTasks = await Task.countDocuments({ isReassigned: true });

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

    // Count tasks using the isReassigned boolean field
    const reassignedTasks = await Task.countDocuments({ isReassigned: true });

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
      reassignedTasks,
      reopenedTasks,
      totalGroups,
      totalUsers
    ] = await Promise.all([
      Task.countDocuments(),
      Task.countDocuments({ 'status.status': 'Completed' }),
      Task.countDocuments({ 'status.status': { $ne: 'Completed' } }),
      Task.countDocuments({ isReassigned: true }),
      Task.countDocuments({ isReopened: true }),
      Group.countDocuments(),
      User.countDocuments()
    ]);

    return res.json({
      totalTasks,
      completedTasks,
      incompleteTasks,
      reassignedTasks,
      reopenedTasks,
      totalGroups,
      totalUsers
    });
  } catch (e) {
    return res.status(500).json({ message: 'Dashboard error', error: e.message });
  }
});

/* -----------------------------------------------------------
 * Admin: Get reopened tasks stats
 * --------------------------------------------------------- */
router.get('/admin-dashboard/reopened-stats', authenticate, async (req, res) => {
  try {
    const actorRole = normalizeRole(req.user.role);
    if (actorRole !== ROLES.ADMIN) {
      return res.status(403).json({ message: 'Only admin can view reopened stats' });
    }

    // Count tasks using the isReopened boolean field
    const reopenedTasks = await Task.countDocuments({ isReopened: true });
    const totalTasks = await Task.countDocuments();

    // Additional analytics: reopened tasks by status
    const reopenedByStatus = await Task.aggregate([
      { $match: { isReopened: true } },
      { $group: { _id: '$status.status', count: { $sum: 1 } } }
    ]);

    return res.json({
      totalTasks,
      reopenedTasks,
      reopenedByStatus
    });
  } catch (e) {
    return res.status(500).json({ message: 'Reopened stats error', error: e.message });
  }
});

/* -----------------------------------------------------------
 * Admin: Get detailed analytics for both reopened and reassigned tasks
 * --------------------------------------------------------- */
router.get('/admin-dashboard/detailed-analytics', authenticate, async (req, res) => {
  try {
    const actorRole = normalizeRole(req.user.role);
    if (actorRole !== ROLES.ADMIN) {
      return res.status(403).json({ message: 'Only admin can view detailed analytics' });
    }

    const [
      totalTasks,
      reassignedTasks,
      reopenedTasks,
      bothReassignedAndReopened,
      reassignedByPriority,
      reopenedByPriority
    ] = await Promise.all([
      Task.countDocuments(),
      Task.countDocuments({ isReassigned: true }),
      Task.countDocuments({ isReopened: true }),
      Task.countDocuments({ isReassigned: true, isReopened: true }),
      Task.aggregate([
        { $match: { isReassigned: true } },
        { $group: { _id: '$priority', count: { $sum: 1 } } }
      ]),
      Task.aggregate([
        { $match: { isReopened: true } },
        { $group: { _id: '$priority', count: { $sum: 1 } } }
      ])
    ]);

    return res.json({
      totalTasks,
      reassignedTasks,
      reopenedTasks,
      bothReassignedAndReopened,
      reassignedByPriority,
      reopenedByPriority,
      percentages: {
        reassignedPercentage: totalTasks > 0 ? ((reassignedTasks / totalTasks) * 100).toFixed(2) : 0,
        reopenedPercentage: totalTasks > 0 ? ((reopenedTasks / totalTasks) * 100).toFixed(2) : 0
      }
    });
  } catch (e) {
    return res.status(500).json({ message: 'Detailed analytics error', error: e.message });
  }
});

/* -----------------------------------------------------------
 * Admin: Get list of reassigned tasks
 * --------------------------------------------------------- */
router.get('/admin-dashboard/reassigned-tasks', authenticate, async (req, res) => {
  try {
    const actorRole = normalizeRole(req.user.role);
    if (actorRole !== ROLES.ADMIN) {
      return res.status(403).json({ message: 'Only admin can view reassigned tasks' });
    }

    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;

    const reassignedTasks = await Task.find({ isReassigned: true })
      .populate('createdBy', 'name email')
      .populate('assignedTo.user', 'name email')
      .populate('assignedTo.group', 'title')
      .sort({ updatedAt: -1 })
      .skip(skip)
      .limit(limit);

    const totalReassignedTasks = await Task.countDocuments({ isReassigned: true });

    return res.json({
      tasks: reassignedTasks.map(task => shape(task)),
      totalTasks: totalReassignedTasks,
      currentPage: page,
      totalPages: Math.ceil(totalReassignedTasks / limit)
    });
  } catch (e) {
    return res.status(500).json({ message: 'Get reassigned tasks error', error: e.message });
  }
});

/* -----------------------------------------------------------
 * Admin: Get list of reopened tasks
 * --------------------------------------------------------- */
router.get('/admin-dashboard/reopened-tasks', authenticate, async (req, res) => {
  try {
    const actorRole = normalizeRole(req.user.role);
    if (actorRole !== ROLES.ADMIN) {
      return res.status(403).json({ message: 'Only admin can view reopened tasks' });
    }

    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;

    const reopenedTasks = await Task.find({ isReopened: true })
      .populate('createdBy', 'name email')
      .populate('assignedTo.user', 'name email')
      .populate('assignedTo.group', 'title')
      .sort({ updatedAt: -1 })
      .skip(skip)
      .limit(limit);

    const totalReopenedTasks = await Task.countDocuments({ isReopened: true });

    return res.json({
      tasks: reopenedTasks.map(task => shape(task)),
      totalTasks: totalReopenedTasks,
      currentPage: page,
      totalPages: Math.ceil(totalReopenedTasks / limit)
    });
  } catch (e) {
    return res.status(500).json({ message: 'Get reopened tasks error', error: e.message });
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
      .populate('claimedBy', 'name email')
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
    
    // Check if user is a member of the assigned group
    let isGroupMember = false;
    if (task.assignedTo.group) {
      const group = await Group.findById(task.assignedTo.group);
      if (group && group.members.includes(req.user._id)) {
        isGroupMember = true;
      }
    }

    if (actorRole !== ROLES.ADMIN && actorRole !== ROLES.MANAGER && !isCreator && !isAssigned && !isGroupMember) {
      return res.status(403).json({
        message: "You can only update status for tasks assigned to you or that you created"
      });
    }

    // Special logic for group tasks when status changes to InProgress
    if (task.assignedTo.group && status === 'InProgress' && !task.claimedBy) {
      // Claim the task for this user
      task.claimedBy = req.user._id;
      
      // Notify other group members that the task has been claimed
      const group = await Group.findById(task.assignedTo.group).populate('members', 'name email');
      if (group) {
        const otherMembers = group.members.filter(member => 
          member._id.toString() !== req.user._id.toString()
        );
        
        for (const member of otherMembers) {
          await Notification.create({
            user: member._id,
            title: `Task Claimed: ${task.title}`,
            message: `${req.user.name || 'A team member'} has started working on task: ${task.title}`,
            type: 'task_claimed',
            taskId: task._id,
            createdBy: req.user._id
          });
        }
      }
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
 * Claim a group task (Employee can claim an unassigned group task)
 * --------------------------------------------------------- */
router.patch("/:id/claim", authenticate, async (req, res) => {
  try {
    const { id } = req.params;

    let task =
      /^\d+$/.test(id)
        ? await Task.findOne({ tid: +id })
        : mongoose.isValidObjectId(id)
          ? await Task.findById(id)
          : null;

    if (!task) return res.status(404).json({ message: "Task not found" });

    // Check if task is assigned to a group
    if (!task.assignedTo.group) {
      return res.status(400).json({ message: "This task is not assigned to a group" });
    }

    // Check if task is already claimed
    if (task.claimedBy) {
      return res.status(400).json({ message: "This task has already been claimed by another user" });
    }

    // Check if user is a member of the assigned group
    const group = await Group.findById(task.assignedTo.group);
    if (!group || !group.members.includes(req.user._id)) {
      return res.status(403).json({ message: "You are not a member of the group assigned to this task" });
    }

    // Claim the task
    task.claimedBy = req.user._id;
    
    // Add to status history
    task.statusHistory.push({
      status: task.status.status,
      updatedAt: new Date(),
      updatedBy: req.user._id,
      comment: 'Task claimed by user'
    });

    await task.save();
    await task.populate([
      { path: 'createdBy', select: 'name email' },
      { path: 'assignedTo.user', select: 'name email role' },
      { path: 'assignedTo.group', select: 'title description' },
      { path: 'claimedBy', select: 'name email' },
      { path: 'status.updatedBy', select: 'name email' }
    ]);

    // Notify other group members that the task has been claimed
    const otherMembers = group.members.filter(memberId => 
      memberId.toString() !== req.user._id.toString()
    );
    
    for (const memberId of otherMembers) {
      await Notification.create({
        user: memberId,
        title: `Task Claimed: ${task.title}`,
        message: `${req.user.name || 'A team member'} has claimed task: ${task.title}`,
        type: 'task_claimed',
        taskId: task._id,
        createdBy: req.user._id
      });
    }

    return res.json({ 
      message: "Task claimed successfully", 
      task: shape(task) 
    });
  } catch (e) {
    return res.status(500).json({ 
      message: "Claim task error", 
      error: e.message 
    });
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
 * Reassign task to user or group (Admin only)
 * --------------------------------------------------------- */
router.patch("/:id/reassign", authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    const { userId, groupId } = req.body;

    // Only admins can reassign tasks
    const actorRole = normalizeRole(req.user.role);
    if (actorRole !== ROLES.ADMIN) {
      return res.status(403).json({ message: "Only admins can reassign tasks" });
    }

    // Validate that only one assignment type is provided
    if (userId && groupId) {
      return res.status(400).json({ 
        message: "Cannot assign to both user and group simultaneously" 
      });
    }

    if (!userId && !groupId) {
      return res.status(400).json({ 
        message: "Must provide either userId or groupId for reassignment" 
      });
    }

    let task =
      /^\d+$/.test(id)
        ? await Task.findOne({ tid: +id })
        : mongoose.isValidObjectId(id)
          ? await Task.findById(id)
          : null;

    if (!task) {
      return res.status(404).json({ message: "Task not found" });
    }

    // Validate assigned user if provided
    let validatedUserId = null;
    if (userId) {
      if (!mongoose.isValidObjectId(userId)) {
        return res.status(400).json({ message: "Invalid user ID format" });
      }
      const user = await User.findById(userId);
      if (!user) {
        return res.status(404).json({ message: "User not found" });
      }
      validatedUserId = userId;
    }

    // Validate assigned group if provided
    let validatedGroupId = null;
    if (groupId) {
      if (!mongoose.isValidObjectId(groupId)) {
        return res.status(400).json({ message: "Invalid group ID format" });
      }
      const group = await Group.findById(groupId);
      if (!group) {
        return res.status(404).json({ message: "Group not found" });
      }
      validatedGroupId = groupId;
    }

    // Store previous assignment for notification
    const previousAssignment = {
      user: task.assignedTo.user,
      group: task.assignedTo.group
    };

    // Check if this is actually a reassignment (task was previously assigned)
    const isActualReassignment = previousAssignment.user || previousAssignment.group;

    // Update assignment and set isReassigned to true only if it's an actual reassignment
    task.assignedTo = {
      user: validatedUserId,
      group: validatedGroupId
    };
    
    // Only mark as reassigned if the task was previously assigned to someone
    if (isActualReassignment) {
      task.isReassigned = true;
    }

    // Add to status history to track reassignment
    task.statusHistory.push({
      status: task.status.status, // Keep current status
      updatedAt: new Date(),
      updatedBy: req.user._id,
      comment: isActualReassignment ? 
        `Task reassigned ${validatedUserId ? 'to user' : 'to group'}` :
        `Task assigned ${validatedUserId ? 'to user' : 'to group'}`
    });

    await task.save();
    await task.populate([
      { path: 'createdBy', select: 'name email' },
      { path: 'assignedTo.user', select: 'name email role' },
      { path: 'assignedTo.group', select: 'title description' },
      { path: 'status.updatedBy', select: 'name email' }
    ]);

    // Notify newly assigned user
    if (validatedUserId) {
      const notification = await Notification.create({
        user: validatedUserId,
        title: isActualReassignment ? `Task Reassigned: ${task.title}` : `Task Assigned: ${task.title}`,
        message: isActualReassignment ? 
          `You have been reassigned to task: ${task.title}` :
          `You have been assigned to task: ${task.title}`,
        type: isActualReassignment ? 'task_reassigned' : 'task_assigned',
        taskId: task._id,
        createdBy: req.user._id
      });
    }

    // Notify previous assignee if there was one and it's actually a reassignment
    if (isActualReassignment && previousAssignment.user && previousAssignment.user.toString() !== validatedUserId) {
      const notification = await Notification.create({
        user: previousAssignment.user,
        title: `Task Reassignment: ${task.title}`,
        message: `Task "${task.title}" has been reassigned to someone else`,
        type: 'task_unassigned',
        taskId: task._id,
        createdBy: req.user._id
      });
    }

    return res.json({ 
      message: isActualReassignment ? "Task reassigned successfully" : "Task assigned successfully", 
      task: shape(task) 
    });
  } catch (e) {
    return res.status(500).json({ 
      message: "Reassign task error", 
      error: e.message 
    });
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
