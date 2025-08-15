import mongoose from "mongoose";
import bcrypt from "bcryptjs";
import { ROLES, normalizeRole } from "../utils/roles.js";
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
      default: ROLES.WORKER,
      required: true,
    },
    isActive: { type: Boolean, default: true },
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

export const User = mongoose.model("User", userSchema);
