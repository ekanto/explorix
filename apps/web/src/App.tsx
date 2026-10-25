import { lazy, Suspense, type ReactNode } from 'react';
import { BrowserRouter, Navigate, Outlet, Route, Routes, useLocation, useParams } from 'react-router';
import { Alert } from '@mantine/core';
import { IconArchive } from '@tabler/icons-react';
import { AppLayout } from './components/Layout';
import { ErrorState, Loading } from './components/ui';
import { useAuth } from './lib/auth';
import { ProjectProvider, useProjectConfig } from './lib/project';

const Login = lazy(() => import('./pages/Login'));
const Overview = lazy(() => import('./pages/Overview'));
const MyWork = lazy(() => import('./pages/MyWork'));
const Projects = lazy(() => import('./pages/Projects'));
const Notifications = lazy(() => import('./pages/Notifications'));
const Profile = lazy(() => import('./pages/Profile'));
const NotFound = lazy(() => import('./pages/NotFound'));
const ProjectDashboard = lazy(() => import('./pages/ProjectDashboard'));

const Charters = lazy(() => import('./pages/exploratory/Charters'));
const CharterForm = lazy(() => import('./pages/exploratory/CharterForm'));
const CharterDetail = lazy(() => import('./pages/exploratory/CharterDetail'));
const Templates = lazy(() => import('./pages/exploratory/Templates'));
const Sessions = lazy(() => import('./pages/exploratory/Sessions'));
const Workbench = lazy(() => import('./pages/exploratory/Workbench'));
const Findings = lazy(() => import('./pages/exploratory/Findings'));
const FindingDetail = lazy(() => import('./pages/exploratory/FindingDetail'));
const Issues = lazy(() => import('./pages/exploratory/Issues'));
const IssueDetail = lazy(() => import('./pages/exploratory/IssueDetail'));

const TestCases = lazy(() => import('./pages/testing/TestCases'));
const TestCaseDetail = lazy(() => import('./pages/testing/TestCaseDetail'));
const TestRuns = lazy(() => import('./pages/testing/TestRuns'));
const TestRunDetail = lazy(() => import('./pages/testing/TestRunDetail'));
const Requirements = lazy(() => import('./pages/testing/Requirements'));
const RequirementDetail = lazy(() => import('./pages/testing/RequirementDetail'));

const Automation = lazy(() => import('./pages/automation/Automation'));
const AutomationRun = lazy(() => import('./pages/automation/AutomationRun'));
const AutomationCompare = lazy(() => import('./pages/automation/AutomationCompare'));
const AutomationTest = lazy(() => import('./pages/automation/AutomationTest'));

const Reports = lazy(() => import('./pages/admin/Reports'));
const Activity = lazy(() => import('./pages/admin/Activity'));
const Integrations = lazy(() => import('./pages/admin/Integrations'));
const ProjectSettings = lazy(() => import('./pages/admin/ProjectSettings'));
const Admin = lazy(() => import('./pages/admin/Admin'));

function RequireAuth({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) return <Loading label="Starting Explorix…" />;
  if (!user) return <Navigate to={`/login?next=${encodeURIComponent(location.pathname + location.search)}`} replace />;
  return <>{children}</>;
}

function ProjectLayout() {
  const { projectId } = useParams();
  const q = useProjectConfig(projectId);
  if (q.isLoading) return <Loading />;
  if (q.error || !q.data) return <ErrorState error={q.error ?? new Error('Project not found')} />;
  return (
    <ProjectProvider config={q.data}>
      {q.data.project.archivedAt && (
        <Alert color="gray" icon={<IconArchive size={18} />} mb="md" title="Archived project">
          This project is archived and read-only. A project admin can unarchive it from Project settings.
        </Alert>
      )}
      <Outlet />
    </ProjectProvider>
  );
}

export function App() {
  return (
    <BrowserRouter>
      <Suspense fallback={<Loading />}>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route
            element={
              <RequireAuth>
                <AppLayout />
              </RequireAuth>
            }
          >
            <Route index element={<Overview />} />
            <Route path="my-work" element={<MyWork />} />
            <Route path="projects" element={<Projects />} />
            <Route path="notifications" element={<Notifications />} />
            <Route path="profile" element={<Profile />} />
            <Route path="admin" element={<Admin />} />
            <Route path="projects/:projectId" element={<ProjectLayout />}>
              <Route index element={<ProjectDashboard />} />
              <Route path="charters" element={<Charters />} />
              <Route path="charters/new" element={<CharterForm />} />
              <Route path="charters/:id" element={<CharterDetail />} />
              <Route path="charters/:id/edit" element={<CharterForm />} />
              <Route path="templates" element={<Templates />} />
              <Route path="sessions" element={<Sessions />} />
              <Route path="sessions/:id" element={<Workbench />} />
              <Route path="findings" element={<Findings />} />
              <Route path="findings/:id" element={<FindingDetail />} />
              <Route path="issues" element={<Issues />} />
              <Route path="issues/:id" element={<IssueDetail />} />
              <Route path="test-cases" element={<TestCases />} />
              <Route path="test-cases/:id" element={<TestCaseDetail />} />
              <Route path="test-runs" element={<TestRuns />} />
              <Route path="test-runs/:id" element={<TestRunDetail />} />
              <Route path="requirements" element={<Requirements />} />
              <Route path="requirements/:id" element={<RequirementDetail />} />
              <Route path="automation" element={<Automation />} />
              <Route path="automation/runs/:id" element={<AutomationRun />} />
              <Route path="automation/compare" element={<AutomationCompare />} />
              <Route path="automation/tests/:testId" element={<AutomationTest />} />
              <Route path="reports" element={<Reports />} />
              <Route path="activity" element={<Activity />} />
              <Route path="integrations" element={<Integrations />} />
              <Route path="settings" element={<ProjectSettings />} />
              <Route path="*" element={<NotFound />} />
            </Route>
            <Route path="*" element={<NotFound />} />
          </Route>
        </Routes>
      </Suspense>
    </BrowserRouter>
  );
}
