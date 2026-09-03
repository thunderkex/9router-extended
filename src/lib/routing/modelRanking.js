/**
 * Model Quality Ranking & Smart Suggestion System
 * 
 * Ranks models by tier (reasoning > flagship > standard > mini > nano) and capabilities.
 * Analyzes prompt context to suggest best models for the task.
 */

// Model tier hierarchy (higher = better quality)
export const MODEL_TIERS = {
  reasoning: 100,   // o1, o3, deepseek-r1, gemini-flash-high, claude-thinking
  flagship: 80,     // gpt-5, gpt-4o, claude-sonnet, gemini-pro, minimax, deepseek-v3, glm-5
  standard: 60,     // gpt-4, claude-haiku, gemini-flash-medium, turbo
  mini: 40,         // gpt-4o-mini, flash-low, small/lite models
  nano: 20,         // smallest/fastest models (<3b)
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
 * Detect model tier from model object or name/id
 */
export function detectModelTier(model, modelName = '') {
  const id = typeof model === 'string'
    ? model
    : (model?.modelId || model?.model || model?.id || model?.name || '');
  const name = typeof model === 'object' && model?.name ? model.name : (modelName || '');
  const str = `${id} ${name}`.toLowerCase();

  // 1. Reasoning models
  if (
    str.match(/\bo[1-9](-|\b)/i) ||
    str.includes('thinking') ||
    str.includes('reasoning') ||
    str.includes('reasoner') ||
    str.match(/\b(r1|qwq|qvq)\b/i) ||
    str.includes('deepseek-r1') ||
    str.includes('-high') ||
    str.includes('(high)')
  ) {
    return MODEL_TIERS.reasoning;
  }

  // 2. Flagship models
  if (
    str.match(/gpt-5|gpt-4o|gpt-4\.5|sonnet|opus|gemini-.*pro|deepseek-v[3-9]|deepseek-chat|glm-[5-9]|minimax-m|kimi-k[2-9]|qwen.*(72b|max|plus)/i)
  ) {
    return MODEL_TIERS.flagship;
  }

  // 3. Nano models
  if (str.match(/\bnano\b|tiny|micro|\b[0-2]\.?[0-9]?b\b/i)) {
    return MODEL_TIERS.nano;
  }

  // 4. Mini models (explicitly avoid matching 'minimax')
  if (
    str.match(/\bmini\b|-mini\b|_mini\b/i) ||
    str.includes('haiku') ||
    str.includes('flash-low') ||
    str.includes('flash-8b') ||
    str.includes('lite') ||
    str.includes('small')
  ) {
    return MODEL_TIERS.mini;
  }

  // 5. Standard models
  if (
    str.match(/gpt-4(?!\.)/i) ||
    str.includes('turbo') ||
    str.includes('flash') ||
    str.includes('standard') ||
    str.includes('medium')
  ) {
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
  const tierScore = detectModelTier(model, model?.name) / 100;
  
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
    const modelTier = detectModelTier(model, model?.name);
    
    if (promptContext.complexity === 'reasoning' && modelTier === MODEL_TIERS.reasoning) {
      contextBoost = 1.3; // 30% boost for reasoning models on complex tasks
    } else if (promptContext.complexity === 'mini' && modelTier === MODEL_TIERS.mini) {
      contextBoost = 1.2; // 20% boost for mini models on simple tasks
    } else if (promptContext.needsCode) {
      // Favor known coding models
      const modelStr = `${model?.modelId || model?.model || model?.id || ''} ${model?.name || ''}`.toLowerCase();
      if (modelStr.match(/gpt-4|claude|kiro|cursor|deepseek|qwen.*coder/i)) {
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
 * Get top N models with tier diversity (ensure mix of reasoning/flagship/standard/mini)
 */
export function getBalancedTopModels(rankedModels, count = 5) {
  if (!Array.isArray(rankedModels) || rankedModels.length === 0) return [];

  const getModelKey = (m) => typeof m === 'string' ? m : (m?.model || m?.modelId || m?.id || m?.name || '');
  const result = [];
  const seenKeys = new Set();
  const tiersCount = { reasoning: 0, flagship: 0, standard: 0, mini: 0 };

  // First pass: ensure representation across tiers (top model from each tier)
  for (const model of rankedModels) {
    const tier = detectModelTier(model, model?.name);
    let picked = false;

    if (tier === MODEL_TIERS.reasoning && tiersCount.reasoning === 0) {
      tiersCount.reasoning++;
      picked = true;
    } else if (tier === MODEL_TIERS.flagship && tiersCount.flagship === 0) {
      tiersCount.flagship++;
      picked = true;
    } else if (tier === MODEL_TIERS.standard && tiersCount.standard === 0) {
      tiersCount.standard++;
      picked = true;
    } else if (tier === MODEL_TIERS.mini && tiersCount.mini === 0) {
      tiersCount.mini++;
      picked = true;
    }

    if (picked) {
      const key = getModelKey(model);
      if (key && !seenKeys.has(key)) {
        result.push(model);
        seenKeys.add(key);
      }
    }

    if (result.length >= count) break;
  }

  // Second pass: fill remaining slots by overall score
  for (const model of rankedModels) {
    const key = getModelKey(model);
    if (key && !seenKeys.has(key)) {
      result.push(model);
      seenKeys.add(key);
      if (result.length >= count) break;
    }
  }

  return result;
}
