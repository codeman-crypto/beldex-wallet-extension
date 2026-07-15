// Cross-browser shims for the one place Chrome and Firefox diverge: the side
// panel. Chrome uses chrome.sidePanel; Firefox uses sidebar_action (manifest)
// plus the chrome.sidebarAction API. Everything else (storage.session, alarms,
// notifications, tabs, runtime) is API-compatible across both in MV3.

// @types/chrome has no sidebarAction (a Firefox-only API), so reach for it loosely.
const anyChrome = chrome as any

/**
 * Make the toolbar icon open the wallet panel. On Chrome that's the side panel;
 * on Firefox we toggle the sidebar from the action click (a valid user gesture).
 * Call once from the background script.
 */
export function wireToolbarOpensPanel(): void {
  if (chrome.sidePanel?.setPanelBehavior) {
    chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => { /* older Chrome */ })
  } else if (anyChrome.sidebarAction && chrome.action?.onClicked) {
    chrome.action.onClicked.addListener(() => {
      anyChrome.sidebarAction.toggle() // Firefox: user-gesture-initiated
    })
  }
}

/** Close the current panel/sidebar (used after opening full-screen tab mode). */
export function closePanel(): void {
  if (anyChrome.sidebarAction?.close) {
    anyChrome.sidebarAction.close() // Firefox: window.close() won't close a sidebar
  } else {
    window.close() // Chrome side panel
  }
}
