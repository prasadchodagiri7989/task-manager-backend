import mongoose from "mongoose";
import { PRIORITIES, STATUSES } from "../utils/roles.js";
import { getNextSeq } from "./Counter.js";

// Comment Schema for task comments
const commentSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true
    },
    comment: {
      type: String,
      required: true,
      trim: true,
      maxlength: 1000
    },
    createdAt: {
      type: Date,
      default: Date.now
    }
  },
  { _id: true }
);

// Attachment Schema
const attachmentSchema = new mongoose.Schema(
  {
    id: String,
    name: String,
    type: String,
    size: Number,
    dataUrl: String, // data:... URL
  },
  { _id: false }
);

// Status Schema
const statusSchema = new mongoose.Schema(
  {
    status: {
      type: String,
      enum: STATUSES, // ["Todo", "In-Progress", "In-Review", "Completed"]
      default: "Todo",
      required: true
    },
    updatedAt: {
      type: Date,
      default: Date.now
    },
    updatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true
    }
  },
  { _id: false }
);

// Main Task Schema (merged with TasksReport functionality)
const taskSchema = new mongoose.Schema(
  {
    // optional sequential numeric id (keep if you like it)
    tid: { type: Number, unique: true, index: true },

    title: { 
      type: String, 
      required: true, 
      trim: true,
      maxlength: 200
    },

    description: { 
      type: String, 
      required: true, 
      trim: true,
      maxlength: 2000
    },

    priority: {
      type: String,
      enum: PRIORITIES, // "Low" | "Medium" | "High"
      default: "Medium",
      required: true
    },

    due: { 
      type: Date 
    },

    attachments: { 
      type: [attachmentSchema], 
      default: [] 
    },

    // Who created this task
    createdBy: { 
      type: mongoose.Schema.Types.ObjectId, 
      ref: "User", 
      required: true, 
      index: true 
    },

    // Comments on this task
    comments: {
      type: [commentSchema],
      default: []
    },

    // Assignment - either a single user OR a single group
    assignedTo: {
      user: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User"
      },
      group: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Group"
      }
    },

    // Current status
    status: {
      type: statusSchema,
      required: true,
      default: function() {
        return {
          status: "Todo",
          updatedAt: new Date(),
          updatedBy: this.createdBy
        };
      }
    },

    // Track status history
    statusHistory: [{
      status: {
        type: String,
        enum: STATUSES,
        required: true
      },
      updatedAt: {
        type: Date,
        default: Date.now
      },
      updatedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
        required: true
      },
      comment: String // Optional comment when status changes
    }]
  },
  { timestamps: true }
);

// Pre-save middleware for task
taskSchema.pre("save", async function (next) {
  if (this.isNew && (this.tid === undefined || this.tid === null)) {
    this.tid = await getNextSeq("task");
  }
  
  // Set initial status if not provided
  if (this.isNew && !this.status.updatedBy) {
    this.status.updatedBy = this.createdBy;
  }
  
  next();
});

// Method to add comment to task
taskSchema.methods.addComment = function(userId, commentText) {
  this.comments.push({
    user: userId,
    comment: commentText
  });
  return this.save();
};

// Method to get latest comments (limit)
taskSchema.methods.getRecentComments = function(limit = 10) {
  return this.comments
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, limit);
};

// Method to update status
taskSchema.methods.updateStatus = function(newStatus, updatedBy, comment) {
  // Add current status to history
  if (this.status.status !== newStatus) {
    this.statusHistory.push({
      status: this.status.status,
      updatedAt: this.status.updatedAt,
      updatedBy: this.status.updatedBy,
      comment: comment
    });

    // Update current status
    this.status = {
      status: newStatus,
      updatedAt: new Date(),
      updatedBy: updatedBy
    };
  }

  return this.save();
};

// Method to assign user to task (replaces any existing assignment)
taskSchema.methods.assignUser = function(userId) {
  this.assignedTo = { user: userId, group: null };
  return this.save();
};

// Method to assign group to task (replaces any existing assignment)
taskSchema.methods.assignGroup = function(groupId) {
  this.assignedTo = { user: null, group: groupId };
  return this.save();
};

// Method to remove assignment
taskSchema.methods.removeAssignment = function() {
  this.assignedTo = { user: null, group: null };
  return this.save();
};

// Method to check if user is assigned to task
taskSchema.methods.isUserAssigned = function(userId) {
  return this.assignedTo.user && String(this.assignedTo.user) === String(userId);
};

// Method to check if user can access task
taskSchema.methods.canUserAccess = function(user, userRole) {
  const isCreator = String(this.createdBy) === String(user._id);
  const isDirectlyAssigned = this.isUserAssigned(user._id);
  
  if (userRole === 'admin') return true;
  if (userRole === 'manager' && (isCreator || isDirectlyAssigned)) return true;
  if (userRole === 'employee' && isDirectlyAssigned) return true;
  
  return false;
};

// Client shape for Task (merged with TasksReport data)
taskSchema.methods.toClient = function () {
  return {
    id: this.tid,                         // numeric task id
    _id: String(this._id),               // MongoDB ObjectId
    title: this.title,
    description: this.description,
    priority: this.priority,
    due: this.due,                       // due date
    attachments: this.attachments,
    createdBy: String(this.createdBy),
    comments: this.comments,
    assignedTo: {
      user: this.assignedTo.user ? String(this.assignedTo.user) : null,
      group: this.assignedTo.group ? String(this.assignedTo.group) : null
    },
    status: this.status,
    statusHistory: this.statusHistory,
    createdAt: this.createdAt,
    updatedAt: this.updatedAt,
  };
};

// Static method to find tasks assigned to a user
taskSchema.statics.findAssignedToUser = function(userId) {
  return this.find({ 'assignedTo.user': userId });
};

// Static method to find tasks assigned to a group
taskSchema.statics.findAssignedToGroup = function(groupId) {
  return this.find({ 'assignedTo.group': groupId });
};

export const Task = mongoose.model("Task", taskSchema);
