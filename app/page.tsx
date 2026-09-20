"use client";

import { useReducer } from "react";
import InputForm from "@/components/InputForm";
import LoadingState from "@/components/LoadingState";
import ResultsList from "@/components/ResultsList";
import ErrorState from "@/components/ErrorState";
import { AnalyzeResponse } from "@/lib/types";

type AppState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "results"; data: AnalyzeResponse }
  | { status: "error"; message: string };

type AppAction =
  | { type: "SUBMIT" }
  | { type: "SUCCESS"; data: AnalyzeResponse }
  | { type: "ERROR"; message: string }
  | { type: "RESET" };

// No `default` case on purpose: AppAction is a discriminated union, so
// TypeScript checks these 4 cases are exhaustive on its own. Adding a new
// action variant without a matching case here becomes a compile error
// instead of a silent no-op at runtime.
function reducer(state: AppState, action: AppAction): AppState {
  switch (action.type) {
    case "SUBMIT":
      return { status: "loading" };
    case "SUCCESS":
      return { status: "results", data: action.data };
    case "ERROR":
      return { status: "error", message: action.message };
    case "RESET":
      return { status: "idle" };
  }
}

const initialState: AppState = { status: "idle" };

export default function Home() {
  const [state, dispatch] = useReducer(reducer, initialState);

  const handleAnalyze = async (
    resumeBullets: string[],
    jobDescription: string
  ) => {
    dispatch({ type: "SUBMIT" });

    try {
      const res = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ resumeBullets, jobDescription }),
      });

      if (!res.ok) {
        const errorBody = await res.json().catch(() => null);
        throw new Error(errorBody?.error ?? "Failed to analyze bullets.");
      }

      const data: AnalyzeResponse = await res.json();
      dispatch({ type: "SUCCESS", data });
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Something went wrong.";
      dispatch({ type: "ERROR", message });
    }
  };

  const handleReset = () => dispatch({ type: "RESET" });

  return (
    <div className="flex flex-1 justify-center bg-zinc-50 px-4 py-12 dark:bg-black">
      <main className="flex w-full max-w-5xl flex-col gap-6">
        <div className="flex items-center gap-2.5">
          <span className="flex h-8 w-8 items-center justify-center rounded-full border border-zinc-300 text-zinc-600 dark:border-zinc-700 dark:text-zinc-300">
            <svg
              viewBox="0 0 24 24"
              className="h-4 w-4"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              aria-hidden="true"
            >
              <circle cx="12" cy="12" r="9" />
              <circle cx="12" cy="12" r="4.5" />
              <circle cx="12" cy="12" r="1" fill="currentColor" stroke="none" />
            </svg>
          </span>
          <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">
            Resume Tailor
          </h1>
        </div>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2 lg:items-start">
          <div className="rounded-xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
            <InputForm
              onSubmit={handleAnalyze}
              onReset={handleReset}
              status={state.status}
            />
          </div>

          <div className="flex flex-col gap-4">
            {state.status === "idle" && (
              <div className="rounded-xl border border-dashed border-zinc-300 px-6 py-10 text-center text-sm text-zinc-400 dark:border-zinc-700 dark:text-zinc-500">
                Results will show up here once you analyze your bullets.
              </div>
            )}
            {state.status === "loading" && <LoadingState />}
            {state.status === "error" && <ErrorState message={state.message} />}
            {state.status === "results" && (
              <>
                <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-50">
                  Results{" "}
                  <span className="font-normal text-zinc-500 dark:text-zinc-400">
                    — {state.data.rankedBullets.length} bullets ranked
                  </span>
                </h2>
                <ResultsList rankedBullets={state.data.rankedBullets} />
              </>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
