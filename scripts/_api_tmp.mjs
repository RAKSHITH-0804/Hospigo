import { spawn } from 'node:child_process';
import { config } from 'dotenv';
config({ path: 'D:/Indigo/Hospigo Code/.env' });
const t = (k, fb) => { const u = new URL(process.env[k] || process.env[fb]); u.pathname = '/hospigo_test'; return u.toString(); };
const env = { ...process.env, NODE_ENV: 'development', DATABASE_URL: t('DATABASE_URL_TEST', 'DATABASE_URL'), DATABASE_URL_HQ: t('DATABASE_URL_HQ'), DATABASE_URL_PATIENT: t('DATABASE_URL_PATIENT'), API_PORT: '3100' };
spawn('node', ['D:/Indigo/Hospigo Code/apps/api/dist/main.js'], { cwd: 'D:/Indigo/Hospigo Code/apps/api', env, stdio: 'inherit' });
