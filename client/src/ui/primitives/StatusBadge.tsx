import { Badge } from './Badge';
import { toneFor } from './statusTone';

export function StatusBadge({ status, label }: { status: string; label: string }) {
  return (
    <Badge tone={toneFor(status)} dot>
      {label}
    </Badge>
  );
}
