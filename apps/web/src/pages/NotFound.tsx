import { Link } from 'react-router';
import { Button } from '@mantine/core';
import { IconMapOff } from '@tabler/icons-react';
import { EmptyState } from '../components/ui';

export default function NotFound() {
  return (
    <EmptyState
      icon={<IconMapOff size={26} />}
      title="Uncharted territory"
      description="This page doesn't exist, or you don't have access to it."
      action={
        <Button component={Link} to="/" variant="light">
          Back to overview
        </Button>
      }
    />
  );
}
