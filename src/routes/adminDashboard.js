
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
    
    // First, get all tasks and then group them by user in JavaScript
    let taskMatch = {};
    if (userId && userId !== 'all') {
      taskMatch = {
        $or: [
          { "assignedTo.user": new mongoose.Types.ObjectId(userId) },
          { "claimedBy": new mongoose.Types.ObjectId(userId) }
        ]
      };
    }

    // Get all tasks that have either a direct assignment or are claimed
    const allTasks = await Task.find({
      ...taskMatch,
      $or: [
        { "assignedTo.user": { $ne: null } },
        { "claimedBy": { $ne: null } }
      ]
    }).populate('assignedTo.user claimedBy', 'name email role');

    // Group tasks by user manually
    const userTasksMap = new Map();

    allTasks.forEach(task => {
      // Determine who actually worked on this task
      let actualUser;
      let assignmentType;
      
      if (task.claimedBy) {
        // Group task claimed by a user
        actualUser = task.claimedBy;
        assignmentType = "group_claimed";
      } else if (task.assignedTo.user) {
        // Direct assignment
        actualUser = task.assignedTo.user;
        assignmentType = "direct_assigned";
      }

      if (actualUser) {
        const userId = actualUser._id.toString();
        
        if (!userTasksMap.has(userId)) {
          userTasksMap.set(userId, {
            user: actualUser,
            tasks: []
          });
        }

        userTasksMap.get(userId).tasks.push({
          _id: task._id,
          title: task.title,
          status: task.status.status,
          due: task.due,
          completedAt: ['Completed', 'Closed'].includes(task.status.status) ? task.status.updatedAt : null,
          isReassigned: task.isReassigned,
          isReopened: task.isReopened,
          createdAt: task.createdAt,
          assignmentType
        });
      }
    });

    // Convert map to array for processing
    const aggregation = Array.from(userTasksMap.entries()).map(([userId, data]) => ({
      _id: userId,
      userName: data.user.name,
      email: data.user.email,
      tasks: data.tasks
    }));

    // Calculate performance for each user
    const userPerformance = aggregation.map(userDoc => {
      const { userName, email, tasks } = userDoc;
      let totalPoints = 0;
      let allocatedPoints = 0;
      let completedTasks = 0;
      let onTimeTasks = 0;
      let beforeTimeTasks = 0;
      let lateTasks = 0;
      let reassignedTasks = 0;
      let reopenedTasks = 0;

      tasks.forEach(task => {
        // Each task gets 3 base points added to total (this never changes)
        totalPoints += 3;

        // Calculate allocated points based on performance
        let taskPoints = 3; // Base points for allocated

        // Check if task is completed or closed
        if ((task.status === 'Completed' || task.status === 'Closed') && task.completedAt && task.due) {
          completedTasks++;
          const completedDate = new Date(task.completedAt);
          const dueDate = new Date(task.due);

          if (completedDate < dueDate) {
            // Before time: Give 5 points (3 base + 2 bonus)
            taskPoints = 5;
            beforeTimeTasks++;
          } else if (completedDate.toDateString() === dueDate.toDateString()) {
            // On time (same day): Give 3 points
            taskPoints = 3;
            onTimeTasks++;
          } else {
            // Late: 3 - days late
            const daysLate = Math.ceil((completedDate - dueDate) / (1000 * 60 * 60 * 24));
            taskPoints = Math.max(0, 3 - daysLate);
            lateTasks++;
          }
        } else if (task.status === 'Completed' || task.status === 'Closed') {
          // Completed/Closed but no due date, give full points
          taskPoints = 3;
          completedTasks++;
          onTimeTasks++;
        } else {
          // Task not completed yet, give 0 allocated points but still count in total
          taskPoints = 0;
        }

        // Apply penalties (but don't let points go below 0)
        if (task.isReassigned) {
          taskPoints = Math.max(0, taskPoints - 3);
          reassignedTasks++;
        }

        if (task.isReopened) {
          taskPoints = Math.max(0, taskPoints - 5);
          reopenedTasks++;
        }

        allocatedPoints += taskPoints;
      });

      // Calculate percentage
      const percentage = totalPoints > 0 ? ((allocatedPoints / totalPoints) * 100).toFixed(2) : 0;

      return {
        userId: userDoc._id,
        userName,
        email,
        totalTasks: tasks.length,
        completedTasks,
        onTimeTasks,
        beforeTimeTasks,
        lateTasks,
        reassignedTasks,
        reopenedTasks,
        totalPoints,
        allocatedPoints,
        percentage: parseFloat(percentage),
        score: `${allocatedPoints}/${totalPoints}`,
        grade: getPerformanceGrade(parseFloat(percentage)),
        taskBreakdown: tasks.map(t => ({
          title: t.title,
          status: t.status,
          assignmentType: t.assignmentType
        }))
      };
    });

    // Sort by percentage (highest first)
    userPerformance.sort((a, b) => b.percentage - a.percentage);

    res.json(userPerformance);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Helper function to assign performance grades
function getPerformanceGrade(percentage) {
  if (percentage >= 90) return 'A+';
  if (percentage >= 80) return 'A';
  if (percentage >= 70) return 'B+';
  if (percentage >= 60) return 'B';
  if (percentage >= 50) return 'C';
  if (percentage >= 40) return 'D';
  return 'F';
}

/**
 * GET /admin/dashboard/group-performance
 */
router.get("/group-performance", async (req, res) => {
  try {
    const { userId } = req.query;
    let match = { "assignedTo.group": { $ne: null } };
    if (userId && userId !== 'all') {
      match["assignedTo.user"] = new mongoose.Types.ObjectId(userId);
    }

    const aggregation = await Task.aggregate([
      { $match: match },
      {
        $group: {
          _id: "$assignedTo.group",
          completedTasks: {
            $sum: {
              $cond: [{ $eq: ["$status.status", "Completed"] }, 1, 0]
            }
          },
          closedTasks: {
            $sum: {
              $cond: [{ $eq: ["$status.status", "Closed"] }, 1, 0]
            }
          },
          totalTasks: { $sum: 1 }
        }
      },
      { $lookup: { from: "groups", localField: "_id", foreignField: "_id", as: "group" } },
      { $unwind: "$group" },
      {
        $project: {
          groupName: "$group.title",
          completedTasks: 1,
          closedTasks: 1,
          totalTasks: 1
        }
      },
      { $sort: { completedTasks: -1, closedTasks: -1 } }
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
