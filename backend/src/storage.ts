import fs from 'fs';
import path from 'path';
import { PROSPECTS_DB, SETTINGS } from './data';
import { buildFullSequence } from './generator';
import { enrichProspectWithMultiAgentOKFICM } from './okf_icm';
import { Prospect, CompanySettings } from './types';

const DATA_DIR = path.join(__dirname, '..', 'storage');
const DB_FILE = path.join(DATA_DIR, 'db.json');

interface PersistedState {
  prospects: Record<string, Prospect>;
  settings: CompanySettings;
  copyEngineVersion?: number;
}

const CURRENT_COPY_ENGINE_VERSION = 12;

export function loadPersistedState(): void {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    if (fs.existsSync(DB_FILE)) {
      const raw = fs.readFileSync(DB_FILE, 'utf-8');
      const parsed: PersistedState = JSON.parse(raw);
      if (parsed.settings) {
        Object.assign(SETTINGS, parsed.settings);
        // Clean up any scraped marketing slogans in SETTINGS.offerings
        if (
          Array.isArray(SETTINGS.offerings) &&
          SETTINGS.offerings.some((o) =>
            /engineer for business|what else can you build|browser does not support/i.test(
              `${o.name} ${o.desc}`
            )
          )
        ) {
          SETTINGS.offerings = [
            {
              id: 'off_1',
              name: 'Enterprise AI platform',
              desc: 'End-to-end model deployment, governance, and RAG pipelines.',
            },
            {
              id: 'off_2',
              name: 'Workflow automation',
              desc: 'AI-powered orchestration for cross-system operational processes.',
            },
            {
              id: 'off_3',
              name: 'Data pipeline toolkit',
              desc: 'Real-time streaming and ERP/IoT data unification across sites.',
            },
          ];
        }
      }
      if (parsed.prospects) {
        Object.keys(PROSPECTS_DB).forEach((k) => delete PROSPECTS_DB[k]);
        Object.assign(PROSPECTS_DB, parsed.prospects);

        // Upgrade legacy template drafts, filter noise, and ensure OKF + ICM + Multi-Agent trace
        if (parsed.copyEngineVersion !== CURRENT_COPY_ENGINE_VERSION) {
          const noiseRegex = /(candy stripe|stripe the jungle|athletics|bengals)/i;
          Object.values(PROSPECTS_DB).forEach((p) => {
            const cleanSigs = p.signals.filter((s) => !noiseRegex.test(s.t) && !noiseRegex.test(s.src));
            if (cleanSigs.length > 0 && cleanSigs.length !== p.signals.length) {
              p.signals = cleanSigs.map((s, idx) => ({ ...s, id: idx }));
              p.sel = p.signals.map((s) => s.id);
            }
            if (Array.isArray(p.angles)) {
              p.angles = p.angles.map((a, idx) => {
                let cleanTitle = a.t;
                if (/AI.*AI/i.test(cleanTitle)) {
                  cleanTitle = `${p.name} platform & roadmap acceleration`;
                }
                let cleanOff = a.off;
                if (/engineer for business|what else can you build|key technologies|everyday ai/i.test(cleanOff)) {
                  cleanOff =
                    idx === 0
                      ? 'Enterprise AI platform'
                      : idx === 1
                      ? 'Workflow automation'
                      : 'Data pipeline toolkit';
                }
                let cleanDesc = a.d;
                if (
                  /\([^)]*$/.test(cleanDesc) ||
                  /for ac\)/i.test(cleanDesc) ||
                  /comp\)/i.test(cleanDesc) ||
                  /engineer for business/i.test(cleanDesc)
                ) {
                  cleanDesc = `Align ${cleanOff.toLowerCase()} with ${p.name}’s latest growth and product initiatives.`;
                }
                let cleanSigStr = a.sig;
                if (noiseRegex.test(cleanSigStr)) {
                  cleanSigStr = p.signals.slice(0, 2).map((s) => s.t).join(', ');
                }
                return {
                  ...a,
                  t: idx === 0 ? cleanTitle : a.t,
                  off: cleanOff,
                  d: cleanDesc,
                  sig: cleanSigStr,
                };
              });
            }
            const prevAppr = p.sequence.map((s) => s.appr);
            p.sequence = buildFullSequence(p, 'Warm & Catchy', 'Standard', SETTINGS).map((s, idx) => ({
              ...s,
              appr: Boolean(prevAppr[idx]),
            }));
            enrichProspectWithMultiAgentOKFICM(p, SETTINGS);
          });
          savePersistedState();
        } else {
          Object.values(PROSPECTS_DB).forEach((p) => {
            if (!p.okf || !p.icm || !p.agentTrace || p.agentTrace.length < 6 || !p.agentTrace[0]?.details) {
              enrichProspectWithMultiAgentOKFICM(p, SETTINGS);
            }
          });
        }
      }
    } else {
      savePersistedState();
    }
  } catch (err) {
    console.warn('Could not load persisted DB, using default state:', err);
  }
}

export function savePersistedState(): void {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    const payload: PersistedState = {
      prospects: PROSPECTS_DB,
      settings: SETTINGS,
      copyEngineVersion: CURRENT_COPY_ENGINE_VERSION,
    };
    fs.writeFileSync(DB_FILE, JSON.stringify(payload, null, 2), 'utf-8');
  } catch (err) {
    console.warn('Failed to write persisted DB:', err);
  }
}
