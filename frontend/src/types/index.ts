export type Relevance = 'High' | 'Medium' | 'Low';
export type Tone = 'Warm & Catchy' | 'Professional' | 'Conversational' | 'Consultative';
export type Length = 'Short' | 'Standard' | 'Detailed';
export type Channel = 'Email' | 'LinkedIn';

export interface Signal {
  id: number;
  cat: string;
  t: string;
  s: string;
  r: Relevance;
  why: string;
  src: string;
  d: string;
}

export interface Person {
  name: string;
  role: string;
  dept: string;
  bio: string;
  li: string;
}

export interface Angle {
  t: string;
  d: string;
  sig: string;
  off: string;
  rcp: string;
  why: string;
}

export interface SequenceStep {
  step: number;
  day: string;
  label: string;
  ch: Channel;
  goal: string;
  subj: string;
  body: string;
  appr: boolean;
}

export interface OKFEntity {
  '@id': string;
  '@type': 'Organization' | 'Person' | 'BusinessEvent' | 'Service';
  name: string;
  attributes: Record<string, string>;
}

export interface OKFTriple {
  id: string;
  subject: string;
  predicate: string;
  object: string;
  provenance: string;
  timestamp: string;
  confidence: number;
}

export interface OKFGraph {
  '@context': string;
  version: string;
  generatedAt: string;
  entities: OKFEntity[];
  triples: OKFTriple[];
}

export interface ICMWeight {
  factor: string;
  sourceNode: string;
  weight: number;
  rationale: string;
}

export interface ICMAttributionChain {
  id: string;
  signalTripleId: string;
  signalSummary: string;
  inferredPain: string;
  recipientMandate: string;
  mappedOffering: string;
  draftClaimAnchor: string;
  confidence: number;
}

export interface MCriticAudit {
  passed: boolean;
  salutationCheck: string;
  groundingScore: number;
  hallucinationFlags: string[];
  notes: string;
}

export interface ICMContextMap {
  prospectId: string;
  weights: ICMWeight[];
  chains: ICMAttributionChain[];
  criticAudit: MCriticAudit;
}

export interface AgentTraceLog {
  agentId:
    | 'harvester'
    | 'news_collector'
    | 'ai_synthesizer'
    | 'okf_architect'
    | 'icm_strategist'
    | 'copywriter'
    | 'critic';
  agentName: string;
  role: string;
  status: 'completed' | 'warning';
  durationMs: number;
  summary: string;
  outputArtifact: string;
  details?: string[];
}

export interface Prospect {
  id: string;
  name: string;
  domain: string;
  ind: string;
  loc: string;
  emp: string;
  date: string;
  status: 'Completed' | 'Partial';
  outreach: string;
  summary: string;
  sel: number[];
  ang: number | 'c';
  custom: string;
  contactIdx: number;
  people: Person[];
  signals: Signal[];
  angles: Angle[];
  sequence: SequenceStep[];
  okf?: OKFGraph;
  icm?: ICMContextMap;
  agentTrace?: AgentTraceLog[];
}

export interface Offering {
  id: string;
  name: string;
  desc: string;
}

export interface CompanySettings {
  companyName: string;
  domain: string;
  category: string;
  description: string;
  senderName: string;
  offerings: Offering[];
}
