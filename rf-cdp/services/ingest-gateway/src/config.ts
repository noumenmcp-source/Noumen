import { config as dotenvConfig } from 'dotenv';

dotenvConfig();

export const config = {
  PORT: process.env.PORT || '8100',
  DITTOFEED_API: process.env.DITTOFEED_API || 'http://localhost:3000',
  ALLOWED_ORIGINS: process.env.ALLOWED_ORIGINS || '*',
  WRITE_KEYS: JSON.parse(process.env.WRITE_KEYS || '{}')
};