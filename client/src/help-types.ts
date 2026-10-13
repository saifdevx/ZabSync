export type HelpCategory = 'app' | 'university' | 'developer';
export interface HelpArticle {
  id: string;
  title: string;
  category: HelpCategory;
  body: string;
  sourceUrl: string | null;
  status: 'draft' | 'published';
  version: number;
  updatedAt: string;
  publishedAt: string | null;
  deletedAt: string | null;
}
export const HELP_CATEGORIES: { value: HelpCategory; label: string }[] = [
  { value: 'app', label: 'Using ZabSync' },
  { value: 'university', label: 'University information' },
  { value: 'developer', label: 'Developer & updates' },
];
