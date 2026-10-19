/**
 * declarativeNetRequest rule management.
 *
 * Rules exist ONLY while a focus session is running. We own the fixed rule ID
 * range 1000-1999: the whole range (in practice: every dynamic rule we have)
 * is always removed before re-adding, so rules can never go stale.
 */
import { RULE_ID_MAX, RULE_ID_MIN } from './types';
import type { TimerState } from './types';

export function shouldBlock(state: TimerState): boolean {
  return state.mode === 'focus' && state.isRunning;
}

/** One redirect rule per domain; `||domain^` matches the domain + subdomains. */
export function buildRules(blocklist: string[]): chrome.declarativeNetRequest.Rule[] {
  const maxRules = RULE_ID_MAX - RULE_ID_MIN + 1;
  return blocklist.slice(0, maxRules).map((domain, index) => ({
    id: RULE_ID_MIN + index,
    priority: 1,
    action: {
      type: 'redirect' as const,
      redirect: {
        extensionPath: `/src/blocked/blocked.html?site=${encodeURIComponent(domain)}`,
      },
    },
    condition: {
      urlFilter: `||${domain}^`,
      resourceTypes: ['main_frame' as const],
    },
  }));
}

/** Make dynamic rules match the desired state exactly (idempotent). */
export async function syncRules(state: TimerState, blocklist: string[]): Promise<void> {
  const existing = await chrome.declarativeNetRequest.getDynamicRules();
  const desired = shouldBlock(state) ? buildRules(blocklist) : [];

  const existingJson = JSON.stringify(existing);
  const desiredJson = JSON.stringify(desired);
  if (existingJson === desiredJson) return;

  await chrome.declarativeNetRequest.updateDynamicRules({
    removeRuleIds: existing.map((rule) => rule.id),
    addRules: desired,
  });
}
