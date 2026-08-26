/**
 * Model Quality Ranking & Smart Suggestion System
 * 
 * Ranks models by tier (reasoning > flagship > standard > mini > nano) and capabilities.
 * Analyzes prompt context to suggest best models for the task.
 */

// Model tier hierarchy (higher = better quality)
const MODEL_TIERS = {
  reasoning: 100,   // o1, o3, claude-sonnet-4, gemini-2.5-pro-thinking
  flagship: 80,     // gpt-5, gpt-4o, claude-sonnet, gemini-pro
  standard: 60,     // gpt-4, claude-haiku, gemini-flash
  mini: 40,         // gpt-4o-mini, claude-haiku-lite
  nano: 20,         // smallest/fastest models
  fallback: 10,     // unknown models
};

// Keywords that indicate need for reasoning/complex models
const REASONING_KEYWORDS = [
  'analyze', 'reasoning', 'complex', 'detailed', 'explain', 'understand',
  'logic', 'proof', 'mathematical', 'algorithm', 'architecture', 'design',
  'debug', 'trace', 'investigate', 'research', 'compare', 'evaluate'
];

// Keywords that indicate simple tasks (mini models sufficient)
const SIMPLE_KEYWORDS = [
  'quick', 'simple', 'fast', 'summarize', 'brief', 'short',
  'translate', 'format', 'convert', 'extract', 'list', 'check'
];

// Code-related keywords (favor models with strong coding capabilities)
const CODE_KEYWORDS = [
  'code', 'function', 'class', 'api', 'bug', 'refactor', 'implement',
  'fix', 'debug', 'test', 'build', 'deploy', 'script', 'program'
];

/**
 * Detect model tier from model name/id
 */
export function detectModelTier(modelId, modelName = '') {
  const str = `${modelId} ${modelName}`.toLowerCase();
  
  // Reasoning models
  if (str.match(/\bo[1-9](-|$)/i) || str.includes('thinking') || str.includes('reasoning')) {
    return MODEL_TIERS.reasoning;
  }
  
  // Flagship models
  if (str.match(/gpt-5|claude-.*-4|gemini-.*-pro(?!-thinking)|sonnet-4/i)) {
    return MODEL_TIERS.flagship;
  }
  
  // Nano models
  if (str.includes('nano')) {
    return MODEL_TIERS.nano;
  }
  
  // Mini models
  if (str.includes('mini') || str.includes('haiku') || str.includes('flash')) {
    return MODEL_TIERS.mini;
  }
  
  // Standard models (GPT-4, etc.)
  if (str.match(/gpt-4(?!\.)/i) || str.includes('turbo')) {
    return MODEL_TIERS.standard;
  }
  
  return MODEL_TIERS.fallback;
}

/**
 * Analyze prompt context to determine task complexity
 */
export function analyzePromptContext(promptText = '') {
  if (typeof promptText !== 'string' || !promptText.trim()) {
    return { complexity: 'standard', needsReasoning: false, needsCode: false };
  }

  const tokens = new Set(promptText.toLowerCase().match(/[a-z][a-z0-9+#.-]*/g) || []);
  const count = (keywords) => keywords.reduce((total, keyword) => total + (tokens.has(keyword) ? 1 : 0), 0);
  const reasoningScore = count(REASONING_KEYWORDS);
  const simpleScore = count(SIMPLE_KEYWORDS);
  const codeScore = count(CODE_KEYWORDS);
  const needsReasoning = reasoningScore >= 2 || promptText.length >= 500;
  const needsCode = codeScore >= 1 && (/```|[{}();]|\b(api|json|sql|javascript|typescript|python)\b/i.test(promptText));
  const isSimple = simpleScore >= 2 && reasoningScore === 0 && !needsCode && promptText.length < 160;

  return {
    complexity: needsReasoning ? 'reasoning' : isSimple ? 'mini' : 'standard',
    needsReasoning,
    needsCode,
  };
}

/**
 * Enhanced scoring: combines tier, health, latency, cost, and prompt context
 */
export function calculateEnhancedScore(model, weights, promptContext = null) {
  const { reliability = 0.4, latency = 0.3, cost = 0.2, quality = 0.1 } = weights;
  
  // Base quality tier score (0-1 normalized)
  const tierScore = detectModelTier(model.modelId || model.model, model.name) / 100;
  
  // Health metrics (reliability)
  const reliabilityScore = model.successRate ?? 1.0;
  
  // Latency score (lower is better, normalize to 0-1)
  const maxLatency = 10000; // 10s ceiling
  const actualLatency = model.latencyMs || model.emaLatency || 1000;
  const latencyScore = 1 - Math.min(actualLatency / maxLatency, 1);
  
  // Cost score (lower is better)
  const costScore = 1 - Math.min((model.cost || 1) / 10, 1);
  
  // Context-aware boost
  let contextBoost = 1.0;
  if (promptContext) {
    const modelTier = detectModelTier(model.modelId || model.model, model.name);
    
    if (promptContext.complexity === 'reasoning' && modelTier === MODEL_TIERS.reasoning) {
      contextBoost = 1.3; // 30% boost for reasoning models on complex tasks
    } else if (promptContext.complexity === 'mini' && modelTier === MODEL_TIERS.mini) {
      contextBoost = 1.2; // 20% boost for mini models on simple tasks
    } else if (promptContext.needsCode) {
      // Favor known coding models (GPT-4, Claude, etc.)
      const modelStr = `${model.modelId || model.model} ${model.name}`.toLowerCase();
      if (modelStr.match(/gpt-4|claude|kiro|cursor/i)) {
        contextBoost = 1.15;
      }
    }
  }
  
  const baseScore = (
    reliability * reliabilityScore +
    latency * latencyScore +
    cost * costScore +
    quality * tierScore
  );
  
  return baseScore * contextBoost;
}

/**
 * Sort models by enhanced score (highest first)
 */
export function rankModels(models, weights, promptContext = null) {
  const scored = models.map(m => ({
    ...m,
    enhancedScore: calculateEnhancedScore(m, weights, promptContext)
  }));
  
  scored.sort((a, b) => b.enhancedScore - a.enhancedScore);
  
  return scored;
}

/**
 * Get top N models with tier diversity (ensure mix of reasoning/flagship/mini)
 */
export function getBalancedTopModels(rankedModels, count = 5) {
  if (rankedModels.length <= count) return rankedModels;
  
  const result = [];
  const tiers = { reasoning: 0, flagship: 0, mini: 0 };
  
  // First pass: get top model from each tier
  for (const model of rankedModels) {
    const tier = detectModelTier(model.modelId || model.model, model.name);
    
    if (tier === MODEL_TIERS.reasoning && tiers.reasoning === 0) {
      result.push(model);
      tiers.reasoning++;
    } else if (tier === MODEL_TIERS.flagship && tiers.flagship === 0) {
      result.push(model);
      tiers.flagship++;
    } else if (tier === MODEL_TIERS.mini && tiers.mini === 0) {
      result.push(model);
      tiers.mini++;
    }
    
    if (result.length >= count) break;
  }
  
  // Second pass: fill remaining slots by score
  for (const model of rankedModels) {
    if (!result.includes(model)) {
      result.push(model);
      if (result.length >= count) break;
    }
  }
  
  return result;
}
