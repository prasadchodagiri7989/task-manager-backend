import mongoose from "mongoose";

const counterSchema = new mongoose.Schema({
  _id: { type: String, required: true }, // e.g., 'user', 'task'
  seq: { type: Number, default: 100 },   // start near your sample data range
});

export const Counter = mongoose.model("Counter", counterSchema);

export const getNextSeq = async (name) => {
  const doc = await Counter.findByIdAndUpdate(
    name,
    { $inc: { seq: 1 } },
    { new: true, upsert: true }
  );
  return doc.seq;
};
