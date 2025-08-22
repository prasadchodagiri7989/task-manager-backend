import mongoose from "mongoose";
import { ROLES, normalizeRole, STATUSES } from "../utils/roles.js";
import { getNextSeq } from "./Counter.js";

const groupSchema = new mongoose.Schema(
  {
    // optional sequential numeric id for frontend
    gid: { type: Number, unique: true, index: true },
    
    title: { 
      type: String, 
      required: true, 
      trim: true,
      maxlength: 100
    },
    
    description: { 
      type: String, 
      required: true, 
      trim: true,
      maxlength: 500
    },
    
    // Reference to the manager who leads this group (must be a manager)
    lead: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      validate: {
        validator: async function(userId) {
          const User = mongoose.model("User");
          const user = await User.findById(userId);
          return user && user.isActive && normalizeRole(user.role) === ROLES.MANAGER;
        },
        message: "Lead must be an active manager"
      }
    },
    
    // Array of group members (managers and employees only)
    members: [{
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      validate: {
        validator: async function(userId) {
          const User = mongoose.model("User");
          const user = await User.findById(userId);
          const userRole = normalizeRole(user?.role);
          return user && user.isActive && 
                 (userRole === ROLES.MANAGER || userRole === ROLES.EMPLOYEE);
        },
        message: "Members can only be active managers or employees"
      }
    }],
    
    // Array of tasks assigned to this group with status tracking
    tasks: [{
      taskId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Task",
        required: true
      },
      status: {
        type: String,
        enum: STATUSES, // ["Todo", "In-Progress", "In-Review", "Completed"]
        default: "Todo",
        required: true
      },
      assignedAt: {
        type: Date,
        default: Date.now
      },
      assignedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
        required: true
      }
    }],
    
    // Who created this group (admin or manager)
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true
    },
    
    // Track when group was created
    createdDatetime: {
      type: Date,
      default: Date.now,
      required: true
    },
    
    // Group status
    isActive: { 
      type: Boolean, 
      default: true 
    }
  },
  { 
    timestamps: true // This adds createdAt and updatedAt automatically
  }
);

// Pre-save middleware to generate sequential ID
groupSchema.pre("save", async function (next) {
  if (this.isNew && (this.gid === undefined || this.gid === null)) {
    this.gid = await getNextSeq("group");
  }
  next();
});

// Ensure lead is included in members array
groupSchema.pre("save", function(next) {
  if (this.lead && !this.members.includes(this.lead)) {
    this.members.push(this.lead);
  }
  next();
});

// Instance method to check if user can create/modify group
groupSchema.methods.canBeModifiedBy = function(user) {
  const userRole = normalizeRole(user?.role);
  return userRole === ROLES.ADMIN || userRole === ROLES.MANAGER;
};

// Static method to validate group creation permissions
groupSchema.statics.canBeCreatedBy = function(user) {
  const userRole = normalizeRole(user?.role);
  return userRole === ROLES.ADMIN || userRole === ROLES.MANAGER;
};

// Instance method for client response
groupSchema.methods.toClient = function() {
  return {
    _id: this._id,
    gid: this.gid,
    title: this.title,
    description: this.description,
    lead: this.lead,
    members: this.members,
    tasks: this.tasks.map(task => ({
      taskId: String(task.taskId),
      status: task.status,
      assignedAt: task.assignedAt,
      assignedBy: String(task.assignedBy)
    })),
    createdBy: this.createdBy,
    createdDatetime: this.createdDatetime,
    isActive: this.isActive,
    createdAt: this.createdAt,
    updatedAt: this.updatedAt
  };
};

// Methods for managing tasks in groups
groupSchema.methods.addTask = function(taskId, assignedBy, status = "Todo") {
  // Check if task already exists
  const existingTask = this.tasks.find(
    task => String(task.taskId) === String(taskId)
  );
  
  if (existingTask) {
    existingTask.status = status;
    existingTask.assignedBy = assignedBy;
    existingTask.assignedAt = new Date();
  } else {
    this.tasks.push({
      taskId,
      status,
      assignedBy,
      assignedAt: new Date()
    });
  }
  
  return this.save();
};

groupSchema.methods.updateTaskStatus = function(taskId, newStatus) {
  const task = this.tasks.find(
    task => String(task.taskId) === String(taskId)
  );
  
  if (task) {
    task.status = newStatus;
    return this.save();
  }
  
  throw new Error("Task not found in group's assigned tasks");
};

groupSchema.methods.removeTask = function(taskId) {
  this.tasks = this.tasks.filter(
    task => String(task.taskId) !== String(taskId)
  );
  return this.save();
};

groupSchema.methods.getTasksByStatus = function(status) {
  return this.tasks.filter(task => task.status === status);
};

// Create indexes for better performance
groupSchema.index({ title: 1 });
groupSchema.index({ lead: 1 });
groupSchema.index({ members: 1 });
groupSchema.index({ createdBy: 1 });
groupSchema.index({ isActive: 1 });

export const Group = mongoose.model("Group", groupSchema);
