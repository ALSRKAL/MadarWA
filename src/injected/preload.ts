/**
 * Runs before the wa-js bundle in the MAIN world.
 * WPPConnect merges window.WPPConfig at load time; these flags disable its
 * analytics hooks and brand the linked device as MadarWA.
 */
declare global {
  interface Window {
    WPPConfig?: Record<string, unknown>;
  }
}

window.WPPConfig = {
  ...(window.WPPConfig ?? {}),
  deviceName: "MadarWA",
  disableGoogleAnalytics: true,
  googleAnalyticsId: null,
  sendStatusToDevice: false,
};

export {};
