// routes/groups.js
import express from "express";
import mongoose from "mongoose";

import { Group } from "../models/Group.js";
import { User } from "../models/User.js";
import { authenticate } from "../middleware/auth.js";
import { ROLES, normalizeRole, prettyRole } from "../utils/roles.js";

const router = express.Router();

/** Scope queries based on the authenticated user's role */
const restrictQueryByRole = (user) => {
  const role = normalizeRole(user?.role);
  if (role === ROLES.ADMIN) return {};
  if (role === ROLES.MANAGER) {
    return { 
      $or: [
        { createdBy: user._id }, 
        { lead: user._id }, 
        { members: user._id }
      ] 
    };
  }
  // employee - can only see groups they're a member of
  return { members: user._id };
};

const shape = (g) => g.toClient();

/* -----------------------------------------------------------
 * Create group (Admin, Manager only)
 * --------------------------------------------------------- */
router.post("/", authenticate, async (req, res) => {
  try {
    const actor = req.user;
    const actorRole = normalizeRole(actor.role);
    
    if (![ROLES.ADMIN, ROLES.MANAGER].includes(actorRole)) {
      return res
        .status(403)
        .json({ message: "Only admin/manager can create groups" });
    }

    const { title, description, leadId, memberIds = [] } = req.body || {};

    if (!title || !description || !leadId) {
      return res
        .status(400)
        .json({ message: "title, description, and leadId are required" });
    }

    // Validate leadId
    if (!mongoose.isValidObjectId(leadId)) {
      return res
        .status(400)
        .json({ message: "leadId must be a valid user ObjectId" });
    }

    const lead = await User.findById(leadId);
    if (!lead || !lead.isActive || normalizeRole(lead.role) !== ROLES.MANAGER) {
      return res.status(400).json({ message: "Lead must be an active manager" });
    }

    // Validate memberIds
    const validMembers = [];
    if (Array.isArray(memberIds) && memberIds.length > 0) {
      for (const memberId of memberIds) {
        if (!mongoose.isValidObjectId(memberId)) {
          return res.status(400).json({ 
            message: `Invalid member ID: ${memberId}` 
          });
        }
        
        const member = await User.findById(memberId);
        if (!member || !member.isActive) {
          return res.status(400).json({ 
            message: `Invalid or inactive member: ${memberId}` 
          });
        }
        
        const memberRole = normalizeRole(member.role);
        if (![ROLES.MANAGER, ROLES.EMPLOYEE].includes(memberRole)) {
          return res.status(400).json({ 
            message: `Member ${member.email} must be a manager or employee` 
          });
        }
        
        validMembers.push(member._id);
      }
    }

    // Ensure lead is in members array
    if (!validMembers.some(id => String(id) === String(leadId))) {
      validMembers.push(leadId);
    }

    const group = await Group.create({
      title,
      description,
      lead: leadId,
      members: validMembers,
      createdBy: actor._id,
      createdDatetime: new Date()
    });

    // Populate for response
    await group.populate(['lead', 'members', 'createdBy']);

    return res.status(201).json(shape(group));
  } catch (e) {
    return res
      .status(500)
      .json({ message: "Create group error", error: e.message });
  }
});

/* -----------------------------------------------------------
 * List groups (scoped by role) + basic pagination
 * --------------------------------------------------------- */
router.get("/", authenticate, async (req, res) => {
  try {
    const { page = 1, limit = 10, isActive } = req.query;
    const filter = restrictQueryByRole(req.user);

    if (isActive !== undefined) {
      filter.isActive = isActive === 'true';
    }

    const groups = await Group.find(filter)
      .populate(['lead', 'members', 'createdBy', 'tasks'])
      .sort({ updatedAt: -1 })
      .skip((+page - 1) * +limit)
      .limit(+limit);

    const total = await Group.countDocuments(filter);

    return res.json({
      data: groups.map(shape),
      page: +page,
      limit: +limit,
      total,
    });
  } catch (e) {
    return res
      .status(500)
      .json({ message: "List groups error", error: e.message });
  }
});

/* -----------------------------------------------------------
 * Get group by numeric id (gid) or ObjectId (scoped)
 * --------------------------------------------------------- */
router.get("/:id", authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    const base = restrictQueryByRole(req.user);

    let group = null;
    if (/^\d+$/.test(id)) {
      group = await Group.findOne({ ...base, gid: +id })
        .populate(['lead', 'members', 'createdBy', 'tasks']);
    } else if (mongoose.isValidObjectId(id)) {
      group = await Group.findOne({ ...base, _id: id })
        .populate(['lead', 'members', 'createdBy', 'tasks']);
    }

    if (!group) return res.status(404).json({ message: "Group not found" });
    return res.json(shape(group));
  } catch (e) {
    return res
      .status(500)
      .json({ message: "Get group error", error: e.message });
  }
});

/* -----------------------------------------------------------
 * Update group (Admin, Manager who created it, or Lead)
 * --------------------------------------------------------- */
