export interface AnalyzeRequest {
    resumeBullets: string[];
    jobDescription: string;
};

export interface AnalyzeResponse {
    rankedBullets: RankedBullet[]
};

export interface RankedBullet {
    bulletText: string;
    relevanceScore: number;     // 1-5, how well it matches this JD
    relevanceReason: string;     // one line: why it's relevant
    followUpQuestions: string[]; // 2-3 skeptical interviewer questions
    specificityScore: number;    // 1-5, concrete vs vague/overclaiming
    specificityNotes: string;    // what's vague/ambiguous, or why it's concrete
};

export type AnalyzeStatus = "idle" | "loading" | "results" | "error";

export interface InputFormProps {
    onSubmit: (resumeBullets: string[], jobDescription: string) => void;
    onReset: () => void;
    status: AnalyzeStatus;
}

export interface ResultsListProps {
    rankedBullets: RankedBullet[];
}

export interface BulletCardProps {
    bullet: RankedBullet;
}

export interface ErrorStateProps {
    message: string;
}