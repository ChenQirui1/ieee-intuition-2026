export type ReadingMode = 'easy_read' | 'checklist' | 'step_by_step';

export type EasyReadOutput = {
  about: string;
  key_points: string[];
  glossary: Array<{ term: string; simple: string }>;
  sections?: Array<{ heading: string; bullets: string[] }>;
  important_links?: Array<{ label: string; url: string }>;
  warnings?: string[];
};

export type ChecklistItem = {
  id: string;
  item: string;
  details?: string;
  required?: boolean;
};

export type ChecklistFee = { id: string; item: string; amount?: string };
export type ChecklistDeadline = { id: string; item: string; date?: string };
export type ChecklistAction = { id: string; item: string; url?: string };

export type ChecklistGuide = {
  goal: string;
  requirements: ChecklistItem[];
  documents: ChecklistItem[];
  fees: ChecklistFee[];
  deadlines: ChecklistDeadline[];
  actions: ChecklistAction[];
  common_mistakes: string[];
};

export type StepByStepStep = {
  id: string;
  step?: number;
  title: string;
  what_to_do: string;
  where_to_click: string;
  url?: string;
  tips: string[];
};

export type StepByStepGuide = {
  goal: string;
  steps: StepByStepStep[];
  finish_check: string[];
};

export type SimplificationIds = {
  easy_read?: string;
  checklist?: string;
  step_by_step?: string;
  intelligent?: string;
};

export type NormalizedReadingPayload = {
  pageId?: string;
  url?: string;
  simplificationIds: SimplificationIds;
  easyRead: EasyReadOutput | null;
  checklist: ChecklistGuide | null;
  stepByStep: StepByStepGuide | null;
  signals: {
    hasChecklist: boolean | null;
    hasStepByStep: boolean | null;
  };
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((v) => asString(v).trim()).filter(Boolean);
}

function parseEasyRead(value: unknown): EasyReadOutput | null {
  if (!isRecord(value)) return null;

  const about = asString(value.about).trim();
  const key_points = asStringArray(value.key_points);

  const glossary = Array.isArray(value.glossary)
    ? value.glossary
        .map((g) => {
          if (!isRecord(g)) return null;
          const term = asString(g.term).trim();
          const simple = asString(g.simple).trim();
          if (!term || !simple) return null;
          return { term, simple };
        })
        .filter((g): g is { term: string; simple: string } => g !== null)
    : [];

  const sections = Array.isArray(value.sections)
    ? value.sections
        .map((s) => {
          if (!isRecord(s)) return null;
          const heading = asString(s.heading).trim();
          const bullets = asStringArray(s.bullets);
          if (!heading || bullets.length === 0) return null;
          return { heading, bullets };
        })
        .filter((s): s is { heading: string; bullets: string[] } => s !== null)
    : undefined;

  const important_links = Array.isArray(value.important_links)
    ? value.important_links
        .map((l) => {
          if (!isRecord(l)) return null;
          const label = asString(l.label).trim();
          const url = asString(l.url).trim();
          if (!url) return null;
          return { label: label || url, url };
        })
        .filter((l): l is { label: string; url: string } => l !== null)
    : undefined;

  const warnings = Array.isArray(value.warnings) ? asStringArray(value.warnings) : undefined;

  if (!about && key_points.length === 0 && glossary.length === 0) return null;

  return {
    about,
    key_points,
    glossary,
    sections: sections && sections.length ? sections : undefined,
    important_links: important_links && important_links.length ? important_links : undefined,
    warnings: warnings && warnings.length ? warnings : undefined,
  };
}

function parseChecklistItems(value: unknown, prefix: string): ChecklistItem[] {
  if (!Array.isArray(value)) return [];
  const items: ChecklistItem[] = [];
  for (let idx = 0; idx < value.length; idx += 1) {
    const raw = value[idx];
    if (!isRecord(raw)) continue;
    const item = asString(raw.item).trim();
    if (!item) continue;
    const details = asString(raw.details).trim();
    const required = typeof raw.required === 'boolean' ? raw.required : undefined;
    items.push({
      id: `${prefix}_${idx + 1}`,
      item,
      details: details || undefined,
      required,
    });
  }
  return items;
}

function parseFees(value: unknown): ChecklistFee[] {
  if (!Array.isArray(value)) return [];
  const items: ChecklistFee[] = [];
  for (let idx = 0; idx < value.length; idx += 1) {
    const raw = value[idx];
    if (!isRecord(raw)) continue;
    const item = asString(raw.item).trim();
    if (!item) continue;
    const amount = asString(raw.amount).trim();
    items.push({
      id: `fee_${idx + 1}`,
      item,
      amount: amount || undefined,
    });
  }
  return items;
}

function parseDeadlines(value: unknown): ChecklistDeadline[] {
  if (!Array.isArray(value)) return [];
  const items: ChecklistDeadline[] = [];
  for (let idx = 0; idx < value.length; idx += 1) {
    const raw = value[idx];
    if (!isRecord(raw)) continue;
    const item = asString(raw.item).trim();
    if (!item) continue;
    const date = asString(raw.date).trim();
    items.push({
      id: `deadline_${idx + 1}`,
      item,
      date: date || undefined,
    });
  }
  return items;
}

