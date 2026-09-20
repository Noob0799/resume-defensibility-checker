const LoadingState = () => {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-12 text-zinc-500 dark:text-zinc-400">
      <div className="flex items-center gap-1.5" aria-hidden="true">
        <span className="h-2.5 w-2.5 animate-bounce rounded-full bg-zinc-400 [animation-delay:-0.3s] dark:bg-zinc-500" />
        <span className="h-2.5 w-2.5 animate-bounce rounded-full bg-zinc-400 [animation-delay:-0.15s] dark:bg-zinc-500" />
        <span className="h-2.5 w-2.5 animate-bounce rounded-full bg-zinc-400 dark:bg-zinc-500" />
      </div>
      <span className="text-sm">Analyzing your bullets...</span>
    </div>
  );
};

export default LoadingState;
