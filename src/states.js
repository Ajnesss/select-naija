'use strict';

const DAY = 24 * 60 * 60 * 1000;
const FRESH_DAYS = 7;

/**
 * A link's state, from the verifier's record.
 *   verified   – last check passed, within the last 7 days
 *   stale      – has passed before, last pass older than 7 days, not failing
 *   failing    – the last two checks failed
 *   unverified – never passed
 * Only verified and stale links are ever shown to users.
 */
function linkState(record, now = Date.now()) {
  if (!record || !record.lastOk) return 'unverified';
  const history = record.history || (record.checks || []).map((c) => c.ok);
  const lastTwo = history.slice(-2);
  if (lastTwo.length === 2 && lastTwo.every((r) => r === false)) return 'failing';
  const age = now - Date.parse(record.lastOk);
  if (Number.isNaN(age)) return 'unverified';
  return age <= FRESH_DAYS * DAY ? 'verified' : 'stale';
}

function isShown(state) {
  return state === 'verified' || state === 'stale';
}

module.exports = { linkState, isShown, FRESH_DAYS, DAY };
