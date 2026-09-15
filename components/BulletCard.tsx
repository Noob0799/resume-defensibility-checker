import { useState } from "react";
import { BulletCardProps } from "@/lib/types";

const specificityBadgeClasses = (score: number) => {
  if (score >= 4) {
    return "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300";
  }
  if (score === 3) {
    return "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300";
  }
  return "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300";
};

const BulletCard = ({ bullet }: BulletCardProps) => {
  const [isOpen, setIsOpen] = useState(true);

  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
      <div className="flex flex-wrap gap-2">
        <span className="rounded-full bg-zinc-100 px-2.5 py-0.5 text-xs font-medium text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">
          Relevance {bullet.relevanceScore}/5
        </span>
        <span
          className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${specificityBadgeClasses(
            bullet.specificityScore
          )}`}
        >
          Specificity {bullet.specificityScore}/5
        </span>
      </div>

      <p className="mt-3 font-medium text-zinc-900 dark:text-zinc-50">
        {bullet.bulletText}
      </p>

      <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">
        {bullet.relevanceReason}
      </p>
      <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
        {bullet.specificityNotes}
      </p>

      <hr className="my-3 border-zinc-200 dark:border-zinc-800" />

      <button
        type="button"
        onClick={() => setIsOpen((open) => !open)}
        className="flex cursor-pointer items-center gap-1 text-sm font-medium text-zinc-600 dark:text-zinc-300"
      >
        {isOpen ? "Hide details" : "Show details"}
        <svg
          viewBox="0 0 24 24"
          className={`h-4 w-4 transition-transform duration-200 ${
            isOpen ? "rotate-180" : ""
          }`}
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          aria-hidden="true"
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      {isOpen && (
        <div className="mt-3">
          <p className="text-xs font-medium uppercase tracking-wide text-zinc-400">
            Likely follow-up
          </p>
          <ul className="mt-1 flex flex-col gap-1">
            {bullet.followUpQuestions.map((question, index) => (
              <li
                key={index}
                className="text-sm text-zinc-800 dark:text-zinc-200"
              >
                {question}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
};

export default BulletCard;
