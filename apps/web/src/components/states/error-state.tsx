import { Button } from '@/components/ui/button';

export function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div role="alert" className="stack-tight items-start">
      <p className="type-label">{message}</p>
      <Button type="button" variant="outline" className="touch-target" onClick={onRetry}>
        Retry
      </Button>
    </div>
  );
}
