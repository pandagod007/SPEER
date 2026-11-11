import path from 'path';
import os from 'os';
import dotenv from 'dotenv';
import express from 'express';
import cors from 'cors';
import {
  buildFullSequence,
  buildStepContent,
  generateFullSequenceWithAI,
  generateSingleStepWithAI,
} from './generator';
import { getUserData, saveUserData, loadPersistedState } from './storage';
import {
  runLiveProspectResearch,
  scrapeOfferingsFromSellerDomain,
  discoverMoreSignalsForProspect,
} from './researcher';
import { enrichProspectWithMultiAgentOKFICM } from './okf_icm';
import { Prospect, Tone, Length, Channel } from './types';

// Load credentials from ~/.env and local .env if present
dotenv.config({ path: path.join(os.homedir(), '.env') });
dotenv.config({ path: path.join(__dirname, '..', '.env') });
dotenv.config({ path: path.join(__dirname, '..', '..', '.env') });

loadPersistedState();

const app = express();
const PORT = process.env.PORT || 4000;

app.use(cors());
app.use(express.json());

function getUserCtx(req: express.Request) {
  const userId =
    (req.headers['x-user-id'] as string) ||
    (req.query.userId as string) ||
    'default';
  const data = getUserData(userId);
  return {
    userId,
    prospects: data.prospects,
    settings: data.settings,
    save: () => saveUserData(userId, data.prospects, data.settings),
  };
}

function updateOutreachStatus(p: Prospect) {
  const apprCount = p.sequence.filter((s) => s.appr).length;
  if (apprCount === p.sequence.length && p.sequence.length > 0) {
    p.outreach = 'Approved';
    p.status = 'Completed';
  } else if (apprCount > 0) {
    p.outreach = `Draft (${apprCount}/${p.sequence.length})`;
  } else {
    p.outreach = 'Draft';
  }
}

// Health check + AI status
app.get('/api/health', (_req, res) => {
  res.json({
    status: 'ok',
    service: 'prospect-iq-backend',
    geminiConfigured: Boolean(process.env.GEMINI_API_KEY),
    liveScrapingEnabled: true,
    googleNewsRssEnabled: true,
  });
});

function getProspectTimestamp(p: Prospect): number {
  if (p.id && p.id.startsWith('p_')) {
    const ts = parseInt(p.id.replace('p_', ''), 10);
    if (!isNaN(ts)) return ts;
  }
  if (p.date) {
    const cleaned = p.date.replace(/^Live\s*·\s*/i, '').trim();
    const parsed = Date.parse(cleaned);
    if (!isNaN(parsed)) return parsed;
  }
  return 0;
}

// Get all prospects + dashboard metrics
app.get('/api/prospects', (req, res) => {
  const { prospects } = getUserCtx(req);
  const list = Object.values(prospects).sort(
    (a, b) => getProspectTimestamp(b) - getProspectTimestamp(a)
  );
  const companiesCount = list.length;
  const signalsCount = list.reduce((acc, p) => acc + p.signals.length, 0);
  let stepsCount = 0;
  let approvedStepsCount = 0;
  list.forEach((p) => {
    p.sequence.forEach((s) => {
      stepsCount++;
      if (s.appr) approvedStepsCount++;
    });
  });

  res.json({
    prospects: list,
    geminiConfigured: Boolean(process.env.GEMINI_API_KEY),
    metrics: {
      companiesCount,
      signalsCount,
      stepsCount,
      approvedStepsCount,
    },
  });
});

// Get single prospect by ID
app.get('/api/prospects/:id', (req, res) => {
  const { prospects } = getUserCtx(req);
  const p = prospects[req.params.id];
  if (!p) return res.status(404).json({ error: 'Prospect not found' });
  res.json(p);
});

