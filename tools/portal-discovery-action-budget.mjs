import { normalizeRecipeActions } from "./portal-discovery-actions.mjs";

const budgetCategories = ["recipeActions", "mandatoryOrchestrationActions", "expandedReplayActions"];

function nonNegativeInteger(value, label) {
  if (!Number.isInteger(value) || value < 0) throw new Error(`${label} must be a non-negative integer.`);
  return value;
}

export function planActionBudget(recipe, { maxActions = recipe?.maxActions, mandatoryOrchestrationActions = 1, expandedReplayActions = 0 } = {}) {
  const recipeActions = normalizeRecipeActions(recipe?.actions).length;
  const categories = {
    recipeActions: nonNegativeInteger(recipeActions, "recipeActions"),
    mandatoryOrchestrationActions: nonNegativeInteger(mandatoryOrchestrationActions, "mandatoryOrchestrationActions"),
    expandedReplayActions: nonNegativeInteger(expandedReplayActions, "expandedReplayActions"),
  };
  const total = budgetCategories.reduce((sum, category) => sum + categories[category], 0);
  const plan = {
    categories,
    countedActions: total,
    maxActions: maxActions === undefined || maxActions === null ? null : nonNegativeInteger(maxActions, "maxActions"),
    budgetCategories,
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
