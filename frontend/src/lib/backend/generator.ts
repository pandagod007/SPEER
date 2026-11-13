import { Prospect, SequenceStep, Tone, Length, Channel, CompanySettings, Signal } from './types';

export const SEQ_TEMPLATE: Array<{
  step: number;
  day: string;
  label: string;
  ch: Channel;
  goal: string;
}> = [
  {
    step: 1,
    day: 'Day 1',
    label: 'Initial outreach',
    ch: 'Email',
    goal: 'Warm, catchy milestone hook + tailored operational insight & high-open-rate subject line',
  },
  {
    step: 2,
    day: 'Day 3',
    label: 'LinkedIn connect',
    ch: 'LinkedIn',
    goal: 'Polite, warm connection note referencing their news + friendly practitioner question',
  },
  {
    step: 3,
    day: 'Day 6',
    label: 'Value follow-up',
    ch: 'Email',
    goal: 'Warm value-add follow-up connecting secondary signal to a concrete 2-page playbook',
  },
  {
    step: 4,
    day: 'Day 10',
    label: 'Breakup / check-in',
    ch: 'Email',
    goal: 'Warm, polite, zero-pressure close-the-loop note cheering on their team',
  },
];

/**
 * Extracts a proper, polite, warm greeting and short name so titles like "Dr. Aris Thorne"
 * become "Hi Dr. Thorne," (or "Hi Raghav,"), never "Hello Dr." or cold robotic headers.
 */
export function formatRecipientGreeting(fullName: string, tone: Tone): {
  salutation: string;
  shortName: string;
} {
  const cleaned = (fullName || 'there').trim().replace(/\s+/g, ' ');
  const parts = cleaned.split(' ');
  const honorificRegex = /^(dr\.?|prof\.?|mr\.?|ms\.?|mrs\.?)$/i;

  if (parts.length >= 2 && honorificRegex.test(parts[0])) {
    const honorific = parts[0].endsWith('.') ? parts[0] : `${parts[0]}.`;
    const firstName = parts[1];
    const lastName = parts[parts.length - 1];
    const shortName = firstName;
    const salutation =
      tone === 'Conversational'
        ? `Hi ${firstName} —`
        : `Hi ${honorific} ${lastName},`;
    return { salutation, shortName };
  }

  const firstName = parts[0] || 'there';
  return {
    salutation: tone === 'Conversational' ? `Hi ${firstName} —` : `Hi ${firstName},`,
    shortName: firstName,
  };
}

/**
 * Normalizes verbose industry strings (e.g. "Enterprise AI & Business Process Automation")
 * into natural conversational labels (e.g. "AI and automation", "fintech and payments").
 */
export function cleanIndustryLabel(ind: string): string {
  const raw = (ind || 'technology').trim();
  if (/enterprise\s+ai.*automation/i.test(raw)) return 'AI and workflow automation';
  if (/fintech|payment/i.test(raw)) return 'fintech and payments';
  if (/logistics|supply\s+chain/i.test(raw)) return 'supply chain and logistics';
  if (/food\s*&\s*beverage|cpg/i.test(raw)) return 'food and beverage';
  if (/heavy\s+manufacturing|steel/i.test(raw)) return 'industrial manufacturing';
  if (/manufacturing/i.test(raw)) return 'manufacturing';
  if (/e-?commerce|retail/i.test(raw)) return 'commerce and retail';
  if (/cloud|security/i.test(raw)) return 'cloud and security';
  return raw.toLowerCase();
}

/**
 * Produces natural, human-sounding plural role descriptions without awkward concatenations
 * like "enterprise ai & business process automation co-founder & cto leaders".
 */
function naturalPeerGroup(role: string, ind: string): string {
  const r = (role || 'Leader').trim();
  const cleanInd = cleanIndustryLabel(ind);

  if (/co-?founder.*cto|cto.*co-?founder/i.test(r)) {
    return `technical co-founders and CTOs`;
  }
  if (/^(CTO|CIO|CDO|COO|CEO|CFO|CISO)$/i.test(r)) {
    return `${cleanInd} ${r.toUpperCase()}s`;
  }
  const vpOfMatch = r.match(/^(SVP|EVP|VP)\s+(?:of\s+)?(.+)$/i);
  if (vpOfMatch) {
    return `${vpOfMatch[2].toLowerCase()} leaders`;
  }
  const dirMatch = r.match(/^(Director|Head)\s+(?:of\s+)?(.+)$/i);
  if (dirMatch) {
    return `${dirMatch[2].toLowerCase()} leaders`;
  }
  return `${cleanInd} engineering and operations leaders`;
}

/**
 * Recovers the full untruncated headline from `sig.s` when `sig.t` was truncated at ~75 chars with `…`.
 */
