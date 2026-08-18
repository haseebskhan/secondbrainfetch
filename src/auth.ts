export function isValidWebhookSecret(
  provided: string | undefined | null,
  expected: string
): boolean {
  if (!provided) return false;
  return provided === expected;
}
