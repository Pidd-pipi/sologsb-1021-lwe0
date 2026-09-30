export type EntryStatus = 'draft' | 'review' | 'disputed' | 'confirmed';

export interface DialectVariant {
  id: string;
  dialect: string;
  form: string;
  pronunciation: string;
  note: string;
}

export interface ExampleSentence {
  id: string;
  text: string;
  translation: string;
  source: string;
}

export interface DictionarySource {
  id: string;
  title: string;
  citation: string;
  url: string;
}

export interface ReviewComment {
  id: string;
  field: string;
  author: string;
  message: string;
  status: 'open' | 'resolved';
  createdAt: string;
  replies: Array<{ id: string; author: string; message: string; createdAt: string }>;
}

export interface DictionaryEntry {
  id: string;
  headword: string;
  pronunciation: string;
  partOfSpeech: string;
  definition: string;
  dialectVariants: DialectVariant[];
  examples: ExampleSentence[];
  sources: DictionarySource[];
  synonyms: string[];
  status: EntryStatus;
  notes: string;
  createdAt: string;
  updatedAt: string;
  reviewerComments: ReviewComment[];
}

export interface VersionRecord {
  id: string;
  at: string;
  action: string;
  detail: string;
  entryId?: string;
  before: DictionaryEntry[];
}

export interface AuditRecord {
  id: string;
  at: string;
  action: string;
  detail: string;
  entryIds: string[];
}

export interface DictionarySnapshot {
  revision: number;
  entries: DictionaryEntry[];
  versions: VersionRecord[];
  audit: AuditRecord[];
}

export interface DuplicatePair {
  leftId: string;
  rightId: string;
  score: number;
  reasons: string[];
}
