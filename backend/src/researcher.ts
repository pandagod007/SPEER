import * as cheerio from 'cheerio';
import { Prospect, Signal, Angle, Person, CompanySettings, Offering } from './types';
import { buildFullSequence, generateFullSequenceWithAI } from './generator';
import { enrichProspectWithMultiAgentOKFICM } from './okf_icm';

export interface ScrapedSiteInfo {
  title: string;
  description: string;
  headings: string[];
  paragraphs: string[];
  reachable: boolean;
}

export interface LiveNewsItem {
  title: string;
  source: string;
  pubDate: string;
  link: string;
}

function normalizeUrl(domainOrUrl: string): string {
  const trimmed = domainOrUrl.trim();
  if (!trimmed) return '';
  if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
    return trimmed;
  }
  return `https://${trimmed}`;
}

export async function scrapeCompanyWebsite(domainOrUrl: string): Promise<ScrapedSiteInfo> {
  const url = normalizeUrl(domainOrUrl);
  if (!url) {
    return { title: '', description: '', headings: [], paragraphs: [], reachable: false };
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 7000);
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        Accept: 'text/html,application/xhtml+xml',
      },
    });
    clearTimeout(timeout);

    if (!res.ok) {
      return { title: '', description: '', headings: [], paragraphs: [], reachable: false };
    }

    const html = await res.text();
    const $ = cheerio.load(html);

    $('script, style, noscript, svg, nav, footer').remove();

    const title = ($('title').first().text() || $('meta[property="og:title"]').attr('content') || '').trim();
    const description = (
      $('meta[name="description"]').attr('content') ||
      $('meta[property="og:description"]').attr('content') ||
      ''
    ).trim();

    const headings: string[] = [];
    $('h1, h2, h3').each((_, el) => {
      const txt = $(el).text().replace(/\s+/g, ' ').trim();
      if (txt.length > 5 && txt.length < 160 && headings.length < 12 && !headings.includes(txt)) {
        headings.push(txt);
      }
    });

    const paragraphs: string[] = [];
    $('p').each((_, el) => {
      const txt = $(el).text().replace(/\s+/g, ' ').trim();
      if (txt.length > 40 && txt.length < 400 && paragraphs.length < 10 && !paragraphs.includes(txt)) {
        paragraphs.push(txt);
      }
    });

    return {
      title,
      description,
      headings,
      paragraphs,
      reachable: true,
    };
  } catch {
    return { title: '', description: '', headings: [], paragraphs: [], reachable: false };
  }
}

export async function fetchGoogleNewsRSS(companyName: string, limit = 15, extraQuery = ''): Promise<LiveNewsItem[]> {
  try {
    const b2bFilter = extraQuery || 'AI OR technology OR expansion OR hiring OR appointed OR launch OR acquisition OR funding OR platform OR enterprise';
    const queryStr = `"${companyName}" (${b2bFilter}) when:365d`;
    const q = encodeURIComponent(queryStr);
    const rssUrl = `https://news.google.com/rss/search?q=${q}&hl=en-US&gl=US&ceid=US:en`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 7000);
    const res = await fetch(rssUrl, { signal: controller.signal });
    clearTimeout(timeout);

    if (!res.ok) return [];
    const xml = await res.text();
    const $ = cheerio.load(xml, { xmlMode: true });

    const noiseSourceRegex = /(athletics|bengals|nfl|nba|mlb|nhl|ncaa|high school|varsity|recipe|horoscope|obituar)/i;
    const noiseTitleRegex = /(candy stripe|stripe the jungle|tiger stripe|zebra stripe|pin stripe|racing stripe|stars and stripes)/i;

    const items: LiveNewsItem[] = [];
    $('item').each((_, el) => {
      if (items.length >= limit) return;
      const rawTitle = $(el).find('title').text().trim();
      const source = $(el).find('source').text().trim() || 'Google News';
      const pubDateRaw = $(el).find('pubDate').text().trim();
      const link = $(el).find('link').text().trim();

      // Strip trailing " - Source Name" from Google News title
      const cleanTitle = rawTitle.replace(/\s+-\s+[^-]+$/, '').trim();
      if (noiseSourceRegex.test(source) || noiseTitleRegex.test(cleanTitle)) {
        return;
      }

      let formattedDate = 'Recent';
      if (pubDateRaw) {
        const dt = new Date(pubDateRaw);
        if (!isNaN(dt.getTime())) {
          formattedDate = dt.toLocaleDateString('en-GB', {
            day: '2-digit',
            month: 'short',
            year: 'numeric',
          });
        }
      }

      if (cleanTitle) {
        items.push({ title: cleanTitle, source, pubDate: formattedDate, link });
      }
    });

    return items;
  } catch {
    return [];
  }
}

