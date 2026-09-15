const LoadingState = () => {
  return (
    <div className="flex items-center justify-center gap-3 py-12 text-zinc-500 dark:text-zinc-400">
      <span
        className="h-4 w-4 animate-spin rounded-full border-2 border-zinc-300 border-t-zinc-600 dark:border-zinc-700 dark:border-t-zinc-300"
        aria-hidden="true"
      />
      <span>Analyzing bullets...</span>
    </div>
  );
};

export default LoadingState;
