'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { Prospect, CompanySettings, Tone, Length, Channel } from '@/types';

type ViewMode = 'dash' | 'new' | 'prog' | 'intel' | 'angles' | 'draft' | 'pros' | 'drafts' | 'set';
type IntelTab = 'Overview' | 'Signals' | 'People' | 'Sources';

const STAGES = [
  'Identifying company',
  'Enriching company profile',
  'Discovering business signals',
  'Researching decision-makers',
  'Consolidating research',
  'Preparing prospect intelligence',
];

export default function ProspectIQApp() {
  const [view, setView] = useState<ViewMode>('dash');
  const [prospects, setProspects] = useState<Prospect[]>([]);
  const [activePid, setActivePid] = useState<string>('acme');
  const [settings, setSettings] = useState<CompanySettings | null>(null);
  const [geminiConfigured, setGeminiConfigured] = useState<boolean>(false);
  const [loading, setLoading] = useState<boolean>(true);
  const [toastMsg, setToastMsg] = useState<string | null>(null);

  // Sub-view states
  const [intelTab, setIntelTab] = useState<IntelTab>('Overview');
  const [sigFilter, setSigFilter] = useState<string>('All');
  const [stepIdx, setStepIdx] = useState<number>(0);
  const [tone, setTone] = useState<Tone>('Warm & Catchy');
  const [len, setLen] = useState<Length>('Standard');
  const [progStep, setProgStep] = useState<number>(0);
  const [researchingName, setResearchingName] = useState<string>('');
  const [refreshing, setRefreshing] = useState<boolean>(false);
  const [loadingMoreSignals, setLoadingMoreSignals] = useState<boolean>(false);
  const [generatingSeq, setGeneratingSeq] = useState<boolean>(false);
  const [regeneratingStep, setRegeneratingStep] = useState<boolean>(false);
  const [importingSite, setImportingSite] = useState<boolean>(false);

  // New prospect form state (defaults to a real online company so user can test immediately)
  const [formComp, setFormComp] = useState('Stripe');
  const [formDom, setFormDom] = useState('stripe.com');
  const [formInd, setFormInd] = useState('Fintech & Payments');
  const [formPer, setFormPer] = useState('David Singleton');
  const [formRole, setFormRole] = useState('CTO');
  const [formLi, setFormLi] = useState('linkedin.com/in/davidsingleton');

  // New contact inside People tab
  const [newContactName, setNewContactName] = useState('');
  const [newContactRole, setNewContactRole] = useState('');

  const showToast = useCallback((msg: string) => {
    setToastMsg(msg);
    setTimeout(() => {
      setToastMsg((prev) => (prev === msg ? null : prev));
    }, 2400);
  }, []);

  const fetchAll = useCallback(async () => {
    try {
      const [pRes, sRes] = await Promise.all([
        fetch('/api/prospects'),
        fetch('/api/settings'),
      ]);
      if (pRes.ok) {
        const data = await pRes.json();
        setProspects(data.prospects || []);
        setGeminiConfigured(Boolean(data.geminiConfigured));
      }
      if (sRes.ok) {
        const sData = await sRes.json();
        setSettings(sData);
      }
    } catch (err) {
      console.error('Error connecting to backend API:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  const curP = prospects.find((p) => p.id === activePid) || prospects[0];

  const updateProspectInState = (updated: Prospect) => {
    setProspects((prev) => prev.map((p) => (p.id === updated.id ? updated : p)));
  };

  // Toggle signal selection
  const toggleSignal = async (sigId: number) => {
    if (!curP) return;
    const nextSel = curP.sel.includes(sigId)
      ? curP.sel.filter((x) => x !== sigId)
      : [...curP.sel, sigId];

    const res = await fetch(`/api/prospects/${curP.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sel: nextSel }),
    });
    if (res.ok) {
      updateProspectInState(await res.json());
    }
  };

  // Select angle
  const selectAngle = async (ang: number | 'c', customText?: string) => {
    if (!curP) return;
    const body: Record<string, unknown> = { ang };
    if (customText !== undefined) body.custom = customText;
    const res = await fetch(`/api/prospects/${curP.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (res.ok) {
      updateProspectInState(await res.json());
    }
  };

  // Generate 4-step sequence & go to draft view
  const generateSequenceAndOpen = async () => {
    if (!curP || generatingSeq) return;
    setGeneratingSeq(true);
    showToast(`Writing natural 4-step sequence with Gemini AI…`);
    try {
      const res = await fetch(`/api/prospects/${curP.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ regenerateSequence: true, tone, len }),
      });
      if (res.ok) {
        updateProspectInState(await res.json());
        setStepIdx(0);
        setView('draft');
      }
    } finally {
      setGeneratingSeq(false);
    }
  };

  // Select primary contact
  const selectPrimaryContact = async (contactIdx: number) => {
    if (!curP) return;
    const res = await fetch(`/api/prospects/${curP.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contactIdx, regenerateSequence: true, tone, len }),
    });
    if (res.ok) {
      const updated: Prospect = await res.json();
      updateProspectInState(updated);
      showToast(`${updated.people[contactIdx]?.name} set as primary contact`);
    }
  };

  // Add new contact
  const handleAddContact = async () => {
    if (!curP || !newContactName.trim()) {
      showToast('Please enter a contact name');
      return;
    }
    const [role, dept] = (newContactRole || 'VP Technology · Technology')
      .split('·')
      .map((s) => s.trim());

    const res = await fetch(`/api/prospects/${curP.id}/people`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: newContactName.trim(),
        role: role || 'Decision Maker',
        dept: dept || 'Leadership',
      }),
    });
    if (res.ok) {
      const updated = await res.json();
      updateProspectInState(updated);
      setNewContactName('');
      setNewContactRole('');
      showToast(`Added and selected ${newContactName.trim()}`);
    }
  };

  // Update sequence step (edit subject/body/channel or regenerate)
  const patchStep = async (
    idx: number,
    payload: {
      subj?: string;
      body?: string;
      ch?: Channel;
      appr?: boolean;
      regenerate?: boolean;
      tone?: Tone;
      len?: Length;
    }
  ) => {
    if (!curP) return;
    if (payload.regenerate) setRegeneratingStep(true);
    try {
      const res = await fetch(`/api/prospects/${curP.id}/sequence/${idx}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (res.ok) {
        updateProspectInState(await res.json());
      }
    } finally {
      if (payload.regenerate) setRegeneratingStep(false);
    }
  };

  // Approve all steps
  const approveEntireSequence = async () => {
    if (!curP) return;
    const res = await fetch(`/api/prospects/${curP.id}/sequence/approve-all`, {
      method: 'POST',
    });
    if (res.ok) {
      const updated: Prospect = await res.json();
      updateProspectInState(updated);
      showToast(`All ${updated.sequence.length} sequence steps approved for ${updated.name}!`);
    }
  };

  // Add follow-up step
  const addFollowUpStep = async () => {
    if (!curP) return;
    const res = await fetch(`/api/prospects/${curP.id}/sequence/add-step`, {
      method: 'POST',
    });
    if (res.ok) {
      const updated: Prospect = await res.json();
      updateProspectInState(updated);
      setStepIdx(updated.sequence.length - 1);
      showToast(`Added Step ${updated.sequence.length}`);
    }
  };

  // LIVE ONLINE RESEARCH: Fetch real website + Google News RSS + Gemini synthesis
  const startNewProspectResearch = async () => {
    const targetName = formComp.trim() || 'Stripe';
    setResearchingName(targetName);
    setProgStep(0);
    setView('prog');

    // Advance progress UI while live HTTP scraping + RSS + AI finishes
    const interval = setInterval(() => {
      setProgStep((prev) => (prev < STAGES.length - 1 ? prev + 1 : prev));
    }, 650);

    try {
      const res = await fetch('/api/prospects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: targetName,
          domain: formDom.trim() || 'stripe.com',
          ind: formInd.trim() || 'Technology',
          contactName: formPer.trim() || 'Executive Contact',
          contactRole: formRole.trim() || 'CTO',
          contactLi: formLi.trim(),
        }),
      });

      clearInterval(interval);
      setProgStep(STAGES.length);

      if (res.ok) {
        const created: Prospect = await res.json();
        setProspects((prev) => [created, ...prev]);
        setActivePid(created.id);
        setIntelTab('Overview');
        showToast(`Live intelligence retrieved for ${created.name}!`);
        setView('intel');
      } else {
        showToast('Live research encountered an error');
        setView('new');
      }
    } catch {
      clearInterval(interval);
      showToast('Network error during live research');
      setView('new');
    }
  };

  // LIVE REFRESH for an existing prospect
  const refreshLiveResearch = async () => {
    if (!curP || refreshing) return;
    setRefreshing(true);
    showToast(`Fetching live website & Google News for ${curP.name}…`);
    try {
      const res = await fetch(`/api/prospects/${curP.id}/refresh`, {
        method: 'POST',
      });
      if (res.ok) {
        const refreshed: Prospect = await res.json();
        updateProspectInState(refreshed);
        showToast(`Updated ${refreshed.name} with ${refreshed.signals.length} live signals!`);
      }
    } finally {
      setRefreshing(false);
    }
  };

  // LIVE DISCOVER MORE SIGNALS (+3 non-duplicate signals)
  const loadMoreSignals = async () => {
    if (!curP || loadingMoreSignals) return;
    setLoadingMoreSignals(true);
    showToast(`Discovering more live signals for ${curP.name}…`);
    try {
      const res = await fetch(`/api/prospects/${curP.id}/signals/more`, {
        method: 'POST',
      });
      if (res.ok) {
        const data = await res.json();
        if (data.prospect) {
          updateProspectInState(data.prospect);
        }
        showToast(
          data.addedCount > 0
            ? `Added ${data.addedCount} new verified signals for ${curP.name}!`
            : `No additional unique signals found right now`
        );
      }
    } finally {
      setLoadingMoreSignals(false);
    }
  };

  // LIVE WEBSITE OFFERINGS IMPORT in Company Settings
  const importOfferingsFromLiveWebsite = async () => {
    if (!settings || importingSite) return;
    setImportingSite(true);
    showToast(`Scraping live website ${settings.domain}…`);
    try {
      const res = await fetch('/api/settings/import-website', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ domain: settings.domain }),
      });
      if (res.ok) {
        const data = await res.json();
        setSettings(data.settings);
        showToast(
          data.importedCount > 0
            ? `Imported ${data.importedCount} headings/offerings from ${settings.domain}!`
            : `Updated company description from ${settings.domain}`
        );
      }
    } finally {
      setImportingSite(false);
    }
  };

  if (loading) {
    return (
      <div className="app">
        <nav className="side-nav">
          <div className="logo">
            <img src="/logo.png" alt="speer logo" />
            speer
          </div>
        </nav>
        <main className="main-area">
          <div className="card">Loading Speer Live Intelligence Engine…</div>
        </main>
      </div>
    );
  }

  const navItems: Array<[ViewMode, string]> = [
    ['dash', 'Dashboard'],
    ['new', 'Research Prospect'],
    ['pros', 'Prospects'],
    ['drafts', 'Outreach Drafts'],
    ['set', 'Company Settings'],
  ];

  const activeNavKey: ViewMode =
    view === 'prog'
      ? 'new'
      : view === 'intel' || view === 'angles'
      ? 'pros'
      : view === 'draft'
      ? 'drafts'
      : view;

  // Render Prospect Switcher Bar
  const renderProspectSwitcher = () => (
    <div className="p-sw">
      <span className="mut" style={{ fontSize: 12, fontWeight: 700 }}>
        ACTIVE PROSPECT:
      </span>
      {prospects.map((p) => (
        <button
          key={p.id}
          className={`chip ${curP?.id === p.id ? 'on' : ''}`}
          onClick={() => {
            setActivePid(p.id);
            setStepIdx(0);
            showToast(`Switched to ${p.name}`);
          }}
        >
          {p.name}
        </button>
      ))}
    </div>
  );

  // Render Prospect Table
  const renderProspectTable = () => (
    <div className="card tw">
      <table>
        <thead>
          <tr>
            <th>Company</th>
            <th>Primary Contact</th>
            <th>Industry</th>
            <th>Last researched</th>
            <th>Research</th>
            <th>Sequence Status</th>
            <th>Action</th>
          </tr>
        </thead>
        <tbody>
          {prospects.map((p) => {
            const person = p.people[p.contactIdx] || p.people[0];
            const apprCnt = p.sequence.filter((s) => s.appr).length;
            const stTag =
              p.outreach === 'Approved' ? 'ok' : p.outreach === '—' ? '' : 'rev';
            return (
              <tr
                key={p.id}
                className="lk"
                onClick={() => {
                  setActivePid(p.id);
                  setIntelTab('Overview');
                  setView('intel');
                }}
              >
                <td>
                  <b>{p.name}</b>
                  <br />
                  <span className="mut" style={{ fontSize: 12 }}>
                    {p.domain}
                  </span>
                </td>
                <td>
                  {person?.name}
                  <br />
                  <span className="mut" style={{ fontSize: 12 }}>
                    {person?.role}
                  </span>
                </td>
                <td>{p.ind}</td>
                <td>{p.date}</td>
                <td>
                  <span className={`tag ${p.status === 'Completed' ? 'ok' : 'rev'}`}>
                    {p.status}
                  </span>
                </td>
                <td>
                  <span className={`tag ${stTag}`}>
                    {p.outreach === 'Approved'
                      ? `Approved (${p.sequence.length}/${p.sequence.length})`
                      : apprCnt
                      ? `${apprCnt}/${p.sequence.length} Approved`
                      : p.outreach}
                  </span>
                </td>
                <td onClick={(e) => e.stopPropagation()}>
                  <button
                    className="btn sm sec"
                    onClick={() => {
                      setActivePid(p.id);
                      setStepIdx(0);
                      setView('draft');
                    }}
                  >
                    Sequence →
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );

  return (
    <>
      <div className="app">
        <nav className="side-nav">
          <div className="logo">
            <img src="/logo.png" alt="speer logo" />
            speer
          </div>
          {navItems.map(([key, label]) => (
            <button
              key={key}
              className={activeNavKey === key ? 'on' : ''}
              onClick={() => setView(key)}
            >
              {label}
            </button>
          ))}
        </nav>

        <main className="main-area">
          {/* DASHBOARD VIEW */}
          {view === 'dash' && (
            <>
              <div className="row" style={{ alignItems: 'center', flex: 'none' }}>
                <div style={{ flex: '3 1 300px' }}>
                  <h1>Research smarter. Discover opportunities.</h1>
                  <div className="mut">
                    Live web scraping & Google News RSS enabled. Research any real company online or click an existing prospect below.
                  </div>
                </div>
              </div>

              <div className="grid-cards">
                <div
                  className="card"
                  onClick={() => setView('new')}
                  style={{
                    cursor: 'pointer',
                    position: 'relative',
                    overflow: 'hidden',
                    background: 'linear-gradient(135deg, #6366d6 0%, #5659c7 100%)',
                    border: '1px solid rgba(255, 255, 255, 0.2)',
                    color: '#f4f5ff',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    minHeight: 118,
                    transition: 'transform 0.15s ease, box-shadow 0.15s ease',
                  }}
                >
                  <div
                    className="dm"
                    style={{
                      fontSize: 22,
                      fontWeight: 700,
                      lineHeight: 1.22,
                      zIndex: 1,
                    }}
                  >
                    Research live
                    <br />
                    prospect
                  </div>
                  <div
                    style={{
                      width: 78,
                      height: 78,
                      borderRadius: '50%',
                      background: 'rgba(255, 255, 255, 0.08)',
                      display: 'grid',
                      placeItems: 'center',
                      flexShrink: 0,
                      marginRight: -6,
                      marginBottom: -14,
                    }}
                  >
                    <div
                      style={{
                        width: 44,
                        height: 44,
                        borderRadius: '50%',
                        background: 'rgba(255, 255, 255, 0.18)',
                        border: '1.5px solid rgba(255, 255, 255, 0.45)',
                        display: 'grid',
                        placeItems: 'center',
                        fontSize: 26,
                        fontWeight: 400,
                        lineHeight: 1,
                        color: '#ffffff',
                      }}
                    >
                      +
                    </div>
                  </div>
                </div>
                <div className="card green">
                  <div className="mut">Verified signals</div>
                  <div className="big">
                    {prospects.reduce((acc, p) => acc + p.signals.length, 0)}
                  </div>
                </div>
                <div className="card lav">
                  <div className="mut">Sequence touchpoints</div>
                  <div className="big">
                    {prospects.reduce((acc, p) => acc + p.sequence.length, 0)}
                  </div>
                </div>
                <div className="card">
                  <div className="mut">Companies researched</div>
                  <div className="big">{prospects.length}</div>
                </div>
              </div>

              <div>
                <h2 style={{ margin: '4px 0 10px' }}>
                  All Researched Prospects (Click any row to open)
                </h2>
                {renderProspectTable()}
              </div>
            </>
          )}

          {/* NEW PROSPECT VIEW */}
          {view === 'new' && (
            <>
              <div>
                <h1>Research live prospect online</h1>
                <div className="mut">
                  Enter any real company name and domain (e.g. Stripe, Cloudflare, HubSpot, Grab, Infosys). The backend will scrape its live website and fetch real Google News articles.
                </div>
              </div>
              <div className="card" style={{ maxWidth: 640 }}>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
                  <span className="mut" style={{ fontSize: 12, alignSelf: 'center' }}>
                    Quick presets:
                  </span>
                  {[
                    ['Stripe', 'stripe.com', 'Fintech & Payments', 'David Singleton', 'CTO'],
                    ['Cloudflare', 'cloudflare.com', 'Cloud & Security', 'Dane Knecht', 'SVP Emerging Tech'],
                    ['Shopify', 'shopify.com', 'E-Commerce Platform', 'Mikhail Parakhin', 'CTO'],
                  ].map(([c, d, i, p, r]) => (
                    <button
                      key={c}
                      type="button"
                      className="chip"
                      onClick={() => {
                        setFormComp(c);
                        setFormDom(d);
                        setFormInd(i);
                        setFormPer(p);
                        setFormRole(r);
                        setFormLi(`linkedin.com/in/${p.toLowerCase().replace(/\s+/g, '')}`);
                      }}
                    >
                      Try {c}
                    </button>
                  ))}
                </div>
                <label>Company name *</label>
                <input
                  value={formComp}
                  onChange={(e) => setFormComp(e.target.value)}
                />
                <label>Company website (scraped live) *</label>
                <input
                  value={formDom}
                  onChange={(e) => setFormDom(e.target.value)}
                />
                <label>Industry</label>
                <input
                  value={formInd}
                  onChange={(e) => setFormInd(e.target.value)}
                />
                <label>Contact person *</label>
                <input
                  value={formPer}
                  onChange={(e) => setFormPer(e.target.value)}
                />
                <label>Job designation</label>
                <input
                  value={formRole}
                  onChange={(e) => setFormRole(e.target.value)}
                />
                <label>LinkedIn profile URL</label>
                <input
                  placeholder="Optional"
                  value={formLi}
                  onChange={(e) => setFormLi(e.target.value)}
                />
                <div style={{ marginTop: 18 }}>
                  <button className="btn" onClick={startNewProspectResearch}>
                    Run live online research →
                  </button>
                </div>
              </div>
            </>
          )}

          {/* PROGRESS VIEW */}
          {view === 'prog' && (
            <>
              <h1>Researching {researchingName || curP?.name} online…</h1>
              <div className="card" style={{ maxWidth: 560 }}>
                <div className="bar">
                  <i style={{ width: `${(progStep / STAGES.length) * 100}%` }} />
                </div>
                <div className="steps">
                  {STAGES.map((s, k) => (
                    <div
                      key={s}
                      className={`st ${k < progStep ? 'done' : k === progStep ? 'act' : ''}`}
                    >
                      <span className="dot">{k < progStep ? '✓' : k + 1}</span>
                      {s}
                    </div>
                  ))}
                </div>
                <div className="mut" style={{ marginTop: 14 }}>
                  Fetching live HTML metadata and real-time Google News RSS articles…
                </div>
              </div>
            </>
          )}

          {/* PROSPECT INTELLIGENCE VIEW */}
          {view === 'intel' && curP && (
            <>
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  flexWrap: 'wrap',
                  gap: 10,
                }}
              >
                <button className="btn sm sec" onClick={() => setView('pros')}>
                  ← Back to Prospects
                </button>
                {renderProspectSwitcher()}
              </div>
              <div className="row" style={{ alignItems: 'center', flexWrap: 'wrap' }}>
                <div style={{ flex: '3 1 300px' }}>
                  <h1>{curP.name}</h1>
                  <div className="mut">
                    {curP.domain} · {curP.ind} · {curP.loc} · {curP.emp} · Researched{' '}
                    {curP.date}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 8, flex: '0 0 auto' }}>
                  <button
                    className="btn sec"
                    disabled={refreshing}
                    onClick={refreshLiveResearch}
                  >
                    {refreshing ? 'Fetching live data…' : '↻ Refresh live online'}
                  </button>
                  <button className="btn" onClick={() => setView('angles')}>
                    Outreach angles →
                  </button>
                </div>
              </div>

              <div className="tabs" role="tablist">
                {(['Overview', 'Signals', 'People', 'Sources'] as IntelTab[]).map(
                  (t) => (
                    <button
                      key={t}
                      className={`tab ${intelTab === t ? 'on' : ''}`}
                      onClick={() => setIntelTab(t)}
                    >
                      {t}
                    </button>
                  )
                )}
              </div>

              {intelTab === 'Overview' && (
                <>
                  <div className="grid-cards">
                    <div className="card dark" style={{ gridColumn: 'span 2' }}>
                      <h2>Company summary</h2>
                      <p>{curP.summary}</p>
                      <span
                        className="tag"
                        style={{ background: 'var(--pri)', color: '#1c1640' }}
                      >
                        Based on {curP.signals.length} sources ({curP.date})
                      </span>
                    </div>
                    <div className="card green">
                      <div className="mut">Signals found</div>
                      <div className="big">{curP.signals.length}</div>
                    </div>
                    <div className="card lav">
                      <div className="mut">High relevance</div>
                      <div className="big">
                        {curP.signals.filter((s) => s.r === 'High').length}
                      </div>
                    </div>
                  </div>
                  <div className="grid-cards">
                    <div className="card">
                      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                        <h2>Recent developments ({curP.signals.length})</h2>
                        <button
                          className="btn sm sec"
                          disabled={loadingMoreSignals}
                          onClick={loadMoreSignals}
                        >
                          {loadingMoreSignals ? 'Scanning…' : '+ Give more signals'}
                        </button>
                      </div>
                      {curP.signals.map((x) => (
                        <div key={x.id} className="ev">
                          <span>{x.t}</span>
                          <span className="mut">{x.d}</span>
                        </div>
                      ))}
                    </div>
                    <div className="card">
                      <h2>Decision-makers ({curP.people.length})</h2>
                      {curP.people.map((person, idx) => (
                        <div key={person.name} className="ev">
                          <span>
                            <b>{person.name}</b>{' '}
                            {idx === curP.contactIdx && (
                              <span className="tag ok" style={{ marginLeft: 6 }}>
                                Primary
                              </span>
                            )}
                          </span>
                          <span className="mut">{person.role}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </>
              )}

              {intelTab === 'Signals' && (
                <>
                  <div className="row" style={{ flex: 'none' }}>
                    <div
                      style={{
                        display: 'flex',
                        gap: 6,
                        flexWrap: 'wrap',
                        flex: '1 1 100%',
                      }}
                    >
                      {['All', ...Array.from(new Set(curP.signals.map((s) => s.cat)))].map(
                        (c) => (
                          <button
                            key={c}
                            className={`chip ${sigFilter === c ? 'on' : ''}`}
                            onClick={() => setSigFilter(c)}
                          >
                            {c}
                          </button>
                        )
                      )}
                    </div>
                  </div>
                  {curP.signals
                    .filter((x) => sigFilter === 'All' || x.cat === sigFilter)
                    .map((x) => (
                      <div
                        key={x.id}
                        className={`card sig ${curP.sel.includes(x.id) ? 'sel' : ''}`}
                        onClick={() => toggleSignal(x.id)}
                      >
                        <input
                          type="checkbox"
                          checked={curP.sel.includes(x.id)}
                          onChange={() => {}}
                          aria-label={`Select ${x.t}`}
                        />
                        <div style={{ flex: 1 }}>
                          <div
                            className="row"
                            style={{ justifyContent: 'space-between', gap: 8 }}
                          >
                            <h3>{x.t}</h3>
                            <span>
                              <span className="tag">{x.cat}</span>{' '}
                              <span className={`tag ${x.r}`}>{x.r}</span>
                            </span>
                          </div>
                          <div>{x.s}</div>
                          <div className="mut" style={{ marginTop: 6 }}>
                            <b>AI reasoning:</b> {x.why}
                          </div>
                          <div
                            className="mut"
                            style={{ fontSize: 12, marginTop: 4 }}
                          >
                            Source: {x.src} · Published {x.d} · Verified
                          </div>
                        </div>
                      </div>
                    ))}
                  <div className="card dark row" style={{ alignItems: 'center' }}>
                    <div>
                      <b>
                        {curP.sel.length} of {curP.signals.length} signal
                        {curP.signals.length === 1 ? '' : 's'} selected.
                      </b>{' '}
                      <span className="mut">
                        The AI will pick one primary signal and use the rest across your
                        multi-step sequence.
                      </span>
                    </div>
                    <div style={{ display: 'flex', gap: 10, flex: '0 0 auto', flexWrap: 'wrap' }}>
                      <button
                        className="btn sec"
                        disabled={loadingMoreSignals}
                        onClick={loadMoreSignals}
                      >
                        {loadingMoreSignals ? 'Scanning news & web…' : '+ Give more signals'}
                      </button>
                      <button
                        className="btn"
                        disabled={curP.sel.length === 0}
                        onClick={() => setView('angles')}
                      >
                        Continue to angles →
                      </button>
                    </div>
                  </div>
                </>
              )}

              {intelTab === 'People' && (
                <div className="grid-cards">
                  {curP.people.map((person, idx) => (
                    <div
                      key={person.name}
                      className={`card ${idx === curP.contactIdx ? 'lav' : ''}`}
                    >
                      <h2>{person.name}</h2>
                      <div>
                        <b>{person.role}</b> · {person.dept}
                      </div>
                      <p>{person.bio}</p>
                      <div className="mut" style={{ fontSize: 12, marginBottom: 12 }}>
                        {person.li}
                      </div>
                      <button
                        className={`btn ${idx === curP.contactIdx ? 'inv' : 'sec'}`}
                        onClick={() => selectPrimaryContact(idx)}
                      >
                        {idx === curP.contactIdx
                          ? 'Selected contact ✓'
                          : 'Select for outreach'}
                      </button>
                    </div>
                  ))}
                  <div className="card">
                    <h2>Add another contact</h2>
                    <label>Full Name</label>
                    <input
                      placeholder="e.g. Sarah Jenkins"
                      value={newContactName}
                      onChange={(e) => setNewContactName(e.target.value)}
                    />
                    <label>Role & Department</label>
                    <input
                      placeholder="e.g. VP Engineering · Technology"
                      value={newContactRole}
                      onChange={(e) => setNewContactRole(e.target.value)}
                    />
                    <button
                      className="btn sec"
                      style={{ marginTop: 12 }}
                      onClick={handleAddContact}
                    >
                      + Add decision-maker
                    </button>
                  </div>
                </div>
              )}

              {intelTab === 'Sources' && (
                <div className="card tw">
                  <table>
                    <thead>
                      <tr>
                        <th>Source</th>
                        <th>Information</th>
                        <th>Category</th>
                        <th>Published</th>
                        <th>Retrieved</th>
                      </tr>
                    </thead>
                    <tbody>
                      {curP.signals.map((x) => (
                        <tr
                          key={x.id}
                          className="lk"
                          onClick={() => showToast(`Verified source: ${x.src}`)}
                        >
                          <td>
                            <b>{x.src}</b>
                          </td>
                          <td>{x.t}</td>
                          <td>
                            <span className="tag">{x.cat}</span>
                          </td>
                          <td>{x.d}</td>
                          <td>{curP.date}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}

          {/* OUTREACH ANGLES VIEW */}
          {view === 'angles' && curP && (
            <>
              {renderProspectSwitcher()}
              <div>
                <h1>Choose an outreach angle for {curP.name}</h1>
                <div className="mut">
                  Recipient:{' '}
                  <b>
                    {curP.people[curP.contactIdx]?.name} (
                    {curP.people[curP.contactIdx]?.role})
                  </b>{' '}
                  · Primary signal:{' '}
                  <b>
                    {curP.signals.find((x) => curP.sel.includes(x.id))?.t || 'None'}
                  </b>
                </div>
              </div>

              <div className="grid-cards">
                {curP.angles.map((a, i) => (
                  <div
                    key={a.t}
                    className={`card ang ${curP.ang === i ? 'sel' : ''}`}
                    onClick={() => selectAngle(i)}
                  >
                    <h2>{a.t}</h2>
                    <p>{a.d}</p>
                    <div className="mut" style={{ fontSize: 13 }}>
                      <b>Supporting signals:</b> {a.sig}
                      <br />
                      <b>Offering:</b> {a.off}
                      <br />
                      <b>Best for:</b> {a.rcp}
                      <br />
                      <b>Why:</b> {a.why}
                    </div>
                    {i === 0 && (
                      <span className="tag High" style={{ marginTop: 8 }}>
                        Recommended
                      </span>
                    )}
                  </div>
                ))}
              </div>

              <div
                className={`card ang ${curP.ang === 'c' ? 'sel' : ''}`}
                onClick={() => selectAngle('c')}
              >
                <h2>Custom outreach angle</h2>
                <div className="mut">
                  Have a specific approach in mind? Tell the AI what you want to
                  communicate across the sequence.
                </div>
                <textarea
                  style={{ minHeight: 70, marginTop: 10 }}
                  placeholder="e.g. Focus on how AI can improve supply chain visibility during expansion"
                  value={curP.custom}
                  onClick={(e) => e.stopPropagation()}
                  onChange={(e) => selectAngle('c', e.target.value)}
                />
                {curP.ang === 'c' && curP.custom && (
                  <div
                    className="card"
                    style={{
                      background: 'var(--bg)',
                      marginTop: 10,
                      padding: 14,
                    }}
                  >
                    <span className="tag rev">Needs review</span> The expansion
                    signals for {curP.name} are verified, but custom claims without a
                    direct source will be framed exploratorily across all sequence
                    steps.
                  </div>
                )}
              </div>

              <div className="row" style={{ flex: 'none' }}>
                <button
                  className="btn sec"
                  style={{ flex: '0 0 auto' }}
                  onClick={() => {
                    setIntelTab('Signals');
                    setView('intel');
                  }}
                >
                  ← Back to signals
                </button>
                <button
                  className="btn"
                  style={{ flex: '0 0 auto' }}
                  disabled={(curP.ang === 'c' && !curP.custom) || generatingSeq}
                  onClick={generateSequenceAndOpen}
                >
                  {generatingSeq
                    ? 'Writing sequence with Gemini AI…'
                    : 'Generate 4-step sequence →'}
                </button>
              </div>
            </>
          )}

          {/* MULTI-STEP SEQUENCE DRAFT VIEW */}
          {view === 'draft' && curP && (() => {
            const person = curP.people[curP.contactIdx] || curP.people[0];
            const seq = curP.sequence;
            const curStep = seq[stepIdx] || seq[0];
            const apprCount = seq.filter((s) => s.appr).length;
            const allAppr = apprCount === seq.length;
            const isCustom = curP.ang === 'c';
            const ev = curP.signals
              .filter((x) => curP.sel.includes(x.id))
              .map((s) => [s.t, s.src, 'ok', 'Verified']);
            if (isCustom && curP.custom) {
              ev.push([
                `Custom claim: "${curP.custom.slice(0, 32)}…"`,
                'No direct source found',
                'bad',
                'Exploratory',
              ]);
            }
            const q = [
              ['Personalization', 'ok'],
              ['Evidence', isCustom ? 'rev' : 'ok'],
              ['Recency', 'ok'],
              ['Offering alignment', 'ok'],
              ['Sequence pacing', 'ok'],
              ['Length', 'ok'],
            ];

            return (
              <>
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    flexWrap: 'wrap',
                    gap: 10,
                  }}
                >
                  <button className="btn sm sec" onClick={() => setView('drafts')}>
                    ← Back to Outreach Drafts
                  </button>
                  {renderProspectSwitcher()}
                </div>
                <div className="row" style={{ alignItems: 'center', flex: 'none' }}>
                  <div style={{ flex: '3 1 300px' }}>
                    <h1>Multi-step outreach sequence</h1>
                    <div className="mut">
                      To <b>{person?.name}</b>, {person?.role} · {curP.name} ·{' '}
                      {apprCount}/{seq.length} steps approved
                    </div>
                  </div>
                  <div
                    style={{
                      display: 'flex',
                      gap: 8,
                      alignItems: 'center',
                      flex: '0 0 auto',
                    }}
                  >
                    <span className={`tag ${allAppr ? 'ok' : 'rev'}`}>
                      {allAppr
                        ? 'Sequence Approved'
                        : `${apprCount} of ${seq.length} Approved`}
                    </span>
                    <button className="btn sm" onClick={approveEntireSequence}>
                      {allAppr ? 'All Approved ✓' : 'Approve entire sequence'}
                    </button>
                  </div>
                </div>

                {/* Sequence Timeline Step Bar */}
                <div className="seq-bar" role="tablist">
                  {seq.map((st, idx) => (
                    <button
                      key={st.step}
                      className={`seq-step ${stepIdx === idx ? 'sel' : ''}`}
                      onClick={() => setStepIdx(idx)}
                    >
                      <div className="seq-top">
                        <span className="seq-day">
                          STEP {st.step} · {st.day}
                        </span>
                        <span className={`tag ${st.appr ? 'ok' : 'rev'}`}>
                          {st.appr ? 'Approved' : 'Draft'}
                        </span>
                      </div>
                      <div className="seq-title">{st.label}</div>
                      <div className="seq-sub">
                        {st.ch} · {st.goal}
                      </div>
                    </button>
                  ))}
                  <button
                    className="seq-step"
                    style={{
                      flex: '0 0 130px',
                      minWidth: 130,
                      alignItems: 'center',
                      justifyContent: 'center',
                      borderStyle: 'dashed',
                      borderColor: 'var(--line)',
                    }}
                    onClick={addFollowUpStep}
                  >
                    <div className="seq-title">+ Add step</div>
                    <div className="seq-sub">Day {seq.length * 3 + 4} touchpoint</div>
                  </button>
                </div>

                <div className="row" style={{ alignItems: 'flex-start' }}>
                  <div className="card" style={{ flex: '2 1 380px' }}>
                    <div
                      className="row"
                      style={{
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        marginBottom: 10,
                      }}
                    >
                      <div>
                        <h2>
                          Step {curStep.step}: {curStep.label} ({curStep.day})
                        </h2>
                        <div className="mut" style={{ fontSize: 12 }}>
                          Goal: {curStep.goal}
                        </div>
                      </div>
                      <span className={`tag ${curStep.appr ? 'ok' : 'rev'}`}>
                        {curStep.appr ? 'Step Approved' : 'Pending review'}
                      </span>
                    </div>

                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                      {(['Email', 'LinkedIn'] as Channel[]).map((x) => (
                        <button
                          key={x}
                          className={`chip ${curStep.ch === x ? 'on' : ''}`}
                          onClick={() =>
                            patchStep(stepIdx, {
                              ch: x,
                              regenerate: true,
                              tone,
                              len,
                            })
                          }
                        >
                          {x}
                        </button>
                      ))}
                      <span style={{ width: 10 }} />
                      {(['Warm & Catchy', 'Professional', 'Conversational', 'Consultative'] as Tone[]).map(
                        (x) => (
                          <button
                            key={x}
                            className={`chip ${tone === x ? 'on' : ''}`}
                            onClick={() => {
                              setTone(x);
                              patchStep(stepIdx, {
                                regenerate: true,
                                tone: x,
                                len,
                              });
                            }}
                          >
                            {x}
                          </button>
                        )
                      )}
                      <span style={{ width: 10 }} />
                      {(['Short', 'Standard', 'Detailed'] as Length[]).map((x) => (
                        <button
                          key={x}
                          className={`chip ${len === x ? 'on' : ''}`}
                          onClick={() => {
                            setLen(x);
                            patchStep(stepIdx, {
                              regenerate: true,
                              tone,
                              len: x,
                            });
                          }}
                        >
                          {x}
                        </button>
                      ))}
                    </div>

                    {curStep.ch === 'Email' && (
                      <>
                        <label>Subject line</label>
                        <input
                          value={curStep.subj}
                          onChange={(e) => {
                            if (curStep.appr)
                              showToast('Edited. Step approval revoked.');
                            patchStep(stepIdx, { subj: e.target.value });
                          }}
                        />
                      </>
                    )}

                    <label>Message body ({curStep.ch})</label>
                    <textarea
                      value={curStep.body}
                      onChange={(e) => {
                        if (curStep.appr)
                          showToast('Edited. Step approval revoked.');
                        patchStep(stepIdx, { body: e.target.value });
                      }}
                    />

                    <div
                      style={{
                        display: 'flex',
                        gap: 10,
                        flexWrap: 'wrap',
                        marginTop: 14,
                      }}
                    >
                      <button
                        className="btn sec"
                        disabled={regeneratingStep}
                        onClick={() => {
                          patchStep(stepIdx, { regenerate: true, tone, len });
                          showToast('Rewriting step with Gemini AI…');
                        }}
                      >
                        {regeneratingStep ? 'Rewriting with AI…' : 'Regenerate step'}
                      </button>
                      <button
                        className="btn out"
                        onClick={() => setView('angles')}
                      >
                        Change angle
                      </button>
                      <button
                        className="btn out"
                        onClick={() => {
                          navigator.clipboard?.writeText(curStep.body).catch(() => {});
                          showToast('Step copied to clipboard');
                        }}
                      >
                        Copy step
                      </button>
                      <button
                        className="btn out"
                        disabled={apprCount === 0}
                        onClick={() =>
                          showToast(
                            `Exported ${seq.length}-step sequence for ${curP.name}`
                          )
                        }
                      >
                        Export sequence ({apprCount}/{seq.length})
                      </button>
                      <button
                        className="btn"
                        onClick={async () => {
                          await patchStep(stepIdx, { appr: true });
                          showToast(`Step ${curStep.step} approved`);
                          if (stepIdx < seq.length - 1) setStepIdx(stepIdx + 1);
                        }}
                      >
                        {curStep.appr
                          ? 'Step Approved ✓'
                          : `Approve step ${curStep.step}`}
                      </button>
                    </div>
                  </div>

                  <div
                    style={{
                      flex: '1 1 280px',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 16,
                    }}
                  >
                    <div className="card">
                      <h2>Evidence used in sequence</h2>
                      {ev.map(([claim, src, cls, status]) => (
                        <div key={claim} className="ev">
                          <span>
                            {claim}
                            <br />
                            <span className="mut">{src}</span>
                          </span>
                          <span>
                            <span className={`tag ${cls}`}>{status}</span>
                          </span>
                        </div>
                      ))}
                    </div>
                    <div className="card dark">
                      <h2>Quality checks</h2>
                      <div
                        style={{
                          display: 'flex',
                          flexWrap: 'wrap',
                          gap: 6,
                          marginTop: 10,
                        }}
                      >
                        {q.map(([label, cls]) => (
                          <span key={label} className={`tag ${cls}`}>
                            {label}
                          </span>
                        ))}
                      </div>
                    </div>
                    <div className="card">
                      <h2>Recipient context</h2>
                      <div>
                        <b>{person?.name}</b> · {person?.role}
                      </div>
                      <div className="mut" style={{ marginTop: 4 }}>
                        {person?.bio}
                      </div>
                    </div>
                  </div>
                </div>
              </>
            );
          })()}

          {/* PROSPECTS DIRECTORY VIEW */}
          {view === 'pros' && (
            <>
              <div className="row" style={{ alignItems: 'center', flex: 'none' }}>
                <div style={{ flex: 1 }}>
                  <h1>Prospects directory</h1>
                  <div className="mut">
                    All {prospects.length} companies are saved to disk (`backend/storage/db.json`) and have full interactive sequences.
                  </div>
                </div>
                <button
                  className="btn"
                  style={{ flex: '0 0 auto' }}
                  onClick={() => setView('new')}
                >
                  + Research live prospect
                </button>
              </div>
              {renderProspectTable()}
            </>
          )}

          {/* OUTREACH DRAFTS VIEW */}
          {view === 'drafts' && (
            <>
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  flexWrap: 'wrap',
                  gap: 12,
                }}
              >
                <div>
                  <h1>Outreach sequences & drafts</h1>
                  <div className="mut">
                    Click any company card below to open its sequence in the builder.
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 16, alignItems: 'center', fontSize: 13 }}>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                    <i className="status-dot green" /> Completed
                  </span>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                    <i className="status-dot yellow" /> Pending
                  </span>
                </div>
              </div>

              <div className="draft-cards-grid">
                {prospects.map((p) => {
                  const person = p.people[p.contactIdx] || p.people[0];
                  const apprCnt = p.sequence.filter((s) => s.appr).length;
                  const totalSteps = p.sequence.length;
                  const allApproved = apprCnt === totalSteps && totalSteps > 0;
                  const pct = Math.round((apprCnt / Math.max(totalSteps, 1)) * 100);

                  const firstPendingIdx = p.sequence.findIndex((s) => !s.appr);
                  const activeIdx = firstPendingIdx >= 0 ? firstPendingIdx : Math.max(totalSteps - 1, 0);
                  const activeStep = p.sequence[activeIdx];
                  const lastStep = p.sequence[Math.max(totalSteps - 1, 0)];

                  const curDayMatch = activeStep?.day?.match(/\d+/);
                  const lastDayMatch = lastStep?.day?.match(/\d+/);
                  const dayLabel =
                    curDayMatch && lastDayMatch
                      ? `Day ${curDayMatch[0]} of ${lastDayMatch[0]}`
                      : activeStep?.day || 'Day 1';

                  return (
                    <div
                      key={p.id}
                      className="card draft-card"
                      onClick={() => {
                        setActivePid(p.id);
                        setStepIdx(firstPendingIdx >= 0 ? firstPendingIdx : 0);
                        setView('draft');
                      }}
                    >
                      <div className="draft-card-head">
                        <div>
                          <h2 style={{ fontSize: 22, marginBottom: 6 }}>{p.name}</h2>
                          <div className="mut" style={{ fontSize: 14 }}>
                            {person?.name} • {person?.role}
                          </div>
                        </div>
                        <span className={`draft-badge ${allApproved ? 'ok' : ''}`}>
                          <i className="badge-dot" />
                          {apprCnt}/{totalSteps} Approved
                        </span>
                      </div>

                      <div className="draft-card-ind">{p.ind}</div>

                      <div className="draft-card-divider" />

                      <div className="draft-card-foot">
                        <div className="draft-dots-row">
                          {p.sequence.map((st, idx) => {
                            const dotClass = st.appr
                              ? 'green'
                              : idx === firstPendingIdx
                              ? 'yellow'
                              : 'upcoming';
                            return (
                              <div
                                key={st.step}
                                style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
                              >
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setActivePid(p.id);
                                    setStepIdx(idx);
                                    setView('draft');
                                  }}
                                  title={`Step ${st.step}: ${st.label} (${st.appr ? 'Approved' : 'Pending review'})`}
                                  style={{
                                    all: 'unset',
                                    cursor: 'pointer',
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                  }}
                                >
                                  <i className={`status-dot ${dotClass}`} />
                                </button>
                                {idx < totalSteps - 1 && (
                                  <span
                                    className={`dot-line ${
                                      st.appr && p.sequence[idx + 1]?.appr ? 'green' : ''
                                    }`}
                                  />
                                )}
                              </div>
                            );
                          })}
                          <span className="mut" style={{ fontSize: 13, marginLeft: 8 }}>
                            {dayLabel}
                          </span>
                        </div>

                        <span
                          style={{
                            fontWeight: 700,
                            fontSize: 14,
                            color: allApproved ? '#4ade80' : '#facc15',
                          }}
                        >
                          {pct}%
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          )}

          {/* COMPANY SETTINGS VIEW */}
          {view === 'set' && settings && (
            <>
              <div>
                <h1>Company settings</h1>
                <div className="mut">
                  Configure your company profile and default outreach persona used by the AI engine.
                </div>
              </div>
              <div className="grid-cards">
                <div className="card">
                  <h2>Company Profile</h2>
                  <div className="mut" style={{ fontSize: 13, marginBottom: 8 }}>
                    Used to match target company buying signals to what your business does.
                  </div>
                  <label>Company Name</label>
                  <input
                    value={settings.companyName}
                    onChange={(e) =>
                      setSettings({ ...settings, companyName: e.target.value })
                    }
                  />
                  <label>Industry / Category</label>
                  <input
                    value={settings.category}
                    onChange={(e) =>
                      setSettings({ ...settings, category: e.target.value })
                    }
                  />
                  <label>Company Website Domain</label>
                  <input
                    value={settings.domain}
                    onChange={(e) =>
                      setSettings({ ...settings, domain: e.target.value })
                    }
                  />
                  <label>Company & Solutions Description</label>
                  <textarea
                    style={{ minHeight: 110 }}
                    value={settings.description}
                    onChange={(e) =>
                      setSettings({ ...settings, description: e.target.value })
                    }
                  />
                  <button
                    className="btn"
                    style={{ marginTop: 14 }}
                    onClick={async () => {
                      const res = await fetch('/api/settings', {
                        method: 'PUT',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(settings),
                      });
                      if (res.ok) {
                        setSettings(await res.json());
                        showToast('Company profile saved to disk');
                      }
                    }}
                  >
                    Save changes
                  </button>
                </div>

                <div className="card">
                  <h2>Outreach Persona & Defaults</h2>
                  <div className="mut" style={{ fontSize: 13, marginBottom: 8 }}>
                    Controls how outreach sequences are signed and styled across all prospects.
                  </div>
                  <label>Sender Name (Email Sign-off)</label>
                  <input
                    placeholder="e.g. Alex Rivera"
                    value={settings.senderName || ''}
                    onChange={(e) =>
                      setSettings({ ...settings, senderName: e.target.value })
                    }
                  />

                  <label>Default Outreach Tone</label>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 6 }}>
                    {(
                      [
                        'Warm & Catchy',
                        'Professional',
                        'Conversational',
                        'Consultative',
                      ] as Tone[]
                    ).map((t) => (
                      <button
                        key={t}
                        type="button"
                        className={`chip ${tone === t ? 'on' : ''}`}
                        onClick={() => setTone(t)}
                      >
                        {t}
                      </button>
                    ))}
                  </div>

                  <label style={{ marginTop: 16 }}>Default Message Length</label>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 6 }}>
                    {(['Short', 'Standard', 'Detailed'] as Length[]).map((l) => (
                      <button
                        key={l}
                        type="button"
                        className={`chip ${len === l ? 'on' : ''}`}
                        onClick={() => setLen(l)}
                      >
                        {l}
                      </button>
                    ))}
                  </div>

                  <button
                    className="btn"
                    style={{ marginTop: 22 }}
                    onClick={async () => {
                      const res = await fetch('/api/settings', {
                        method: 'PUT',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(settings),
                      });
                      if (res.ok) {
                        setSettings(await res.json());
                        showToast('Outreach persona & defaults saved');
                      }
                    }}
                  >
                    Save persona defaults
                  </button>
                </div>
              </div>
            </>
          )}
        </main>
      </div>

      <div
        id="toast"
        className={toastMsg ? 'show' : ''}
        style={{
          position: 'fixed',
          bottom: 24,
          left: '50%',
          transform: 'translateX(-50%)',
          background: 'var(--dk)',
          color: 'var(--on-dk)',
          padding: '10px 20px',
          borderRadius: 999,
          fontWeight: 700,
          opacity: toastMsg ? 1 : 0,
          transition: '0.25s',
          pointerEvents: 'none',
          zIndex: 99,
        }}
      >
        {toastMsg}
      </div>
    </>
  );
}
