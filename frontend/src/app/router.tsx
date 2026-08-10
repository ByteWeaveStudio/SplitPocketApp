import { createBrowserRouter } from 'react-router-dom'

import { AppLayout } from '@/app/layouts/AppLayout'
import { NotFoundPage } from '@/app/not-found'
import { RedirectIfSignedIn, RequireAuth } from '@/app/route-guards'
import { AuthCallbackPage } from '@/features/auth/pages/AuthCallbackPage'
import { ForgotPasswordPage } from '@/features/auth/pages/ForgotPasswordPage'
import { ResetPasswordPage } from '@/features/auth/pages/ResetPasswordPage'
import { SignInPage } from '@/features/auth/pages/SignInPage'
import { SignUpPage } from '@/features/auth/pages/SignUpPage'
import { DashboardPage } from '@/features/dashboard/pages/DashboardPage'
import { GroupDetailPage } from '@/features/groups/pages/GroupDetailPage'
import { GroupsPage } from '@/features/groups/pages/GroupsPage'
import { JoinGroupPage } from '@/features/groups/pages/JoinGroupPage'
import { ExpensesPage } from '@/features/personal-expenses/pages/ExpensesPage'
import { ReportsPage } from '@/features/reports/pages/ReportsPage'
import { SettingsPage } from '@/features/settings/pages/SettingsPage'

export const router = createBrowserRouter([
  {
    path: '/',
    element: (
      <RequireAuth>
        <AppLayout />
      </RequireAuth>
    ),
    children: [
      { index: true, element: <DashboardPage /> },
      { path: 'expenses', element: <ExpensesPage /> },
      { path: 'groups', element: <GroupsPage /> },
      { path: 'groups/:groupId', element: <GroupDetailPage /> },
      { path: 'reports', element: <ReportsPage /> },
      { path: 'settings', element: <SettingsPage /> },
    ],
  },
  {
    path: '/auth/sign-in',
    element: (
      <RedirectIfSignedIn>
        <SignInPage />
      </RedirectIfSignedIn>
    ),
  },
  {
    path: '/auth/sign-up',
    element: (
      <RedirectIfSignedIn>
        <SignUpPage />
      </RedirectIfSignedIn>
    ),
  },
  {
    path: '/auth/forgot-password',
    element: (
      <RedirectIfSignedIn>
        <ForgotPasswordPage />
      </RedirectIfSignedIn>
    ),
  },
  // Outside RequireAuth on purpose: an invite link is usually opened by
  // someone who doesn't have an account yet, and the page handles that case
  // itself rather than bouncing them to a sign-in screen with no context.
  { path: '/join/:token', element: <JoinGroupPage /> },
  { path: '/auth/reset-password', element: <ResetPasswordPage /> },
  { path: '/auth/callback', element: <AuthCallbackPage /> },
  { path: '*', element: <NotFoundPage /> },
])