function categorizeHeadline(title: string): { cat: string; r: 'High' | 'Medium' | 'Low'; why: string } {
  const lower = title.toLowerCase();
  if (/(appoint|ceo|cto|cio|cfo|vp|chief|hire|executive|board|leader)/.test(lower)) {
    return {
      cat: 'Leadership',
      r: 'High',
      why: 'Executive and leadership changes frequently trigger strategic reviews and new vendor partnerships.',
    };
  }
  if (/(hiring|job|recruit|talent|workforce|engineer|team)/.test(lower)) {
    return {
      cat: 'Hiring',
      r: 'High',
      why: 'Active talent expansion signals budget commitment toward internal engineering and operational scale.',
    };
  }
  if (/(ai|cloud|platform|launch|product|software|digital|automati|data|tech|partner)/.test(lower)) {
    return {
      cat: 'Technology',
      r: 'High',
      why: 'Technology initiatives open an immediate window to align platform and workflow capabilities.',
    };
  }
  return {
    cat: 'Expansion',
    r: 'High',
    why: 'Growth, funding, or market expansion increases cross-site coordination and scalability requirements.',
  };
}

async function synthesizeWithGemini(
  params: {
    name: string;
    domain: string;
    ind: string;
    contactName: string;
    contactRole: string;
    contactLi: string;
    site: ScrapedSiteInfo;
    news: LiveNewsItem[];
    settings: CompanySettings;
  },
  apiKey: string
): Promise<{
  ind: string;
  loc: string;
  emp: string;
  summary: string;
  signals: Signal[];
  people: Person[];
  angles: Angle[];
} | null> {
  try {
    const prompt = `You are an elite B2B Prospect Intelligence analyst for "${params.settings.companyName}" (${params.settings.category}).
Company & Solutions Description: ${params.settings.description}

We are researching prospect company: "${params.name}" (Website: ${params.domain}, Industry hint: ${params.ind}).
Target Contact provided: "${params.contactName}" (${params.contactRole}, LinkedIn: ${params.contactLi}).

LIVE SCRAPED WEBSITE DATA FROM ${params.domain}:
- Title: ${params.site.title || 'N/A'}
- Meta Description: ${params.site.description || 'N/A'}
- Key Headings: ${params.site.headings.join(' | ') || 'N/A'}
- Key Paragraphs: ${params.site.paragraphs.slice(0, 5).join(' || ') || 'N/A'}

LIVE GOOGLE NEWS ARTICLES FOR "${params.name}":
${
  params.news.length
    ? params.news.map((n, i) => `${i + 1}. [${n.pubDate}] ${n.title} (Source: ${n.source})`).join('\n')
    : 'No recent RSS items; use grounded search knowledge and website context.'
}

Return ONLY a valid JSON object (no markdown fences) matching this exact structure:
{
  "ind": "Specific Industry Name",
  "loc": "Headquarters City, Country",
  "emp": "Employee range e.g. 1,000-5,000 employees",
  "summary": "2-3 sentence factual executive summary based on their live website and recent news.",
  "signals": [
    {
      "id": 0,
      "cat": "Expansion | Leadership | Technology | Hiring",
      "t": "Concise signal headline (max 65 chars)",
      "s": "1-2 sentence factual summary of the real signal or news item.",
      "r": "High",
      "why": "1 sentence explaining why this signal matters for our offerings.",
      "src": "Real publication name or '${params.domain}'",
      "d": "Published date e.g. 14 Oct 2026"
    }
  ],
  "people": [
    {
      "name": "${params.contactName}",
      "role": "${params.contactRole}",
      "dept": "Technology | Operations | Executive",
      "bio": "1-2 sentence contextual bio relevant to their role at ${params.name}.",
      "li": "${params.contactLi || 'linkedin.com/in/' + params.contactName.toLowerCase().replace(/\s+/g, '-')}"
    }
  ],
  "angles": [
    {
      "t": "Angle title (3-5 words)",
      "d": "1 sentence outreach hook description.",
      "sig": "Comma-separated signal titles used",
      "off": "Exact name of one of our offerings",
      "rcp": "Best recipient roles",
      "why": "1 sentence rationale"
    }
  ]
}
Ensure exactly 5 distinct, high-value signals (covering Leadership, Expansion, Technology, and Hiring), 2 to 3 people (with ${params.contactName} first), and 3 tailored outreach angles.`;

    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          responseMimeType: 'application/json',
          temperature: 0.2,
        },
      }),
    });

    if (!res.ok) return null;
    const data = await res.json();
    const rawText = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!rawText) return null;

    const cleaned = rawText.replace(/^```json\s*/i, '').replace(/```\s*$/i, '').trim();
    const parsed = JSON.parse(cleaned);
    if (!parsed || !Array.isArray(parsed.signals) || !Array.isArray(parsed.angles)) {
      return null;
    }

    parsed.signals = parsed.signals.map((s: Signal, idx: number) => ({
      ...s,
      id: idx,
      r: ['High', 'Medium', 'Low'].includes(s.r) ? s.r : 'High',
    }));

    return parsed;
  } catch (err) {
    console.warn('Gemini synthesis fallback triggered:', err);
    return null;
  }
}

