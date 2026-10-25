import { useState } from 'react';
import { Navigate, useNavigate, useSearchParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { Alert, Anchor, Box, Button, Center, Code, Collapse, Group, Loader, Paper, PasswordInput, Stack, Text, TextInput, Title } from '@mantine/core';
import { IconAlertCircle } from '@tabler/icons-react';
import { api, errorMessage } from '../lib/api';
import { useAuth } from '../lib/auth';
import { Logo } from '../components/Logo';

const DEMO = [
  ['admin@explorix.dev', 'Org owner / project admin'],
  ['lead@explorix.dev', 'QA lead (reviews sessions)'],
  ['tester@explorix.dev', 'Exploratory tester'],
  ['viewer@explorix.dev', 'Read-only product reviewer'],
];

const passwordProblem = (p: string) => (p.length < 10 ? 'Use at least 10 characters' : !/[a-zA-Z]/.test(p) || !/[0-9]/.test(p) ? 'Use both letters and numbers' : null);

/** First run: creates the workspace (organization) and its owner account. */
function SetupForm({ desktop, onDone }: { desktop: boolean; onDone: () => void }) {
  const { setup } = useAuth();
  const [f, setF] = useState({ orgName: '', name: '', email: '', password: '', confirm: '' });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [touched, setTouched] = useState(false);
  const pw = passwordProblem(f.password);
  const mismatch = f.confirm.length > 0 && f.confirm !== f.password;
  const valid = f.orgName.trim() && f.name.trim() && /\S+@\S+\.\S+/.test(f.email) && !pw && f.confirm === f.password;
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.currentTarget.value });

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setTouched(true);
    if (!valid) return;
    setBusy(true);
    setError(null);
    try {
      await setup({ orgName: f.orgName.trim(), name: f.name.trim(), email: f.email.trim(), password: f.password });
      onDone();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} noValidate>
      <Stack>
        <div>
          <Title order={3} fz={20}>
            Welcome to Explorix
          </Title>
          <Text size="sm" c="dimmed">
            Create your workspace and owner account.{desktop ? ' Everything is stored on this computer.' : ''}
          </Text>
        </div>
        {error && (
          <Alert color="red" icon={<IconAlertCircle size={18} />} role="alert">
            {error}
          </Alert>
        )}
        <TextInput label="Workspace name" placeholder="e.g. Acme QA" required value={f.orgName} onChange={set('orgName')} maxLength={120} autoFocus error={touched && !f.orgName.trim() ? 'Required' : null} />
        <TextInput label="Your name" required value={f.name} onChange={set('name')} maxLength={120} autoComplete="name" error={touched && !f.name.trim() ? 'Required' : null} />
        <TextInput label="Email" type="email" required value={f.email} onChange={set('email')} maxLength={200} autoComplete="username" description="Used to sign in." error={touched && !/\S+@\S+\.\S+/.test(f.email) ? 'Enter a valid email' : null} />
        <PasswordInput label="Password" required value={f.password} onChange={set('password')} autoComplete="new-password" description="At least 10 characters, with letters and numbers." error={touched || f.password ? (f.password ? pw : touched ? 'Required' : null) : null} />
        <PasswordInput label="Confirm password" required value={f.confirm} onChange={set('confirm')} autoComplete="new-password" error={mismatch ? 'Passwords do not match' : null} />
        <Button type="submit" loading={busy} fullWidth>
          Create workspace
        </Button>
        <Text size="xs" c="dimmed">
          You can invite teammates and load a sample project after signing in.
        </Text>
      </Stack>
    </form>
  );
}

export default function Login() {
  const { user, login } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [showDemo, setShowDemo] = useState(false);
  const status = useQuery({ queryKey: ['setup-status'], queryFn: () => api.get<{ needsSetup: boolean; desktop: boolean }>('/auth/setup-status'), retry: 1, staleTime: 0 });
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
          {status.isLoading ? (
            <Center py="lg">
              <Loader size="sm" />
            </Center>
          ) : status.data?.needsSetup ? (
            <SetupForm desktop={status.data.desktop} onDone={() => navigate('/', { replace: true })} />
          ) : (
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
          )}
        </Paper>
        {!status.data?.needsSetup && !status.data?.desktop && !status.isLoading && (
          <>
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
          </>
        )}
      </Box>
    </Center>
  );
}
