// How much of the application shell (sidenav, topbar, mobile nav, persistent player bar) renders
// around the current page. Shared state (not props) because the toggles happen in place, without a
// route change, and the shell (components/layout/AppShell.vue) and the page or layout toggling it
// live in different subtrees.
//
// Two consumers, two shapes:
//   - Explore's cinema mode calls hide(): the page provides its own full-viewport content and
//     transport, so the whole shell would be redundant chrome around it.
//   - The Labs layout calls rail(): each experiment is a full-width canvas, so the sidenav narrows
//     to an icon rail and the search topbar - which has nothing to search on those pages - goes
//     away. The shell itself stays.
export const useChrome = () => {
  const visible = useState('chrome-visible', () => true)
  const topbar = useState('chrome-topbar', () => true)
  const { setRailed } = useSidebar()

  const hide = () => { visible.value = false }

  const rail = () => {
    visible.value = true
    topbar.value = false
    setRailed(true)
  }

  // Also the way out of both modes, so leaving Explore or Labs always lands back on the full shell.
  // The rail is a flag over the user's own sidebar width rather than a write to it, so dropping it
  // restores whatever they had without this having to remember and replay it.
  const show = () => {
    visible.value = true
    topbar.value = true
    setRailed(false)
  }

  return { visible, topbar, hide, show, rail }
}
