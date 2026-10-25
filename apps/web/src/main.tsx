import React from 'react';
import ReactDOM from 'react-dom/client';
import { MantineProvider, localStorageColorSchemeManager } from '@mantine/core';
import { Notifications } from '@mantine/notifications';
import { ModalsProvider } from '@mantine/modals';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ApiError } from './lib/api';
import { AuthProvider } from './lib/auth';
import { cssVariablesResolver, theme } from './theme';
import { App } from './App';

import '@fontsource-variable/inter';
import '@mantine/core/styles.css';
import '@mantine/notifications/styles.css';
import '@mantine/dates/styles.css';
import '@mantine/charts/styles.css';
import '@mantine/tiptap/styles.css';
import '@mantine/dropzone/styles.css';
import '@mantine/spotlight/styles.css';
import './styles.css';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: (count, err) => !(err instanceof ApiError && err.status >= 400 && err.status < 500) && count < 2,
      refetchOnWindowFocus: false,
    },
  },
});

const colorSchemeManager = localStorageColorSchemeManager({ key: 'explorix-color-scheme' });

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <MantineProvider theme={theme} cssVariablesResolver={cssVariablesResolver} defaultColorScheme="auto" colorSchemeManager={colorSchemeManager}>
      <Notifications position="top-right" limit={4} />
      <QueryClientProvider client={queryClient}>
        <ModalsProvider>
          <AuthProvider>
            <App />
          </AuthProvider>
        </ModalsProvider>
      </QueryClientProvider>
    </MantineProvider>
  </React.StrictMode>,
);
