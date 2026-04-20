/**
 * AI Sentinel — Service Worker (background.js)
 * Manifest V3 compliant. Forces the side panel to open on icon click.
 */

// Open the side panel when the action icon is clicked.
chrome.action.onClicked.addListener((tab) => {
  chrome.sidePanel.open({ tabId: tab.id });
});

// Set the side panel options for every tab by default.
chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setOptions({
    enabled: true,
  });
});
