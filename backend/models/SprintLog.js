import mongoose from 'mongoose';

const sprintLogSchema = new mongoose.Schema({
  timestamp: {
    type: Date,
    default: Date.now
  },
  mode: {
    type: String,
    enum: ['Control', 'Experimental'],
    required: true
  },
  promptTokens: {
    type: Number,
    required: true,
    default: 0
  },
  candidatesTokens: {
    type: Number,
    required: true,
    default: 0
  },
  totalTokens: {
    type: Number,
    required: true,
    default: 0
  },
  wasCached: {
    type: Boolean,
    required: true,
    default: false
  },
  originalFileSizeKB: {
    type: Number,
    required: true,
    default: 0
  },
  optimizedFileSizeKB: {
    type: Number,
    required: true,
    default: 0
  },
  regionalCarbonFactor: {
    type: String,
    enum: ['high', 'low'],
    required: true
  },
  calculatedVirtualCost: {
    type: Number,
    required: true,
    default: 0
  },
  // Extra telemetry fields
  mealTag: {
    type: String,
    default: ''
  },
  imageHash: {
    type: String,
    default: ''
  },
  foodData: {
    type: mongoose.Schema.Types.Mixed,
    default: null
  },
  simulatedEgressFee: {
    type: Number,
    default: 0
  },
  carbonEmissionGrams: {
    type: Number,
    default: 0
  },
  s3TtlDays: {
    type: Number,
    default: null
  }
});

const SprintLog = mongoose.model('SprintLog', sprintLogSchema, 'sprint_logs');
export default SprintLog;
