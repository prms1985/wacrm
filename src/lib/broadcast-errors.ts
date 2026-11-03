/** Saved errors may come from an HTTP response or an asynchronous Meta webhook. */
export function isCallingNotEnabledError(message: string | null | undefined): boolean {
  if (!message) return false;
  return /(?:^|\D)138000(?:\D|$)/.test(message) ||
    /calling\s+(?:(?:api|apis)\s+)?(?:is\s+|are\s+)?not\s+enabled/i.test(message);
}
