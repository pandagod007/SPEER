import { NextRequest, NextResponse } from 'next/server';
import {
  buildStepContent,
  generateFullSequenceWithAI,
  generateSingleStepWithAI,
  generateSignalBullets,
  generateSignalBulletsWithGemini,
} from '@/lib/backend/generator';
import { getUserData, saveUserData } from '@/lib/backend/storage';
import {
  runLiveProspectResearch,
  scrapeOfferingsFromSellerDomain,
  discoverMoreSignalsForProspect,
} from '@/lib/backend/researcher';
import { enrichProspectWithMultiAgentOKFICM } from '@/lib/backend/okf_icm';
import { Prospect, Tone, Length, Channel } from '@/lib/backend/types';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

type RouteContext = {
  params: { path?: string[] };
};

function getUserCtx(req: NextRequest) {
  const userId =
    req.headers.get('x-user-id') ||
    req.nextUrl.searchParams.get('userId') ||
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

function ensureSignalBullets(p: Prospect, settings: ReturnType<typeof getUserCtx>['settings']): boolean {
  let mutated = false;
  p.signals.forEach((s) => {
    if (!s.bullets || s.bullets.length !== 5) {
      s.bullets = generateSignalBullets(s, p, settings);
      mutated = true;
    }
  });
  return mutated;
}

function createNdjsonStream(
  runner: (sendEvent: (payload: Record<string, unknown>) => void) => Promise<void>
): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const sendEvent = (payload: Record<string, unknown>) => {
        controller.enqueue(encoder.encode(JSON.stringify(payload) + '\n'));
      };
      try {
        await runner(sendEvent);
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'application/x-ndjson; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      'X-Accel-Buffering': 'no',
    },
  });
}

async function parseJsonBody(req: NextRequest): Promise<Record<string, unknown>> {
  try {
    return (await req.json()) as Record<string, unknown>;
  } catch {
    return {};
  }
}

export async function GET(req: NextRequest, context: RouteContext) {
  const segments = context.params.path || [];

  // GET /api/health
  if (segments.length === 1 && segments[0] === 'health') {
    return NextResponse.json({
      status: 'ok',
      service: 'prospect-iq-backend',
      geminiConfigured: Boolean(process.env.GEMINI_API_KEY),
      liveScrapingEnabled: true,
      googleNewsRssEnabled: true,
    });
  }

  // GET /api/prospects
  if (segments.length === 1 && segments[0] === 'prospects') {
    const { prospects, settings, save } = getUserCtx(req);
    let mutated = false;
    const list = Object.values(prospects)
      .map((p) => {
        if (ensureSignalBullets(p, settings)) mutated = true;
        return p;
      })
      .sort((a, b) => getProspectTimestamp(b) - getProspectTimestamp(a));
    if (mutated) save();

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

    return NextResponse.json({
      prospects: list,
      geminiConfigured: Boolean(process.env.GEMINI_API_KEY),
      metrics: {
        companiesCount,
        signalsCount,
        stepsCount,
        approvedStepsCount,
      },
    });
  }

  // GET /api/prospects/:id
  if (segments.length === 2 && segments[0] === 'prospects') {
    const { prospects, settings, save } = getUserCtx(req);
    const p = prospects[segments[1]];
    if (!p) return NextResponse.json({ error: 'Prospect not found' }, { status: 404 });
    if (ensureSignalBullets(p, settings)) save();
    return NextResponse.json(p);
  }

  // GET /api/prospects/:id/okf
  if (segments.length === 3 && segments[0] === 'prospects' && segments[2] === 'okf') {
    const { prospects, settings } = getUserCtx(req);
    const p = prospects[segments[1]];
    if (!p) return NextResponse.json({ error: 'Prospect not found' }, { status: 404 });
    if (!p.okf || !p.icm) {
      enrichProspectWithMultiAgentOKFICM(p, settings);
    }
    return NextResponse.json({
      okf: p.okf,
      icm: p.icm,
      agentTrace: p.agentTrace,
    });
  }

  // GET /api/settings
  if (segments.length === 1 && segments[0] === 'settings') {
    const { settings } = getUserCtx(req);
    return NextResponse.json(settings);
  }

  return NextResponse.json({ error: 'Not found' }, { status: 404 });
}

