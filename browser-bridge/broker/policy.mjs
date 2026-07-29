import { BrowserBridgeErrorCode } from '../shared/errors.mjs';
import { BrowserToolName } from '../shared/protocol.mjs';

const SENSITIVE_AUTOCOMPLETE = new Set([
  'one-time-code',
  'cc-number',
  'cc-csc',
  'cc-exp',
  'cc-exp-month',
  'cc-exp-year',
]);
const HIGH_RISK_WORDS = /\b(delete|remove|destroy|purchase|buy|pay|submit|order)\b/i;

export function classifyElementRisk(element = {}) {
  const inputType = String(element.inputType ?? '').toLowerCase();
  const autocomplete = String(element.autocomplete ?? '').toLowerCase();
  const label = `${element.text ?? ''} ${element.name ?? ''} ${element.role ?? ''}`;
  if (inputType === 'password' || SENSITIVE_AUTOCOMPLETE.has(autocomplete)) {
    return { risk: 'blocked', reason: 'sensitive_input' };
  }
  if (HIGH_RISK_WORDS.test(label)) return { risk: 'high', reason: 'destructive_or_submit' };
  return { risk: 'low' };
}

/**
 * Determines whether a valid command can be immediately dispatched. This is
 * deliberately conservative: callers must have already validated tool input.
 */
export function evaluateCommandPolicy({ tool, tab, element, targetOrigin }) {
  if (!tab?.shared) {
    return { decision: 'deny', code: BrowserBridgeErrorCode.TAB_NOT_SHARED };
  }

  const elementRisk = classifyElementRisk(element);
  if (elementRisk.risk === 'blocked') {
    return { decision: 'deny', code: BrowserBridgeErrorCode.POLICY_BLOCKED };
  }

  if (tool === BrowserToolName.STATUS || tool === BrowserToolName.LIST_TABS) {
    return { decision: 'allow' };
  }
  if (tool === BrowserToolName.SNAPSHOT) {
    return tab.readAllowed ? { decision: 'allow' } : { decision: 'approval' };
  }
  if (tool === BrowserToolName.SCREENSHOT || tool === BrowserToolName.TYPE) {
    return { decision: 'approval' };
  }
  if (tool === BrowserToolName.CLICK) {
    return elementRisk.risk === 'high' || !tab.lowRiskAllowed
      ? { decision: 'approval' }
      : { decision: 'allow' };
  }
  if (tool === BrowserToolName.SCROLL || tool === BrowserToolName.WAIT) {
    return tab.lowRiskAllowed ? { decision: 'allow' } : { decision: 'approval' };
  }
  if (tool === BrowserToolName.NAVIGATE) {
    return targetOrigin === tab.origin && tab.lowRiskAllowed
      ? { decision: 'allow' }
      : { decision: 'approval' };
  }
  return { decision: 'deny', code: BrowserBridgeErrorCode.POLICY_BLOCKED };
}
