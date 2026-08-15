import { Link } from 'react-router-dom';
import { Compass } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/common/states';

export function NotFoundPage() {
  return (
    <EmptyState
      icon={Compass}
      title="Page not found"
      description="The page you are looking for does not exist, or you may not have access to it."
      action={
        <Button asChild>
          <Link to="/">Back to Saarthi</Link>
        </Button>
      }
      className="min-h-[60vh]"
    />
  );
}

export default NotFoundPage;
