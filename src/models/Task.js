import mongoose from "mongoose";
import { PRIORITIES, STATUSES } from "../utils/roles.js";
import { getNextSeq } from "./Counter.js";

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

const taskSchema = new mongoose.Schema(
  {
    // optional sequential numeric id (keep if you like it)
    tid: { type: Number, unique: true, index: true },

    title: { type: String, required: true, trim: true },

    // store HTML from editor
    descriptionHtml: { type: String, required: true },

    status: {
      type: String,
      enum: STATUSES,
      default: "Todo",
    },

    priority: {
      type: String,
      enum: PRIORITIES, // "Low" | "Medium" | "High"
      default: "Medium",
    },

    due: { type: Date },

    attachments: { type: [attachmentSchema], default: [] },

    // ✅ Only ObjectId references
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    assignedTo: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },

    history: [
      {
        by: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
        action: String,
        at: { type: Date, default: Date.now },
      },
    ],
  },
  { timestamps: true }
);

taskSchema.pre("save", async function (next) {
  if (this.isNew && (this.tid === undefined || this.tid === null)) {
    this.tid = await getNextSeq("task");
  }
  next();
});

// Client shape (keep both `description` and `descriptionHtml` to satisfy frontend)
taskSchema.methods.toClient = function () {
  return {
    id: this.tid,                         // numeric task id (if you use it)
    mongoId: String(this._id),            // task ObjectId (handy)
    title: this.title,
    description: this.descriptionHtml,    // <-- alias for frontend that expects `description`
    descriptionHtml: this.descriptionHtml,
    priority: this.priority,
    status: this.status,
    due: this.due,
    attachments: this.attachments,
    assigneeId: this.assignedTo ? String(this.assignedTo) : null, // <-- ObjectId string
    createdBy: this.createdBy ? String(this.createdBy) : null,    // <-- ObjectId string
    createdAt: this.createdAt,
    updatedAt: this.updatedAt,
  };
};

export const Task = mongoose.model("Task", taskSchema);
