import React, { useState, useEffect, useRef } from 'react';
import './App.css';

const API_BASE = 'http://localhost:5000/api';

export default function App() {
  const [mode, setMode] = useState('Control'); // 'Control' | 'Experimental'
  const [mealTag, setMealTag] = useState('');
  const [imageFile, setImageFile] = useState(null);
  const [previewUrl, setPreviewUrl] = useState(null);
  
  // App state
  const [isLoading, setIsLoading] = useState(false);
  const [activeResult, setActiveResult] = useState(null);
  const [logs, setLogs] = useState([]);
  const [cumulativeCost, setCumulativeCost] = useState(0);
  const [budgetLimit, setBudgetLimit] = useState(0.50);
  const [budgetViolation, setBudgetViolation] = useState(false);

  // Research Simulation & Analytics state
  const [activeTab, setActiveTab] = useState('single'); // 'single' | 'simulation'
  const [isSimulating, setIsSimulating] = useState(false);
  const [hoveredPoint, setHoveredPoint] = useState(null);
  
  // Feedback
  const [errorMsg, setErrorMsg] = useState('');
  const [successMsg, setSuccessMsg] = useState('');
  
  const fileInputRef = useRef(null);

  useEffect(() => {
    fetchTelemetry();
  }, []);

  const fetchTelemetry = async () => {
    try {
      const res = await fetch(`${API_BASE}/telemetry`);
      if (!res.ok) throw new Error('Failed to fetch telemetry');
      const data = await res.json();
      setLogs(data.logs || []);
      setCumulativeCost(data.cumulativeCost || 0);
      setBudgetLimit(data.budgetLimit || 0.50);
      setBudgetViolation(data.budgetViolation || false);
    } catch (err) {
      console.error('Error fetching telemetry:', err);
    }
  };

  const handleFileChange = (e) => {
    const file = e.target.files[0];
    if (file) {
      setImageFile(file);
      setPreviewUrl(URL.createObjectURL(file));
      setErrorMsg('');
    }
  };

  const removeImage = (e) => {
    e.stopPropagation();
    setImageFile(null);
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleDragOver = (e) => {
    e.preventDefault();
  };

  const handleDrop = (e) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file && file.type.startsWith('image/')) {
      setImageFile(file);
      setPreviewUrl(URL.createObjectURL(file));
      setErrorMsg('');
    }
  };

  const triggerFileInput = () => {
    if (fileInputRef.current) {
      fileInputRef.current.click();
    }
  };

  const handleReset = async () => {
    if (!window.confirm('Are you sure you want to clear the entire database? This resets all research telemetry.')) {
      return;
    }
    try {
      setIsLoading(true);
      const res = await fetch(`${API_BASE}/reset`, { method: 'POST' });
      const data = await res.json();
      if (res.ok) {
        setLogs([]);
        setCumulativeCost(0);
        setBudgetViolation(false);
        setActiveResult(null);
        setImageFile(null);
        setPreviewUrl(null);
        setMealTag('');
        if (fileInputRef.current) fileInputRef.current.value = '';
        setSuccessMsg('Telemetry database successfully wiped!');
        setTimeout(() => setSuccessMsg(''), 4000);
      } else {
        throw new Error(data.error || 'Reset failed');
      }
    } catch (err) {
      setErrorMsg(err.message);
      setTimeout(() => setErrorMsg(''), 5000);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!imageFile && !mealTag.trim()) {
      setErrorMsg('Error: Please upload a meal image OR type a meal tag.');
      return;
    }

    setIsLoading(true);
    setErrorMsg('');
    setSuccessMsg('');

    try {
      const formData = new FormData();
      formData.append('mode', mode);
      formData.append('mealTag', mealTag);
      if (imageFile) {
        formData.append('image', imageFile);
      }

      const response = await fetch(`${API_BASE}/analyze-meal`, {
        method: 'POST',
        body: formData
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || 'Server error occurred during analysis');
      }

      setActiveResult({
        meal: result.data.item,
        calories: result.data.calories,
        protein: result.data.protein,
        carbs: result.data.carbs,
        fat: result.data.fat,
        explanation: result.data.explanation,
        wasCached: result.log.wasCached,
        mode: result.log.mode
      });

      // Update telemetry database states
      setCumulativeCost(result.cumulativeCost);
      setBudgetViolation(result.budgetViolation);
      
      // Refresh database records
      await fetchTelemetry();
      
      setSuccessMsg(result.log.wasCached ? 'Instant cache hit bypass loaded!' : 'Analysis completed successfully!');
      setTimeout(() => setSuccessMsg(''), 4000);

    } catch (err) {
      console.error(err);
      setErrorMsg(err.message);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSimulateSprint = async (sprintMode) => {
    setIsSimulating(true);
    setIsLoading(true);
    setErrorMsg('');
    setSuccessMsg('');

    try {
      const res = await fetch(`${API_BASE}/simulate-sprint`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: sprintMode })
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to simulate sprint');
      }

      setCumulativeCost(data.cumulativeCost);
      await fetchTelemetry();
      setSuccessMsg(`Sprint simulation completed! Successfully added ${data.logsCount} transactions.`);
      setTimeout(() => setSuccessMsg(''), 4000);
    } catch (err) {
      console.error(err);
      setErrorMsg(err.message);
    } finally {
      setIsSimulating(false);
      setIsLoading(false);
    }
  };

  // ==========================================
  // METRICS CALCULATIONS (REAL-TIME TELEMETRY)
  // ==========================================
  const totalTokens = logs.reduce((sum, log) => sum + (log.totalTokens || 0), 0);
  
  // S3 storage savings: Sum of (originalFileSizeKB - optimizedFileSizeKB) where mode is Experimental
  const rawStorageTotal = logs.reduce((sum, log) => sum + (log.originalFileSizeKB || 0), 0);
  const optStorageTotal = logs.reduce((sum, log) => {
    return sum + (log.mode === 'Experimental' ? (log.optimizedFileSizeKB || 0) : (log.originalFileSizeKB || 0));
  }, 0);
  const storageSavedKB = rawStorageTotal - optStorageTotal;

  // Cache hits and rate
  const cacheHits = logs.filter(log => log.wasCached).length;
  const cacheHitRate = logs.length > 0 ? ((cacheHits / logs.length) * 100).toFixed(1) : '0.0';

  // Carbon Reductions
  // 1. Control Scenario (If every request was handled using the standard Scrum unoptimized cloud flow)
  const controlScenarioCarbonGrams = logs.reduce((sum, log) => {
    // Standard us-east-1 energy footprint model for comparison
    const tokens = log.wasCached ? 125 : (log.totalTokens || 200); // assume standard tokens for comparisons
    const size = log.originalFileSizeKB || 0;
    const simulatedControlCarbon = ((tokens * 0.00015 + size * 0.005 + 1.2) * 475);
    return sum + simulatedControlCarbon;
  }, 0);

  // 2. Actual Scenario
  const actualCarbonGrams = logs.reduce((sum, log) => sum + (log.carbonEmissionGrams || 0), 0);

  // 3. Reduction
  const carbonSavedGrams = controlScenarioCarbonGrams > actualCarbonGrams 
    ? (controlScenarioCarbonGrams - actualCarbonGrams) 
    : 0;

  const carbonReductionPercent = controlScenarioCarbonGrams > 0 
    ? ((carbonSavedGrams / controlScenarioCarbonGrams) * 100).toFixed(1) 
    : '0.0';

  // Budget remaining percentage
  const budgetSpentPercent = Math.min((cumulativeCost / budgetLimit) * 100, 100);
  const isBudgetDanger = cumulativeCost >= budgetLimit;
  const isBudgetWarning = cumulativeCost >= budgetLimit * 0.7 && !isBudgetDanger;

  // ==========================================
  // RESEARCH PAPER METRICS & GRAPH CALCULATIONS
  // ==========================================
  // Group logs by mode
  const controlLogs = logs.filter(log => log.mode === 'Control');
  const expLogs = logs.filter(log => log.mode === 'Experimental');

  // Control Vs Calculation: Vs = Σ(SPi * μi) / [CAWS + (Ttokens * ω)]
  // We scale Vs by 100 to make it readable.
  // SPi = 5. μi = 1.0 for Control. CAWS = calculatedVirtualCost + simulatedEgressFee. Ttokens_k = totalTokens / 1000. ω = 475.
  const totalSP_Control = controlLogs.length * 5;
  const totalCAWS_Control = controlLogs.reduce((sum, log) => sum + (log.calculatedVirtualCost || 0) + (log.simulatedEgressFee || 0), 0);
  const totalTokens_Control = controlLogs.reduce((sum, log) => sum + (log.totalTokens || 0), 0);
  const ttokensK_Control = totalTokens_Control / 1000;
  const ω_Control = 475;
  const denominator_Control = totalCAWS_Control + (ttokensK_Control * ω_Control);
  const vs_Control = denominator_Control > 0 ? (totalSP_Control / denominator_Control) * 100 : 0;

  // Experimental Vs Calculation:
  // SPi = 5. μi = log.wasCached ? 1.5 : 1.0. CAWS = cost + egress. Ttokens_k = totalTokens / 1000. ω = 50.
  const totalSP_Exp = expLogs.reduce((sum, log) => sum + (5 * (log.wasCached ? 1.5 : 1.0)), 0);
  const totalCAWS_Exp = expLogs.reduce((sum, log) => sum + (log.calculatedVirtualCost || 0) + (log.simulatedEgressFee || 0), 0);
  const totalTokens_Exp = expLogs.reduce((sum, log) => sum + (log.totalTokens || 0), 0);
  const ttokensK_Exp = totalTokens_Exp / 1000;
  const ω_Exp = 50;
  const denominator_Exp = totalCAWS_Exp + (ttokensK_Exp * ω_Exp);
  const vs_Exp = denominator_Exp > 0 ? (totalSP_Exp / denominator_Exp) * 100 : 0;

  // Running costs for line chart
  const controlCosts = [];
  let sumCostControl = 0;
  [...controlLogs].reverse().forEach(log => {
    sumCostControl += (log.calculatedVirtualCost || 0) + (log.simulatedEgressFee || 0);
    controlCosts.push(sumCostControl);
  });

  const expCosts = [];
  let sumCostExp = 0;
  [...expLogs].reverse().forEach(log => {
    sumCostExp += (log.calculatedVirtualCost || 0) + (log.simulatedEgressFee || 0);
    expCosts.push(sumCostExp);
  });

  // Carbon emissions totals
  const controlCarbonTotal = controlLogs.reduce((sum, log) => sum + (log.carbonEmissionGrams || 0), 0);
  const expCarbonTotal = expLogs.reduce((sum, log) => sum + (log.carbonEmissionGrams || 0), 0);

  // Tokens breakdown
  const controlPromptTokens = controlLogs.reduce((sum, log) => sum + (log.promptTokens || 0), 0);
  const controlCandidateTokens = controlLogs.reduce((sum, log) => sum + (log.candidatesTokens || 0), 0);
  const expPromptTokens = expLogs.reduce((sum, log) => sum + (log.promptTokens || 0), 0);
  const expCandidateTokens = expLogs.reduce((sum, log) => sum + (log.candidatesTokens || 0), 0);

  // Custom SVG Chart rendering helpers
  const renderVelocityChart = () => {
    const width = 360;
    const height = 200;
    const paddingLeft = 50;
    const paddingRight = 20;
    const paddingTop = 20;
    const paddingBottom = 30;
    const plotWidth = width - paddingLeft - paddingRight;
    const plotHeight = height - paddingTop - paddingBottom;

    const maxVal = Math.max(vs_Control, vs_Exp, 10) * 1.15;
    const controlHeight = (vs_Control / maxVal) * plotHeight;
    const expHeight = (vs_Exp / maxVal) * plotHeight;

    return (
      <svg width="100%" height="100%" viewBox={`0 0 ${width} ${height}`} className="svg-chart">
        {[0, 0.25, 0.5, 0.75, 1].map((r, idx) => {
          const y = paddingTop + plotHeight - (r * plotHeight);
          const val = (r * maxVal).toFixed(1);
          return (
            <g key={idx}>
              <line x1={paddingLeft} y1={y} x2={width - paddingRight} y2={y} stroke="rgba(255,255,255,0.07)" strokeDasharray="3,3" />
              <text x={paddingLeft - 10} y={y + 4} fill="hsl(var(--text-muted))" fontSize="10" textAnchor="end" fontFamily="monospace">
                {val}
              </text>
            </g>
          );
        })}
        <line x1={paddingLeft} y1={paddingTop + plotHeight} x2={width - paddingRight} y2={paddingTop + plotHeight} stroke="rgba(255,255,255,0.2)" />
        <line x1={paddingLeft} y1={paddingTop} x2={paddingLeft} y2={paddingTop + plotHeight} stroke="rgba(255,255,255,0.2)" />

        <rect
          x={paddingLeft + plotWidth * 0.15}
          y={paddingTop + plotHeight - controlHeight}
          width={plotWidth * 0.25}
          height={controlHeight}
          fill="url(#controlGrad)"
          rx="4"
          className="chart-bar"
          style={{ transition: 'all 0.5s ease', cursor: 'pointer' }}
          onMouseEnter={() => setHoveredPoint({ type: 'vs', mode: 'Control', value: vs_Control })}
          onMouseLeave={() => setHoveredPoint(null)}
        />
        <text x={paddingLeft + plotWidth * 0.275} y={paddingTop + plotHeight + 16} fill="hsl(var(--text-secondary))" fontSize="10" textAnchor="middle" fontWeight="600">
          Control
        </text>

        <rect
          x={paddingLeft + plotWidth * 0.6}
          y={paddingTop + plotHeight - expHeight}
          width={plotWidth * 0.25}
          height={expHeight}
          fill="url(#expGrad)"
          rx="4"
          className="chart-bar"
          style={{ transition: 'all 0.5s ease', cursor: 'pointer' }}
          onMouseEnter={() => setHoveredPoint({ type: 'vs', mode: 'Sustain-Agile', value: vs_Exp })}
          onMouseLeave={() => setHoveredPoint(null)}
        />
        <text x={paddingLeft + plotWidth * 0.725} y={paddingTop + plotHeight + 16} fill="hsl(var(--text-secondary))" fontSize="10" textAnchor="middle" fontWeight="600">
          Sustain-Agile
        </text>

        <defs>
          <linearGradient id="controlGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="hsl(var(--color-control))" stopOpacity="1" />
            <stop offset="100%" stopColor="hsl(var(--color-control))" stopOpacity="0.4" />
          </linearGradient>
          <linearGradient id="expGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="hsl(var(--color-experimental))" stopOpacity="1" />
            <stop offset="100%" stopColor="hsl(var(--color-experimental))" stopOpacity="0.4" />
          </linearGradient>
        </defs>
      </svg>
    );
  };

  const renderCostChart = () => {
    const width = 360;
    const height = 200;
    const paddingLeft = 50;
    const paddingRight = 20;
    const paddingTop = 20;
    const paddingBottom = 30;
    const plotWidth = width - paddingLeft - paddingRight;
    const plotHeight = height - paddingTop - paddingBottom;

    const maxVal = Math.max(
      controlCosts[controlCosts.length - 1] || 0,
      expCosts[expCosts.length - 1] || 0,
      0.01
    ) * 1.15;

    const maxIndex = Math.max(controlCosts.length, expCosts.length, 5);

    const getPointsPath = (costs) => {
      if (costs.length === 0) return '';
      return costs.map((cost, idx) => {
        const x = paddingLeft + (idx / (maxIndex - 1)) * plotWidth;
        const y = paddingTop + plotHeight - (cost / maxVal) * plotHeight;
        return `${idx === 0 ? 'M' : 'L'} ${x} ${y}`;
      }).join(' ');
    };

    const controlPath = getPointsPath(controlCosts);
    const expPath = getPointsPath(expCosts);

    return (
      <svg width="100%" height="100%" viewBox={`0 0 ${width} ${height}`} className="svg-chart">
        {[0, 0.25, 0.5, 0.75, 1].map((r, idx) => {
          const y = paddingTop + plotHeight - (r * plotHeight);
          const val = `$${(r * maxVal).toFixed(4)}`;
          return (
            <g key={idx}>
              <line x1={paddingLeft} y1={y} x2={width - paddingRight} y2={y} stroke="rgba(255,255,255,0.07)" strokeDasharray="3,3" />
              <text x={paddingLeft - 10} y={y + 4} fill="hsl(var(--text-muted))" fontSize="9" textAnchor="end" fontFamily="monospace">
                {val}
              </text>
            </g>
          );
        })}
        <line x1={paddingLeft} y1={paddingTop + plotHeight} x2={width - paddingRight} y2={paddingTop + plotHeight} stroke="rgba(255,255,255,0.2)" />
        <line x1={paddingLeft} y1={paddingTop} x2={paddingLeft} y2={paddingTop + plotHeight} stroke="rgba(255,255,255,0.2)" />

        {controlPath && (
          <path d={controlPath} fill="none" stroke="hsl(var(--color-control))" strokeWidth="2.5" style={{ transition: 'all 0.5s ease' }} />
        )}
        {controlCosts.map((cost, idx) => {
          const x = paddingLeft + (idx / (maxIndex - 1)) * plotWidth;
          const y = paddingTop + plotHeight - (cost / maxVal) * plotHeight;
          return (
            <circle
              key={`c-${idx}`}
              cx={x}
              cy={y}
              r="4"
              fill="hsl(var(--color-control))"
              stroke="#000"
              strokeWidth="1.5"
              style={{ cursor: 'pointer' }}
              onMouseEnter={() => setHoveredPoint({ type: 'cost', mode: 'Control', index: idx + 1, value: cost })}
              onMouseLeave={() => setHoveredPoint(null)}
            />
          );
        })}

        {expPath && (
          <path d={expPath} fill="none" stroke="hsl(var(--color-experimental))" strokeWidth="2.5" style={{ transition: 'all 0.5s ease' }} />
        )}
        {expCosts.map((cost, idx) => {
          const x = paddingLeft + (idx / (maxIndex - 1)) * plotWidth;
          const y = paddingTop + plotHeight - (cost / maxVal) * plotHeight;
          return (
            <circle
              key={`e-${idx}`}
              cx={x}
              cy={y}
              r="4"
              fill="hsl(var(--color-experimental))"
              stroke="#000"
              strokeWidth="1.5"
              style={{ cursor: 'pointer' }}
              onMouseEnter={() => setHoveredPoint({ type: 'cost', mode: 'Sustain-Agile', index: idx + 1, value: cost })}
              onMouseLeave={() => setHoveredPoint(null)}
            />
          );
        })}
        <text x={paddingLeft + plotWidth / 2} y={paddingTop + plotHeight + 18} fill="hsl(var(--text-muted))" fontSize="9" textAnchor="middle">
          Transactions Chronological Sequence
        </text>
      </svg>
    );
  };

  const renderCarbonChart = () => {
    const width = 360;
    const height = 200;
    const paddingLeft = 50;
    const paddingRight = 20;
    const paddingTop = 20;
    const paddingBottom = 30;
    const plotWidth = width - paddingLeft - paddingRight;
    const plotHeight = height - paddingTop - paddingBottom;

    const maxVal = Math.max(controlCarbonTotal, expCarbonTotal, 5) * 1.15;
    const controlHeight = (controlCarbonTotal / maxVal) * plotHeight;
    const expHeight = (expCarbonTotal / maxVal) * plotHeight;

    return (
      <svg width="100%" height="100%" viewBox={`0 0 ${width} ${height}`} className="svg-chart">
        {[0, 0.25, 0.5, 0.75, 1].map((r, idx) => {
          const y = paddingTop + plotHeight - (r * plotHeight);
          const val = `${(r * maxVal).toFixed(0)}g`;
          return (
            <g key={idx}>
              <line x1={paddingLeft} y1={y} x2={width - paddingRight} y2={y} stroke="rgba(255,255,255,0.07)" strokeDasharray="3,3" />
              <text x={paddingLeft - 10} y={y + 4} fill="hsl(var(--text-muted))" fontSize="10" textAnchor="end" fontFamily="monospace">
                {val}
              </text>
            </g>
          );
        })}
        <line x1={paddingLeft} y1={paddingTop + plotHeight} x2={width - paddingRight} y2={paddingTop + plotHeight} stroke="rgba(255,255,255,0.2)" />
        <line x1={paddingLeft} y1={paddingTop} x2={paddingLeft} y2={paddingTop + plotHeight} stroke="rgba(255,255,255,0.2)" />

        <rect
          x={paddingLeft + plotWidth * 0.15}
          y={paddingTop + plotHeight - controlHeight}
          width={plotWidth * 0.25}
          height={controlHeight}
          fill="url(#controlGrad)"
          rx="4"
          className="chart-bar"
          style={{ transition: 'all 0.5s ease', cursor: 'pointer' }}
          onMouseEnter={() => setHoveredPoint({ type: 'carbon', mode: 'Control', value: controlCarbonTotal })}
          onMouseLeave={() => setHoveredPoint(null)}
        />
        <text x={paddingLeft + plotWidth * 0.275} y={paddingTop + plotHeight + 16} fill="hsl(var(--text-secondary))" fontSize="10" textAnchor="middle" fontWeight="600">
          Control
        </text>

        <rect
          x={paddingLeft + plotWidth * 0.6}
          y={paddingTop + plotHeight - expHeight}
          width={plotWidth * 0.25}
          height={expHeight}
          fill="url(#expGrad)"
          rx="4"
          className="chart-bar"
          style={{ transition: 'all 0.5s ease', cursor: 'pointer' }}
          onMouseEnter={() => setHoveredPoint({ type: 'carbon', mode: 'Sustain-Agile', value: expCarbonTotal })}
          onMouseLeave={() => setHoveredPoint(null)}
        />
        <text x={paddingLeft + plotWidth * 0.725} y={paddingTop + plotHeight + 16} fill="hsl(var(--text-secondary))" fontSize="10" textAnchor="middle" fontWeight="600">
          Sustain-Agile
        </text>
      </svg>
    );
  };

  const renderTokenChart = () => {
    const width = 360;
    const height = 200;
    const paddingLeft = 50;
    const paddingRight = 20;
    const paddingTop = 20;
    const paddingBottom = 30;
    const plotWidth = width - paddingLeft - paddingRight;
    const plotHeight = height - paddingTop - paddingBottom;

    const controlTotal = controlPromptTokens + controlCandidateTokens;
    const expTotal = expPromptTokens + expCandidateTokens;

    const maxVal = Math.max(controlTotal, expTotal, 500) * 1.15;

    const controlPromptHeight = (controlPromptTokens / maxVal) * plotHeight;
    const controlCandHeight = (controlCandidateTokens / maxVal) * plotHeight;

    const expPromptHeight = (expPromptTokens / maxVal) * plotHeight;
    const expCandHeight = (expCandidateTokens / maxVal) * plotHeight;

    return (
      <svg width="100%" height="100%" viewBox={`0 0 ${width} ${height}`} className="svg-chart">
        {[0, 0.25, 0.5, 0.75, 1].map((r, idx) => {
          const y = paddingTop + plotHeight - (r * plotHeight);
          const val = (r * maxVal).toFixed(0);
          return (
            <g key={idx}>
              <line x1={paddingLeft} y1={y} x2={width - paddingRight} y2={y} stroke="rgba(255,255,255,0.07)" strokeDasharray="3,3" />
              <text x={paddingLeft - 10} y={y + 4} fill="hsl(var(--text-muted))" fontSize="9" textAnchor="end" fontFamily="monospace">
                {val}
              </text>
            </g>
          );
        })}
        <line x1={paddingLeft} y1={paddingTop + plotHeight} x2={width - paddingRight} y2={paddingTop + plotHeight} stroke="rgba(255,255,255,0.2)" />
        <line x1={paddingLeft} y1={paddingTop} x2={paddingLeft} y2={paddingTop + plotHeight} stroke="rgba(255,255,255,0.2)" />

        <rect
          x={paddingLeft + plotWidth * 0.15}
          y={paddingTop + plotHeight - controlPromptHeight}
          width={plotWidth * 0.25}
          height={controlPromptHeight}
          fill="url(#controlGrad)"
          rx="2"
          className="chart-bar"
          style={{ transition: 'all 0.5s ease', cursor: 'pointer' }}
          onMouseEnter={() => setHoveredPoint({ type: 'tokens', mode: 'Control', prompt: controlPromptTokens, candidates: controlCandidateTokens })}
          onMouseLeave={() => setHoveredPoint(null)}
        />
        {controlCandHeight > 0 && (
          <rect
            x={paddingLeft + plotWidth * 0.15}
            y={paddingTop + plotHeight - controlPromptHeight - controlCandHeight}
            width={plotWidth * 0.25}
            height={controlCandHeight}
            fill="hsl(var(--color-gold))"
            rx="2"
            className="chart-bar"
            style={{ transition: 'all 0.5s ease', cursor: 'pointer' }}
            onMouseEnter={() => setHoveredPoint({ type: 'tokens', mode: 'Control', prompt: controlPromptTokens, candidates: controlCandidateTokens })}
            onMouseLeave={() => setHoveredPoint(null)}
          />
        )}
        <text x={paddingLeft + plotWidth * 0.275} y={paddingTop + plotHeight + 16} fill="hsl(var(--text-secondary))" fontSize="10" textAnchor="middle" fontWeight="600">
          Control
        </text>

        <rect
          x={paddingLeft + plotWidth * 0.6}
          y={paddingTop + plotHeight - expPromptHeight}
          width={plotWidth * 0.25}
          height={expPromptHeight}
          fill="url(#expGrad)"
          rx="2"
          className="chart-bar"
          style={{ transition: 'all 0.5s ease', cursor: 'pointer' }}
          onMouseEnter={() => setHoveredPoint({ type: 'tokens', mode: 'Sustain-Agile', prompt: expPromptTokens, candidates: expCandidateTokens })}
          onMouseLeave={() => setHoveredPoint(null)}
        />
        {expCandHeight > 0 && (
          <rect
            x={paddingLeft + plotWidth * 0.6}
            y={paddingTop + plotHeight - expPromptHeight - expCandHeight}
            width={plotWidth * 0.25}
            height={expCandHeight}
            fill="hsl(var(--color-gold))"
            rx="2"
            className="chart-bar"
            style={{ transition: 'all 0.5s ease', cursor: 'pointer' }}
            onMouseEnter={() => setHoveredPoint({ type: 'tokens', mode: 'Sustain-Agile', prompt: expPromptTokens, candidates: expCandidateTokens })}
            onMouseLeave={() => setHoveredPoint(null)}
          />
        )}
        <text x={paddingLeft + plotWidth * 0.725} y={paddingTop + plotHeight + 16} fill="hsl(var(--text-secondary))" fontSize="10" textAnchor="middle" fontWeight="600">
          Sustain-Agile
        </text>
      </svg>
    );
  };

  return (
    <div className="app-container">
      {/* 1. Header Area */}
      <header className="app-header">
        <div className="brand-logo-glow" />
        <div className="brand-section">
          <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'hsl(var(--color-experimental))' }}>
            <path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
          </svg>
          <div>
            <h1 className="brand-title">Sustain-Agile Calorie Tracker</h1>
            <p className="brand-subtitle">Green Computing Cloud Experimentation Dashboard</p>
          </div>
        </div>

        <div className="header-actions">
          {/* Dual Toggle Selector */}
          <div className={`mode-toggle-container mode-${mode.toLowerCase()}`}>
            <div className="mode-toggle-active-bg" />
            <button 
              type="button" 
              className={`mode-toggle-btn ${mode === 'Control' ? 'active' : ''}`}
              onClick={() => setMode('Control')}
            >
              Control Mode
            </button>
            <button 
              type="button" 
              className={`mode-toggle-btn ${mode === 'Experimental' ? 'active' : ''}`}
              onClick={() => setMode('Experimental')}
            >
              Sustain-Agile
            </button>
          </div>

          {/* Reset Button */}
          <button type="button" className="reset-btn" onClick={handleReset} title="Wipe Telemetry Logs">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M10 11v6M14 11v6" />
            </svg>
            Reset
          </button>
        </div>
      </header>

      {/* 2. Budget Alert Banner & Budget Gate Visualizer */}
      {budgetViolation && (
        <div className="budget-violation-banner">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
            <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" />
            <line x1="12" y1="9" x2="12" y2="13" />
            <line x1="12" y1="17" x2="12.01" y2="17" />
          </svg>
          MOCK AWS BUDGET CEILING VIOLATED - SPRINT COLLAPSE
        </div>
      )}

      <div className="budget-bar-wrapper">
        <div className="budget-bar-header">
          <div className="budget-label">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'hsl(var(--color-gold))' }}>
              <rect x="2" y="5" width="20" height="14" rx="2" />
              <line x1="2" y1="10" x2="22" y2="10" />
            </svg>
            Simulated AWS Budget Merge-Gate
          </div>
          <div className="budget-limits">
            <span style={{ color: isBudgetDanger ? '#ef4444' : isBudgetWarning ? '#f59e0b' : '#10b981' }}>
              ${cumulativeCost.toFixed(5)}
            </span>
            <span style={{ color: 'hsl(var(--text-muted))' }}> / ${budgetLimit.toFixed(2)}</span>
          </div>
        </div>
        <div className="budget-bar-outer">
          <div 
            className={`budget-bar-inner ${isBudgetDanger ? 'danger' : isBudgetWarning ? 'warning' : 'safe'}`}
            style={{ width: `${budgetSpentPercent}%` }}
          />
        </div>
      </div>

      {/* 3. Feedback Tickers */}
      {errorMsg && (
        <div className="budget-violation-banner" style={{ background: '#7f1d1d', border: '1px solid #ef4444', animation: 'none' }}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="10" />
            <line x1="15" y1="9" x2="9" y2="15" />
            <line x1="9" y1="9" x2="15" y2="15" />
          </svg>
          {errorMsg}
        </div>
      )}
      {successMsg && (
        <div className="cache-hit-ticker" style={{ justifyContent: 'center', fontSize: '1rem', padding: '1rem' }}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
            <polyline points="22 4 12 14.01 9 11.01" />
          </svg>
          {successMsg}
        </div>
      )}

      {/* 4. Real-time Telemetry Dashboard Metrics Grid */}
      <section className="telemetry-grid">
        {/* Metric 1: Total Cumulative Tokens */}
        <div className="metric-card tokens">
          <div className="metric-header">
            <span>Cumulative Tokens</span>
            <span className="metric-icon">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#3b82f6" strokeWidth="2.5">
                <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
                <line x1="8" y1="21" x2="16" y2="21" />
                <line x1="12" y1="17" x2="12" y2="21" />
              </svg>
            </span>
          </div>
          <div className="metric-value" style={{ color: '#3b82f6' }}>{totalTokens.toLocaleString()}</div>
          <div className="metric-subtext">
            <span>Enterprise Consumption</span>
            <span style={{ fontFamily: 'monospace' }}>API Requests: {logs.filter(l => !l.wasCached).length}</span>
          </div>
        </div>

        {/* Metric 2: Virtual Operational Cost */}
        <div className="metric-card cost">
          <div className="metric-header">
            <span>Virtual Cost</span>
            <span className="metric-icon">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="hsl(var(--color-gold))" strokeWidth="2.5">
                <line x1="12" y1="1" x2="12" y2="23" />
                <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
              </svg>
            </span>
          </div>
          <div className="metric-value" style={{ color: 'hsl(var(--color-gold))' }}>${cumulativeCost.toFixed(5)}</div>
          <div className="metric-subtext">
            <span>AWS Budget Pool Used</span>
            <span style={{ color: isBudgetDanger ? '#ef4444' : 'hsl(var(--text-muted))' }}>
              {budgetSpentPercent.toFixed(1)}% Spent
            </span>
          </div>
        </div>

        {/* Metric 3: S3 Storage Saved */}
        <div className="metric-card storage">
          <div className="metric-header">
            <span>S3 Storage Saved</span>
            <span className="metric-icon">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#8b5cf6" strokeWidth="2.5">
                <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
                <polyline points="3.27 6.96 12 12.01 20.73 6.96" />
                <line x1="12" y1="22.08" x2="12" y2="12" />
              </svg>
            </span>
          </div>
          <div className="metric-value" style={{ color: '#8b5cf6' }}>
            {storageSavedKB >= 1024 
              ? `${(storageSavedKB / 1024).toFixed(2)} MB` 
              : `${storageSavedKB.toFixed(1)} KB`
            }
          </div>
          <div className="metric-subtext">
            <span>Via WebP optimization</span>
            <span className="metric-change-positive">
              {rawStorageTotal > 0 ? `-${((storageSavedKB / rawStorageTotal) * 100).toFixed(0)}%` : '0%'}
            </span>
          </div>
        </div>

        {/* Metric 4: Cache Hit Rate */}
        <div className="metric-card cache">
          <div className="metric-header">
            <span>Cache Hit Rate</span>
            <span className="metric-icon">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="hsl(var(--color-experimental))" strokeWidth="2.5">
                <path d="M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2 2 6.477 2 12s4.477 10 10 10z" />
                <path d="m9 12 2 2 4-4" />
              </svg>
            </span>
          </div>
          <div className="metric-value" style={{ color: 'hsl(var(--color-experimental))' }}>{cacheHitRate}%</div>
          <div className="metric-subtext">
            <span>API Bypass Count</span>
            <span style={{ color: 'hsl(var(--color-experimental))', fontWeight: 700 }}>
              {cacheHits} / {logs.length} Hits
            </span>
          </div>
        </div>

        {/* Metric 5: Carbon Footprint Saved */}
        <div className="metric-card carbon">
          <div className="metric-header">
            <span>Carbon Saved</span>
            <span className="metric-icon">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#06b6d4" strokeWidth="2.5">
                <path d="M11 20A7 7 0 0 1 9.8 6.1C15.5 5 17 4.48 19 2c1 2 2 3.5 2 5.5a7 7 0 0 1-7 7h-3" />
                <path d="M9.8 6.1C5 7.5 3.5 11 3.5 14.5A5.5 5.5 0 0 0 9 20" />
              </svg>
            </span>
          </div>
          <div className="metric-value" style={{ color: '#06b6d4' }}>
            {carbonSavedGrams >= 1000 
              ? `${(carbonSavedGrams / 1000).toFixed(2)} kg` 
              : `${carbonSavedGrams.toFixed(1)} g`
            }
          </div>
          <div className="metric-subtext">
            <span>Simulated Reductions</span>
            <span className="metric-change-positive">-{carbonReductionPercent}% CO₂e</span>
          </div>
        </div>

        {/* Metric 6: Sustainability Velocity */}
        <div className="metric-card velocity">
          <div className="metric-header">
            <span>Sustainability Velocity</span>
            <span className="metric-icon">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="hsl(var(--color-experimental))" strokeWidth="2.5">
                <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
              </svg>
            </span>
          </div>
          <div className="metric-value" style={{ color: 'hsl(var(--color-experimental))' }}>
            {mode === 'Control' ? vs_Control.toFixed(2) : vs_Exp.toFixed(2)}
          </div>
          <div className="metric-subtext">
            <span>Current Vs Score</span>
            <span className={vs_Exp > vs_Control ? "metric-change-positive" : ""}>
              {vs_Control > 0 && vs_Exp > 0 
                ? `x${(vs_Exp / vs_Control).toFixed(1)} vs Control` 
                : 'Vs = Σ(SP×μ) / [CAWS+(T×ω)]'}
            </span>
          </div>
        </div>
      </section>

      {/* 5. Main Split layout: Left (Form Panel) | Right (Interactive Telemetry Dashboard) */}
      <main className="main-layout">
        {/* Left Side: Analyzer & Simulation Control */}
        <section className={`form-panel mode-${mode.toLowerCase()}`}>
          <div className="panel-tabs">
            <button 
              type="button" 
              className={`panel-tab-btn ${activeTab === 'single' ? 'active' : ''}`}
              onClick={() => setActiveTab('single')}
            >
              Single Request
            </button>
            <button 
              type="button" 
              className={`panel-tab-btn ${activeTab === 'simulation' ? 'active' : ''}`}
              onClick={() => setActiveTab('simulation')}
            >
              Sprint Simulation
            </button>
          </div>
          
          {activeTab === 'single' ? (
            <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
              
              {/* Input tag */}
              <div className="input-group">
                <label className="input-label" htmlFor="meal-tag-input">Meal Tag (Text Name)</label>
                <input 
                  id="meal-tag-input"
                  type="text" 
                  className="text-input" 
                  placeholder="e.g. Avocado Salad, Pepperoni Pizza, Apple" 
                  value={mealTag}
                  onChange={(e) => setMealTag(e.target.value)}
                  disabled={isLoading}
                />
              </div>

              {/* File uploader */}
              <div className="input-group">
                <label className="input-label">Meal Image (Drag & Drop or Click)</label>
                <div 
                  className="uploader-area" 
                  onClick={triggerFileInput}
                  onDragOver={handleDragOver}
                  onDrop={handleDrop}
                >
                  <input 
                    type="file" 
                    ref={fileInputRef}
                    style={{ display: 'none' }} 
                    accept="image/*"
                    onChange={handleFileChange}
                    disabled={isLoading}
                  />
                  
                  {previewUrl ? (
                    <>
                      <img src={previewUrl} className="uploader-preview" alt="Meal Preview" />
                      <button type="button" className="remove-img-btn" onClick={removeImage} title="Remove image">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                          <line x1="18" y1="6" x2="6" y2="18" />
                          <line x1="6" y1="6" x2="18" y2="18" />
                        </svg>
                      </button>
                    </>
                  ) : (
                    <>
                      <div className="upload-icon">
                        <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12" />
                        </svg>
                      </div>
                      <p className="upload-text">Upload meal image</p>
                      <p className="upload-subtext">JPEG, PNG, WEBP up to 10MB</p>
                    </>
                  )}
                </div>
              </div>

              {/* Explain the selected framework strategy */}
              <div className="mode-descriptor">
                <strong>
                  {mode === 'Control' ? 'Control Mode (Standard Agile):' : 'Sustain-Agile Mode (Green Cloud):'}
                </strong>
                <ul className="descriptor-list">
                  {mode === 'Control' ? (
                    <>
                      <li>Direct execution: Bypasses caches completely.</li>
                      <li>Uncompressed storage: Uploads raw buffers.</li>
                      <li>Heavy descriptive prompt design for nutrition.</li>
                      <li>Hosts in high-carbon grid us-east-1 (475 g/kWh).</li>
                    </>
                  ) : (
                    <>
                      <li>Fast Semantic Cache checking (Image hash & tags).</li>
                      <li>Media compression: Uses Sharp for WebP convert.</li>
                      <li>Compressed prompts to save egress and API tokens.</li>
                      <li>Hosts in low-carbon renewable grid eu-west-1 (50 g/kWh).</li>
                    </>
                  )}
                </ul>
              </div>

              {/* Action Submit */}
              <button 
                type="submit" 
                className="submit-btn"
                disabled={isLoading}
              >
                {isLoading ? (
                  <>
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" className="spinner" style={{ animation: 'spin 1s linear infinite' }}>
                      <circle cx="12" cy="12" r="10" strokeDasharray="32" strokeDashoffset="12" />
                    </svg>
                    Processing...
                  </>
                ) : (
                  <>
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                      <path d="m22 2-7 20-4-9-9-4Z" />
                      <path d="M22 2 11 13" />
                    </svg>
                    Analyze Nutrition
                  </>
                )}
              </button>
            </form>
          ) : (
            <div className="simulation-panel">
              <h3 className="sim-title" style={{ fontSize: '1rem', fontWeight: 700, marginBottom: '0.5rem', color: '#fff' }}>
                Sprint Backlog Simulation Suite
              </h3>
              <p className="sim-desc" style={{ fontSize: '0.8rem', color: 'hsl(var(--text-secondary))', lineHeight: 1.4, marginBottom: '1.25rem' }}>
                Test the proposed Sustain-Agile framework vs. the standard Scrum workflow at scale. Running a simulation executes a batch backlog of 10 tasks (including 4 duplicate queries to test semantic caching).
              </p>
              
              <div className="sim-actions" style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                <button 
                  type="button" 
                  className="sim-btn control" 
                  onClick={() => handleSimulateSprint('Control')}
                  disabled={isLoading}
                  style={{
                    background: 'hsl(var(--color-control))',
                    color: '#000',
                    border: 'none',
                    padding: '0.875rem',
                    borderRadius: '0.5rem',
                    fontWeight: 700,
                    cursor: 'pointer',
                    transition: 'all 0.25s ease'
                  }}
                >
                  {isSimulating ? 'Simulating...' : 'Run Control Scrum Sprint'}
                </button>
                
                <button 
                  type="button" 
                  className="sim-btn experimental" 
                  onClick={() => handleSimulateSprint('Experimental')}
                  disabled={isLoading}
                  style={{
                    background: 'hsl(var(--color-experimental))',
                    color: '#000',
                    border: 'none',
                    padding: '0.875rem',
                    borderRadius: '0.5rem',
                    fontWeight: 700,
                    cursor: 'pointer',
                    transition: 'all 0.25s ease'
                  }}
                >
                  {isSimulating ? 'Simulating...' : 'Run Sustain-Agile Sprint'}
                </button>
              </div>
              
              <div className="sim-details" style={{ marginTop: '1.25rem', padding: '0.875rem', background: 'rgba(255,255,255,0.02)', borderRadius: '0.5rem', border: '1px solid hsl(var(--border-subtle))', fontSize: '0.75rem', lineHeight: 1.4 }}>
                <strong style={{ color: 'hsl(var(--text-secondary))', display: 'block', marginBottom: '0.25rem' }}>Backlog Preset:</strong>
                <ol style={{ paddingLeft: '1.15rem', color: 'hsl(var(--text-muted))', display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                  <li>Apple (1200KB)</li>
                  <li>Salad (2400KB)</li>
                  <li>Pizza (3100KB)</li>
                  <li>Salad (Duplicate → Cache Hit)</li>
                  <li>Burger (3500KB)</li>
                  <li>Apple (Duplicate → Cache Hit)</li>
                  <li>Chicken (1800KB)</li>
                  <li>Burger (Duplicate → Cache Hit)</li>
                  <li>Eggs (1500KB)</li>
                  <li>Chicken (Duplicate → Cache Hit)</li>
                </ol>
              </div>
            </div>
          )}
        </section>

        {/* Right Side: Active Result Display & Telemetry feed */}
        <section className="dashboard-display">
          
          {/* Active Result Card */}
          {activeResult && (
            <div className="result-card">
              <div className="result-header">
                <div className="result-title-section">
                  <span className="result-subtitle">Meal Identified</span>
                  <h3 className="result-title">{activeResult.meal}</h3>
                </div>
                <div className={`result-badge ${activeResult.mode.toLowerCase()}`}>
                  {activeResult.mode} Mode
                </div>
              </div>

              {activeResult.wasCached && (
                <div className="cache-hit-ticker">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                  SEMANTIC CACHE HIT Bypassed Google Gemini API ($0 / 0 Tokens)
                </div>
              )}

              {/* Nutrition Pills Grid */}
              <div className="nutrition-grid">
                <div className="nutrition-pill calories">
                  <span className="nutrition-pill-value">{activeResult.calories}</span>
                  <span className="nutrition-pill-label">Calories</span>
                </div>
                <div className="nutrition-pill protein">
                  <span className="nutrition-pill-value">{activeResult.protein}g</span>
                  <span className="nutrition-pill-label">Protein</span>
                </div>
                <div className="nutrition-pill carbs">
                  <span className="nutrition-pill-value">{activeResult.carbs}g</span>
                  <span className="nutrition-pill-label">Carbs</span>
                </div>
                <div className="nutrition-pill fat">
                  <span className="nutrition-pill-value">{activeResult.fat}g</span>
                  <span className="nutrition-pill-label">Fats</span>
                </div>
              </div>

              <div className="explanation-section">
                <h4 style={{ color: '#fff', fontSize: '0.85rem', marginBottom: '0.5rem', fontWeight: 700 }}>
                  Dietary Breakdown:
                </h4>
                <p style={{ whiteSpace: 'pre-line' }}>{activeResult.explanation}</p>
              </div>
            </div>
          )}

          {/* Telemetry Logs feed */}
          <div className="logs-container">
            <div className="logs-header">
              <h3 className="logs-title">System Telemetry Log Feed</h3>
              <span className="logs-count">{logs.length} Transactions</span>
            </div>

            {logs.length === 0 ? (
              <div className="empty-logs-state">
                <div className="empty-icon">
                  <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                    <rect x="2" y="3" width="20" height="14" rx="2" />
                    <line x1="8" y1="21" x2="16" y2="21" />
                    <line x1="12" y1="17" x2="12" y2="21" />
                  </svg>
                </div>
                <strong style={{ color: 'hsl(var(--text-secondary))' }}>No Transactions Logged</strong>
                <p style={{ fontSize: '0.75rem', maxWidth: '320px', lineHeight: 1.4 }}>
                  Perform food analyses in both modes to populate the deep backend sustainable computing log dataset.
                </p>
              </div>
            ) : (
              <div className="table-wrapper">
                <table className="logs-table">
                  <thead>
                    <tr>
                      <th>Time</th>
                      <th>Mode</th>
                      <th>Meal Tag</th>
                      <th>Cache Status</th>
                      <th>Token Load</th>
                      <th>Virtual Cost</th>
                      <th>S3 Optimized</th>
                      <th>Cloud Region</th>
                      <th>TTL Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {logs.map((log) => {
                      const date = new Date(log.timestamp).toLocaleTimeString();
                      const savingsPct = log.originalFileSizeKB > 0 
                        ? (((log.originalFileSizeKB - log.optimizedFileSizeKB) / log.originalFileSizeKB) * 100).toFixed(0)
                        : 0;

                      return (
                        <tr key={log._id}>
                          <td style={{ color: 'hsl(var(--text-muted))', fontWeight: 600 }}>{date}</td>
                          <td>
                            <span className={`mode-badge ${log.mode.toLowerCase()}`}>
                              {log.mode}
                            </span>
                          </td>
                          <td style={{ fontWeight: 600, color: '#fff' }}>{log.mealTag || 'Unnamed Meal'}</td>
                          <td>
                            {log.wasCached ? (
                              <span className="cache-badge">HIT</span>
                            ) : (
                              <span className="miss-badge">MISS</span>
                            )}
                          </td>
                          <td style={{ fontFamily: 'monospace' }}>
                            {log.totalTokens > 0 ? (
                              <span title={`Prompt: ${log.promptTokens} | Candidates: ${log.candidatesTokens}`}>
                                {log.totalTokens}
                              </span>
                            ) : (
                              <span style={{ color: 'hsl(var(--text-muted))' }}>0</span>
                            )}
                          </td>
                          <td style={{ color: 'hsl(var(--color-gold))', fontWeight: 600, fontFamily: 'monospace' }}>
                            ${log.calculatedVirtualCost.toFixed(5)}
                          </td>
                          <td>
                            {log.mode === 'Experimental' && log.originalFileSizeKB > 0 ? (
                              <div className="mini-savings-bar">
                                <div className="mini-savings-outer">
                                  <div className="mini-savings-inner" style={{ width: `${Math.max(100 - savingsPct, 10)}%` }} />
                                </div>
                                <span className="mini-savings-text" style={{ color: '#10b981' }}>
                                  -{savingsPct}% ({log.optimizedFileSizeKB.toFixed(0)}K)
                                </span>
                              </div>
                            ) : log.originalFileSizeKB > 0 ? (
                              <span style={{ color: 'hsl(var(--text-muted))' }}>
                                {log.originalFileSizeKB.toFixed(0)} KB (Raw)
                              </span>
                            ) : (
                              <span style={{ color: 'hsl(var(--text-muted))' }}>-</span>
                            )}
                          </td>
                          <td>
                            <span style={{ 
                              color: log.regionalCarbonFactor === 'low' ? 'hsl(var(--color-experimental))' : 'hsl(var(--color-control))',
                              fontWeight: 600,
                              fontSize: '0.75rem'
                            }}>
                              {log.regionalCarbonFactor === 'low' ? 'eu-west-1' : 'us-east-1'}
                            </span>
                          </td>
                          <td>
                            {log.s3TtlDays ? (
                              <span className="ttl-badge" title="Automatically scheduled for clean up in 7 days">
                                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                                  <circle cx="12" cy="12" r="10" />
                                  <polyline points="12 6 12 12 16 14" />
                                </svg>
                                {log.s3TtlDays} Days
                              </span>
                            ) : (
                              <span style={{ color: 'hsl(var(--text-muted))' }}>Infinite</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Carbon Footprint Reduction Visualizer */}
          <div className="carbon-visualizer-card">
            <div className="carbon-info">
              <h4 className="carbon-info-title">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" style={{ color: '#06b6d4' }}>
                  <path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
                </svg>
                Grid Carbon Shifting Assessment
              </h4>
              <p className="carbon-info-desc">
                By routing Experimental Mode workloads to renewable AWS grids like <strong>eu-west-1</strong>, compressing token volumes, and bypassing LLM requests with image hash cache checks, this testbed models dramatic real-world carbon emissions reductions.
              </p>
            </div>

            <div className="carbon-compare-bar">
              <div className="compare-row">
                <div className="compare-row-header">
                  <span style={{ color: 'hsl(var(--color-control))' }}>Control Scrum Simulation CO₂e</span>
                  <span style={{ fontFamily: 'monospace' }}>{controlScenarioCarbonGrams.toFixed(1)} g</span>
                </div>
                <div className="compare-row-bar-outer">
                  <div className="compare-row-bar-inner control" style={{ width: controlScenarioCarbonGrams > 0 ? '100%' : '0%' }} />
                </div>
              </div>

              <div className="compare-row">
                <div className="compare-row-header">
                  <span style={{ color: 'hsl(var(--color-experimental))' }}>Actual Mixed System CO₂e</span>
                  <span style={{ fontFamily: 'monospace' }}>{actualCarbonGrams.toFixed(1)} g</span>
                </div>
                <div className="compare-row-bar-outer">
                  <div 
                    className="compare-row-bar-inner experimental" 
                    style={{ 
                      width: controlScenarioCarbonGrams > 0 
                        ? `${(actualCarbonGrams / controlScenarioCarbonGrams) * 100}%` 
                        : '0%' 
                    }} 
                  />
                </div>
              </div>
            </div>
          </div>

        </section>
      </main>

      {/* 6. Sustain-Agile Performance Analytics Dashboard */}
      {logs.length > 0 && (
        <section className="analytics-section">
          <div className="analytics-header">
            <h2 className="analytics-title">Sustain-Agile Research Performance Analytics</h2>
            <p className="analytics-subtitle">Experimental Validation and Multi-dimensional Velocity Assessment</p>
          </div>

          <div className="vs-formula-card">
            <div className="vs-formula-body">
              <div className="vs-formula-math">
                <span className="math-vs">V<sub>s</sub></span>
                <span className="math-equals">=</span>
                <div className="math-fraction">
                  <span className="math-numerator">Σ (SP<sub>i</sub> × μ<sub>i</sub>)</span>
                  <span className="math-denominator">CAWS + (T<sub>tokens</sub> × ω)</span>
                </div>
              </div>
              <div className="vs-formula-legend">
                <h4 style={{ color: '#fff', fontSize: '0.85rem', marginBottom: '0.35rem', fontWeight: 700 }}>Sustainability Velocity (V<sub>s</sub>) Legend:</h4>
                <p><strong>SP<sub>i</sub></strong> = User Story Points (Assigned 5 per transaction)</p>
                <p><strong>μ<sub>i</sub></strong> = Productivity Efficiency (1.0 default, 1.5 for instant Cache Hits)</p>
                <p><strong>CAWS</strong> = AWS Cumulative Costs ($ Egress + LLM Inference)</p>
                <p><strong>T<sub>tokens</sub></strong> = Cumulative Tokens consumed (scaled per 1K tokens)</p>
                <p><strong>ω</strong> = Regional carbon factor (Control: 475 g/kWh, Sustain-Agile: 50 g/kWh)</p>
              </div>
            </div>
          </div>

          <div className="charts-grid">
            <div className="chart-card">
              <h3 className="chart-card-title">Sustainability Velocity (V<sub>s</sub>)</h3>
              <div className="chart-container">{renderVelocityChart()}</div>
            </div>
            
            <div className="chart-card">
              <h3 className="chart-card-title">AWS Egress & Inference Cost ($)</h3>
              <div className="chart-container">{renderCostChart()}</div>
            </div>

            <div className="chart-card">
              <h3 className="chart-card-title">Carbon Footprint Emissions (g CO₂e)</h3>
              <div className="chart-container">{renderCarbonChart()}</div>
            </div>

            <div className="chart-card">
              <h3 className="chart-card-title">Computational LLM Token Load</h3>
              <div className="chart-container">{renderTokenChart()}</div>
            </div>
          </div>

          {/* Metric Inspector Console */}
          <div className="inspector-panel">
            <div className="inspector-glow-accent" style={{ background: hoveredPoint ? (hoveredPoint.mode === 'Control' ? 'rgba(244, 63, 94, 0.15)' : 'rgba(34, 197, 94, 0.15)') : 'rgba(255,255,255,0.02)' }} />
            <div className="inspector-content">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ color: hoveredPoint ? (hoveredPoint.mode === 'Control' ? 'hsl(var(--color-control))' : 'hsl(var(--color-experimental))') : 'hsl(var(--text-muted))' }}>
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="16" x2="12" y2="12" />
                <line x1="12" y1="8" x2="12.01" y2="8" />
              </svg>
              {hoveredPoint ? (
                <div className="inspector-data">
                  <strong style={{ textTransform: 'uppercase', color: hoveredPoint.mode === 'Control' ? 'hsl(var(--color-control))' : 'hsl(var(--color-experimental))' }}>
                    {hoveredPoint.mode} Mode
                  </strong>
                  <span style={{ color: '#fff', fontWeight: 600, marginLeft: '0.5rem' }}>
                    {hoveredPoint.type === 'vs' && `Calculated Velocity Score: ${hoveredPoint.value.toFixed(2)}`}
                    {hoveredPoint.type === 'cost' && `Cumulative Operational Cost: $${hoveredPoint.value.toFixed(5)} (at transaction index #${hoveredPoint.index})`}
                    {hoveredPoint.type === 'carbon' && `Total Grid Carbon Emissions: ${hoveredPoint.value.toFixed(1)} g CO₂e`}
                    {hoveredPoint.type === 'tokens' && `Total sprint tokens: ${(hoveredPoint.prompt + hoveredPoint.candidates).toLocaleString()} (Prompt: ${hoveredPoint.prompt.toLocaleString()} | Completion: ${hoveredPoint.candidates.toLocaleString()})`}
                  </span>
                </div>
              ) : (
                <span style={{ color: 'hsl(var(--text-muted))', fontSize: '0.85rem' }}>
                  Hover over bars or nodes in the charts above to run deep telemetry metric inspection.
                </span>
              )}
            </div>
          </div>
        </section>
      )}

      {/* Dynamic Keyframes for spinner in CSS styles */}
      <style>{`
        @keyframes spin {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }
        .spinner {
          animation: spin 1s linear infinite;
        }
      `}</style>
    </div>
  );
}