router.patch("/:id", authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    let group =
      /^\d+$/.test(id)
        ? await Group.findOne({ gid: +id })
        : mongoose.isValidObjectId(id)
        ? await Group.findById(id)
        : null;

    if (!group) return res.status(404).json({ message: "Group not found" });

    const actor = req.user;
    const actorRole = normalizeRole(actor.role);
    const isCreator = String(group.createdBy) === String(actor._id);
    const isLead = String(group.lead) === String(actor._id);

    // Permission check
    if (actorRole !== ROLES.ADMIN && !isCreator && !isLead) {
      return res.status(403).json({ 
        message: "Only admin, group creator, or group lead can modify this group" 
      });
    }

    const { title, description, leadId, memberIds, isActive } = req.body || {};
    const updates = {};

    if (title !== undefined) updates.title = title;
    if (description !== undefined) updates.description = description;
    if (isActive !== undefined) updates.isActive = isActive;

    // Handle lead change
    if (leadId !== undefined) {
      if (!mongoose.isValidObjectId(leadId)) {
        return res.status(400).json({ message: "leadId must be a valid user ObjectId" });
      }
      const newLead = await User.findById(leadId);
      if (!newLead || !newLead.isActive || normalizeRole(newLead.role) !== ROLES.MANAGER) {
        return res.status(400).json({ message: "New lead must be an active manager" });
      }
      updates.lead = leadId;
    }

    // Handle members update
    if (Array.isArray(memberIds)) {
      const validMembers = [];
      for (const memberId of memberIds) {
        if (!mongoose.isValidObjectId(memberId)) {
          return res.status(400).json({ message: `Invalid member ID: ${memberId}` });
        }
        const member = await User.findById(memberId);
        if (!member || !member.isActive) {
          return res.status(400).json({ message: `Invalid or inactive member: ${memberId}` });
        }
        const memberRole = normalizeRole(member.role);
        if (![ROLES.MANAGER, ROLES.EMPLOYEE].includes(memberRole)) {
          return res.status(400).json({ 
            message: `Member ${member.email} must be a manager or employee` 
          });
        }
        validMembers.push(member._id);
      }
      
      // Ensure lead is in members
      const currentLead = updates.lead || group.lead;
      if (!validMembers.some(id => String(id) === String(currentLead))) {
        validMembers.push(currentLead);
      }
      
      updates.members = validMembers;
    }

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ message: "No valid fields to update" });
    }

    Object.assign(group, updates);
    await group.save();
    await group.populate(['lead', 'members', 'createdBy', 'tasks']);

    return res.json(shape(group));
  } catch (e) {
    return res
      .status(500)
      .json({ message: "Update group error", error: e.message });
  }
});

/* -----------------------------------------------------------
 * Add task to group (Admin, Group Lead, or Group Creator)
 * --------------------------------------------------------- */
router.patch("/:id/tasks", authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    const { taskId } = req.body || {};

    if (!taskId) {
      return res.status(400).json({ message: "taskId is required" });
    }

    if (!mongoose.isValidObjectId(taskId)) {
      return res.status(400).json({ message: "taskId must be a valid ObjectId" });
    }

    let group =
      /^\d+$/.test(id)
        ? await Group.findOne({ gid: +id })
        : mongoose.isValidObjectId(id)
        ? await Group.findById(id)
        : null;

    if (!group) return res.status(404).json({ message: "Group not found" });

    const actor = req.user;
    const actorRole = normalizeRole(actor.role);
    const isCreator = String(group.createdBy) === String(actor._id);
    const isLead = String(group.lead) === String(actor._id);

    if (actorRole !== ROLES.ADMIN && !isCreator && !isLead) {
      return res.status(403).json({ 
        message: "Only admin, group creator, or group lead can add tasks" 
      });
    }

    // Check if task already in group
    if (group.tasks.includes(taskId)) {
      return res.status(400).json({ message: "Task already in this group" });
    }

    group.tasks.push(taskId);
    await group.save();
    await group.populate(['lead', 'members', 'createdBy', 'tasks']);

    return res.json(shape(group));
  } catch (e) {
    return res
      .status(500)
      .json({ message: "Add task to group error", error: e.message });
  }
});

/* -----------------------------------------------------------
 * Delete group (Admin only)
 * --------------------------------------------------------- */
router.delete("/:id", authenticate, async (req, res) => {
  try {
    const actorRole = normalizeRole(req.user.role);
    if (actorRole !== ROLES.ADMIN) {
      return res.status(403).json({ message: "Only admin can delete groups" });
    }

    const { id } = req.params;
    const deleted =
      /^\d+$/.test(id)
        ? await Group.findOneAndDelete({ gid: +id })
        : mongoose.isValidObjectId(id)
        ? await Group.findByIdAndDelete(id)
        : null;

    if (!deleted) return res.status(404).json({ message: "Group not found" });
    return res.json({ message: "Group deleted" });
  } catch (e) {
    return res
      .status(500)
      .json({ message: "Delete group error", error: e.message });
  }
});

export default router;
