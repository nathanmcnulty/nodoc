import {
  buildEffectiveActions,
  estimateReplayExpansion,
  normalizeRecipeAction,
} from "./portal-discovery-actions.mjs";

function nonNegativeInteger(value, label) {
  if (!Number.isInteger(value) || value < 0) throw new Error(`${label} must be a non-negative integer.`);
  return value;
}

export function planActionBudget(recipe = {}, {
  maxActions = recipe?.maxActions,
  mandatoryOrchestrationActions = 1,
  expandedReplayActions,
  cliActions = [],
} = {}) {
  const recipeActions = buildEffectiveActions({
    recipeActions: recipe?.actions ?? [],
    cliActions,
  });
  const normalizedRecipeActions = recipeActions.map((action) => normalizeRecipeAction(action));
  const replayExpansion = expandedReplayActions === undefined
    ? estimateReplayExpansion(normalizedRecipeActions, recipe)
    : expandedReplayActions;
  const categories = {
    recipeActions: nonNegativeInteger(recipeActions.length, "recipeActions"),
    cliActions: nonNegativeInteger(cliActions.length, "cliActions"),
    mandatoryOrchestrationActions: nonNegativeInteger(mandatoryOrchestrationActions, "mandatoryOrchestrationActions"),
    expandedReplayActions: nonNegativeInteger(replayExpansion, "expandedReplayActions"),
  };
  const total = Object.values(categories).reduce((sum, category) => sum + category, 0);
  const plan = {
    categories,
    countedActions: total,
    maxActions: maxActions === undefined || maxActions === null ? null : nonNegativeInteger(maxActions, "maxActions"),
    budgetCategories: Object.keys(categories),
    effectiveActions: buildEffectiveActions({
      recipeActions: recipe?.actions ?? [],
      cliActions,
      includeInitialNavigation: mandatoryOrchestrationActions > 0,
      initialUrl: recipe?.url ?? "https://invalid.initial-root.invalid/",
    }).map(({ raw, ...action }) => action),
  };
  if (plan.maxActions !== null && total > plan.maxActions) {
    const error = new Error(`Action budget exceeded: planned ${total} browser actions exceeds authorized maximum ${plan.maxActions}.`);
    error.code = "action-budget-exceeded";
    error.blocker = {
      code: error.code,
      detail: error.message,
      categories,
      countedActions: total,
      maxActions: plan.maxActions,
      remediation: "Reduce recipe or replay actions, or obtain an authorization ceiling that covers all mandatory orchestration actions before rerunning.",
    };
    throw error;
  }
  return plan;
}

export function validateActionBudgetResult(actionResults, plan) {
  const countedActions = Array.isArray(actionResults) ? actionResults.length : 0;
  if (plan?.maxActions !== null && plan?.maxActions !== undefined && countedActions > plan.maxActions) {
    const error = new Error(`Action result count ${countedActions} exceeds authorized maximum ${plan.maxActions}.`);
    error.code = "action-budget-exceeded";
    error.blocker = {
      code: error.code,
      detail: error.message,
      countedActions,
      maxActions: plan.maxActions,
      remediation: "Stop the run and reconcile the planned action categories before any further browser interaction.",
    };
    throw error;
  }
  return { ...plan, consumedActions: countedActions };
}
