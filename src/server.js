import 'dotenv/config';
import app from './app.js';
import { connectDB } from './config/db.js';

const PORT = process.env.PORT || 4000;

async function start() {
  try {
    await connectDB(process.env.MONGO_URI);
    app.listen(PORT, () => {
      console.log(`🚀 Server at http://localhost:${PORT}`);
    });
  } catch (e) {
    console.error('DB connection error:', e);
    process.exit(1);
  }
}

start();
