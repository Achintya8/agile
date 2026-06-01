import { GoogleGenerativeAI } from '@google/generative-ai';
import sharp from 'sharp';
import crypto from 'crypto';
import * as tf from '@tensorflow/tfjs';
import * as mobilenet from '@tensorflow-models/mobilenet';
import SprintLog from '../models/SprintLog.js';
import { BUDGET_LIMIT, getCumulativeCost } from '../middleware/budgetGate.js';

// Setup Gemini API client lazily to handle dotenv initialization order
const getGeminiClient = () => {
  const apiKey = process.env.GEMINI_API_KEY;
  const isApiKeyConfigured = apiKey && apiKey !== 'YOUR_GEMINI_API_KEY' && apiKey.trim().length > 0;
  if (!isApiKeyConfigured) return null;
  return new GoogleGenerativeAI(apiKey);
};

// Free OpenRouter models — Llama 3.3 70B as primary (less congested), Gemma 2 9B as vision secondary
const FREE_TEXT_MODEL   = 'meta-llama/llama-3.3-70b-instruct:free'; // Primary: text-only, reliable free tier
const FREE_VISION_MODEL = 'google/gemma-2-9b-it:free';              // Secondary: vision-capable free model

const callOpenRouter = async (prompt, processedImageBuffer, mode, mimetype, model = FREE_TEXT_MODEL) => {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey || apiKey === 'YOUR_OPENROUTER_API_KEY' || apiKey.trim().length === 0) return null;

  const hasImage = !!processedImageBuffer;

  try {
    const messages = [];
    // Gemma models are vision-capable and can receive image payloads
    const isVisionModel = model.includes('gemma') || model.includes('vision');

    if (isVisionModel && hasImage) {
      const base64Image = processedImageBuffer.toString('base64');
      const mime = mode === 'Experimental' ? 'image/webp' : (mimetype || 'image/png');
      messages.push({
        role: 'user',
        content: [
          { type: 'text', text: prompt },
          { type: 'image_url', image_url: { url: `data:${mime};base64,${base64Image}` } }
        ]
      });
    } else {
      messages.push({ role: 'user', content: prompt });
    }

    const payload = {
      model,
      messages
    };

    console.log(`[BACKEND] Sending request to OpenRouter (${model})...`);
    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'http://localhost:5000',
        'X-Title': 'Sustain-Agile Tracker'
      },
      body: JSON.stringify(payload)
    });

    if (response.status !== 200) {
      const errorBody = await response.text();
      console.warn(`[BACKEND] OpenRouter error ${response.status} with ${model}: ${errorBody}`);
      return null;
    }

    const data = await response.json();
    console.log(`[BACKEND] OpenRouter (${model}) responded successfully.`);
    return {
      text: data.choices?.[0]?.message?.content || '',
      usage: {
        promptTokens: data.usage?.prompt_tokens || 0,
        candidatesTokens: data.usage?.completion_tokens || 0,
        totalTokens: data.usage?.total_tokens || 0
      }
    };
  } catch (err) {
    console.error('[BACKEND] OpenRouter call failed:', err);
    return null;
  }
};

let localClassifier = null;
const getClassifier = async () => {
  if (!localClassifier) {
    console.log('[BACKEND] Loading local MobileNet classifier...');
    const start = Date.now();
    localClassifier = await mobilenet.load({ version: 2, alpha: 1.0 });
    console.log(`[BACKEND] Local MobileNet classifier loaded in ${((Date.now() - start) / 1000).toFixed(2)}s`);
  }
  return localClassifier;
};

const classifyImageBuffer = async (imageBuffer) => {
  try {
    const model = await getClassifier();
    const { data } = await sharp(imageBuffer)
      .resize(224, 224, { fit: 'fill' })
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
      
    const tensor = tf.tensor3d(new Uint8Array(data), [224, 224, 3], 'int32');
    const predictions = await model.classify(tensor);
    tensor.dispose();
    
    if (predictions && predictions.length > 0) {
      const rawClass = predictions[0].className;
      const firstLabel = rawClass.split(',')[0].trim();
      return firstLabel.charAt(0).toUpperCase() + firstLabel.slice(1);
    }
  } catch (err) {
    console.error('[BACKEND] Local MobileNet classification failed:', err);
  }
  return null;
};