function recoverFullHeadline(sig: Signal): string {
  const rawTitle = (sig.t || '').trim();
  const rawSummary = (sig.s || '').trim();

  // Check if sig.s contains a quoted full title: e.g. Live news coverage from AlleyWatch: "Full Title Here".
  const quoteMatch = rawSummary.match(/:\s*["“]([^"”]+)["”]/);
  if (quoteMatch && quoteMatch[1]) {
    const quoted = quoteMatch[1].trim();
    if (quoted.length >= rawTitle.replace(/[….]+$/, '').length) {
      return quoted;
    }
  }
  return rawTitle.replace(/[….]+$/, '').trim();
}

/**
 * Removes trailing prepositions, articles, or conjunctions when shortening a phrase
 * so we NEVER end with broken fragments like "to intern with" or "for ac".
 */
function trimDanglingWords(phrase: string): string {
  let res = phrase.trim();
  const danglingRegex =
    /\s+\b(with|for|to|in|on|of|and|or|by|at|from|as|into|across|under|over|the|a|an|that|which|who|he|she|they)$/i;
  while (danglingRegex.test(res)) {
    res = res.replace(danglingRegex, '').trim();
  }
  return res;
}

export interface DistilledSignalHook {
  archetype:
    | 'funding'
    | 'founder_story'
    | 'leadership'
    | 'ma'
    | 'industrial'
    | 'expansion'
    | 'hiring'
    | 'product_tech';
  shortHook: string;
  subjKeyword: string;
  eventPhrase: string;
  warmCongratsSingle: string;
  warmCombinedPrimary: string;
  warmCombinedSecondary: string;
  subjLineStep1: string;
  subjLineStep2: string;
  subjLineStep3: string;
  subjLineStep4: string;
}

/**
 * Intelligently distills any raw news headline or website signal into warm, polite, catchy,
 * grammatically flawless phrases and high-open-rate subject lines.
 */
export function distillSignalToNaturalHook(
  sig: Signal | undefined,
  companyName: string,
  recipientRole = '',
  recipientFirstName = 'there'
): DistilledSignalHook {
  const firstName = recipientFirstName || 'there';

  if (!sig || !sig.t) {
    return {
      archetype: 'product_tech',
      shortHook: `${companyName}’s current AI and platform roadmap`,
      subjKeyword: `${companyName}’s roadmap`,
      eventPhrase: `scaling ${companyName}’s core platform`,
      warmCongratsSingle: `I’ve been following ${companyName}’s momentum and love what your team is building`,
      warmCombinedPrimary: `the momentum around ${companyName}’s product roadmap`,
      warmCombinedSecondary: `your team’s focus on scaling cleanly`,
      subjLineStep1: `${firstName} — quick thought on ${companyName}'s platform roadmap`,
      subjLineStep2: `${firstName} — loving ${companyName}'s momentum!`,
      subjLineStep3: `Quick architecture idea for ${companyName}'s roadmap, ${firstName}`,
      subjLineStep4: `Cheering ${companyName} on from the sidelines, ${firstName}!`,
    };
  }

  const fullHeadline = recoverFullHeadline(sig);
  const isWebsiteFocus = /^website focus:/i.test(sig.t) || /live html/i.test(sig.src || '');

  let raw = fullHeadline
    .replace(/[.!?…]+$/, '')
    .replace(/^website focus:\s*/i, '')
    .replace(/^platform initiative:\s*/i, '')
    .replace(/^scoop:\s*/i, '')
    .replace(/\s+\|\s+.*$/, '')
    .replace(/:\s+lessons\s+from.*$/i, '')
    .replace(/\s+-\s+[^-]+$/, '')
    .trim();

  const compEsc = companyName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const rawWithoutCompany = raw
    .replace(new RegExp(`^${compEsc}['’]?s?\\s+`, 'i'), '')
    .replace(/^(says|announces|reports|reveals)\s+/i, '')
    .trim();

  const sText = (sig.s || '').toLowerCase();
  const combinedText = `${fullHeadline}. ${sig.s || ''}`;

  // 1. FUNDING / CAPITAL RAISE / STRATEGIC INVESTMENT (Must check BEFORE industrial upgrade so "$30m" is never mistaken for a steel mill!)
  const isIndustrialMill = /\b(furnace|rolling\s+mill|arc\s+furnace|mill\s+#?\d+|kiln|plant\s+modernization)\b/i.test(
    combinedText
  );
  const isFunding =
    !isIndustrialMill &&
    (/\b(raises?|raised|secures?|secured|closes?|closed)\s+\$\d+/i.test(combinedText) ||
      /\$\d+(?:\.\d+)?\s*(?:m|b|million|billion)\b.*(to\s+build|to\s+scale|funding|series|seed|round|valuation|compliance|platform|os\b)/i.test(
        combinedText
      ) ||
      /\b(series\s+[a-f]|seed\s+round|investment\s+from|venture|funding\s+round)\b/i.test(combinedText));

  if (isFunding) {
    const amtMatch = combinedText.match(/(\$\d+(?:\.\d+)?\s*(?:M|B|m|b|million|billion))/i);
    const amt = amtMatch ? amtMatch[1].toUpperCase().replace(/\s*MILLION/i, 'M').replace(/\s*BILLION/i, 'B') : '';

    // Extract purpose after "to build / to scale / for ..."
    const purposeMatch = fullHeadline.match(/\bto\s+(build|scale|expand|launch|automate)\s+(.+)$/i);
    let purposeClean = '';
    let shortTopic = 'your next growth phase';

    if (purposeMatch) {
      const verb = purposeMatch[1].toLowerCase();
      let obj = trimDanglingWords(purposeMatch[2].replace(/[.!?…]+$/, ''));
      // Add article if starts with "sales tax OS"
      if (/^sales\s+tax\s+os\b/i.test(obj)) {
        obj = `the ${obj}`;
        shortTopic = 'the sales tax OS';
      } else if (/ai-driven\s+sales\s+tax\s+compliance/i.test(obj)) {
        shortTopic = 'AI-driven sales tax compliance';
      } else {
        const topicWords = obj.split(/\s+/).slice(0, 4).join(' ');
        shortTopic = trimDanglingWords(topicWords);
      }
      purposeClean = `to ${verb} ${obj}`;
    } else if (/sales\s+tax/i.test(fullHeadline)) {
      purposeClean = 'to scale your sales tax platform';
      shortTopic = 'the sales tax platform';
    }

    const investorMatch = fullHeadline.match(/investment\s+from\s+([A-Z][A-Za-z0-9\s&]+?)(?:$|[,.])/i);
    const investorNote = investorMatch ? ` with backing from ${investorMatch[1].trim()}` : '';

    const raiseLabel = amt ? `${amt} raise` : `new funding round`;
    return {
      archetype: 'funding',
      shortHook: `${companyName}’s ${raiseLabel}${purposeClean ? ' ' + purposeClean : ''}`,
      subjKeyword: `${companyName}'s ${raiseLabel}`,
      eventPhrase: `scaling fast after the ${raiseLabel}`,
      warmCongratsSingle: `Huge congratulations on ${companyName}’s ${raiseLabel}${investorNote}${
        purposeClean ? ' ' + purposeClean : ''
      }`,
      warmCombinedPrimary: `${companyName}’s ${raiseLabel}${investorNote}${purposeClean ? ' ' + purposeClean : ''}`,
      warmCombinedSecondary: `the recent ${raiseLabel}${investorNote}`,
      subjLineStep1: `${firstName} — huge congrats on ${companyName}'s ${raiseLabel} (+ a quick thought on ${shortTopic})`,
      subjLineStep2: `${firstName} — congrats on ${companyName}'s ${raiseLabel}!`,
      subjLineStep3: `Quick architecture idea as ${companyName} scales ${shortTopic}, ${firstName}`,
      subjLineStep4: `Cheering ${companyName} on after the ${raiseLabel}, ${firstName}!`,
    };
  }

  // 2. FOUNDER / EXECUTIVE PROFILE STORY (e.g. "He skipped college to intern with an ex-Sequoia director. Three years later, he's a cofounder.")
  if (
    /\b(he|she|they)\s+(skipped|left|dropped|started|built|quit|went)|three\s+years\s+later|cofounder|co-founder|founder\s+story/i.test(
      combinedText
    )
  ) {
    const pub = sig.src && !/google news|live html/i.test(sig.src) ? sig.src : 'recent press';
    const skippedCollege = /skipped\s+college/i.test(combinedText);
    const storyDetail = skippedCollege
      ? `your journey from skipping college to co-founding ${companyName}`
      : `your journey building and co-founding ${companyName}`;

    return {
      archetype: 'founder_story',
      shortHook: `the ${pub} feature on ${storyDetail}`,
      subjKeyword: `your ${pub} feature & ${companyName}`,
      eventPhrase: `leading ${companyName}’s rapid growth`,
      warmCongratsSingle: `I really enjoyed reading the ${pub} feature on ${storyDetail}`,
      warmCombinedPrimary: `the ${pub} feature on ${storyDetail}`,
      warmCombinedSecondary: `I loved reading the ${pub} story on ${storyDetail}`,
      subjLineStep1: `${firstName} — loved the ${pub} piece on your journey building ${companyName}!`,
      subjLineStep2: `${firstName} — loved your founder story in ${pub}!`,
      subjLineStep3: `Following up on my note & cheering on ${companyName}'s growth, ${firstName}`,
      subjLineStep4: `Cheering ${companyName} on from the sidelines, ${firstName}!`,
    };
  }

  // 3. EXECUTIVE / LEADERSHIP APPOINTMENT
  if (
    /new\s+(cto|cio|cdo|vp|chief|coo|ceo)\s+appointed/i.test(raw) ||
    /joined.*as\s+chief/i.test(sText) ||
    /named\s+(cto|cio|cdo|coo|ceo)/i.test(sText)
  ) {
    const roleMatch = combinedText.match(/\b(CTO|CIO|CDO|COO|CEO)\b/i);
    const rName = roleMatch ? roleMatch[1].toUpperCase() : 'leadership';
    const isSameRole = Boolean(recipientRole && recipientRole.toUpperCase().includes(rName));
    return {
      archetype: 'leadership',
      shortHook: isSameRole ? `stepping into the ${rName} role` : `the new ${rName} appointment`,
      subjKeyword: `${companyName}'s ${rName} roadmap`,
      eventPhrase: isSameRole ? `shaping your first-90-day ${rName} roadmap` : `aligning around the new ${rName} vision`,
      warmCongratsSingle: isSameRole
        ? `Huge congratulations on stepping into the ${rName} role at ${companyName}`
        : `It’s exciting to see ${companyName} strengthening its leadership team with the new ${rName} appointment`,
      warmCombinedPrimary: isSameRole
        ? `stepping into the ${rName} seat at ${companyName}`
        : `${companyName}’s new ${rName} appointment`,
      warmCombinedSecondary: isSameRole
        ? `your new mandate as ${rName}`
        : `the new ${rName} appointment`,
      subjLineStep1: isSameRole
        ? `${firstName} — warm congrats on the ${rName} role at ${companyName} (+ a quick thought)`
        : `${firstName} — ${companyName}'s new ${rName} chapter & scaling the roadmap`,
      subjLineStep2: isSameRole
        ? `${firstName} — congrats on the new ${rName} role at ${companyName}!`
        : `${firstName} — exciting times at ${companyName}!`,
      subjLineStep3: `A quick 90-day architecture idea for ${companyName}, ${firstName}`,
      subjLineStep4: `Wishing you a fantastic quarter at ${companyName}, ${firstName}!`,
    };
  }

  // 4. M&A / ACQUISITION
  if (/\b(to\s+buy|buys|acquires|acquired|acquisition\s+of)\b/i.test(raw)) {
    const target = trimDanglingWords(
      rawWithoutCompany
        .replace(/^(to\s+buy|buys|acquires|acquired|acquisition\s+of)\s+/i, '')
        .replace(/\s+(as|for)\s+.*$/i, '')
        .replace(/^a\.?i\.?\s+start-up\s+/i, '')
    );
    return {
      archetype: 'ma',
      shortHook: `bringing ${target} into the ${companyName} fold`,
      subjKeyword: `${target} integration`,
      eventPhrase: `integrating ${target} into ${companyName}’s core stack`,
      warmCongratsSingle: `Huge congratulations on ${companyName}’s move to acquire ${target}`,
      warmCombinedPrimary: `bringing ${target} under the ${companyName} roof`,
      warmCombinedSecondary: `the move to bring ${target} into the fold`,
      subjLineStep1: `${firstName} — congrats on ${companyName}'s ${target} acquisition (+ a quick integration idea)`,
      subjLineStep2: `${firstName} — exciting news on ${companyName} & ${target}!`,
      subjLineStep3: `Quick playbook for unifying data after the ${target} move, ${firstName}`,
      subjLineStep4: `Wishing ${companyName} a smooth integration with ${target}, ${firstName}!`,
    };
  }

  // 5. INDUSTRIAL / FURNACE / MILL MODERNIZATION (Strictly industrial!)
  if (isIndustrialMill) {
    const cleanUp = rawWithoutCompany.replace(/upgrade/i, 'modernization');
    return {
      archetype: 'industrial',
      shortHook: `the ${cleanUp}`,
      subjKeyword: `Pittsburgh Mill #2 modernization`,
      eventPhrase: `rolling out the ${cleanUp}`,
      warmCongratsSingle: `It was exciting to read about ${companyName}’s ${cleanUp}`,
      warmCombinedPrimary: `${companyName}’s ${cleanUp}`,
      warmCombinedSecondary: `the ${cleanUp}`,
      subjLineStep1: `${firstName} — ${companyName}'s ${cleanUp} (+ a quick note on sensor pipelines)`,
      subjLineStep2: `${firstName} — following ${companyName}'s ${cleanUp}!`,
      subjLineStep3: `Quick telemetry playbook for ${companyName}'s mill modernization, ${firstName}`,
      subjLineStep4: `Wishing ${companyName} a smooth commissioning on the modernization, ${firstName}!`,
    };
  }

  // 6. FACILITY / HUB / REGIONAL OR RETAIL EXPANSION
  if (
    /\b(plant|facility|hub|monterrey|pune|distribution\s+center|southeast\s+asia|whole\s+foods|target|national\s+rollout)\b/i.test(
      combinedText
    )
  ) {
    if (/whole\s+foods|target|national\s+rollout/i.test(combinedText)) {
      return {
        archetype: 'expansion',
        shortHook: `the national rollout with Whole Foods & Target`,
        subjKeyword: `Whole Foods & Target rollout`,
        eventPhrase: `scaling fulfillment for the Whole Foods & Target expansion`,
        warmCongratsSingle: `Huge congratulations on ${companyName}’s upcoming national rollout with Whole Foods and Target`,
        warmCombinedPrimary: `${companyName}’s national rollout with Whole Foods and Target`,
        warmCombinedSecondary: `the 3,200-store expansion with Whole Foods and Target`,
        subjLineStep1: `${firstName} — congrats on ${companyName}'s Whole Foods & Target rollout (+ a quick thought)`,
        subjLineStep2: `${firstName} — congrats on the Whole Foods & Target expansion!`,
        subjLineStep3: `Quick fulfillment automation idea for ${companyName}'s retail rollout, ${firstName}`,
        subjLineStep4: `Cheering on ${companyName}'s retail launch, ${firstName}!`,
      };
    }

    if (/southeast\s+asia/i.test(combinedText)) {
      return {
        archetype: 'expansion',
        shortHook: `the Southeast Asia market expansion`,
        subjKeyword: `Southeast Asia expansion`,
        eventPhrase: `gearing up for the Southeast Asia market entry`,
        warmCongratsSingle: `Congratulations on ${companyName}’s upcoming expansion into Southeast Asia`,
        warmCombinedPrimary: `${companyName}’s expansion into Southeast Asia`,
        warmCombinedSecondary: `the 2027 Southeast Asia expansion`,
        subjLineStep1: `${firstName} — ${companyName}'s Southeast Asia expansion (+ a quick architecture note)`,
        subjLineStep2: `${firstName} — exciting news on ${companyName}'s Southeast Asia push!`,
        subjLineStep3: `Quick multi-region data playbook for ${companyName}, ${firstName}`,
        subjLineStep4: `Wishing ${companyName} huge success in Southeast Asia, ${firstName}!`,
      };
    }

    const locMatch = combinedText.match(/\bin\s+([A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+)?)(?=[,.\s]|$)/);
    const loc = locMatch ? locMatch[1].trim() : 'new regional';
    return {
      archetype: 'expansion',
      shortHook: `the ${loc} hub expansion`,
      subjKeyword: `${loc} hub rollout`,
      eventPhrase: `bringing the new ${loc} capacity online`,
      warmCongratsSingle: `Congratulations on ${companyName}’s new ${loc} expansion`,
      warmCombinedPrimary: `opening the new ${loc} facilities`,
      warmCombinedSecondary: `the new ${loc} expansion`,
      subjLineStep1: `${firstName} — congrats on ${companyName}'s ${loc} expansion (+ a quick workflow idea)`,
      subjLineStep2: `${firstName} — congrats on the new ${loc} rollout at ${companyName}!`,
      subjLineStep3: `Quick cross-site automation playbook for ${companyName}'s ${loc} rollout, ${firstName}`,
      subjLineStep4: `Wishing ${companyName} a smooth launch in ${loc}, ${firstName}!`,
    };
  }

  // 7. HIRING / TALENT SURGE
  if (/^hiring\s+|\bopen\s+roles\s+for\b/i.test(raw)) {
    const roles = trimDanglingWords(
      raw
        .replace(/^hiring\s+/i, '')
        .replace(/\s+on linkedin.*$/i, '')
    );
    const shortRoles = roles.replace(/^\d+\s+/, '');
    return {
      archetype: 'hiring',
      shortHook: `growing the ${roles} team`,
      subjKeyword: `scaling ${companyName}'s ${shortRoles} team`,
      eventPhrase: `expanding your ${shortRoles} team`,
      warmCongratsSingle: `It’s great to see ${companyName} growing fast and expanding the ${roles} team`,
      warmCombinedPrimary: `${companyName}’s push to hire ${roles}`,
      warmCombinedSecondary: `expanding the team with new ${roles}`,
      subjLineStep1: `${firstName} — scaling ${companyName}'s ${shortRoles} roadmap (+ a quick idea)`,
      subjLineStep2: `${firstName} — exciting growth on ${companyName}'s engineering team!`,
      subjLineStep3: `Helping ${companyName}'s team ship faster while you hire, ${firstName}`,
      subjLineStep4: `Wishing you great hires for the ${shortRoles} team, ${firstName}!`,
    };
  }

  // 8. LEGACY MIGRATION / TMS / ERP
  if (/migration|legacy\s+tms|erp/i.test(raw)) {
    const cleanMig = trimDanglingWords(rawWithoutCompany.replace(/\s*initiative$/i, ''));
    const loweredMig = cleanMig.charAt(0).toLowerCase() + cleanMig.slice(1);
    return {
      archetype: 'product_tech',
      shortHook: `the ${loweredMig}`,
      subjKeyword: `${companyName}'s ${loweredMig}`,
      eventPhrase: `modernizing core systems during the ${loweredMig}`,
      warmCongratsSingle: `I’ve been following ${companyName}’s progress on the ${loweredMig}`,
      warmCombinedPrimary: `the ${loweredMig}`,
      warmCombinedSecondary: `the ${loweredMig}`,
      subjLineStep1: `${firstName} — ${companyName}'s ${loweredMig} (+ a quick integration thought)`,
      subjLineStep2: `${firstName} — quick question on ${companyName}'s ${loweredMig}`,
      subjLineStep3: `A 2-page playbook for ${companyName}'s ${loweredMig}, ${firstName}`,
      subjLineStep4: `Wishing ${companyName} a smooth ${loweredMig}, ${firstName}!`,
    };
  }

  // 9. WEBSITE POSITIONING / SLOGAN (e.g. "Website focus: VELOCITY IS SURVIVAL" or "Flexible solutions for every business model")
  if (isWebsiteFocus) {
    let focusConcept = 'scaling intelligent enterprise workflows end-to-end';
    if (/digital\s+workforce|digital\s+employees/i.test(combinedText)) {
      focusConcept = 'scaling AI digital employees that own work end-to-end';
    } else if (/payments|billing|money\s+movement/i.test(combinedText)) {
      focusConcept = 'scaling flexible payments and financial infrastructure';
    } else if (raw.length > 0 && raw.length <= 45 && raw !== raw.toUpperCase()) {
      focusConcept = `delivering ${trimDanglingWords(raw.toLowerCase())}`;
    }

    return {
      archetype: 'product_tech',
      shortHook: focusConcept,
      subjKeyword: `${companyName}'s AI & platform velocity`,
      eventPhrase: focusConcept,
      warmCongratsSingle: `I really love ${companyName}’s focus on ${focusConcept}`,
      warmCombinedPrimary: `${companyName}’s focus on ${focusConcept}`,
      warmCombinedSecondary: `your focus on ${focusConcept}`,
      subjLineStep1: `${firstName} — loved ${companyName}'s focus on ${focusConcept.replace(/^scaling\s+/i, '')}`,
      subjLineStep2: `${firstName} — big fan of what ${companyName} is building!`,
      subjLineStep3: `Quick architecture idea for ${companyName}'s platform velocity, ${firstName}`,
      subjLineStep4: `Cheering ${companyName} on from the sidelines, ${firstName}!`,
    };
  }

  // 10. GENERAL PRODUCT LAUNCH / AI / PRESS HEADLINES (e.g. "Production-grade AI agents for financial compliance", "Mirakl & Stripe Launch Agentic Commerce Infrastructure")
  const cleanQuotes = rawWithoutCompany.replace(/["“”]/g, '').trim();

  // Handle headlines starting with a verb like "Launches Platform for Sales Tax..." or "Launch Agentic Commerce..."
  let naturalTopic = cleanQuotes;
  if (/^(launches|launch|unveils|introduces|rolls\s+out)\s+/i.test(naturalTopic)) {
    const rest = trimDanglingWords(
      naturalTopic.replace(/^(launches|launch|unveils|introduces|rolls\s+out)\s+/i, '')
    );
    naturalTopic = `launching ${rest.charAt(0).toLowerCase() + rest.slice(1)}`;
  } else if (/^mirakl\s*&\s*stripe\s+launch\s+/i.test(cleanQuotes)) {
    const rest = trimDanglingWords(cleanQuotes.replace(/^mirakl\s*&\s*stripe\s+launch\s+/i, ''));
    naturalTopic = `launching ${rest.toLowerCase()} with Mirakl`;
  } else if (/singularity\s+has\s+begun/i.test(cleanQuotes)) {
    naturalTopic = `Stripe’s push into next-generation agentic AI`;
  } else {
    const words = cleanQuotes.split(/\s+/);
    const sliced = words.length > 8 ? words.slice(0, 8).join(' ') : cleanQuotes;
    const trimmed = trimDanglingWords(sliced);
    naturalTopic = trimmed.replace(/^[A-Z][a-z]+/, (m) => m.toLowerCase());
  }

  const pubSource = sig.src && !/google news|live html/i.test(sig.src) ? sig.src : '';
  const sourceMention = pubSource ? ` in ${pubSource}` : '';

  return {
    archetype: 'product_tech',
    shortHook: naturalTopic.startsWith('launching ') ? naturalTopic : `your work on ${naturalTopic}`,
    subjKeyword: `${companyName}'s ${trimDanglingWords(naturalTopic.replace(/^launching\s+/i, '').split(/\s+/).slice(0, 4).join(' '))}`,
    eventPhrase: naturalTopic.startsWith('launching ') ? naturalTopic : `scaling ${naturalTopic}`,
    warmCongratsSingle: `I really enjoyed reading${sourceMention} about ${companyName}’s momentum with ${naturalTopic}`,
    warmCombinedPrimary: `${companyName}’s work on ${naturalTopic}`,
    warmCombinedSecondary: `the recent update${sourceMention} on ${naturalTopic}`,
    subjLineStep1: `${firstName} — loved reading about ${companyName}'s ${trimDanglingWords(
      naturalTopic.replace(/^(launching|your work on)\s+/i, '').split(/\s+/).slice(0, 6).join(' ')
    )} (+ a quick thought)`,
    subjLineStep2: `${firstName} — loved the recent update on ${companyName}!`,
    subjLineStep3: `Quick architecture idea for ${companyName}'s roadmap, ${firstName}`,
    subjLineStep4: `Cheering ${companyName} on from the sidelines, ${firstName}!`,
  };
}

/**
 * Lowercases offering names for mid-sentence flow while preserving uppercase acronyms like AI, ERP, IoT, QA,
 * and sanitizing any scraped marketing slogans into clean capability phrases.
 */
function formatOfferingMidSentence(offeringName: string): string {
  const raw = (offeringName || 'Enterprise AI platform').trim();
  if (/engineer for business|what else can you build|key technologies|everyday ai/i.test(raw)) {
    return 'enterprise AI & workflow automation';
  }
  return raw
    .toLowerCase()
    .replace(/\bai\b/g, 'AI')
    .replace(/\berp\b/g, 'ERP')
    .replace(/\biot\b/g, 'IoT')
    .replace(/\bqa\b/g, 'QA')
    .replace(/\brag\b/g, 'RAG');
}

/**
 * Generates warm, polite, contextually accurate operational insights and value propositions
 * tailored to the prospect's TRUE industry, signal archetype, and selected Algoworks offering.
 */
function buildContextualValueProp(
  archetype: DistilledSignalHook['archetype'],
  role: string,
  dept: string,
  ind: string,
  offeringName: string,
  companyName: string,
  sellerName: string,
  tone: Tone
): {
  insightParagraph: string;
  pokeTheBearQuestion: string;
  valueParagraph: string;
} {
  const offLower = formatOfferingMidSentence(offeringName);
  const cleanInd = cleanIndustryLabel(ind);
  const peers = naturalPeerGroup(role, ind);

  // 1. Industrial / Mill / Furnace Modernization (ONLY when genuinely industrial!)
  if (archetype === 'industrial') {
    return {
      insightParagraph: `When ${peers} roll out a major furnace or mill modernization, the toughest hurdle before commissioning usually isn't installing the hardware—it's unifying high-frequency sensor telemetry across legacy PLCs and historian systems so predictive maintenance models have clean, reliable data.`,
      pokeTheBearQuestion: `As the new hardware comes online at ${companyName}, how is your team keeping legacy PLC and historian data silos from slowing down your predictive maintenance models?`,
      valueParagraph: `At ${sellerName}, we built our ${offLower} specifically to unify real-time plant telemetry and automate anomaly detection pipelines in weeks—without pulling your plant engineers off the floor.`,
    };
  }

  // 2. High-Growth Funding / Founder Story / AI & SaaS Product Scale-up (e.g. Zamp, Stripe)
  if (archetype === 'funding' || archetype === 'founder_story') {
    return {
      insightParagraph: `When fast-growing ${cleanInd} teams scale right after a major funding milestone, the biggest hidden drag on velocity usually isn't the core product or AI models—it's senior engineers getting pulled off flagship features just to wrangle custom ERP connectors, messy client data pipelines, and compliance guardrails.`,
      pokeTheBearQuestion: `As ${companyName} scales across more enterprise workflows this year, how are you keeping custom data integrations and orchestration plumbing from eating into core engineering velocity?`,
      valueParagraph: `At ${sellerName}, we help high-growth engineering teams deploy governed ${offLower} pipelines and automated cross-system integrations in weeks—so your core team can stay 100% focused on the product roadmap.`,
    };
  }

  // 3. M&A / Post-Acquisition Integration
  if (archetype === 'ma') {
    const isSoftwareOrFintech = /fintech|ai|software|cloud|payment|tech/i.test(ind);
    if (isSoftwareOrFintech) {
      return {
        insightParagraph: `When ${peers} bring a newly acquired AI or platform capability into the fold, the hidden bottleneck is rarely the vision—it's unifying model routing, real-time telemetry, and enterprise governance across both stacks without slowing down product shipping.`,
        pokeTheBearQuestion: `As you integrate these capabilities into ${companyName}’s core stack, how is your team keeping cross-platform data and governance plumbing from slowing down Q4 delivery?`,
        valueParagraph: `At ${sellerName}, we help ${cleanInd} engineering teams stand up unified ${offLower} architectures and automated data pipelines in weeks rather than quarters.`,
      };
    }
    return {
      insightParagraph: `When ${peers} integrate newly acquired facilities, the real bottleneck usually isn't on the production floor—it's harmonizing SKU, inventory, and QA data across disparate ERPs before forecast blind spots creep in.`,
      pokeTheBearQuestion: `As you bring those new facilities onto ${companyName}’s core stack, how is your team avoiding months of manual ERP and QA data reconciliation?`,
      valueParagraph: `At ${sellerName}, we help ${cleanInd} teams use our ${offLower} to unify multi-site data pipelines and automate cross-system handoffs in weeks instead of quarters.`,
    };
  }

  // 4. New Leadership Appointment (CTO / CIO / COO)
  if (archetype === 'leadership') {
    return {
      insightParagraph: `When a ${role} steps into a new mandate during an active growth phase, the biggest early hurdle usually isn't setting the architecture vision—it's untangling brittle data handoffs and manual glue code so they don't slow down your first-90-day wins.`,
      pokeTheBearQuestion: `As you shape ${companyName}’s roadmap this quarter, how are you keeping legacy integration debt from pulling your best engineers off high-impact initiatives?`,
      valueParagraph: `At ${sellerName}, we partner with ${peers} to stand up production-ready ${offLower} foundations and governance in weeks—without a disruptive 6-month replatforming freeze.`,
    };
  }

  // 5. Geographic / Hub / Retail Expansion
  if (archetype === 'expansion') {
    return {
      insightParagraph: `When ${peers} bring new regional hubs or retail distribution channels online, the biggest headache is often fragmented partner, ERP, and telemetry data quietly creating manual reconciliation work for operations teams.`,
      pokeTheBearQuestion: `As volume scales across new locations, how is your team preventing fragmented cross-site data from turning into manual fire drills?`,
      valueParagraph: `At ${sellerName}, we built our ${offLower} capabilities to unify multi-site data streams and automate cross-system workflows before new capacity goes live.`,
    };
  }

  // 6. Hiring / Engineering Capacity Expansion
  if (archetype === 'hiring') {
    return {
      insightParagraph: `When ${cleanInd} teams open multiple technical roles at once, it’s often because underlying data plumbing and cross-system integrations are eating up senior engineering bandwidth right when the product roadmap is accelerating.`,
      pokeTheBearQuestion: `While your new engineering hires ramp up, how is your team keeping data pipeline and workflow backlogs from slowing down delivery?`,
      valueParagraph: `At ${sellerName}, we help ${cleanInd} teams automate that underlying ${offLower} layer immediately—so your engineers can focus on shipping core innovation from day one.`,
    };
  }

  // 7. Default Product / AI / Tech Initiative
  return {
    insightParagraph:
      tone === 'Consultative'
        ? `When ${cleanInd} leaders push an ambitious initiative like this into production, the hidden drag is almost always unifying real-time data pipelines and compliance guardrails across existing systems.`
        : `As initiatives like this scale across ${companyName}, the toughest part is rarely the core software or AI model—it's getting clean, governed data flowing across systems without pulling senior engineers off the main roadmap.`,
    pokeTheBearQuestion: `How is your team making sure cross-system data and integration bottlenecks don't slow down your rollout over the next two quarters?`,
    valueParagraph: `At ${sellerName}, we help ${peers} deploy our ${offLower} to automate those underlying pipelines and cut months of custom integration work out of the critical path.`,
  };
}

/**
 * Converts an offering name into a natural plural/actionable capability phrase for subject lines
 * (so we never say "automates enterprise AI platform" or "unifies data pipeline toolkit").
 */
function formatOfferingForSubject(offeringName: string): string {
  const raw = (offeringName || '').trim();
  if (/data\s+pipeline\s+toolkit/i.test(raw)) return 'real-time data pipelines';
  if (/enterprise\s+ai\s+platform/i.test(raw)) return 'enterprise AI & data pipelines';
  if (/workflow\s+automation/i.test(raw)) return 'cross-system workflow automation';
  if (/engineer for business|what else can you build|key technologies|everyday ai/i.test(raw)) {
    return 'enterprise AI & workflow automation';
  }
  return formatOfferingMidSentence(raw);
}

/**
 * Builds catchy, high-converting subject lines that directly address the specific problem
 * the prospect company is facing (from their live signal) and state how our company solves it.
 */
function buildProblemSolutionSubjects(
  archetype: DistilledSignalHook['archetype'],
  priHook: DistilledSignalHook,
  companyName: string,
  sellerName: string,
  offeringName: string,
  shortName: string,
  role: string,
  ind: string
): {
  step1: string;
  step2: string;
  step3: string;
  step4: string;
} {
  const offSubj = formatOfferingForSubject(offeringName);

  if (archetype === 'industrial') {
    return {
      step1: `Solving ${companyName}'s legacy PLC & sensor data silos during mill modernization — how ${sellerName} automates ${offSubj}`,
      step2: `Unifying plant-floor telemetry at ${companyName} with ${sellerName}`,
      step3: `How ${sellerName} eliminates sensor pipeline blind spots for ${companyName}'s plant commissioning`,
      step4: `Removing predictive-maintenance data bottlenecks at ${companyName} — ${sellerName} is ready when you are, ${shortName}`,
    };
  }

  if (archetype === 'funding' || archetype === 'founder_story') {
    return {
      step1: `Stopping custom integration debt from slowing ${companyName}'s post-funding velocity — how ${sellerName} solves it`,
      step2: `Protecting ${companyName}'s core engineering bandwidth with ${sellerName}`,
      step3: `How ${sellerName} offloads ${offSubj} plumbing so ${companyName}'s engineers ship 2x faster`,
      step4: `Eliminating scaling bottlenecks on ${companyName}'s roadmap — ${sellerName} is here when timing aligns, ${shortName}`,
    };
  }

  if (archetype === 'ma') {
    return {
      step1: `Solving post-acquisition stack & data silos at ${companyName} — how ${sellerName} unifies ${offSubj} in weeks`,
      step2: `Eliminating post-merger integration friction at ${companyName} with ${sellerName}`,
      step3: `How ${sellerName} cuts post-acquisition data & workflow integration from quarters to weeks for ${companyName}`,
      step4: `De-risking ${companyName}'s stack integration — ${sellerName} is ready when you are, ${shortName}`,
    };
  }

  if (archetype === 'leadership') {
    const rName = /^(CTO|CIO|CDO|COO|CEO)$/i.test(role) ? role.toUpperCase() : 'leadership';
    return {
      step1: `Clearing brittle data handoffs in your first 90 days at ${companyName} — how ${sellerName} solves it`,
      step2: `Removing legacy integration bottlenecks on ${companyName}'s ${rName} roadmap with ${sellerName}`,
      step3: `How ${sellerName} solves cross-system ${offSubj} debt for ${companyName} without a 6-month freeze`,
      step4: `Eliminating technical debt on ${companyName}'s roadmap — ${sellerName} is here when needed, ${shortName}`,
    };
  }

  if (archetype === 'expansion') {
    const isRetailRollout = /whole\s+foods|target|retail/i.test(priHook.shortHook);
    if (isRetailRollout) {
      return {
        step1: `Solving ${companyName}'s 3,200-store fulfillment & QA data bottlenecks — how ${sellerName} automates ${offSubj}`,
        step2: `Eliminating retail rollout fulfillment friction at ${companyName} with ${sellerName}`,
        step3: `How ${sellerName} stops manual ERP & supply-chain fire drills during ${companyName}'s national expansion`,
        step4: `Keeping ${companyName}'s retail expansion bottleneck-free — ${sellerName} is ready when you are, ${shortName}`,
      };
    }
    return {
      step1: `Solving multi-site ERP & data silos in ${companyName}'s expansion — how ${sellerName} automates ${offSubj}`,
      step2: `Eliminating cross-site coordination bottlenecks at ${companyName} with ${sellerName}`,
      step3: `How ${sellerName} removes manual reconciliation across ${companyName}'s new hubs in under 45 days`,
      step4: `Solving multi-region scaling bottlenecks at ${companyName} — ${sellerName} is here when timing aligns, ${shortName}`,
    };
  }

  if (archetype === 'hiring') {
    return {
      step1: `Stopping data-plumbing backlogs while ${companyName} scales hiring — how ${sellerName} bridges the gap`,
      step2: `Solving ${companyName}'s engineering bandwidth crunch with ${sellerName}`,
      step3: `How ${sellerName} automates ${offSubj} today so ${companyName}'s team ships without waiting on new hires`,
      step4: `Keeping ${companyName}'s delivery on schedule while you hire — ${sellerName} is ready when you are, ${shortName}`,
    };
  }

  // Default product / tech / migration / industry-specific bottlenecks
  if (/migration|legacy\s+tms|erp/i.test(priHook.shortHook)) {
    return {
      step1: `Eliminating legacy migration downtime & data silos at ${companyName} — how ${sellerName} solves it`,
      step2: `De-risking ${companyName}'s legacy cutover with ${sellerName}`,
      step3: `How ${sellerName} automates zero-disruption ${offSubj} migration for ${companyName} in 6 weeks`,
      step4: `Solving ${companyName}'s system migration bottlenecks — ${sellerName} is ready when you are, ${shortName}`,
    };
  }

  if (/logistics|supply\s+chain/i.test(ind)) {
    return {
      step1: `Eliminating cross-hub freight & TMS data blind spots at ${companyName} — how ${sellerName} solves it`,
      step2: `Solving supply-chain data bottlenecks at ${companyName} with ${sellerName}`,
      step3: `How ${sellerName} automates real-time shipment & ERP reconciliation for ${companyName}`,
      step4: `Removing supply-chain scaling hurdles at ${companyName} — ${sellerName} is ready when you are, ${shortName}`,
    };
  }

  if (/heavy\s+manufacturing|steel/i.test(ind)) {
    return {
      step1: `Eliminating legacy PLC & plant-floor telemetry silos at ${companyName} — how ${sellerName} solves it`,
      step2: `Unifying plant-floor telemetry at ${companyName} with ${sellerName}`,
      step3: `How ${sellerName} automates predictive maintenance & sensor pipelines for ${companyName}`,
      step4: `Removing plant engineering bottlenecks at ${companyName} — ${sellerName} is ready when you are, ${shortName}`,
    };
  }

  if (/manufacturing/i.test(ind)) {
    return {
      step1: `Solving multi-plant ERP & production data silos at ${companyName} — how ${sellerName} automates ${offSubj}`,
      step2: `Eliminating plant-to-ERP workflow bottlenecks at ${companyName} with ${sellerName}`,
      step3: `How ${sellerName} cuts manual cross-plant data reconciliation by 60% for ${companyName}`,
      step4: `Removing production scaling hurdles at ${companyName} — ${sellerName} is here when timing is right, ${shortName}`,
    };
  }

  if (/fintech|payment/i.test(ind)) {
    return {
      step1: `Solving real-time AI routing & compliance pipeline bottlenecks at ${companyName} — how ${sellerName} accelerates delivery`,
      step2: `Eliminating financial data & compliance plumbing bottlenecks at ${companyName} with ${sellerName}`,
      step3: `How ${sellerName} offloads custom ${offSubj} plumbing so ${companyName}'s engineers ship 2x faster`,
      step4: `Removing production AI & payment pipeline hurdles at ${companyName} — ${sellerName} is ready when you are, ${shortName}`,
    };
  }

  if (/cloud|security/i.test(ind)) {
    return {
      step1: `Eliminating enterprise AI inference & data-pipeline bottlenecks at ${companyName} — how ${sellerName} solves it`,
      step2: `Solving high-throughput AI orchestration bottlenecks at ${companyName} with ${sellerName}`,
      step3: `How ${sellerName} cuts custom ${offSubj} integration work by 60% for ${companyName}`,
      step4: `Removing platform scaling hurdles at ${companyName} — ${sellerName} is here when timing aligns, ${shortName}`,
    };
  }

  if (/e-?commerce|retail/i.test(ind)) {
    return {
      step1: `Solving high-volume merchant data & AI workflow bottlenecks at ${companyName} — how ${sellerName} accelerates shipping`,
      step2: `Eliminating commerce data-pipeline bottlenecks at ${companyName} with ${sellerName}`,
      step3: `How ${sellerName} automates cross-platform ${offSubj} for ${companyName} in weeks`,
      step4: `Removing commerce scaling hurdles at ${companyName} — ${sellerName} is ready when you are, ${shortName}`,
    };
  }

  if (/hospital|health|medical/i.test(ind) || /hospital/i.test(companyName)) {
    return {
      step1: `Eliminating fragmented patient-care & clinical workflow silos at ${companyName} — how ${sellerName} solves it`,
      step2: `Solving clinical & operational data silos at ${companyName} with ${sellerName}`,
      step3: `How ${sellerName} unifies hospital data & automated workflows for ${companyName}`,
      step4: `Removing operational data hurdles at ${companyName} — ${sellerName} is here when timing is right, ${shortName}`,
    };
  }

  const cleanInd = cleanIndustryLabel(ind);
  return {
    step1: `Solving ${companyName}'s cross-system data & scaling bottlenecks — how ${sellerName} accelerates ${offSubj}`,
    step2: `Eliminating engineering bottlenecks on ${companyName}'s ${cleanInd} roadmap with ${sellerName}`,
    step3: `How ${sellerName} cuts custom ${offSubj} integration work by 60% for ${companyName}`,
    step4: `Removing production scaling hurdles at ${companyName} — ${sellerName} is here when timing is right, ${shortName}`,
  };
}

export function buildStepContent(
  p: Omit<Prospect, 'sequence'>,
  stepIdx: number,
  tone: Tone = 'Warm & Catchy',
  len: Length = 'Standard',
  settings?: CompanySettings,
  overrideCh?: Channel
): SequenceStep {
  const tpl = SEQ_TEMPLATE[stepIdx] || {
    step: stepIdx + 1,
    day: `Day ${(stepIdx + 1) * 3 + 1}`,
    label: `Follow-up #${stepIdx}`,
    ch: 'LinkedIn' as Channel,
    goal: 'Warm check-in and architecture benchmark share',
  };
  const ch = overrideCh || tpl.ch;
  const person = p.people[p.contactIdx] || p.people[0] || {
    name: 'Executive Team',
    role: 'Leader',
    dept: 'Technology',
    bio: '',
    li: '',
  };
  const { salutation, shortName } = formatRecipientGreeting(person.name, tone);
  const isCustom = p.ang === 'c' && Boolean(p.custom);
  const angObj = isCustom
    ? { t: p.custom, off: settings?.offerings[0]?.name || 'Enterprise AI platform', d: p.custom }
    : p.angles[typeof p.ang === 'number' ? p.ang : 0] || p.angles[0];

  const sigs = p.signals.filter((x) => p.sel.includes(x.id));
  const priSig = sigs[0] || p.signals[0];
  const secSig = sigs[1] || p.signals[1] || priSig;
  const seller = settings?.companyName || 'Algoworks';
  const sender = settings?.senderName || 'GODY';
  const cleanInd = cleanIndustryLabel(p.ind);

  const priHook = distillSignalToNaturalHook(priSig, p.name, person.role, shortName);
  const secHook = distillSignalToNaturalHook(secSig, p.name, person.role, shortName);

  // If primary signal is a founder story and secondary is funding, use funding for the operational value prop archetype
  const effectiveArchetype =
    priHook.archetype === 'founder_story' && secHook.archetype !== 'founder_story'
      ? secHook.archetype
      : priHook.archetype;

  const valueProp = buildContextualValueProp(
    effectiveArchetype,
    person.role,
    person.dept,
    p.ind,
    angObj.off,
    p.name,
    seller,
    tone
  );

  const probSolSubjects = buildProblemSolutionSubjects(
    effectiveArchetype,
    priHook,
    p.name,
    seller,
    angObj.off,
    shortName,
    person.role,
    p.ind
  );

  const hasDistinctSecondary =
    sigs.length > 1 &&
    secSig &&
    secSig.id !== priSig?.id &&
    secHook.warmCombinedSecondary !== priHook.warmCombinedPrimary;

  const warmSignOff = `Warm regards,\n${sender}\n${seller}`;

  let subj = '';
  let body = '';

  if (stepIdx === 0) {
    // Problem-focused + how our company solves it catchy subject line
    subj = isCustom
      ? `Solving ${p.name}'s ${trimDanglingWords(
          p.custom.toLowerCase().split(/\s+/).slice(0, 5).join(' ')
        )} bottlenecks — how ${seller} delivers it`
      : probSolSubjects.step1;

    // Polite, warm, catchy opening paragraph that makes immediate sense
    let opener = '';
    if (isCustom) {
      opener = `Hope your week is going well! ${priHook.warmCongratsSingle}—as your team scales, I was curious how you’re approaching ${p.custom.toLowerCase()} at ${p.name}.`;
    } else if (hasDistinctSecondary) {
      if (secHook.archetype === 'founder_story') {
        opener = `Hope you’re having a great week! ${priHook.warmCongratsSingle}—and ${secHook.warmCombinedSecondary}.`;
      } else {
        opener = `Hope you’re having a great week! ${priHook.warmCongratsSingle}—and seeing ${secHook.warmCombinedSecondary} makes it clear how fast things are moving at ${p.name} right now.`;
      }
    } else {
      opener = `Hope you’re having a great week! ${priHook.warmCongratsSingle}—it’s an exciting time for the ${p.name} team.`;
    }

    const coreInsight =
      tone === 'Conversational'
        ? `${valueProp.pokeTheBearQuestion}\n\n${valueProp.valueParagraph}`
        : `${valueProp.insightParagraph}\n\n${valueProp.valueParagraph}`;

    const proofDetail =
      len === 'Detailed'
        ? `\n\nFor quick context, we recently helped a similar ${cleanInd} team stand up governed production pipelines in under six weeks—giving their leadership full visibility without pulling core engineers off their primary roadmap.`
        : '';

    const cta = isCustom
      ? `Would you be open to a quick 10-minute chat next week to trade notes on ${p.custom.toLowerCase()}, or seeing a short 2-page playbook on how we’ve set this up? Either way, wishing you and the ${p.name} team continued success!`
      : `Would you be open to a quick look at the 2-page architecture playbook we used for a similar ${cleanInd} scale-up, or a brief 10-minute chat next week? Either way, wishing you and the ${p.name} team continued momentum!`;

    body =
      ch === 'Email'
        ? `${salutation}\n\n${opener}\n\n${
            len === 'Short'
              ? `${valueProp.pokeTheBearQuestion}\n\n${valueProp.valueParagraph}\n\n`
              : `${coreInsight}${proofDetail}\n\n`
          }${cta}\n\n${warmSignOff}`
        : `${salutation} hope your week is going well! ${priHook.warmCongratsSingle}. ${valueProp.pokeTheBearQuestion} Would love to share a quick 2-page playbook on how peer ${cleanInd} teams solved this with our ${formatOfferingMidSentence(angObj.off)} if helpful!`;
  } else if (stepIdx === 1) {
    subj = probSolSubjects.step2;
    const secMention =
      hasDistinctSecondary && secHook.archetype === 'founder_story'
        ? ` (${secHook.warmCombinedSecondary}!)`
        : '';
    const hookWithCompany = priHook.shortHook.toLowerCase().includes(p.name.toLowerCase())
      ? priHook.shortHook
      : `${priHook.shortHook} at ${p.name}`;

    body = `${salutation} hope your week is going great! Sent a quick note by email earlier regarding ${hookWithCompany}${secMention}.\n\nCurious: ${
      valueProp.pokeTheBearQuestion.charAt(0).toLowerCase() + valueProp.pokeTheBearQuestion.slice(1)
    }${
      len === 'Detailed'
        ? `\n\nAlways happy to share a concise 1-page architecture breakdown on how peer ${naturalPeerGroup(
            person.role,
            p.ind
          )} handle this with ${seller}—would love to stay connected here!`
        : `\n\nWould love to stay connected here either way!`
    }`;
  } else if (stepIdx === 2) {
    subj = probSolSubjects.step3;
    const secondHookRef = hasDistinctSecondary
      ? `Hope your week is going smoothly! Thinking about ${priHook.shortHook} alongside ${secHook.shortHook}, keeping cross-system data and workflow handoffs clean usually becomes the #1 priority for ${person.dept.toLowerCase()} teams.`
      : `Hope your week is going smoothly! Following up briefly on my note about ${priHook.shortHook}—most ${naturalPeerGroup(
          person.role,
          p.ind
        )} tell us that cross-system integrations only get busier once rollout hits full stride.`;

    const blueprintOffer = `We recently helped a fast-moving ${cleanInd} team in a very similar spot deploy our ${formatOfferingMidSentence(angObj.off)} to automate data reconciliation and workflow orchestration in under 45 days—freeing their core engineers to focus 100% on product velocity.`;

    const step3Cta = `Would you be open to me sending over the 2-page teardown of how they architected it? No pressure at all—just thought it might be a useful reference for your team.`;

    body =
      ch === 'Email'
        ? `${salutation}\n\n${secondHookRef}\n\n${
            len === 'Short' ? '' : `${blueprintOffer}\n\n`
          }${step3Cta}\n\n${warmSignOff}`
        : `${salutation} quick thought as ${p.name} moves forward on ${priHook.shortHook}: we just put together a short 2-page teardown on how a peer ${cleanInd} team automated those cross-system workflows in 45 days. Open to me dropping it here for you?`;
  } else {
    subj = probSolSubjects.step4;
    const rawAngleTopic = trimDanglingWords(
      angObj.t
        .replace(new RegExp(`^${p.ind.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*`, 'i'), '')
        .replace(new RegExp(`^${p.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*`, 'i'), '')
        .replace(/\bacceleration\b/gi, 'execution')
        .toLowerCase()
        .replace(/\bai\b/g, 'AI')
    );
    const cleanAngleTopic = rawAngleTopic || `your ${formatOfferingMidSentence(angObj.off)} roadmap`;
    const hookWithCompany = priHook.shortHook.toLowerCase().includes(p.name.toLowerCase())
      ? priHook.shortHook
      : `${priHook.shortHook} at ${p.name}`;

    body =
      ch === 'Email'
        ? `${salutation}\n\nI can imagine how packed your schedule is as ${person.role} with ${hookWithCompany} in full swing, so I’ll make this my last note for now.\n\n${
            len === 'Short'
              ? ''
              : `If scaling ${cleanAngleTopic} or freeing up engineering bandwidth ever becomes a priority later this year, I’d always be delighted to share what’s working for other ${cleanInd} teams.\n\n`
          }Until then, wishing you and the entire ${p.name} team huge success with the rollout!\n\n${warmSignOff}`
        : `${salutation} know you're heads-down with ${hookWithCompany}, so I'll pause reaching out after this. Wishing you and the team continued success, and always glad to trade notes on ${cleanAngleTopic} down the road!`;
  }

  return {
    step: tpl.step,
    day: tpl.day,
    label: tpl.label,
    ch,
    goal: tpl.goal,
    subj,
    body,
    appr: false,
  };
}

export function buildFullSequence(
  p: Omit<Prospect, 'sequence'>,
  tone: Tone = 'Warm & Catchy',
  len: Length = 'Standard',
  settings?: CompanySettings
): SequenceStep[] {
  return SEQ_TEMPLATE.map((_, idx) => buildStepContent(p, idx, tone, len, settings));
}

const WARM_CATCHY_COPYWRITING_RULES = `
POLITE, CATCHY & WARM HIGH-OPEN-RATE B2B COPYWRITING RULES:
1. TONE & PERSONALITY (POLITE, CATCHY, WARM & HUMAN):
   - Every message MUST sound like it was written by a warm, polite, sharp, and genuinely enthusiastic peer who truly admires what the recipient and their company are building.
   - Start with a warm, polite greeting (e.g., "Hi Raghav,\\n\\nHope you’re having a great week! First off, huge congratulations on...") that celebrates their real achievement or news signal naturally.
   - NEVER use nonsensical Mad-Libs or broken grammar (never paste raw headline fragments like "the raises $30m" or "your work on he skipped college to intern with"). Paraphrase every signal into smooth, natural human English.

2. CONTEXTUAL ACCURACY (100% LOGICAL ALIGNMENT):
   - Match the operational insight strictly to the company's ACTUAL industry and signal:
     * If they are a FinTech / AI / SaaS company raising capital or launching software (e.g., Zamp raising $30M for a sales tax OS, Stripe launching AI agents), talk about keeping senior engineers focused on core product/AI velocity rather than getting bogged down in custom ERP connectors, data pipelines, and compliance guardrails.
     * NEVER mention steel mills, furnaces, or legacy PLCs unless the company is literally a heavy manufacturing/steel company modernizing a physical furnace or mill!

3. CATCHY PROBLEM + SOLUTION SUBJECT LINES (CRITICAL):
   - Every subject line MUST be catchy, directly address the specific operational or engineering problem the prospect company is facing (inferred from their signal), and explicitly state how our company ([Seller]) solves it!
   - Never write generic "congrats" or vague "quick thought" subject lines. Instead, use the Problem → Solution formula:
     * Step 1 example: "Solving Zamp's post-$30M integration backlog — how Algoworks automates enterprise AI pipelines"
     * Step 1 example (Expansion): "Eliminating Acme's Pune plant data silos — how Algoworks automates multi-site workflows"
     * Step 3 example: "How Algoworks cuts custom ERP & data-pipeline work by 60% for Zamp's engineering team"
     * Step 4 example: "Removing scaling bottlenecks on Zamp's roadmap — Algoworks is ready when you are, Raghav"

4. STRUCTURE & SIGN-OFF:
   - Keep paragraphs crisp (1-2 sentences per paragraph) with clean visual spacing.
   - End with a polite, low-pressure, warm call-to-action ("Would you be open to a quick look at the 2-page architecture playbook we used for a similar scale-up, or a brief 10-minute chat next week? Either way, wishing you and the [Company] team continued momentum!") and sign off warmly with:
     Warm regards,
     [Sender]
     [Seller]
`;

/**
 * LIVE GEMINI AI COPYWRITER:
 * Generates polite, catchy, warm, high-open-rate B2B outreach copy using Gemini 2.5 Flash
 * with fallback to the intelligent deterministic copywriting engine.
 */
export async function generateFullSequenceWithAI(
  p: Omit<Prospect, 'sequence'>,
  tone: Tone = 'Warm & Catchy',
  len: Length = 'Standard',
  settings?: CompanySettings
): Promise<SequenceStep[]> {
  const apiKey = process.env.GEMINI_API_KEY || '';
  const fallback = buildFullSequence(p, tone, len, settings);
  if (!apiKey) return fallback;

  try {
    const person = p.people[p.contactIdx] || p.people[0];
    const { salutation, shortName } = formatRecipientGreeting(person.name, tone);
    const isCustom = p.ang === 'c' && Boolean(p.custom);
    const angObj = isCustom
      ? { t: p.custom, d: p.custom, off: settings?.offerings[0]?.name || 'Enterprise AI platform' }
      : p.angles[typeof p.ang === 'number' ? p.ang : 0] || p.angles[0];
    const selectedSigs = p.signals.filter((x) => p.sel.includes(x.id));
    const seller = settings?.companyName || 'Algoworks';
    const sender = settings?.senderName || 'GODY';

    const wordGuide =
      len === 'Short'
        ? '55-75 words per email (concise, warm, and punchy)'
        : len === 'Detailed'
        ? '110-145 words per email (warm, catchy, with concrete architecture context)'
        : '80-110 words per email (ideal warm, scannable executive length)';

    const prompt = `You are an elite B2B outbound copywriter writing a 4-step sequence on behalf of ${sender} at ${seller} (${settings?.description}).

${WARM_CATCHY_COPYWRITING_RULES}

RECIPIENT CONTEXT:
- Full Name: ${person.name} (First Name: ${shortName})
- Exact Greeting to start with: "${salutation}"
- Role & Department: ${person.role} (${person.dept})
- Bio / Mandate: ${person.bio}
- Company: ${p.name} (${p.domain}, Industry: ${p.ind})
- Company Summary: ${p.summary}

VERIFIED SIGNALS DISCOVERED (Paraphrase warmly and naturally—NEVER copy-paste raw headlines verbatim into broken grammar):
${selectedSigs.map((s, i) => `${i + 1}. [${s.cat}] ${recoverFullHeadline(s)} — ${s.s} (Why it matters: ${s.why} | Source: ${s.src}, ${s.d})`).join('\n')}

SELECTED OUTREACH ANGLE & OFFERING:
- Angle: ${angObj.t} (${angObj.d})
- Seller Offering to Connect: ${angObj.off}

STYLE & FORMAT PARAMETERS:
- Tone: Polite, Catchy, and Warm (${tone})
- Target Length: ${wordGuide}
- Sign-off for Emails (Steps 1, 3, 4):
Warm regards,
${sender}
${seller}

Return ONLY a valid JSON array of 4 objects matching these 4 steps:
[
  {
    "step": 1,
    "day": "Day 1",
    "label": "Initial outreach",
    "ch": "Email",
    "goal": "Warm, catchy milestone hook + tailored operational insight & high-open-rate subject line",
    "subj": "Catchy Problem + Solution subject line addressing the specific bottleneck ${p.name} faces and how ${seller} solves it with ${angObj.off}",
    "body": "Full message body with double line breaks (\\n\\n) between short paragraphs"
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
          temperature: 0.45,
        },
      }),
    });

    if (!res.ok) return fallback;
    const data = await res.json();
    const rawText = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!rawText) return fallback;

    const cleaned = rawText.replace(/^```json\s*/i, '').replace(/```\s*$/i, '').trim();
    const parsed = JSON.parse(cleaned);
    if (!Array.isArray(parsed) || parsed.length === 0) return fallback;

    return SEQ_TEMPLATE.map((tpl, idx) => {
      const aiStep = parsed[idx];
      if (!aiStep || !aiStep.body) return fallback[idx];
      return {
        step: tpl.step,
        day: tpl.day,
        label: tpl.label,
        ch: tpl.ch,
        goal: tpl.goal,
        subj: aiStep.subj || fallback[idx].subj,
        body: aiStep.body,
        appr: false,
      };
    });
  } catch (err) {
    console.warn('Gemini sequence copywriter fallback triggered:', err);
    return fallback;
  }
}

export async function generateSingleStepWithAI(
  p: Omit<Prospect, 'sequence'>,
  stepIdx: number,
  tone: Tone = 'Warm & Catchy',
  len: Length = 'Standard',
  settings?: CompanySettings,
  overrideCh?: Channel
): Promise<SequenceStep> {
  const fallback = buildStepContent(p, stepIdx, tone, len, settings, overrideCh);
  const apiKey = process.env.GEMINI_API_KEY || '';
  if (!apiKey) return fallback;

  try {
    const person = p.people[p.contactIdx] || p.people[0];
    const { salutation, shortName } = formatRecipientGreeting(person.name, tone);
    const isCustom = p.ang === 'c' && Boolean(p.custom);
    const angObj = isCustom
      ? { t: p.custom, d: p.custom, off: settings?.offerings[0]?.name || 'Enterprise AI platform' }
      : p.angles[typeof p.ang === 'number' ? p.ang : 0] || p.angles[0];
    const selectedSigs = p.signals.filter((x) => p.sel.includes(x.id));
    const seller = settings?.companyName || 'Algoworks';
    const sender = settings?.senderName || 'GODY';
    const ch = overrideCh || fallback.ch;

    const wordGuide =
      ch === 'LinkedIn'
        ? len === 'Short'
          ? '30-45 words'
          : '45-65 words'
        : len === 'Short'
        ? '55-75 words'
        : len === 'Detailed'
        ? '110-145 words'
        : '80-110 words';

    const prompt = `Write Step ${fallback.step} (${fallback.day} — ${fallback.label}) of a signal-based B2B outbound sequence via ${ch}.

${WARM_CATCHY_COPYWRITING_RULES}

Sender: ${sender} at ${seller} (${settings?.description}).
Recipient: ${person.name} (First Name: ${shortName}), ${person.role} (${person.dept}) at ${p.name} (${p.ind}).
Bio: ${person.bio}
Exact Greeting to start with: "${salutation}"
Step Goal: ${fallback.goal}.
Selected Angle: ${angObj.t} (${angObj.d}) — connecting to ${angObj.off}.
Signals to weave in warmly and naturally:
${selectedSigs.map((s) => `- [${s.cat}] ${recoverFullHeadline(s)}: ${s.s} (Why it matters: ${s.why})`).join('\n')}
Tone: Polite, Catchy, and Warm (${tone}). Target length: ${wordGuide}.

Return ONLY valid JSON:
{
  "subj": "Catchy Problem + Solution subject line addressing the specific problem ${p.name} is facing and how ${seller} solves it",
  "body": "Complete ${ch} message body with short, warm paragraphs"
}`;

    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          responseMimeType: 'application/json',
          temperature: 0.45,
        },
      }),
    });

    if (!res.ok) return fallback;
    const data = await res.json();
    const rawText = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!rawText) return fallback;

    const parsed = JSON.parse(rawText.replace(/^```json\s*/i, '').replace(/```\s*$/i, '').trim());
    if (!parsed || !parsed.body) return fallback;

    return {
      ...fallback,
      ch,
      subj: parsed.subj || fallback.subj,
      body: parsed.body,
      appr: false,
    };
  } catch {
    return fallback;
  }
}

/**
 * 5-POINT SIGNAL RELEVANCE GENERATOR:
 * Summarizes the news in crisp bullet points and shows the relation how it is relevant
 * for our company, in exactly 5 short, punchy bullet points.
 */
export function generateSignalBullets(
  sig: Signal,
  prospect: { name: string; domain?: string; ind?: string },
  settings?: CompanySettings | null
): [string, string, string, string, string] {
  const seller = settings?.companyName || 'Speer';
  const offeringDesc = settings?.offerings?.[0]?.name
    ? `${settings.offerings[0].name}`
    : 'B2B sales intelligence & outreach automation';
  const cleanHead = recoverFullHeadline(sig)
    .replace(/^Live news coverage from [^:]+:\s*"?/i, '')
    .replace(/"?\s*\.?$/i, '')
    .trim();
  const cat = (sig.cat || 'General').toLowerCase();

  // Bullet 1: Core news summary (crisp, short)
  let b1 = `${prospect.name}: ${cleanHead}`;
  if (b1.length > 115) b1 = b1.slice(0, 112) + '…';

  // Bullet 2: Operational/technical shift
  let b2 = '';
  if (cat.includes('tech')) {
    b2 = 'Modernizing platform infrastructure & automated workflow capabilities at scale';
  } else if (cat.includes('lead')) {
    b2 = 'Leadership transition triggering internal strategy realignment & vendor evaluation';
  } else if (cat.includes('expan') || cat.includes('growth')) {
    b2 = 'Footprint scaling rapidly, driving multi-site coordination & workflow requirements';
  } else if (cat.includes('hir')) {
    b2 = 'Aggressive hiring across key engineering & specialized execution functions';
  } else {
    b2 =
      sig.s && sig.s.length > 15 && !sig.s.startsWith('Live news')
        ? sig.s.slice(0, 110)
        : 'Active operational milestone driving near-term vendor and tooling decisions';
  }

  // Bullet 3: Impacted committee / stakeholders
  let b3 = '';
  if (cat.includes('tech')) {
    b3 = 'Directly impacts VP Engineering, Platform Leads & Technical Architecture teams';
  } else if (cat.includes('lead')) {
    b3 = 'Directly impacts Executive Committee & newly appointed department leaders';
  } else if (cat.includes('expan')) {
    b3 = 'Affects VP Operations, Regional Directors & Revenue teams driving expansion';
  } else if (cat.includes('hir')) {
    b3 = 'Impacts Hiring Managers & Team Leads striving to ramp up newly joined talent';
  } else {
    b3 = 'Directly affects key decision-makers evaluating operational agility and velocity';
  }

  // Bullet 4: Direct relation to our company
  let b4 = '';
  if (cat.includes('tech')) {
    b4 = `Relevance to ${seller}: Direct opening to position our ${offeringDesc} alongside their new tech stack`;
  } else if (cat.includes('lead')) {
    b4 = `Relevance to ${seller}: High-intent window to introduce our solutions before new vendor contracts lock in`;
  } else if (cat.includes('expan')) {
    b4 = `Relevance to ${seller}: Multi-region expansion demands our automated intelligence to eliminate pipeline friction`;
  } else if (cat.includes('hir')) {
    b4 = `Relevance to ${seller}: Growing teams need our workflow leverage to achieve high output without adding tool bloat`;
  } else {
    b4 = `Relevance to ${seller}: Provides immediate grounded relevance and checkable rationale for partnership outreach`;
  }

  // Bullet 5: Actionable outreach hook
  let b5 = '';
  if (cat.includes('tech')) {
    b5 = 'Outreach hook: Pitch joint integration & automated workflow orchestration tailored to their roadmap';
  } else if (cat.includes('lead')) {
    b5 = 'Outreach hook: Congratulate leadership on mandate & share actionable benchmark audit tailored to their priorities';
  } else if (cat.includes('expan')) {
    b5 = 'Outreach hook: Present blueprint on streamlining pipeline velocity across their expanding operations';
  } else if (cat.includes('hir')) {
    b5 = 'Outreach hook: Offer workflow solutions that double productivity for new hires without adding tool clutter';
  } else {
    b5 = `Outreach hook: Reference ${sig.src || 'recent announcements'} to initiate an evidence-backed consultative dialogue`;
  }

  return [b1, b2, b3, b4, b5];
}

export async function generateSignalBulletsWithGemini(
  sig: Signal,
  prospect: { name: string; domain?: string; ind?: string },
  settings?: CompanySettings | null
): Promise<string[]> {
  const fallback = generateSignalBullets(sig, prospect, settings);
  const apiKey = process.env.GEMINI_API_KEY || '';
  if (!apiKey) return fallback;

  try {
    const seller = settings?.companyName || 'Speer';
    const cleanHead = recoverFullHeadline(sig);
    const prompt = `You are an elite B2B sales strategist for "${seller}" (${settings?.category || 'B2B Sales Intelligence & AI Outreach'}).
Our Company Offerings & Profile: ${settings?.description || 'B2B sales intelligence and AI outreach SaaS, turn target company website and news into evidence-backed brief, personalized outreach sequences.'}

Prospect Company: "${prospect.name}" (${prospect.domain || ''}, Industry: ${prospect.ind || ''}).
News/Trigger Signal:
- Title: ${cleanHead}
- Snippet: ${sig.s}
- Category: ${sig.cat}
- AI Reasoning: ${sig.why}
- Source: ${sig.src} (${sig.d})

TASK:
Summarize this news in bullet points AND show the relation how it is relevant for our company ("${seller}"), in JUST 5 BULLET POINTS.
Requirements:
1. Exactly 5 bullet points.
2. Crisp and short. No need to be long proper sentences, but must share the core idea clearly.
3. Structure:
   - Bullet 1: Core news event summary
   - Bullet 2: Practical/technical shift behind it
   - Bullet 3: Key internal teams/stakeholders affected at ${prospect.name}
   - Bullet 4: Direct relation & relevance to our company (${seller})
   - Bullet 5: Actionable outreach hook or value proposition

Return ONLY a JSON array of 5 short strings:
["...", "...", "...", "...", "..."]`;

    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          responseMimeType: 'application/json',
          temperature: 0.3,
        },
      }),
    });

    if (!res.ok) return fallback;
    const data = await res.json();
    const rawText = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!rawText) return fallback;

    const parsed = JSON.parse(rawText.replace(/^```json\s*/i, '').replace(/```\s*$/i, '').trim());
    if (Array.isArray(parsed) && parsed.length === 5) {
      return parsed.map((item) => String(item).trim());
    }
    return fallback;
  } catch (err) {
    console.warn('Gemini signal bullets generation fallback triggered:', err);
    return fallback;
  }
}

