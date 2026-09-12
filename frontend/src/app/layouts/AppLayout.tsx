import { Home, Plus, Settings, TrendingUp, Users, Wallet } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { NavLink, Outlet, useLocation } from 'react-router-dom'

import { BrandMark } from '@/components/brand-mark'
import { ConnectivityBanner } from '@/components/connectivity-banner'
import { ThemeToggle } from '@/components/theme-toggle'
import { Button } from '@/components/ui/button'
import { ExpenseComposer } from '@/features/expense-composer/components/expense-composer'
import { useComposerStore } from '@/features/expense-composer/composer-store'
import { useNewExpenseShortcut } from '@/hooks/use-new-expense-shortcut'
import { cn } from '@/lib/utils'
import { GROUPS_DISABLED_NOTICE } from '@/features/groups/groups-service'

interface NavItem {
  to: string
  label: string
  icon: LucideIcon
  end?: boolean
}

// Groups before Expenses: splitting is what the app is for, and personal
// tracking is what supports it. The order of these two is the clearest
// statement the navigation makes about which is which.
const NAV_ITEMS: NavItem[] = [
  { to: '/', label: 'Home', icon: Home, end: true },
  { to: '/groups', label: 'Groups', icon: Users },
  { to: '/expenses', label: 'Expenses', icon: Wallet },
  { to: '/reports', label: 'Reports', icon: TrendingUp },
]

export function AppLayout() {
  useNewExpenseShortcut()
  const { pathname } = useLocation()

  return (
    <div className="min-h-svh md:grid md:grid-cols-[15rem_1fr]">
      <Sidebar />
      <div className="flex min-h-svh flex-col">
        <MobileHeader />
        <ConnectivityBanner />
        <p className="border-b bg-secondary px-4 py-2 text-center text-xs text-muted-foreground">
          {GROUPS_DISABLED_NOTICE}
        </p>
        <main className="flex-1 px-4 pb-28 pt-4 md:px-8 md:py-8">
          {/* Keyed by route so each page gets one entrance animation. */}
          <div key={pathname} className="page-enter mx-auto w-full max-w-4xl">
            <Outlet />
          </div>
        </main>
      </div>
      <MobileTabBar />
      <ExpenseComposer />
    </div>
  )
}

function Sidebar() {
  const openNewExpense = useComposerStore((state) => state.openNew)
  return (
    <aside className="sticky top-0 hidden h-svh flex-col border-r bg-sidebar md:flex">
      <div className="px-5 pt-6">
        <BrandMark withWordmark />
      </div>
      <div className="px-4 pt-6">
        <Button className="w-full justify-start gap-2" onClick={() => openNewExpense()}>
          <Plus className="size-4" aria-hidden />
          Add expense
        </Button>
      </div>
      <nav className="flex flex-1 flex-col gap-1 px-4 pt-6" aria-label="Primary">
        {NAV_ITEMS.map((item) => (
          <SidebarLink key={item.to} item={item} />
        ))}
      </nav>
      <div className="flex items-center justify-between gap-2 border-t px-4 py-3">
        <SidebarLink
          item={{ to: '/settings', label: 'Settings', icon: Settings }}
          className="flex-1"
        />
        <ThemeToggle />
      </div>
    </aside>
  )
}

function SidebarLink({ item, className }: { item: NavItem; className?: string }) {
  return (
    <NavLink
      to={item.to}
      end={item.end}
      className={({ isActive }) =>
        cn(
          'flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors',
          isActive
            ? 'bg-sidebar-accent font-medium text-sidebar-accent-foreground'
            : 'text-muted-foreground hover:bg-sidebar-accent/50 hover:text-foreground',
          className,
        )
      }
    >
      <item.icon className="size-4" aria-hidden />
      {item.label}
    </NavLink>
  )
}

function MobileHeader() {
  return (
    <header className="sticky top-0 z-30 flex items-center justify-between border-b bg-background/80 px-4 pb-3 pt-[max(0.75rem,env(safe-area-inset-top))] backdrop-blur md:hidden">
      <BrandMark withWordmark />
      <div className="flex items-center gap-1">
        <ThemeToggle className="size-11" />
        <Button variant="ghost" size="icon" className="size-11" asChild>
          <NavLink to="/settings" aria-label="Settings">
            <Settings className="size-5" aria-hidden />
          </NavLink>
        </Button>
      </div>
    </header>
  )
}

function MobileTabBar() {
  const openNewExpense = useComposerStore((state) => state.openNew)
  const [homeTab, groupsTab, expensesTab, reportsTab] = NAV_ITEMS
  return (
    <nav
      aria-label="Primary"
      className="fixed inset-x-0 bottom-0 z-30 border-t bg-background/90 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden"
    >
      <div className="grid grid-cols-5 items-center px-2 py-2">
        <TabLink item={homeTab} />
        <TabLink item={groupsTab} />
        <div className="flex justify-center">
          <Button
            size="icon"
            aria-label="Add expense"
            className="-mt-7 size-14 rounded-full shadow-lg"
            onClick={() => openNewExpense()}
          >
            <Plus className="size-6" aria-hidden />
          </Button>
        </div>
        <TabLink item={expensesTab} />
        <TabLink item={reportsTab} />
      </div>
    </nav>
  )
}

function TabLink({ item }: { item?: NavItem }) {
  if (!item) return null
  return (
    <NavLink
      to={item.to}
      end={item.end}
      className={({ isActive }) =>
        cn(
          'flex flex-col items-center gap-1 rounded-md py-1 text-[11px] transition-colors',
          isActive ? 'text-primary' : 'text-muted-foreground',
        )
      }
    >
      <item.icon className="size-5" aria-hidden />
      {item.label}
    </NavLink>
  )
}
