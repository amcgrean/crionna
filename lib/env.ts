import { z } from 'zod';

const schema = z.object({
  // Database
  DATABASE_URL: z.string().url(),

  // Anthropic
  ANTHROPIC_API_KEY: z.string().min(1),

  // Cloudflare R2
  R2_ACCOUNT_ID: z.string().min(1),
  R2_ACCESS_KEY_ID: z.string().min(1),
  R2_SECRET_ACCESS_KEY: z.string().min(1),
  R2_BUCKET_NAME: z.string().min(1),
  R2_PUBLIC_URL: z.string().url(),

  // Firecrawl
  FIRECRAWL_API_KEY: z.string().min(1),

  // GitHub App (for ingestion log commits)
  GITHUB_APP_ID: z.string().min(1),
  GITHUB_APP_PRIVATE_KEY: z.string().min(1),
  GITHUB_APP_INSTALLATION_ID: z.string().min(1),
  GITHUB_LOG_REPO_OWNER: z.string().min(1),
  GITHUB_LOG_REPO_NAME: z.string().min(1),

  // Auth.js
  AUTH_SECRET: z.string().min(32),
  AUTH_EMAIL_FROM: z.string().email(),

  // App
  NEXT_PUBLIC_APP_URL: z.string().url(),
});

const _parsed = schema.safeParse(process.env);

if (!_parsed.success) {
  const missing = _parsed.error.issues.map((i) => i.path.join('.')).join(', ');
  throw new Error(`Missing or invalid environment variables: ${missing}`);
}

export const env = _parsed.data;
