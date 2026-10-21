export const demoUserPassword = process.env.LIVE_DEMO_USER_PASSWORD ?? "";
export const demoAdminPassword = process.env.LIVE_DEMO_ADMIN_PASSWORD ?? "";

export function assertDemoCredentialsConfigured(options: { admin?: boolean } = {}): void {
  if (demoUserPassword.length < 16 || demoUserPassword.length > 72) {
    throw new Error("Set LIVE_DEMO_USER_PASSWORD to the same random demo-only password used by the isolated seed.");
  }
  if (options.admin && (demoAdminPassword.length < 16 || demoAdminPassword.length > 72)) {
    throw new Error("Set LIVE_DEMO_ADMIN_PASSWORD to the same random demo-only password used by the isolated seed.");
  }
}
