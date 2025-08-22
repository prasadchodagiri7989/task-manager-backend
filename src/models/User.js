import mongoose from "mongoose";
import bcrypt from "bcryptjs";
import { ROLES, normalizeRole, STATUSES } from "../utils/roles.js";
import { getNextSeq } from "./Counter.js";

const userSchema = new mongoose.Schema(
  {
    uid: { type: Number, unique: true, index: true }, // optional numeric id for frontend
    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, unique: true, lowercase: true },
    password: { type: String, required: true, minlength: 6 },
    role: {
      type: String,
      enum: Object.values(ROLES),
      default: ROLES.EMPLOYEE,
      required: true,
    },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

// UserTasks Schema - tracks tasks assigned to individual users
const userTasksSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      unique: true,
      index: true
    },
    
    assignedTasks: [{
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
    }]
  },
  { timestamps: true }
);

userSchema.pre("save", async function (next) {
  if (this.isNew && (this.uid === undefined || this.uid === null)) {
    this.uid = await getNextSeq("user");
  }
  // normalize role to your canonical value (usually lowercase)
  this.role = normalizeRole(this.role);

  if (!this.isModified("password")) return next();
  const salt = await bcrypt.genSalt(10);
  this.password = await bcrypt.hash(this.password, salt);
  next();
});

userSchema.methods.comparePassword = async function (candidate) {
  return bcrypt.compare(candidate, this.password);
};

// Expose ObjectId as `id` and keep numeric `uid`
userSchema.methods.toClient = function () {
  return {
    id: this._id.toString(),   // <-- use this in the frontend Select
    uid: this.uid,             // optional, if you still want it
    name: this.name,
    email: this.email,
    role: this.role,           // already normalized
    isActive: this.isActive,
    createdAt: this.createdAt,
  };
};

// Methods for UserTasks
userTasksSchema.methods.addTask = function(taskId, assignedBy, status = "Todo") {
  // Check if task already exists
  const existingTask = this.assignedTasks.find(
    task => String(task.taskId) === String(taskId)
  );
  
  if (existingTask) {
    existingTask.status = status;
    existingTask.assignedBy = assignedBy;
    existingTask.assignedAt = new Date();
  } else {
    this.assignedTasks.push({
      taskId,
      status,
      assignedBy,
      assignedAt: new Date()
    });
  }
  
  return this.save();
};

userTasksSchema.methods.updateTaskStatus = function(taskId, newStatus) {
  const task = this.assignedTasks.find(
    task => String(task.taskId) === String(taskId)
  );
  
  if (task) {
    task.status = newStatus;
    return this.save();
  }
  
  throw new Error("Task not found in user's assigned tasks");
};

userTasksSchema.methods.removeTask = function(taskId) {
  this.assignedTasks = this.assignedTasks.filter(
    task => String(task.taskId) !== String(taskId)
  );
  return this.save();
};

userTasksSchema.methods.getTasksByStatus = function(status) {
  return this.assignedTasks.filter(task => task.status === status);
};

userTasksSchema.methods.toClient = function() {
  return {
    _id: String(this._id),
    userId: String(this.userId),
    assignedTasks: this.assignedTasks.map(task => ({
      taskId: String(task.taskId),
      status: task.status,
      assignedAt: task.assignedAt,
      assignedBy: String(task.assignedBy)
    })),
    createdAt: this.createdAt,
    updatedAt: this.updatedAt
  };
};

export const User = mongoose.model("User", userSchema);
export const UserTasks = mongoose.model("UserTasks", userTasksSchema);
