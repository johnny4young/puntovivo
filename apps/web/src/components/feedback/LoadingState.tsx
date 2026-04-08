interface PageLoadingStateProps {
  title: string;
  description: string;
}

interface FullscreenLoadingStateProps {
  title: string;
  description: string;
}

export function PageLoadingState({ title, description }: PageLoadingStateProps) {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-secondary-900">{title}</h1>
        <p className="mt-1 text-sm text-secondary-500">{description}</p>
      </div>

      <div className="space-y-6">
        <div className="card animate-pulse p-6">
          <div className="grid gap-4 md:grid-cols-2">
            {Array.from({ length: 6 }, (_, index) => (
              <div key={index} className="space-y-2">
                <div className="h-4 w-24 rounded bg-secondary-100" />
                <div className="h-11 rounded-xl bg-secondary-100" />
              </div>
            ))}
          </div>
          <div className="mt-6 h-28 rounded-2xl bg-secondary-100" />
          <div className="mt-6 flex justify-end">
            <div className="h-11 w-36 rounded-xl bg-secondary-100" />
          </div>
        </div>
      </div>
    </div>
  );
}

export function FullscreenLoadingState({ title, description }: FullscreenLoadingStateProps) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-secondary-50 px-6 py-12">
      <div className="w-full max-w-md rounded-3xl border border-secondary-200 bg-white p-8 text-center shadow-soft">
        <div className="mx-auto h-12 w-12 animate-spin rounded-full border-4 border-secondary-200 border-t-primary-600" />
        <h1 className="mt-6 text-xl font-semibold text-secondary-900">{title}</h1>
        <p className="mt-2 text-sm text-secondary-500">{description}</p>
      </div>
    </div>
  );
}