export async function runLiveProspectResearch(params: {
  id?: string;
  name: string;
  domain: string;
  ind: string;
  loc?: string;
  contactName: string;
  contactRole: string;
  contactLi?: string;
  settings: CompanySettings;
}): Promise<Prospect> {
  const id = params.id || 'p_' + Date.now();
  const cleanDomain = params.domain
    .trim()
    .replace(/^https?:\/\//i, '')
    .replace(/\/.*$/, '');

  // 1. Run live website scraping & live Google News RSS fetch in parallel
  const [site, news] = await Promise.all([
    scrapeCompanyWebsite(cleanDomain),
    fetchGoogleNewsRSS(params.name),
  ]);

  const nowStr = new Date().toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });

  // 2. If GEMINI_API_KEY is available in environment, synthesize structured intelligence via Gemini
  const apiKey = process.env.GEMINI_API_KEY || '';
  if (apiKey) {
    const aiResult = await synthesizeWithGemini(
      {
        name: params.name,
        domain: cleanDomain,
        ind: params.ind,
        contactName: params.contactName,
        contactRole: params.contactRole,
        contactLi: params.contactLi || '',
        site,
        news,
        settings: params.settings,
      },
      apiKey
    );

    if (aiResult) {
      const base: Omit<Prospect, 'sequence'> = {
        id,
        name: params.name,
        domain: cleanDomain,
        ind: aiResult.ind || params.ind || 'Enterprise',
        loc: aiResult.loc || params.loc || 'Global',
        emp: aiResult.emp || '500–5,000 employees',
        date: `Live · ${nowStr}`,
        status: 'Completed',
        outreach: 'Draft',
        summary: aiResult.summary,
        sel: aiResult.signals.map((s) => s.id),
        ang: 0,
        custom: '',
        contactIdx: 0,
        people: aiResult.people,
        signals: aiResult.signals,
        angles: aiResult.angles,
      };
      const sequence = await generateFullSequenceWithAI(
        base,
        'Warm & Catchy',
        'Standard',
        params.settings
      );
      return enrichProspectWithMultiAgentOKFICM(
        { ...base, sequence },
        params.settings,
        `Scraped ${cleanDomain} (${site.headings.length} headings) & fetched ${news.length} Google News RSS items.`
      );
    }
  }

  // 3. Real-Data Live Extraction Pipeline (from live Google News RSS + live scraped website DOM)
  const signals: Signal[] = [];

  // Convert real Google News articles into verified signals
  news.slice(0, 4).forEach((item, idx) => {
    const meta = categorizeHeadline(item.title);
    signals.push({
      id: idx,
      cat: meta.cat,
      t: item.title.length > 78 ? item.title.slice(0, 75) + '…' : item.title,
      s: `Live news coverage from ${item.source}: "${item.title}".`,
      r: meta.r,
      why: meta.why,
      src: item.source,
      d: item.pubDate,
    });
  });

  // Add live website signal if scraped successfully
  if (site.reachable && (site.description || site.headings.length > 0)) {
    const hText = site.headings[0] || site.title || `${params.name} platform positioning`;
    signals.push({
      id: signals.length,
      cat: 'Technology',
      t: `Website focus: ${hText.slice(0, 62)}`,
      s:
        site.description ||
        site.paragraphs[0] ||
        `Extracted from live homepage at ${cleanDomain}: ${site.headings.slice(0, 3).join(' · ')}.`,
      r: 'High',
      why: `Direct positioning on ${cleanDomain} highlights current strategic and product priorities.`,
      src: `${cleanDomain} (Live HTML)`,
      d: nowStr,
    });
  }

  // Fallback signal if both RSS and site were blocked by firewall/Cloudflare
  if (signals.length === 0) {
    signals.push({
      id: 0,
      cat: 'Leadership',
      t: `${params.contactName} leading ${params.contactRole} agenda at ${params.name}`,
      s: `${params.contactName} oversees ${params.contactRole} initiatives as ${params.name} scales in ${params.ind}.`,
      r: 'High',
      why: 'Direct alignment with decision-maker mandate.',
      src: cleanDomain,
      d: nowStr,
    });
  }

  const liveSummary =
    site.reachable && (site.description || site.paragraphs[0])
      ? `${site.description || ''} ${site.paragraphs[0] || ''}`.trim()
      : news.length > 0
      ? `${params.name} (${cleanDomain}) is actively covered in recent ${params.ind} news, including "${news[0].title}" (${news[0].source}).`
      : `${params.name} (${cleanDomain}) operates in ${params.ind}, with ${params.contactName} serving as ${params.contactRole}.`;

  const off0 = params.settings.offerings[0]?.name || 'Enterprise AI platform';
  const off1 = params.settings.offerings[1]?.name || 'Workflow automation';
  const off2 = params.settings.offerings[2]?.name || 'Data pipeline toolkit';

  const cleanAnglePrefix = /\bAI\b/i.test(params.ind)
    ? `${params.name} platform & roadmap acceleration`
    : `${params.ind} AI & platform acceleration`;

  const angles: Angle[] = [
    {
      t: cleanAnglePrefix,
      d: `Align ${off0.toLowerCase()} with ${params.name}’s latest growth and product initiatives.`,
      sig: signals.slice(0, 2).map((s) => s.t).join(', '),
      off: off0,
      rcp: `${params.contactRole}, CTO, CIO`,
      why: `Directly connects live signals from ${signals[0]?.src} to ${params.contactName}’s remit.`,
    },
    {
      t: 'Operational workflow automation',
      d: `Help ${params.name} automate high-friction cross-team workflows as they scale.`,
      sig: signals.map((s) => s.t).slice(0, 2).join(', '),
      off: off1,
      rcp: `COO, VP Operations, ${params.contactRole}`,
      why: 'Reduces manual coordination overhead during expansion and product rollouts.',
    },
    {
      t: 'Unified data & analytics foundation',
      d: `Modernize real-time data pipelines across ${params.name}’s core systems.`,
      sig: signals[signals.length - 1]?.t || signals[0]?.t,
      off: off2,
      rcp: `Head of Data, ${params.contactRole}`,
      why: 'Provides a clean, low-risk technical entry point.',
    },
  ];

  const baseProspect: Omit<Prospect, 'sequence'> = {
    id,
    name: params.name,
    domain: cleanDomain,
    ind: params.ind || 'Enterprise Technology',
    loc: params.loc || 'Global',
    emp: 'Active Enterprise',
    date: `Live · ${nowStr}`,
    status: 'Completed',
    outreach: 'Draft',
    summary: liveSummary,
    sel: signals.map((s) => s.id),
    ang: 0,
    custom: '',
    contactIdx: 0,
    people: [
      {
        name: params.contactName,
        role: params.contactRole,
        dept: 'Technology & Strategy',
        bio: `Primary decision-maker at ${params.name} (${cleanDomain}).`,
        li:
          params.contactLi ||
          `linkedin.com/in/${params.contactName.toLowerCase().replace(/\s+/g, '-')}`,
      },
    ],
    signals,
    angles,
  };

  const sequence = await generateFullSequenceWithAI(
    baseProspect,
    'Warm & Catchy',
    'Standard',
    params.settings
  );
  return enrichProspectWithMultiAgentOKFICM(
    { ...baseProspect, sequence },
    params.settings,
    `Scraped ${cleanDomain} (${site.headings.length} headings) & fetched ${news.length} Google News RSS items.`
  );
}

