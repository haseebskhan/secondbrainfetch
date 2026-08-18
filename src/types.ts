export type Category =
  | "Recipes/Food"
  | "Fitness/Health"
  | "Business/Ideas"
  | "Learning/Tech"
  | "Travel"
  | "Quotes/Inspiration"
  | "Entertainment/Humor"
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
// retry logic) — no longer surfaced as a Notion property.
export type PipelineStatus = "Done" | "Failed" | "Partial";

export interface PipelineResult {
  status: PipelineStatus;
  sourceUrl: string;
  title?: string;
  reelDescription?: string;
  uploader?: string;
  zettelkastenNotes?: string;
  category?: Category;
  tags?: string[];
  transcript?: string | null;
  errorMessage?: string;
}
