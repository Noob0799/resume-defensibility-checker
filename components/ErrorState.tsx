import { ErrorStateProps } from "@/lib/types";

const ErrorState = ({ message }: ErrorStateProps) => {
  return (
    <div
      role="alert"
      className="rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-300"
    >
      {message}
    </div>
  );
};

export default ErrorState;