// LIVE RESEARCH: Create & research a new prospect online
app.post('/api/prospects', async (req, res) => {
  try {
    const { prospects, settings, save } = getUserCtx(req);
    const {
      name = 'Stripe',
      domain = 'stripe.com',
      ind = 'Fintech & Payments',
      loc = 'San Francisco, USA',
      contactName = 'David Singleton',
      contactRole = 'CTO',
      contactLi = 'linkedin.com/in/davidsingleton',
    } = req.body;

    const fullProspect = await runLiveProspectResearch({
      name,
      domain,
      ind,
      loc,
      contactName,
      contactRole,
      contactLi,
      settings,
    });

    prospects[fullProspect.id] = fullProspect;
    save();

    res.status(201).json(fullProspect);
  } catch (err) {
    console.error('Error researching prospect:', err);
    res.status(500).json({ error: 'Failed to complete live prospect research' });
  }
});

// LIVE STREAMING RESEARCH: Streams stage-by-stage execution (NDJSON) as each stage runs
app.post('/api/prospects/stream', async (req, res) => {
  res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  const sendEvent = (payload: Record<string, unknown>) => {
    res.write(JSON.stringify(payload) + '\n');
  };

  try {
    const { prospects, settings, save } = getUserCtx(req);
    const {
      name = 'Stripe',
      domain = 'stripe.com',
      ind = 'Fintech & Payments',
      loc = 'San Francisco, USA',
      contactName = 'David Singleton',
      contactRole = 'CTO',
      contactLi = 'linkedin.com/in/davidsingleton',
    } = req.body;

    const fullProspect = await runLiveProspectResearch(
      {
        name,
        domain,
        ind,
        loc,
        contactName,
        contactRole,
        contactLi,
        settings,
      },
      (ev) => {
        sendEvent(ev as unknown as Record<string, unknown>);
      }
    );

    prospects[fullProspect.id] = fullProspect;
    save();

    sendEvent({ type: 'complete', prospect: fullProspect });
    res.end();
  } catch (err) {
    console.error('Error in streaming prospect research:', err);
    sendEvent({ type: 'error', error: 'Failed to complete live prospect research' });
    res.end();
  }
});

// LIVE REFRESH: Re-run live online research for an existing prospect
app.post('/api/prospects/:id/refresh', async (req, res) => {
  try {
    const { prospects, settings, save } = getUserCtx(req);
    const existing = prospects[req.params.id];
    if (!existing) return res.status(404).json({ error: 'Prospect not found' });

    const primaryPerson = existing.people[existing.contactIdx] || existing.people[0];
    const refreshed = await runLiveProspectResearch({
      id: existing.id,
      name: existing.name,
      domain: existing.domain,
      ind: existing.ind,
      loc: existing.loc,
      contactName: primaryPerson?.name || 'Executive Contact',
      contactRole: primaryPerson?.role || 'CTO',
      contactLi: primaryPerson?.li,
      settings,
    });

    if (existing.people.length > refreshed.people.length) {
      const existingNames = new Set(refreshed.people.map((p) => p.name.toLowerCase()));
      existing.people.forEach((p) => {
        if (!existingNames.has(p.name.toLowerCase())) {
          refreshed.people.push(p);
        }
      });
    }

    prospects[existing.id] = refreshed;
    save();
    res.json(refreshed);
  } catch (err) {
    console.error('Error refreshing prospect:', err);
    res.status(500).json({ error: 'Failed to refresh prospect online' });
  }
});

// LIVE STREAMING REFRESH: Re-run live online research with real-time stage streaming
app.post('/api/prospects/:id/refresh-stream', async (req, res) => {
  const { prospects, settings, save } = getUserCtx(req);
  const existing = prospects[req.params.id];
  if (!existing) return res.status(404).json({ error: 'Prospect not found' });

  res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  const sendEvent = (payload: Record<string, unknown>) => {
    res.write(JSON.stringify(payload) + '\n');
  };

  try {
    const primaryPerson = existing.people[existing.contactIdx] || existing.people[0];
    const refreshed = await runLiveProspectResearch(
      {
        id: existing.id,
        name: existing.name,
        domain: existing.domain,
        ind: existing.ind,
        loc: existing.loc,
        contactName: primaryPerson?.name || 'Executive Contact',
        contactRole: primaryPerson?.role || 'CTO',
        contactLi: primaryPerson?.li,
        settings,
      },
      (ev) => {
        sendEvent(ev as unknown as Record<string, unknown>);
      }
    );

    if (existing.people.length > refreshed.people.length) {
      const existingNames = new Set(refreshed.people.map((p) => p.name.toLowerCase()));
      existing.people.forEach((p) => {
        if (!existingNames.has(p.name.toLowerCase())) {
          refreshed.people.push(p);
        }
      });
    }

    prospects[existing.id] = refreshed;
    save();

    sendEvent({ type: 'complete', prospect: refreshed });
    res.end();
  } catch (err) {
    console.error('Error in streaming refresh:', err);
    sendEvent({ type: 'error', error: 'Failed to refresh prospect online' });
    res.end();
  }
});

