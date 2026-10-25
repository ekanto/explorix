import { useState } from 'react';
import { Navigate, useNavigate, useSearchParams } from 'react-router';
import { Alert, Anchor, Box, Button, Center, Code, Collapse, Group, Paper, PasswordInput, Stack, Text, TextInput, Title } from '@mantine/core';
import { IconAlertCircle } from '@tabler/icons-react';
import { errorMessage } from '../lib/api';
import { useAuth } from '../lib/auth';
import { Logo } from '../components/Logo';

const DEMO = [
  ['admin@explorix.dev', 'Org owner / project admin'],
  ['lead@explorix.dev', 'QA lead (reviews sessions)'],
  ['tester@explorix.dev', 'Exploratory tester'],
  ['viewer@explorix.dev', 'Read-only product reviewer'],
];

export default function Login() {
  const { user, login } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [showDemo, setShowDemo] = useState(false);
  const next = params.get('next');
  const safeNext = next && next.startsWith('/') && !next.startsWith('//') ? next : '/';

  if (user) return <Navigate to={safeNext} replace />;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await login(email, password);
      navigate(safeNext, { replace: true });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Center mih="100vh" p="md" style={{ background: 'radial-gradient(circle at 20% 0%, var(--mantine-color-explorix-light) 0%, transparent 55%)' }}>
      <Box w="100%" maw={400}>
        <Stack align="center" mb="lg" gap={6}>
          <Logo size={40} />
          <Text c="dimmed" size="sm">
            Exploratory testing & quality engineering
          </Text>
        </Stack>
        <Paper withBorder shadow="sm" p="xl">
          <form onSubmit={submit} noValidate>
            <Stack>
              <Title order={3} fz={20}>
                Sign in
              </Title>
              {error && (
                <Alert color="red" icon={<IconAlertCircle size={18} />} role="alert">
                  {error}
                </Alert>
              )}
              <TextInput label="Email" type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.currentTarget.value)} autoFocus />
              <PasswordInput label="Password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.currentTarget.value)} />
              <Button type="submit" loading={busy} fullWidth>
                Sign in
              </Button>
            </Stack>
          </form>
        </Paper>
        <Group justify="center" mt="md">
          <Anchor size="xs" c="dimmed" onClick={() => setShowDemo((s) => !s)} component="button" type="button">
            {showDemo ? 'Hide' : 'Show'} demo accounts (seeded data)
          </Anchor>
        </Group>
        <Collapse expanded={showDemo}>
          <Paper withBorder p="sm" mt="xs">
            <Text size="xs" c="dimmed" mb={6}>
              Password for all demo accounts: <Code>Explorix-demo-1</Code>
            </Text>
            <Stack gap={4}>
              {DEMO.map(([e, role]) => (
                <Group key={e} justify="space-between" gap={4}>
                  <Anchor
                    size="xs"
                    component="button"
                    type="button"
                    onClick={() => {
                      setEmail(e);
                      setPassword('Explorix-demo-1');
                    }}
                  >
                    {e}
                  </Anchor>
                  <Text size="xs" c="dimmed">
                    {role}
                  </Text>
                </Group>
              ))}
            </Stack>
          </Paper>
        </Collapse>
      </Box>
    </Center>
  );
}
