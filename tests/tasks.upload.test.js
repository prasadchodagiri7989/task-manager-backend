import request from 'supertest';
import app from '../src/app.js';
import mongoose from 'mongoose';
import fs from 'fs';
import path from 'path';

describe('POST /tasks', () => {
  let token;
  beforeAll(async () => {
    // Replace with a valid login or token retrieval
    token = process.env.TEST_AUTH_TOKEN;
  });

  it('should create a task with file and voice upload', async () => {
    const filePath = path.join(__dirname, 'testfile.txt');
    const voicePath = path.join(__dirname, 'testvoice.mp3');
    fs.writeFileSync(filePath, 'Test file content');
    fs.writeFileSync(voicePath, 'Test voice content');

    const res = await request(app)
      .post('/tasks')
      .set('Authorization', `Bearer ${token}`)
      .field('title', 'Test Task')
      .field('description', 'Test Description')
      .field('priority', 'Medium')
      .attach('file', filePath)
      .attach('voice', voicePath);

    expect(res.statusCode).toBe(201);
    expect(res.body).toHaveProperty('file');
    expect(res.body).toHaveProperty('voice');
    expect(res.body.title).toBe('Test Task');
    expect(res.body.description).toBe('Test Description');

    fs.unlinkSync(filePath);
    fs.unlinkSync(voicePath);
  });

  afterAll(async () => {
    await mongoose.connection.close();
  });
});