export async function POST(req: NextRequest, context: RouteContext) {
  const segments = context.params.path || [];
  const body = await parseJsonBody(req);

  // POST /api/prospects
  if (segments.length === 1 && segments[0] === 'prospects') {
    try {
      const { prospects, settings, save } = getUserCtx(req);
      const fullProspect = await runLiveProspectResearch({
        name: (body.name as string) || 'Stripe',
        domain: (body.domain as string) || 'stripe.com',
        ind: (body.ind as string) || 'Fintech & Payments',
        loc: (body.loc as string) || 'San Francisco, USA',
        contactName: (body.contactName as string) || 'David Singleton',
        contactRole: (body.contactRole as string) || 'CTO',
        contactLi: (body.contactLi as string) || 'linkedin.com/in/davidsingleton',
        settings,
      });

      prospects[fullProspect.id] = fullProspect;
      save();
      return NextResponse.json(fullProspect, { status: 201 });
    } catch (err) {
      console.error('Error researching prospect:', err);
      return NextResponse.json({ error: 'Failed to complete live prospect research' }, { status: 500 });
    }
  }

  // POST /api/prospects/stream
  if (segments.length === 2 && segments[0] === 'prospects' && segments[1] === 'stream') {
    return createNdjsonStream(async (sendEvent) => {
      try {
        const { prospects, settings, save } = getUserCtx(req);
        const fullProspect = await runLiveProspectResearch(
          {
            name: (body.name as string) || 'Stripe',
            domain: (body.domain as string) || 'stripe.com',
            ind: (body.ind as string) || 'Fintech & Payments',
            loc: (body.loc as string) || 'San Francisco, USA',
            contactName: (body.contactName as string) || 'David Singleton',
            contactRole: (body.contactRole as string) || 'CTO',
            contactLi: (body.contactLi as string) || 'linkedin.com/in/davidsingleton',
            settings,
          },
          (ev) => {
            sendEvent(ev as unknown as Record<string, unknown>);
          }
        );

        prospects[fullProspect.id] = fullProspect;
        save();
        sendEvent({ type: 'complete', prospect: fullProspect });
      } catch (err) {
        console.error('Error in streaming prospect research:', err);
        sendEvent({ type: 'error', error: 'Failed to complete live prospect research' });
      }
    });
  }

  // POST /api/prospects/:id/refresh
  if (segments.length === 3 && segments[0] === 'prospects' && segments[2] === 'refresh') {
    try {
      const { prospects, settings, save } = getUserCtx(req);
      const existing = prospects[segments[1]];
      if (!existing) return NextResponse.json({ error: 'Prospect not found' }, { status: 404 });

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
      return NextResponse.json(refreshed);
    } catch (err) {
      console.error('Error refreshing prospect:', err);
      return NextResponse.json({ error: 'Failed to refresh prospect online' }, { status: 500 });
    }
  }

  // POST /api/prospects/:id/refresh-stream
  if (segments.length === 3 && segments[0] === 'prospects' && segments[2] === 'refresh-stream') {
    const { prospects, settings, save } = getUserCtx(req);
    const existing = prospects[segments[1]];
    if (!existing) return NextResponse.json({ error: 'Prospect not found' }, { status: 404 });

    return createNdjsonStream(async (sendEvent) => {
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
      } catch (err) {
        console.error('Error in streaming refresh:', err);
        sendEvent({ type: 'error', error: 'Failed to refresh prospect online' });
      }
    });
  }

  // POST /api/prospects/:id/signals/more
  if (
    segments.length === 4 &&
    segments[0] === 'prospects' &&
    segments[2] === 'signals' &&
    segments[3] === 'more'
  ) {
    try {
      const { prospects, settings, save } = getUserCtx(req);
      const p = prospects[segments[1]];
      if (!p) return NextResponse.json({ error: 'Prospect not found' }, { status: 404 });

      const newSignals = await discoverMoreSignalsForProspect(p, settings, 3);
      if (newSignals.length > 0) {
        for (const s of newSignals) {
          if (!s.bullets || s.bullets.length !== 5) {
            s.bullets = generateSignalBullets(s, p, settings);
          }
        }
        p.signals.push(...newSignals);
        newSignals.forEach((s) => {
          if (s.r === 'High' && !p.sel.includes(s.id)) {
            p.sel.push(s.id);
          }
        });
        enrichProspectWithMultiAgentOKFICM(p, settings);
        save();
      }

      return NextResponse.json({
        prospect: p,
        addedCount: newSignals.length,
      });
    } catch (err) {
      console.error('Error discovering more signals:', err);
      return NextResponse.json({ error: 'Failed to discover more signals' }, { status: 500 });
    }
  }

  // POST /api/prospects/:id/signals/:sigId/bullets
  if (
    segments.length === 5 &&
    segments[0] === 'prospects' &&
    segments[2] === 'signals' &&
    segments[4] === 'bullets'
  ) {
    try {
      const { prospects, settings, save } = getUserCtx(req);
      const p = prospects[segments[1]];
      if (!p) return NextResponse.json({ error: 'Prospect not found' }, { status: 404 });

      const sigId = parseInt(segments[3], 10);
      const sig = p.signals.find((s) => s.id === sigId);
      if (!sig) return NextResponse.json({ error: 'Signal not found' }, { status: 404 });

      const bullets = await generateSignalBulletsWithGemini(sig, p, settings);
      sig.bullets = bullets;
      save();

      return NextResponse.json({ sigId, bullets, prospect: p });
    } catch (err) {
      console.error('Error generating signal bullets:', err);
      return NextResponse.json({ error: 'Failed to generate bullets for signal' }, { status: 500 });
    }
  }

  // POST /api/prospects/:id/people
  if (segments.length === 3 && segments[0] === 'prospects' && segments[2] === 'people') {
    const { prospects, settings, save } = getUserCtx(req);
    const p = prospects[segments[1]];
    if (!p) return NextResponse.json({ error: 'Prospect not found' }, { status: 404 });

    const name = body.name as string | undefined;
    if (!name) return NextResponse.json({ error: 'Name is required' }, { status: 400 });

    const role = (body.role as string) || 'Decision Maker';
    const dept = (body.dept as string) || 'Leadership';
    const bio = body.bio as string | undefined;
    const li = body.li as string | undefined;

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
    return NextResponse.json(p, { status: 201 });
  }

  // POST /api/prospects/:id/sequence/approve-all
  if (
    segments.length === 4 &&
    segments[0] === 'prospects' &&
    segments[2] === 'sequence' &&
    segments[3] === 'approve-all'
  ) {
    const { prospects, save } = getUserCtx(req);
    const p = prospects[segments[1]];
    if (!p) return NextResponse.json({ error: 'Prospect not found' }, { status: 404 });

    p.sequence.forEach((s) => (s.appr = true));
    updateOutreachStatus(p);
    save();
    return NextResponse.json(p);
  }

  // POST /api/prospects/:id/sequence/add-step
  if (
    segments.length === 4 &&
    segments[0] === 'prospects' &&
    segments[2] === 'sequence' &&
    segments[3] === 'add-step'
  ) {
    const { prospects, settings, save } = getUserCtx(req);
    const p = prospects[segments[1]];
    if (!p) return NextResponse.json({ error: 'Prospect not found' }, { status: 404 });

    const num = p.sequence.length + 1;
    const day = `Day ${num * 3 + 1}`;
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
    return NextResponse.json(p, { status: 201 });
  }

  // POST /api/settings/import-website
  if (segments.length === 2 && segments[0] === 'settings' && segments[1] === 'import-website') {
    try {
      const { settings, save } = getUserCtx(req);
      const targetDomain = (body.domain as string) || settings.domain;
      const scraped = await scrapeOfferingsFromSellerDomain(targetDomain);
      if (scraped.description) {
        settings.description = scraped.description;
      }
      if (scraped.offerings.length > 0) {
        settings.offerings = scraped.offerings;
      }
      save();
      return NextResponse.json({
        settings,
        importedCount: scraped.offerings.length,
      });
    } catch (err) {
      console.error('Error importing website offerings:', err);
      return NextResponse.json({ error: 'Could not scrape website offerings' }, { status: 500 });
    }
  }

  return NextResponse.json({ error: 'Not found' }, { status: 404 });
}