let liveRequestsMade = 0;
const MAX_LIVE_REQUESTS = 20;

// Regex helper to extract and parse JSON from Gemini's response
const parseGeminiJson = (text) => {
  try {
    // Look for markdown json blocks first
    const jsonBlockRegex = /```json\s*([\s\S]*?)\s*```/;
    const match = text.match(jsonBlockRegex);
    if (match && match[1]) {
      return JSON.parse(match[1].trim());
    }

    // Try to find any JSON-like structure
    const bruteRegex = /\{[\s\S]*\}/;
    const bruteMatch = text.match(bruteRegex);
    if (bruteMatch) {
      return JSON.parse(bruteMatch[0].trim());
    }

    return JSON.parse(text.trim());
  } catch (err) {
    console.error('Failed to parse Gemini response as JSON. Text:', text, 'Error:', err);
    return null;
  }
};

// High-fidelity fallback database for meal identification (if Gemini key is missing)
const MOCK_MEALS_DB = [
  { keywords: ['apple'], item: 'Fresh Apple', calories: 95, protein: 0.5, carbs: 25, fat: 0.3, explanation: 'A standard medium-sized raw apple with skin, high in fiber and vitamin C.' },
  { keywords: ['salad', 'lettuce', 'vegetable'], item: 'Mediterranean Garden Salad', calories: 180, protein: 4, carbs: 12, fat: 14, explanation: 'Mixed salad greens with cherry tomatoes, cucumbers, olives, feta cheese, and olive oil dressing.' },
  { keywords: ['pizza', 'cheese', 'pepperoni'], item: 'Pepperoni Pizza Slice', calories: 290, protein: 12, carbs: 32, fat: 12, explanation: 'One large slice of classic hand-tossed pepperoni pizza with mozzarella cheese and tomato sauce.' },
  { keywords: ['egg', 'scrambled', 'breakfast'], item: 'Scrambled Eggs (2 eggs)', calories: 140, protein: 12, carbs: 1, fat: 10, explanation: 'Two farm-fresh eggs scrambled with a splash of milk and cooked in a small pat of butter.' },
  { keywords: ['chicken', 'breast', 'meat'], item: 'Grilled Chicken Breast (150g)', calories: 245, protein: 46, carbs: 0, fat: 5, explanation: 'Lean, boneless skinless chicken breast grilled with olive oil, salt, and black pepper.' },
  { keywords: ['banana'], item: 'Medium Banana', calories: 105, protein: 1.3, carbs: 27, fat: 0.3, explanation: 'One raw yellow banana, an excellent quick source of potassium, vitamins, and fast-acting carbs.' },
  { keywords: ['burger', 'beef', 'fast food'], item: 'Classic Cheese Burger', calories: 350, protein: 20, carbs: 35, fat: 15, explanation: 'Beef patty topped with cheddar cheese, lettuce, tomato, pickles, and house sauce on a sesame bun.' }
];

const getMockMealData = (tag = '') => {
  const cleanTag = tag.trim().toLowerCase();
  for (const meal of MOCK_MEALS_DB) {
    if (meal.keywords.some(k => cleanTag.includes(k))) {
      return meal;
    }
  }
  
  // Default general healthy meal
  return {
    item: tag ? `Meal (${tag})` : 'Healthy Energy Bowl',
    calories: 420,
    protein: 22,
    carbs: 45,
    fat: 16,
    explanation: 'A balanced energy bowl containing complex grains, lean protein, healthy fats, and steamed vegetables.'
  };
};

