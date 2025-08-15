import 'dotenv/config';
import app from '../src/app.js';
import { connectDB } from '../src/config/db.js';

let dbPromise;
function ensureDB() {
  if (!dbPromise) dbPromise = connectDB(process.env.MONGO_URI);
  return dbPromise;
}

export default async function handler(req, res) {
  await ensureDB();
  return app(req, res);
}
