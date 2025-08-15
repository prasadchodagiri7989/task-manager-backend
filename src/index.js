import "dotenv/config";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import { connectDB } from "./config/db.js";

import authRoutes from "./routes/auth.js";
import userRoutes from "./routes/users.js";
import taskRoutes from "./routes/tasks.js";



const app = express();

app.use(express.json());
app.use(helmet());
app.use(morgan("dev"));
app.use(cors({
  origin: 'http://localhost:8081',
  credentials: true, // If using cookies
}));

app.get("/", (req, res) => res.send("Task Manager API is running"));

app.use("/auth", authRoutes);
app.use("/users", userRoutes);
app.use("/tasks", taskRoutes);

const PORT = process.env.PORT || 4000;

connectDB(process.env.MONGO_URI)
  .then(() => app.listen(PORT, () => console.log(`🚀 Server at http://localhost:${PORT}`)))
  .catch((e) => {
    console.error("DB connection error:", e);
    process.exit(1);
  });
