import express from 'express';
import cors from 'cors';
import multer from 'multer';
import dotenv from 'dotenv';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { analyzeMeal, getTelemetry, resetLogs } from './controllers/calorieController.js';
import { budgetGate } from './middleware/budgetGate.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());

// Setup Multer for in-memory file uploads
const storage = multer.memoryStorage();
const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 } // 10MB upload limit
});

// Connect to MongoDB Database
const connectDatabase = async () => {
  try {
    let mongoUri = process.env.MONGODB_URI;

    if (!mongoUri) {
      console.log('No MONGODB_URI found in environment. Starting MongoMemoryServer...');
      const mongoServer = await MongoMemoryServer.create();
      mongoUri = mongoServer.getUri();
      console.log(`MongoMemoryServer started dynamically at: ${mongoUri}`);
    }

    await mongoose.connect(mongoUri);
    console.log('Successfully connected to MongoDB!');
  } catch (error) {
    console.error('Failed to connect to MongoDB database:', error);
    process.exit(1);
  }
};

// API Endpoints
app.post('/api/analyze-meal', upload.single('image'), budgetGate, analyzeMeal);
app.get('/api/telemetry', getTelemetry);
app.post('/api/reset', resetLogs);

// Backend Health Check
app.get('/api/health', (req, res) => {
  res.status(200).json({ status: 'healthy', timestamp: new Date() });
});

// Startup Entrypoint
const startServer = async () => {
  await connectDatabase();
  app.listen(PORT, () => {
    console.log(`Backend server is running on http://localhost:${PORT}`);
  });
};

startServer();