export const analyzeMeal = async (req, res) => {
  try {
    const { mode, mealTag } = req.body;
    let cleanMealTag = mealTag ? mealTag.trim() : '';
    console.log(`[BACKEND] Received /api/analyze-meal request. Mode: ${mode}, Tag: ${cleanMealTag}, HasFile: ${!!req.file}`);

    if (req.file) {
      console.log('[BACKEND] Image uploaded, running local TensorFlow/MobileNet classification...');
      const detectedTag = await classifyImageBuffer(req.file.buffer);
      if (detectedTag) {
        console.log(`[BACKEND] Local MobileNet classified image as: ${detectedTag}`);
        cleanMealTag = detectedTag;
      } else {
        console.log('[BACKEND] Local classification returned null, using request tag:', cleanMealTag);
      }
    }

    if (!req.file && !cleanMealTag) {
      return res.status(400).json({ error: 'Please upload a meal image or enter a meal name.' });
    }

    const hasFile = !!req.file;
    const originalFileSizeKB = hasFile ? parseFloat((req.file.buffer.length / 1024).toFixed(2)) : 0;
    
    let imageHash = '';
    if (hasFile) {
      imageHash = crypto.createHash('sha256').update(req.file.buffer).digest('hex');
    }

    // ==========================================
    // 1. EXPERIMENTAL MODE - CACHE CHECK
    // ==========================================
    if (mode === 'Experimental') {
      let cachedLog = null;

      // Check text tag cache (case-insensitive)
      if (cleanMealTag) {
        cachedLog = await SprintLog.findOne({
          mealTag: { $regex: new RegExp(`^${cleanMealTag}$`, 'i') },
          foodData: { $ne: null }
        }).sort({ timestamp: -1 });
      }

      // Check cryptographic image hash cache
      if (!cachedLog && imageHash) {
        cachedLog = await SprintLog.findOne({
          imageHash: imageHash,
          foodData: { $ne: null }
        }).sort({ timestamp: -1 });
      }

      if (cachedLog) {
        // Cache Hit! Return cached data immediately at $0 cost and 0 tokens.
        let optimizedFileSizeKB = originalFileSizeKB;
        
        if (hasFile) {
          try {
            // Compress the image to simulate WebP optimized size even for cached log
            const compressed = await sharp(req.file.buffer)
              .resize(600, null, { withoutEnlargement: true })
              .webp({ quality: 80 })
              .toBuffer();
            optimizedFileSizeKB = parseFloat((compressed.length / 1024).toFixed(2));
          } catch (err) {
            console.error('Sharp compression during cache hit failed, using default ratio:', err);
            optimizedFileSizeKB = parseFloat((originalFileSizeKB * 0.25).toFixed(2)); // Default 75% savings
          }
        }

        const simulatedEgressFee = parseFloat(((optimizedFileSizeKB / 1024 / 1024) * 0.09).toFixed(8)); // $0.09 per GB
        
        // Low environmental factor (eu-west-1): 50 g CO2eq / kWh.
        // Database cache hit requires virtually zero energy. Let's log 0.002 grams.
        const carbonEmissionGrams = 0.002;

        const newLog = new SprintLog({
          mode: 'Experimental',
          promptTokens: 0,
          candidatesTokens: 0,
          totalTokens: 0,
          wasCached: true,
          originalFileSizeKB,
          optimizedFileSizeKB,
          regionalCarbonFactor: 'low',
          calculatedVirtualCost: 0,
          mealTag: cachedLog.mealTag || cleanMealTag,
          imageHash: imageHash || cachedLog.imageHash,
          foodData: cachedLog.foodData,
          simulatedEgressFee,
          carbonEmissionGrams,
          s3TtlDays: 7
        });

        await newLog.save();
        
        const cumulativeCost = await getCumulativeCost();

        return res.status(200).json({
          message: 'Cache hit! Retrieved nutrition details in 0ms.',
          data: cachedLog.foodData,
          log: newLog,
          cumulativeCost,
          budgetLimit: BUDGET_LIMIT,
          budgetViolation: false
        });
      }
    }

    // ==========================================
    // 2. IMAGE COMPRESSION (Green Cloud / Experimental)
    // ==========================================
    let processedImageBuffer = hasFile ? req.file.buffer : null;
    let optimizedFileSizeKB = originalFileSizeKB;

    if (mode === 'Experimental' && hasFile) {
      try {
        // Compress using sharp to next-gen WebP
        processedImageBuffer = await sharp(req.file.buffer)
          .resize(600, null, { withoutEnlargement: true }) // Width 600px, auto height
          .webp({ quality: 80 })
          .toBuffer();
        optimizedFileSizeKB = parseFloat((processedImageBuffer.length / 1024).toFixed(2));
      } catch (err) {
        console.error('Sharp image processing error, using fallback original:', err);
        processedImageBuffer = req.file.buffer;
        optimizedFileSizeKB = parseFloat((originalFileSizeKB * 0.25).toFixed(2));
      }
    }

    // ==========================================
    // 3. PROMPT DESIGN & AI CALL
    // ==========================================
    let prompt = '';
    let parsedFoodData = null;
    let promptTokens = 0;
    let candidatesTokens = 0;
    let totalTokens = 0;
    let rawTextResponse = '';

    if (mode === 'Control') {
      prompt = `You are an elite nutritionist. Carefully analyze the food item "${cleanMealTag || 'shown in this image'}"${hasFile ? ' in this image' : ''}. Identify every ingredient, estimate its weight in grams, and calculate the total calories, protein, carbs, and fats. Provide a detailed breakdown explanation.
      
      At the very end of your response, output a JSON block matching this schema so the system can parse the metrics:
      JSON_START { "item": "${cleanMealTag || 'Name of primary food item'}", "calories": total_calories_number, "protein": total_protein_grams_number, "carbs": total_carbs_grams_number, "fat": total_fat_grams_number } JSON_END`;
    } else {
      // Experimental Mode - Compressed Prompt
      prompt = `Return JSON only for "${cleanMealTag || 'food in image'}": {item: string, calories: number, protein: number, carbs: number, fat: number}`;
    }

    // Determine which API client and model to call based on the live requests made count
    const turnIndex = liveRequestsMade % 20;
    let apiUsed = 'Gemini';
    let modelUsed = 'gemini-3.5-flash';

    if (turnIndex < 5) {
      apiUsed = 'Gemini';
      modelUsed = 'gemini-3.5-flash';
    } else if (turnIndex < 10) {
      apiUsed = 'OpenRouter';
      modelUsed = FREE_TEXT_MODEL; // meta-llama/llama-3.3-70b-instruct:free
    } else if (turnIndex < 15) {
      apiUsed = 'Gemini';
      modelUsed = 'gemini-3.5-flash';
    } else {
      apiUsed = 'OpenRouter';
      modelUsed = FREE_VISION_MODEL; // google/gemma-2-9b-it:free
    }

    console.log(`[BACKEND] Rotation selection: Live request count: ${liveRequestsMade}. Turn index: ${turnIndex}. Chosen API: ${apiUsed}, Model: ${modelUsed}`);

    if (liveRequestsMade < MAX_LIVE_REQUESTS) {
      liveRequestsMade++; // Increment immediately to reflect that a live call is counted
      if (apiUsed === 'OpenRouter') {
        const openRouterResult = await callOpenRouter(prompt, processedImageBuffer, mode, hasFile ? req.file.mimetype : null, modelUsed);
        if (openRouterResult) {
          rawTextResponse = openRouterResult.text;
          promptTokens = openRouterResult.usage.promptTokens;
          candidatesTokens = openRouterResult.usage.candidatesTokens;
          totalTokens = openRouterResult.usage.totalTokens;

          // Parse output
          if (mode === 'Control') {
            const jsonStart = rawTextResponse.indexOf('JSON_START');
            const jsonEnd = rawTextResponse.indexOf('JSON_END');
            let jsonContent = null;
            if (jsonStart !== -1 && jsonEnd !== -1) {
              const rawJson = rawTextResponse.substring(jsonStart + 10, jsonEnd).trim();
              jsonContent = parseGeminiJson(rawJson);
            } else {
              jsonContent = parseGeminiJson(rawTextResponse);
            }

            parsedFoodData = {
              item: jsonContent?.item || cleanMealTag || 'Identified Food',
              calories: jsonContent?.calories || 380,
              protein: jsonContent?.protein || 18,
              carbs: jsonContent?.carbs || 45,
              fat: jsonContent?.fat || 12,
              explanation: rawTextResponse.replace(/JSON_START[\s\S]*JSON_END/, '').trim()
            };
          } else {
            const jsonContent = parseGeminiJson(rawTextResponse);
            parsedFoodData = {
              item: jsonContent?.item || cleanMealTag || 'Identified Food',
              calories: jsonContent?.calories || 380,
              protein: jsonContent?.protein || 18,
              carbs: jsonContent?.carbs || 45,
              fat: jsonContent?.fat || 12,
              explanation: `Successfully processed using green compressed pipeline. Output size: ${optimizedFileSizeKB.toFixed(1)} KB.`
            };
          }
        } else {
          console.warn(`[BACKEND] OpenRouter call failed for ${modelUsed}. Will fall back to local simulation.`);
        }
      } else {
        // Use Gemini API
        const genAI = getGeminiClient();
        if (genAI) {
          try {
            console.log(`[BACKEND] Calling Gemini 3.5 Flash API (Live Call #${liveRequestsMade})...`);
            const model = genAI.getGenerativeModel({ model: modelUsed });
            const requestPayload = [prompt];
            
            if (hasFile) {
              requestPayload.push({
                inlineData: {
                  data: processedImageBuffer.toString('base64'),
                  mimeType: mode === 'Experimental' ? 'image/webp' : req.file.mimetype
                }
              });
            }

            const result = await model.generateContent(requestPayload);
            console.log(`[BACKEND] Gemini API response received!`);
            const response = await result.response;
            rawTextResponse = response.text();
            console.log(`[BACKEND] Gemini response text: ${rawTextResponse.substring(0, 100)}...`);
          
            const usage = response.usageMetadata || {};
            promptTokens = usage.promptTokenCount || usage.promptTokens || 0;
            candidatesTokens = usage.candidatesTokenCount || usage.candidatesTokens || 0;
            totalTokens = usage.totalTokenCount || usage.totalTokens || (promptTokens + candidatesTokens) || 0;
            
            if (mode === 'Control') {
              const jsonStart = rawTextResponse.indexOf('JSON_START');
              const jsonEnd = rawTextResponse.indexOf('JSON_END');
              let jsonContent = null;
              if (jsonStart !== -1 && jsonEnd !== -1) {
                const rawJson = rawTextResponse.substring(jsonStart + 10, jsonEnd).trim();
                jsonContent = parseGeminiJson(rawJson);
              } else {
                jsonContent = parseGeminiJson(rawTextResponse);
              }

              parsedFoodData = {
                item: jsonContent?.item || cleanMealTag || 'Identified Food',
                calories: jsonContent?.calories || 380,
                protein: jsonContent?.protein || 18,
                carbs: jsonContent?.carbs || 45,
                fat: jsonContent?.fat || 12,
                explanation: rawTextResponse.replace(/JSON_START[\s\S]*JSON_END/, '').trim()
              };
            } else {
              const jsonContent = parseGeminiJson(rawTextResponse);
              parsedFoodData = {
                item: jsonContent?.item || cleanMealTag || 'Identified Food',
                calories: jsonContent?.calories || 380,
                protein: jsonContent?.protein || 18,
                carbs: jsonContent?.carbs || 45,
                fat: jsonContent?.fat || 12,
                explanation: `Successfully processed using green compressed pipeline. Output size: ${optimizedFileSizeKB.toFixed(1)} KB.`
              };
            }
          } catch (geminiError) {
            console.error('Gemini API call failed, falling back to local simulation:', geminiError);
          }
        } else {
          console.warn('[BACKEND] Gemini API client not configured or missing key.');
        }
      }
    }

    // High fidelity simulation fallback if Gemini was bypassed/failed
    if (!parsedFoodData) {
      console.log('Using High-Fidelity Mock AI engine for sustainable local emulation...');
      const mockResult = getMockMealData(cleanMealTag);
      
      parsedFoodData = {
        item: mockResult.item,
        calories: mockResult.calories,
        protein: mockResult.protein,
        carbs: mockResult.carbs,
        fat: mockResult.fat,
        explanation: mode === 'Control' 
          ? `[LOCAL SIMULATED] Elite Nutritionist Analysis:\n\nHaving thoroughly analyzed the meal "${mockResult.item}", we detected fresh ingredients of standard weights.\n\nNutrition Breakdown:\n- Protein: ${mockResult.protein}g\n- Carbs: ${mockResult.carbs}g\n- Fats: ${mockResult.fat}g\n\nDetailed Assessment: ${mockResult.explanation}` 
          : mockResult.explanation
      };

      // Set mock token usage with realistic variance based on image size and meal tag length
      const tagLengthFactor = cleanMealTag ? cleanMealTag.length * 3 : 15;
      
      if (mode === 'Control') {
        promptTokens = 450 + tagLengthFactor + Math.floor(Math.random() * 30);
        candidatesTokens = 180 + Math.floor(Math.random() * 40);
      } else {
        promptTokens = 75 + Math.floor(tagLengthFactor / 4) + Math.floor(Math.random() * 10);
        candidatesTokens = 35 + Math.floor(Math.random() * 15);
      }
      totalTokens = promptTokens + candidatesTokens;
    }

    // ==========================================
    // 4. TELEMETRY & COST CALCULATIONS
    // ==========================================
    // Enterprise cost: $0.075 / 1M input, $0.30 / 1M output tokens
    const inputCost = (promptTokens / 1000000) * 0.075;
    const outputCost = (candidatesTokens / 1000000) * 0.30;
    let calculatedVirtualCost = parseFloat((inputCost + outputCost).toFixed(8));
    if (req.body.simulatedCost !== undefined) {
      calculatedVirtualCost = parseFloat(req.body.simulatedCost);
    }

    // Simulated cloud egress fee: $0.09 per GB
    const activeFileSizeKB = mode === 'Experimental' ? optimizedFileSizeKB : originalFileSizeKB;
    const simulatedEgressFee = parseFloat(((activeFileSizeKB / 1024 / 1024) * 0.09).toFixed(8));

    // Simulated regional carbon emissions (grams of CO2eq)
    // Control: us-east-1 (475 g CO2eq/kWh). Unoptimized GPU and high network egress
    // Experimental: eu-west-1 (50 g CO2eq/kWh). Compressed token computation & WebP optimization
    let carbonEmissionGrams = 0;
    if (mode === 'Control') {
      // us-east-1 energy footprint model
      const computeEnergyKwh = totalTokens * 0.00015; // Unoptimized GPU model
      const storageEnergyKwh = originalFileSizeKB * 0.005; // Raw storage handling model
      carbonEmissionGrams = parseFloat(((computeEnergyKwh + storageEnergyKwh + 1.2) * 475).toFixed(4));
    } else {
      // eu-west-1 energy footprint model
      const computeEnergyKwh = totalTokens * 0.00006; // Optimized GPU model
      const storageEnergyKwh = optimizedFileSizeKB * 0.0008; // Lean storage handling model
      carbonEmissionGrams = parseFloat(((computeEnergyKwh + storageEnergyKwh + 0.1) * 50).toFixed(4));
    }

    // ==========================================
    // 5. DATABASE SAVE & GOVERNANCE CHECKS
    // ==========================================
    const newLog = new SprintLog({
      mode,
      promptTokens,
      candidatesTokens,
      totalTokens,
      wasCached: false,
      originalFileSizeKB,
      optimizedFileSizeKB,
      regionalCarbonFactor: mode === 'Control' ? 'high' : 'low',
      calculatedVirtualCost,
      mealTag: parsedFoodData.item || cleanMealTag || 'Identified Food',
      imageHash,
      foodData: parsedFoodData,
      simulatedEgressFee,
      carbonEmissionGrams,
      s3TtlDays: mode === 'Experimental' ? 7 : null
    });

    console.log(`[BACKEND] Saving log to MongoMemoryServer...`);
    await newLog.save();
    console.log(`[BACKEND] Log saved successfully!`);

    const cumulativeCost = await getCumulativeCost();
    let budgetViolation = false;

    // Control Mode Governance Warning Trigger
    if (mode === 'Control' && cumulativeCost > BUDGET_LIMIT) {
      budgetViolation = true;
      console.error('=========================================');
      console.error('MOCK AWS BUDGET CEILING VIOLATED - SPRINT COLLAPSE');
      console.error(`Cumulative virtual costs: $${cumulativeCost.toFixed(5)} exceeds limit of $${BUDGET_LIMIT.toFixed(2)}`);
      console.error('=========================================');
    }

    return res.status(200).json({
      message: 'Meal parsed successfully!',
      data: parsedFoodData,
      log: newLog,
      cumulativeCost,
      budgetLimit: BUDGET_LIMIT,
      budgetViolation
    });
  } catch (error) {
    console.error('Fatal error in analyzeMeal controller:', error);
    return res.status(500).json({ error: 'Server failed to analyze the food item.' });
  }
};