export async function PATCH(req: NextRequest, context: RouteContext) {
  const segments = context.params.path || [];
  const body = await parseJsonBody(req);

  // PATCH /api/prospects/:id
  if (segments.length === 2 && segments[0] === 'prospects') {
    const { prospects, settings, save } = getUserCtx(req);
    const p = prospects[segments[1]];
    if (!p) return NextResponse.json({ error: 'Prospect not found' }, { status: 404 });

    if (Array.isArray(body.sel)) p.sel = body.sel as number[];
    if (body.ang !== undefined) p.ang = body.ang as Prospect['ang'];
    if (typeof body.custom === 'string') p.custom = body.custom;
    if (typeof body.contactIdx === 'number') p.contactIdx = body.contactIdx;

    if (body.regenerateSequence) {
      p.sequence = await generateFullSequenceWithAI(
        p,
        (body.tone as Tone) || 'Warm & Catchy',
        (body.len as Length) || 'Standard',
        settings
      );
      updateOutreachStatus(p);
    }

    enrichProspectWithMultiAgentOKFICM(p, settings);
    save();
    return NextResponse.json(p);
  }

  // PATCH /api/prospects/:id/sequence/:stepIdx
  if (segments.length === 4 && segments[0] === 'prospects' && segments[2] === 'sequence') {
    const { prospects, settings, save } = getUserCtx(req);
    const p = prospects[segments[1]];
    if (!p) return NextResponse.json({ error: 'Prospect not found' }, { status: 404 });

    const idx = parseInt(segments[3], 10);
    const step = p.sequence[idx];
    if (!step) return NextResponse.json({ error: 'Sequence step not found' }, { status: 404 });

    if (body.regenerate) {
      const targetCh = (body.ch as Channel) || step.ch;
      p.sequence[idx] = await generateSingleStepWithAI(
        p,
        idx,
        (body.tone as Tone) || 'Warm & Catchy',
        (body.len as Length) || 'Standard',
        settings,
        targetCh
      );
    } else {
      if (typeof body.subj === 'string') {
        step.subj = body.subj;
        step.appr = false;
      }
      if (typeof body.body === 'string') {
        step.body = body.body;
        step.appr = false;
      }
      if (body.ch) {
        step.ch = body.ch as Channel;
        step.appr = false;
      }
      if (typeof body.appr === 'boolean') {
        step.appr = body.appr;
      }
    }

    updateOutreachStatus(p);
    save();
    return NextResponse.json(p);
  }

  return NextResponse.json({ error: 'Not found' }, { status: 404 });
}

export async function PUT(req: NextRequest, context: RouteContext) {
  const segments = context.params.path || [];
  const body = await parseJsonBody(req);

  // PUT /api/settings
  if (segments.length === 1 && segments[0] === 'settings') {
    const { settings, save } = getUserCtx(req);
    if (body.companyName !== undefined) settings.companyName = body.companyName as string;
    if (body.domain !== undefined) settings.domain = body.domain as string;
    if (body.category !== undefined) settings.category = body.category as string;
    if (body.description !== undefined) settings.description = body.description as string;
    if (body.senderName !== undefined) settings.senderName = body.senderName as string;
    if (Array.isArray(body.offerings)) settings.offerings = body.offerings as typeof settings.offerings;
    if (typeof body.profileCompleted === 'boolean') settings.profileCompleted = body.profileCompleted;
    save();
    return NextResponse.json(settings);
  }

  return NextResponse.json({ error: 'Not found' }, { status: 404 });
}
