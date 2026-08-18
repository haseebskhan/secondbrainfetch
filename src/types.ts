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

export interface AnalysisResult {
  title: string;
  summary: string;
  category: Category;
  tags: string[];
}

export type PipelineStatus = "Done" | "Failed" | "Partial";

export interface PipelineResult {
  status: PipelineStatus;
  sourceUrl: string;
  title?: string;
  summary?: string;
  category?: Category;
  tags?: string[];
  transcript?: string | null;
  errorMessage?: string;
}
