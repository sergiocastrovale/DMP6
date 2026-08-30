// Whether the application shell (sidenav, topbar, mobile nav, persistent player bar) renders
// around the current page. Explore's cinema mode is the only consumer today - toggling this
// hides the whole shell in favour of a full-viewport, distraction-free layout. Shared state
// (not a prop) because the toggle happens in place, without a route change, and the shell
// (components/layout/AppShell.vue) and the page toggling it live in different subtrees.
export const useChrome = () => {
  const visible = useState('chrome-visible', () => true)

  const hide = () => { visible.value = false }
  const show = () => { visible.value = true }

  return { visible, hide, show }
}
