// ─── Environment validation ──────────────────────────────────────────────────
// Validates all required VITE_ env vars at startup.  If any critical variable
// is missing the app throws a clear, actionable error instead of silently
// producing empty strings that cause confusing downstream failures.

const REQUIRED_VARS = {
  VITE_CONTRACT_POOL:       'Pool contract address',
  VITE_CONTRACT_VERIFIER:   'Verifier contract address',
  VITE_CONTRACT_ASP:        'ASP contract address',
  VITE_CONTRACT_COMPLIANCE: 'Compliance contract address',
} as const

type EnvKey = keyof typeof REQUIRED_VARS

/** Read an env var or return null if not set. */
function readEnv(key: string): string | null {
  const val = import.meta.env[key]
  if (typeof val !== 'string' || val.trim() === '') return null
  return val.trim()
}

/**
 * Validate that all required env vars are present.
 * Returns a map of missing var names → descriptions.
 * If `throwOnError` is true (default), throws immediately on the first miss.
 */
export function validateEnv(throwOnError = true): Record<string, string> {
  const missing: Record<string, string> = {}

  for (const [key, desc] of Object.entries(REQUIRED_VARS) as [EnvKey, string][]) {
    if (!readEnv(key)) {
      missing[key] = desc
    }
  }

  if (throwOnError && Object.keys(missing).length > 0) {
    const entries = Object.entries(missing)
      .map(([k, d]) => `  ${k}  — ${d}`)
      .join('\n')
    throw new Error(
      `Missing required environment variables:\n${entries}\n\n` +
      `Copy .env.example → .env and fill in your deployed contract addresses.\n` +
      `See the README for deployment instructions.`,
    )
  }

  return missing
}

/**
 * Get a validated env var.  Throws with a clear message if missing.
 */
export function requireEnv(key: EnvKey): string {
  const val = readEnv(key)
  if (!val) {
    throw new Error(
      `Environment variable ${key} is not set (${REQUIRED_VARS[key]}). ` +
      `Add it to your .env file (copy .env.example → .env).`,
    )
  }
  return val
}

/**
 * Get an optional env var with a fallback default.
 */
export function optionalEnv(key: string, fallback: string): string {
  return readEnv(key) ?? fallback
}