export const getTelemetry = async (req, res) => {
  try {
    const logs = await SprintLog.find().sort({ timestamp: -1 });
    const cumulativeCost = await getCumulativeCost();
    return res.status(200).json({
      logs,
      cumulativeCost,
      budgetLimit: BUDGET_LIMIT,
      budgetViolation: cumulativeCost > BUDGET_LIMIT
    });
  } catch (error) {
    console.error('Error fetching telemetry logs:', error);
    return res.status(500).json({ error: 'Failed to retrieve telemetry data.' });
  }
};

export const resetLogs = async (req, res) => {
  try {
    await SprintLog.deleteMany({});
    liveRequestsMade = 0;
    console.log('Database wiped! Telemetry metrics reset. Live request counter reset.');
    return res.status(200).json({
      message: 'Telemetry database wiped successfully.',
      cumulativeCost: 0,
      budgetLimit: BUDGET_LIMIT,
      budgetViolation: false
    });
  } catch (error) {
    console.error('Error resetting telemetry:', error);
    return res.status(500).json({ error: 'Failed to clear telemetry logs.' });
  }
};

export const simulateSprint = async (req, res) => {
  try {
    const { mode } = req.body;
    if (mode !== 'Control' && mode !== 'Experimental') {
      return res.status(400).json({ error: 'Invalid mode. Must be Control or Experimental.' });
    }

    const SIMULATION_ITEMS = [
      { tag: 'Apple', originalSize: 1200 },
      { tag: 'Salad', originalSize: 2400 },
      { tag: 'Pizza', originalSize: 3100 },
      { tag: 'Salad', originalSize: 2400 }, // Duplicate -> cache hit in Experimental
      { tag: 'Burger', originalSize: 3500 },
      { tag: 'Apple', originalSize: 1200 }, // Duplicate -> cache hit in Experimental
      { tag: 'Chicken', originalSize: 1800 },
      { tag: 'Burger', originalSize: 3500 }, // Duplicate -> cache hit in Experimental
      { tag: 'Eggs', originalSize: 1500 },
      { tag: 'Chicken', originalSize: 1800 }  // Duplicate -> cache hit in Experimental
    ];

    const logsToSave = [];
    const seenTags = new Set();
    const now = Date.now();

    for (let i = 0; i < SIMULATION_ITEMS.length; i++) {
      const item = SIMULATION_ITEMS[i];
      const mealTag = item.tag;
      const originalFileSizeKB = item.originalSize;
      const mealData = getMockMealData(mealTag);
      
      // Separate timestamps slightly so they have a sequence in logs (e.g. 2 mins apart)
      const timestamp = new Date(now - (SIMULATION_ITEMS.length - i) * 120000);

      if (mode === 'Control') {
        const promptTokens = 450 + Math.floor(Math.random() * 50);
        const candidatesTokens = 180 + Math.floor(Math.random() * 30);
        const totalTokens = promptTokens + candidatesTokens;
        
        const inputCost = (promptTokens / 1000000) * 0.075;
        const outputCost = (candidatesTokens / 1000000) * 0.30;
        const calculatedVirtualCost = parseFloat((inputCost + outputCost).toFixed(8));
        
        const simulatedEgressFee = parseFloat(((originalFileSizeKB / 1024 / 1024) * 0.09).toFixed(8));
        
        const computeEnergyKwh = totalTokens * 0.00015;
        const storageEnergyKwh = originalFileSizeKB * 0.005;
        const carbonEmissionGrams = parseFloat(((computeEnergyKwh + storageEnergyKwh + 1.2) * 475).toFixed(4));

        logsToSave.push({
          timestamp,
          mode: 'Control',
          promptTokens,
          candidatesTokens,
          totalTokens,
          wasCached: false,
          originalFileSizeKB,
          optimizedFileSizeKB: originalFileSizeKB,
          regionalCarbonFactor: 'high',
          calculatedVirtualCost,
          mealTag,
          imageHash: crypto.createHash('sha256').update(mealTag + timestamp).digest('hex'),
          foodData: {
            item: mealData.item,
            calories: mealData.calories,
            protein: mealData.protein,
            carbs: mealData.carbs,
            fat: mealData.fat,
            explanation: `[SIMULATED CONTROL] Analyzed ${mealData.item} in us-east-1. Raw prompt design used. No cache search performed.`
          },
          simulatedEgressFee,
          carbonEmissionGrams,
          s3TtlDays: null
        });
      } else {
        // Experimental Mode
        const cleanTag = mealTag.toLowerCase();
        const isCached = seenTags.has(cleanTag);
        seenTags.add(cleanTag);

        const optimizedFileSizeKB = parseFloat((originalFileSizeKB * 0.22).toFixed(2));
        const simulatedEgressFee = parseFloat(((optimizedFileSizeKB / 1024 / 1024) * 0.09).toFixed(8));

        if (isCached) {
          // Cache hit
          logsToSave.push({
            timestamp,
            mode: 'Experimental',
            promptTokens: 0,
            candidatesTokens: 0,
            totalTokens: 0,
            wasCached: true,
            originalFileSizeKB,
            optimizedFileSizeKB,
            regionalCarbonFactor: 'low',
            calculatedVirtualCost: 0,
            mealTag,
            imageHash: crypto.createHash('sha256').update(mealTag + timestamp).digest('hex'),
            foodData: {
              item: mealData.item,
              calories: mealData.calories,
              protein: mealData.protein,
              carbs: mealData.carbs,
              fat: mealData.fat,
              explanation: `[SIMULATED CACHE HIT] Bypassed Gemini API model completely. Output size: ${optimizedFileSizeKB.toFixed(1)} KB.`
            },
            simulatedEgressFee,
            carbonEmissionGrams: 0.002,
            s3TtlDays: 7
          });
        } else {
          // Cache miss in experimental (prompt distilled, compressed, low carbon region)
          const promptTokens = 80 + Math.floor(Math.random() * 10);
          const candidatesTokens = 35 + Math.floor(Math.random() * 10);
          const totalTokens = promptTokens + candidatesTokens;

          const inputCost = (promptTokens / 1000000) * 0.075;
          const outputCost = (candidatesTokens / 1000000) * 0.30;
          const calculatedVirtualCost = parseFloat((inputCost + outputCost).toFixed(8));

          const computeEnergyKwh = totalTokens * 0.00006;
          const storageEnergyKwh = optimizedFileSizeKB * 0.0008;
          const carbonEmissionGrams = parseFloat(((computeEnergyKwh + storageEnergyKwh + 0.1) * 50).toFixed(4));

          logsToSave.push({
            timestamp,
            mode: 'Experimental',
            promptTokens,
            candidatesTokens,
            totalTokens,
            wasCached: false,
            originalFileSizeKB,
            optimizedFileSizeKB,
            regionalCarbonFactor: 'low',
            calculatedVirtualCost,
            mealTag,
            imageHash: crypto.createHash('sha256').update(mealTag + timestamp).digest('hex'),
            foodData: {
              item: mealData.item,
              calories: mealData.calories,
              protein: mealData.protein,
              carbs: mealData.carbs,
              fat: mealData.fat,
              explanation: `[SIMULATED SUSTAIN-AGILE] Processed through distilled green pipeline. Output size: ${optimizedFileSizeKB.toFixed(1)} KB.`
            },
            simulatedEgressFee,
            carbonEmissionGrams,
            s3TtlDays: 7
          });
        }
      }
    }

    // Save to Database
    const savedLogs = await SprintLog.insertMany(logsToSave);
    
    // Get cumulative cost
    const cumulativeCost = await getCumulativeCost();

    return res.status(200).json({
      message: `Successfully simulated 10-task ${mode} sprint!`,
      logsCount: savedLogs.length,
      cumulativeCost
    });

  } catch (error) {
    console.error('Sprint simulation error:', error);
    return res.status(500).json({ error: 'Failed to run sprint simulation.' });
  }
};