// LIVE DISCOVER MORE SIGNALS: Fetch & synthesize +3 new unique signals for a prospect
app.post('/api/prospects/:id/signals/more', async (req, res) => {
  try {
    const { prospects, settings, save } = getUserCtx(req);
    const p = prospects[req.params.id];
    if (!p) return res.status(404).json({ error: 'Prospect not found' });

    const newSignals = await discoverMoreSignalsForProspect(p, settings, 3);
    if (newSignals.length > 0) {
      p.signals.push(...newSignals);
      // Auto-select newly discovered High-relevance signals
      newSignals.forEach((s) => {
        if (s.r === 'High' && !p.sel.includes(s.id)) {
          p.sel.push(s.id);
        }
      });
      enrichProspectWithMultiAgentOKFICM(p, settings);
      save();
    }

    res.json({
      prospect: p,
      addedCount: newSignals.length,
    });
  } catch (err) {
    console.error('Error discovering more signals:', err);
    res.status(500).json({ error: 'Failed to discover more signals' });
  }
});

// Update selected signals, angle, or primary contact
app.patch('/api/prospects/:id', async (req, res) => {
  const { prospects, settings, save } = getUserCtx(req);
  const p = prospects[req.params.id];
  if (!p) return res.status(404).json({ error: 'Prospect not found' });

  const { sel, ang, custom, contactIdx, regenerateSequence, tone, len } = req.body;
  if (Array.isArray(sel)) p.sel = sel;
  if (ang !== undefined) p.ang = ang;
  if (typeof custom === 'string') p.custom = custom;
  if (typeof contactIdx === 'number') p.contactIdx = contactIdx;

  if (regenerateSequence) {
    p.sequence = await generateFullSequenceWithAI(
      p,
      (tone as Tone) || 'Warm & Catchy',
      (len as Length) || 'Standard',
      settings
    );
    updateOutreachStatus(p);
  }

  enrichProspectWithMultiAgentOKFICM(p, settings);
  save();
  res.json(p);
});

// Export standalone OKF JSON-LD + ICM bundle for a prospect
app.get('/api/prospects/:id/okf', (req, res) => {
  const { prospects, settings } = getUserCtx(req);
  const p = prospects[req.params.id];
  if (!p) return res.status(404).json({ error: 'Prospect not found' });
  if (!p.okf || !p.icm) {
    enrichProspectWithMultiAgentOKFICM(p, settings);
  }
  res.json({
    okf: p.okf,
    icm: p.icm,
    agentTrace: p.agentTrace,
  });
});

// Add a new decision-maker contact to a prospect
app.post('/api/prospects/:id/people', async (req, res) => {
  const { prospects, settings, save } = getUserCtx(req);
  const p = prospects[req.params.id];
  if (!p) return res.status(404).json({ error: 'Prospect not found' });

  const { name, role = 'Decision Maker', dept = 'Leadership', bio, li } = req.body;
  if (!name) return res.status(400).json({ error: 'Name is required' });

  p.people.push({
    name,
    role,
    dept,
    bio: bio || `Added to ${p.name} buying committee.`,
    li: li || `linkedin.com/in/${name.toLowerCase().replace(/\s+/g, '-')}`,
  });
  p.contactIdx = p.people.length - 1;
  p.sequence = await generateFullSequenceWithAI(p, 'Warm & Catchy', 'Standard', settings);
  updateOutreachStatus(p);

  save();
  res.status(201).json(p);
});

