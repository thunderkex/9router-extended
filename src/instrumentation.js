export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { initConsoleLogCapture } = await import("@/lib/consoleLogBuffer");
    initConsoleLogCapture();

    const { checkDefaultPasswordGuard } = await import("@/lib/auth/dashboardSession");
    await checkDefaultPasswordGuard();
  }
}
