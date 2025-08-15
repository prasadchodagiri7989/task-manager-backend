// api/index.js
import 'dotenv/config';
import { connectDB } from '../src/config/db.js';
import app from '../src/app.js';
import { createServer } from 'http';
import { parse } from 'url';

let server;
let dbInitialized = false;

export default async function handler(req, res) {
  if (!dbInitialized) {
    await connectDB(process.env.MONGO_URI);
    dbInitialized = true;
  }

  if (!server) {
    server = createServer(app);
  }

  const parsedUrl = parse(req.url, true);
  req.url = parsedUrl.path;
  server.emit('request', req, res);
}