function parseActions(value: unknown): ChecklistAction[] {
  if (!Array.isArray(value)) return [];
  const items: ChecklistAction[] = [];
  for (let idx = 0; idx < value.length; idx += 1) {
    const raw = value[idx];
    if (!isRecord(raw)) continue;
    const item = asString(raw.item).trim();
    if (!item) continue;
    const urlRaw = asString(raw.url).trim();
    items.push({
      id: `act_${idx + 1}`,
      item,
      url: urlRaw || undefined,
    });
  }
  return items;
}

function parseChecklistGuide(value: unknown): ChecklistGuide | null {
  if (!isRecord(value)) return null;

  const goal = asString(value.goal).trim();
  const requirements = parseChecklistItems(value.requirements, 'req');
  const documents = parseChecklistItems(value.documents, 'doc');
  const fees = parseFees(value.fees);
  const deadlines = parseDeadlines(value.deadlines);
  const actions = parseActions(value.actions);
  const common_mistakes = Array.isArray(value.common_mistakes)
    ? asStringArray(value.common_mistakes)
    : [];

  if (!goal && requirements.length === 0 && actions.length === 0 && documents.length === 0) return null;

  return {
    goal,
    requirements,
    documents,
    fees,
    deadlines,
    actions,
    common_mistakes,
  };
}

function parseSteps(value: unknown): StepByStepStep[] {
  if (!Array.isArray(value)) return [];
  const steps: StepByStepStep[] = [];
  for (let idx = 0; idx < value.length; idx += 1) {
    const raw = value[idx];
    if (!isRecord(raw)) continue;

    const stepRaw = raw.step;
    const step =
      typeof stepRaw === 'number'
        ? stepRaw
        : typeof stepRaw === 'string' && stepRaw.trim()
          ? Number(stepRaw)
          : undefined;

    const title = asString(raw.title).trim();
    const what_to_do = asString(raw.what_to_do).trim();
    const where_to_click = asString(raw.where_to_click).trim();
    const urlRaw = asString(raw.url).trim();
    const tips = asStringArray(raw.tips);

    const stableNum = Number.isFinite(step as number) ? (step as number) : idx + 1;

    steps.push({
      id: `step_${stableNum}`,
      step: Number.isFinite(step as number) ? (step as number) : undefined,
      title: title || `Step ${stableNum}`,
      what_to_do,
      where_to_click,
      url: urlRaw || undefined,
      tips,
    });
  }
  return steps;
}

function parseStepByStepGuide(value: unknown): StepByStepGuide | null {
  if (!isRecord(value)) return null;
  const goal = asString(value.goal).trim();
  const steps = parseSteps(value.steps);
  const finish_check = Array.isArray(value.finish_check) ? asStringArray(value.finish_check) : [];
  if (!goal && steps.length === 0) return null;
  return { goal, steps, finish_check };
}

export function normalizeReadingPayload(payload: unknown): NormalizedReadingPayload {
  const root = isRecord(payload) ? payload : {};

  const outputs = isRecord(root.outputs) ? root.outputs : {};
  const intelligent = isRecord(outputs.intelligent) ? (outputs.intelligent as Record<string, unknown>) : null;

  const easyRead =
    parseEasyRead(outputs.easy_read) ||
    (intelligent ? parseEasyRead(intelligent.summary) : null) ||
    parseEasyRead(outputs.summary);

  const simplIdsRaw = isRecord(root.simplification_ids) ? root.simplification_ids : {};
  const simplificationIds: SimplificationIds = {
    easy_read: asString(simplIdsRaw.easy_read).trim() || undefined,
    checklist: asString(simplIdsRaw.checklist).trim() || undefined,
    step_by_step: asString(simplIdsRaw.step_by_step).trim() || undefined,
    intelligent: asString(simplIdsRaw.intelligent).trim() || undefined,
  };

  // Checklist can come from the canonical "checklist" mode, or from an "intelligent" bundle.
  const intelligentChecklist = intelligent && isRecord(intelligent.checklist) ? intelligent.checklist : null;
  const hasChecklistSignal =
    intelligentChecklist && typeof intelligentChecklist.has_checklist === 'boolean'
      ? (intelligentChecklist.has_checklist as boolean)
      : null;

  const checklistFromMode = parseChecklistGuide(outputs.checklist);
  const checklistFromIntelligent =
    hasChecklistSignal === false ? null : parseChecklistGuide(intelligentChecklist);

  const checklist = checklistFromMode || checklistFromIntelligent;

  // Step-by-step can come from the canonical "step_by_step" mode, or be embedded in intelligent.checklist.steps.
  const stepByStepFromMode = parseStepByStepGuide(outputs.step_by_step);
  const embeddedSteps =
    intelligentChecklist && Array.isArray((intelligentChecklist as Record<string, unknown>).steps)
      ? ({ goal: asString((intelligentChecklist as Record<string, unknown>).goal), steps: (intelligentChecklist as Record<string, unknown>).steps, finish_check: (intelligentChecklist as Record<string, unknown>).finish_check } as Record<string, unknown>)
      : null;
  const stepByStepFromIntelligent = embeddedSteps ? parseStepByStepGuide(embeddedSteps) : null;

  const stepByStep = stepByStepFromMode || stepByStepFromIntelligent;

  const hasChecklist = checklist ? true : hasChecklistSignal;
  const hasStepByStep = stepByStep ? true : hasChecklistSignal === false ? false : null;

  return {
    pageId: asString(root.page_id).trim() || undefined,
    url: asString(root.url).trim() || undefined,
    simplificationIds,
    easyRead,
    checklist,
    stepByStep,
    signals: { hasChecklist, hasStepByStep },
  };
}