export async function discoverMoreSignalsForProspect(
  p: Prospect,
  settings: CompanySettings,
  count = 3
): Promise<Signal[]> {
  const existingTitles = new Set(p.signals.map((s) => s.t.toLowerCase()));
  const nextStartId = p.signals.reduce((max, s) => Math.max(max, s.id), -1) + 1;
  const nowStr = new Date().toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });

  // Fetch a wider batch of Google News RSS items with strategic B2B keywords
  const [broadNews, strategicNews] = await Promise.all([
    fetchGoogleNewsRSS(p.name, 20),
    fetchGoogleNewsRSS(p.name, 15, 'AI OR expansion OR hiring OR partnership OR cloud OR leadership OR launch'),
  ]);

  const combinedNews = [...strategicNews, ...broadNews].filter(
    (item, idx, arr) =>
      arr.findIndex((x) => x.title.toLowerCase() === item.title.toLowerCase()) === idx &&
      !existingTitles.has(item.title.toLowerCase()) &&
      !Array.from(existingTitles).some((ex) => item.title.toLowerCase().includes(ex.slice(0, 24)))
  );

  const apiKey = process.env.GEMINI_API_KEY || '';
  if (apiKey) {
    try {
      const prompt = `You are a B2B Prospect Intelligence analyst for "${settings.companyName}" (${settings.category}).
Company & Solutions Description: ${settings.description}

We are finding ${count} ADDITIONAL business & technology signals for "${p.name}" (${p.domain}, Industry: ${p.ind}).

ALREADY DISCOVERED SIGNALS (DO NOT REPEAT THESE):
${p.signals.map((s) => `- [${s.cat}] ${s.t}`).join('\n')}

ADDITIONAL LIVE NEWS CANDIDATES FOR "${p.name}":
${
  combinedNews.length
    ? combinedNews
        .slice(0, 10)
        .map((n, i) => `${i + 1}. [${n.pubDate}] ${n.title} (Source: ${n.source})`)
        .join('\n')
    : 'Use grounded knowledge of recent product, hiring, leadership, or expansion developments.'
}

Return ONLY a valid JSON array of ${count} NEW signal objects (no markdown fences):
[
  {
    "cat": "Expansion | Leadership | Technology | Hiring",
    "t": "Concise new signal headline (max 65 chars)",
    "s": "1-2 sentence factual summary of the signal.",
    "r": "High | Medium",
    "why": "1 sentence explaining why this signal creates an opportunity for our offerings.",
    "src": "Real publication name or '${p.domain}'",
    "d": "Published date e.g. ${nowStr}"
  }
]`;

      const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            responseMimeType: 'application/json',
            temperature: 0.35,
          },
        }),
      });

      if (res.ok) {
        const data = await res.json();
        const rawText = data?.candidates?.[0]?.content?.parts?.[0]?.text;
        if (rawText) {
          const cleaned = rawText.replace(/^```json\s*/i, '').replace(/```\s*$/i, '').trim();
          const parsed = JSON.parse(cleaned);
          if (Array.isArray(parsed) && parsed.length > 0) {
            return parsed.slice(0, count).map((s, idx) => ({
              id: nextStartId + idx,
              cat: s.cat || 'Technology',
              t: s.t || `Strategic initiative at ${p.name}`,
              s: s.s || '',
              r: ['High', 'Medium', 'Low'].includes(s.r) ? s.r : 'Medium',
              why: s.why || 'Aligns with enterprise growth and technology modernization.',
              src: s.src || p.domain,
              d: s.d || nowStr,
            }));
          }
        }
      }
    } catch (err) {
      console.warn('Gemini discover-more fallback triggered:', err);
    }
  }

  // Fallback to unused live news items
  const newSignals: Signal[] = [];
  for (const item of combinedNews) {
    if (newSignals.length >= count) break;
    const meta = categorizeHeadline(item.title);
    newSignals.push({
      id: nextStartId + newSignals.length,
      cat: meta.cat,
      t: item.title.length > 78 ? item.title.slice(0, 75) + '…' : item.title,
      s: `Live coverage from ${item.source}: "${item.title}".`,
      r: meta.r,
      why: meta.why,
      src: item.source,
      d: item.pubDate,
    });
  }

  // If still fewer than requested, scrape additional headings from their website
  if (newSignals.length < count) {
    const site = await scrapeCompanyWebsite(p.domain);
    for (const h of site.headings) {
      if (newSignals.length >= count) break;
      if (!existingTitles.has(h.toLowerCase())) {
        newSignals.push({
          id: nextStartId + newSignals.length,
          cat: 'Technology',
          t: `Platform initiative: ${h.slice(0, 58)}`,
          s: `Highlighted on ${p.domain}: "${h}".`,
          r: 'Medium',
          why: 'Demonstrates active investment in digital capabilities and customer experience.',
          src: `${p.domain} (Live HTML)`,
          d: nowStr,
        });
      }
    }
  }

  return newSignals;
}

export async function scrapeOfferingsFromSellerDomain(domain: string): Promise<{
  description?: string;
  offerings: Offering[];
}> {
  const site = await scrapeCompanyWebsite(domain);
  if (!site.reachable) {
    return { offerings: [] };
  }

  const candidateHeadings = site.headings.filter(
    (h) => h.length >= 8 && h.length <= 55 && !/(cookie|privacy|login|sign in|contact|menu)/i.test(h)
  );

  const offerings: Offering[] = candidateHeadings.slice(0, 4).map((h, i) => ({
    id: `live_off_${Date.now()}_${i}`,
    name: h,
    desc: site.paragraphs[i]
      ? site.paragraphs[i].slice(0, 120)
      : `Extracted live from ${domain}`,
  }));

  return {
    description: site.description || site.paragraphs[0],
    offerings,
  };
}