// Update or regenerate a specific sequence step
app.patch('/api/prospects/:id/sequence/:stepIdx', async (req, res) => {
  const { prospects, settings, save } = getUserCtx(req);
  const p = prospects[req.params.id];
  if (!p) return res.status(404).json({ error: 'Prospect not found' });

  const idx = parseInt(req.params.stepIdx, 10);
  const step = p.sequence[idx];
  if (!step) return res.status(404).json({ error: 'Sequence step not found' });

  const { subj, body, ch, appr, regenerate, tone, len } = req.body;

  if (regenerate) {
    const targetCh = (ch as Channel) || step.ch;
    p.sequence[idx] = await generateSingleStepWithAI(
      p,
      idx,
      (tone as Tone) || 'Warm & Catchy',
      (len as Length) || 'Standard',
      settings,
      targetCh
    );
  } else {
    if (typeof subj === 'string') {
      step.subj = subj;
      step.appr = false;
    }
    if (typeof body === 'string') {
      step.body = body;
      step.appr = false;
    }
    if (ch) {
      step.ch = ch;
      step.appr = false;
    }
    if (typeof appr === 'boolean') {
      step.appr = appr;
    }
  }

  updateOutreachStatus(p);
  save();
  res.json(p);
});

// Approve entire sequence for a prospect
app.post('/api/prospects/:id/sequence/approve-all', (req, res) => {
  const { prospects, save } = getUserCtx(req);
  const p = prospects[req.params.id];
  if (!p) return res.status(404).json({ error: 'Prospect not found' });

  p.sequence.forEach((s) => (s.appr = true));
  updateOutreachStatus(p);
  save();
  res.json(p);
});

// Add an extra follow-up touchpoint step to a prospect's sequence
app.post('/api/prospects/:id/sequence/add-step', (req, res) => {
  const { prospects, settings, save } = getUserCtx(req);
  const p = prospects[req.params.id];
  if (!p) return res.status(404).json({ error: 'Prospect not found' });

  const num = p.sequence.length + 1;
  const day = `Day ${num * 3 + 1}`;
  const person = p.people[p.contactIdx] || p.people[0];
  const extraStep = buildStepContent(p, 1, 'Warm & Catchy', 'Standard', settings, 'LinkedIn');

  p.sequence.push({
    step: num,
    day,
    label: `Follow-up #${num - 1}`,
    ch: 'LinkedIn',
    goal: 'Warm check-in & architecture benchmark share',
    subj: extraStep.subj || `Solving ${p.name}'s scaling bottlenecks with ${settings.companyName}`,
    body: extraStep.body,
    appr: false,
  });

  updateOutreachStatus(p);
  save();
  res.status(201).json(p);
});

// Get & update company settings
app.get('/api/settings', (req, res) => {
  const { settings } = getUserCtx(req);
  res.json(settings);
});

app.put('/api/settings', (req, res) => {
  const { settings, save } = getUserCtx(req);
  const { companyName, domain, category, description, senderName, offerings } = req.body;
  if (companyName) settings.companyName = companyName;
  if (domain) settings.domain = domain;
  if (category) settings.category = category;
  if (description) settings.description = description;
  if (senderName) settings.senderName = senderName;
  if (Array.isArray(offerings)) settings.offerings = offerings;
  save();
  res.json(settings);
});

// LIVE OFFERINGS SCRAPER: Scrape seller's actual website to import offerings
app.post('/api/settings/import-website', async (req, res) => {
  try {
    const { settings, save } = getUserCtx(req);
    const targetDomain = req.body.domain || settings.domain;
    const scraped = await scrapeOfferingsFromSellerDomain(targetDomain);
    if (scraped.description) {
      settings.description = scraped.description;
    }
    if (scraped.offerings.length > 0) {
      settings.offerings = scraped.offerings;
    }
    save();
    res.json({
      settings,
      importedCount: scraped.offerings.length,
    });
  } catch (err) {
    console.error('Error importing website offerings:', err);
    res.status(500).json({ error: 'Could not scrape website offerings' });
  }
});

app.listen(PORT, () => {
  console.log(`Speer Backend (LIVE Research Engine) running on http://localhost:${PORT}`);
});
