import fs from 'fs';
import os from 'os';
import path from 'path';
import { PROSPECTS_DB, SETTINGS, getDefaultSettings, getDefaultProspects } from './data';
import { Prospect, CompanySettings } from './types';

const isServerless = Boolean(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME);
const DATA_DIR = isServerless
  ? path.join(os.tmpdir(), 'speer-storage')
  : path.join(process.cwd(), 'storage');
const DB_FILE = path.join(DATA_DIR, 'db.json');
const USERS_DIR = path.join(DATA_DIR, 'users');

const userStateCache = new Map<string, { prospects: Record<string, Prospect>; settings: CompanySettings }>();

function sanitizeUserId(userId?: string): string {
  if (!userId || typeof userId !== 'string') return 'default';
  const clean = userId.replace(/[^a-zA-Z0-9_-]/g, '_').trim();
  return clean || 'default';
}

export function getUserData(userId?: string): { prospects: Record<string, Prospect>; settings: CompanySettings } {
  const safeId = sanitizeUserId(userId);
  if (userStateCache.has(safeId)) {
    return userStateCache.get(safeId)!;
  }

  try {
    if (!fs.existsSync(USERS_DIR)) {
      fs.mkdirSync(USERS_DIR, { recursive: true });
    }
  } catch (err) {
    console.warn(`Could not create storage dir ${USERS_DIR}:`, err);
  }

  const userFile = path.join(USERS_DIR, `${safeId}.json`);
  if (fs.existsSync(userFile)) {
    try {
      const raw = fs.readFileSync(userFile, 'utf-8');
      const parsed = JSON.parse(raw);
      const state = {
        prospects: parsed.prospects || getDefaultProspects(),
        settings: parsed.settings || getDefaultSettings(),
      };
      userStateCache.set(safeId, state);
      return state;
    } catch (err) {
      console.warn(`Could not parse user file for ${safeId}, reinitializing:`, err);
    }
  }

  // If this is the 'default' user and db.json exists, load from db.json
  if (safeId === 'default' && fs.existsSync(DB_FILE)) {
    try {
      const raw = fs.readFileSync(DB_FILE, 'utf-8');
      const parsed = JSON.parse(raw);
      const state = {
        prospects: parsed.prospects || getDefaultProspects(),
        settings: parsed.settings || getDefaultSettings(),
      };
      userStateCache.set(safeId, state);
      return state;
    } catch {}
  }

  // Fresh user: initialize with clean default data
  const freshState = {
    prospects: getDefaultProspects(),
    settings: getDefaultSettings(),
  };
  userStateCache.set(safeId, freshState);
  saveUserData(safeId, freshState.prospects, freshState.settings);
  return freshState;
}

export function saveUserData(
  userId: string | undefined,
  prospects: Record<string, Prospect>,
  settings: CompanySettings
): void {
  const safeId = sanitizeUserId(userId);
  try {
    if (!fs.existsSync(USERS_DIR)) {
      fs.mkdirSync(USERS_DIR, { recursive: true });
    }
    const userFile = path.join(USERS_DIR, `${safeId}.json`);
    const payload = {
      userId: safeId,
      prospects,
      settings,
      updatedAt: new Date().toISOString(),
    };
    fs.writeFileSync(userFile, JSON.stringify(payload, null, 2), 'utf-8');
    userStateCache.set(safeId, { prospects, settings });

    // Also update db.json if default user
    if (safeId === 'default') {
      fs.writeFileSync(DB_FILE, JSON.stringify({ prospects, settings }, null, 2), 'utf-8');
    }
  } catch (err) {
    console.warn(`Failed to save user data for ${safeId}:`, err);
  }
}

export function loadPersistedState(): void {
  getUserData('default');
}

export function savePersistedState(): void {
  const def = getUserData('default');
  saveUserData('default', def.prospects, def.settings);
}
