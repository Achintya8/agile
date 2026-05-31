import SprintLog from '../models/SprintLog.js';
import crypto from 'crypto';

export const BUDGET_LIMIT = 0.50;

export const getCumulativeCost = async () => {
  const result = await SprintLog.aggregate([
    {
      $group: {
        _id: null,
        totalCost: { $sum: '$calculatedVirtualCost' }
      }
    }
  ]);
  return result.length > 0 ? result[0].totalCost : 0;
};

export const budgetGate = async (req, res, next) => {
  try {
    const cumulativeCost = await getCumulativeCost();
    const mode = req.body.mode || 'Control';

    if (mode === 'Experimental') {
      // Predict if transaction is cached
      const mealTag = req.body.mealTag ? req.body.mealTag.trim() : '';
      let isCached = false;

      // 1. Text lookup check
      if (mealTag) {
        const cacheHit = await SprintLog.findOne({
          mealTag: { $regex: new RegExp(`^${mealTag}$`, 'i') }
        });
        if (cacheHit) {
          isCached = true;
        }
      }

      // 2. Cryptographic image hash lookup check
      if (!isCached && req.file) {
        const hash = crypto.createHash('sha256').update(req.file.buffer).digest('hex');
        const cacheHit = await SprintLog.findOne({ imageHash: hash });
        if (cacheHit) {
          isCached = true;
        }
      }

      // If cached, predicted virtual cost is $0. If not cached, we predict a tiny cost (~$0.0001)
      const predictedCost = isCached ? 0 : 0.0001;

      if (cumulativeCost + predictedCost > BUDGET_LIMIT) {
        return res.status(400).json({
          error: 'MOCK AWS BUDGET CEILING VIOLATED - TRANSACTION BLOCKED',
          message: `This experimental operation is blocked because the remaining simulated budget is $${(BUDGET_LIMIT - cumulativeCost).toFixed(5)}, which is less than the predicted transaction cost.`,
          cumulativeCost,
          budgetLimit: BUDGET_LIMIT
        });
      }
    }

    req.cumulativeCostBefore = cumulativeCost;
    next();
  } catch (error) {
    console.error('Error in budgetGate middleware:', error);
    next(error);
  }
};
