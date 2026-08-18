export type Category =
  | "Recipes/Food"
  | "Fitness/Health"
  | "Business/Ideas"
  | "Learning/Tech"
  | "Travel"
  | "Quotes/Inspiration"
  | "Entertainment/Humor"
  | "Trading"
  | "Claude Hacks"
  | "Parenting Hacks"
  | "Design Hacks"
  | "Design Inspiration"
  | "Other";

export interface DownloadResult {
  filePath: string;
  isVideo: boolean;
}

export interface ReelMetadata {
  title: string;
  description: string;
  uploader: string;
}

export interface AnalysisResult {
  title: string;
  category: Category;
  tags: string[];
}

// Tracks pipeline outcome internally (drives the Failed/Partial degraded-
// retry logic) — no longer surfaced as a Notion property. "Duplicate" means
// this Source URL was already saved; the pipeline exits before any writes.
export type PipelineStatus = "Done" | "Failed" | "Partial" | "Duplicate";

export interface RelatedNote {
  title: string;
  url: string;
}

export interface PipelineResult {
  status: PipelineStatus;
  sourceUrl: string;
  title?: string;
  reelDescription?: string;
  uploader?: string;
  externalSourceUrl?: string;
  keyItems?: string[];
  contentNotes?: string;
  contentNotesHeading?: string;
  relatedNotes?: RelatedNote[];
  category?: Category;
  tags?: string[];
  transcript?: string | null;
  errorMessage?: string;
}
