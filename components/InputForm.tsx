import { InputFormProps } from "@/lib/types";
import { SubmitEvent, useState } from "react";

const textareaClasses =
  "resize-y rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 placeholder:text-zinc-400 outline-none transition-colors focus:border-zinc-500 focus:ring-2 focus:ring-zinc-200 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:placeholder:text-zinc-500 dark:focus:border-zinc-500 dark:focus:ring-zinc-800";

const labelClasses = "text-sm font-medium text-zinc-700 dark:text-zinc-300";

const InputForm = ({ onSubmit, onReset, status }: InputFormProps) => {
  const [resumeBullets, setResumeBullets] = useState("");
  const [jobDescription, setJobDescription] = useState("");

  const handleSubmit = (e: SubmitEvent<HTMLFormElement>) => {
    e.preventDefault();
    const bullets = resumeBullets
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
    onSubmit(bullets, jobDescription);
  };

  const handleReset = () => {
    // Two separate resets: this component owns resumeBullets/jobDescription
    // as local state (lifted to the parent only on submit), so clearing
    // them happens directly here. onReset() then tells the parent to reset
    // its own reducer state, which this component has no access to.
    setResumeBullets("");
    setJobDescription("");
    onReset();
  };

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-5">
      <div className="flex flex-col gap-1.5">
        <label htmlFor="resumeBullets" className={labelClasses}>
          Resume bullets
        </label>
        <textarea
          id="resumeBullets"
          name="resumeBullets"
          onChange={(e) => setResumeBullets(e.target.value)}
          value={resumeBullets}
          rows={5}
          placeholder="Paste your resume bullets, one per line"
          className={textareaClasses}
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="jobDescription" className={labelClasses}>
          Job description
        </label>
        <textarea
          id="jobDescription"
          name="jobDescription"
          onChange={(e) => setJobDescription(e.target.value)}
          value={jobDescription}
          rows={5}
          placeholder="Paste the job description"
          className={textareaClasses}
        />
      </div>

      <div className="flex items-center gap-3">
        <button
          type="submit"
          className="cursor-pointer self-start rounded-full bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-400 focus:ring-offset-2 dark:focus:ring-offset-zinc-950"
        >
          Analyze bullets
        </button>
        {status !== "idle" && (
          <button
            type="button"
            onClick={handleReset}
            className="cursor-pointer self-start rounded-full bg-zinc-100 px-5 py-2.5 text-sm font-semibold text-zinc-700 transition-colors hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-700"
          >
            Reset
          </button>
        )}
      </div>
    </form>
  );
};

export default InputForm;
