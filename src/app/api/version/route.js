import pkg from "../../../../package.json" with { type: "json" };
import { checkForUpdate, fetchGitHubExtendedLatest, getLocalAppMd5, clearPluginUpdateCache } from "@/lib/updateCheck.js";
import { UPDATER_CONFIG } from "@/shared/constants/config.js";

const EXTENDED_REPO = UPDATER_CONFIG.githubRepo || "thunderkex/9router-extended";

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const force = searchParams.get("force") === "true" || searchParams.get("force") === "1";
  if (force) {
    clearPluginUpdateCache("9router-extended");
  }

  const currentVersion = pkg.version;
  const currentMd5 = getLocalAppMd5();
  const isBun = typeof process !== "undefined" && Boolean(process.versions?.bun);
  const tarballUrl = UPDATER_CONFIG.tarballUrl;

  const packageManagers = {
    bun: `bun add -g ${tarballUrl}`,
    npm: `npm i -g ${tarballUrl} --force`,
    pnpm: `pnpm add -g ${tarballUrl}`,
    yarn: `yarn global add ${tarballUrl}`,
  };

  const defaultPkgManager = isBun ? "bun" : "npm";
  const updateCmd = packageManagers[defaultPkgManager];

  const result = await checkForUpdate(
    "9router-extended",
    currentVersion,
    () => fetchGitHubExtendedLatest(EXTENDED_REPO),
    force ? 0 : 3600000,
    currentMd5
  );

  return Response.json({
    ...result,
    isExtended: true,
    repo: EXTENDED_REPO,
    updateCmd,
    packageManagers,
    defaultPkgManager,
    detectedRuntime: isBun ? "bun" : "node",
    tarballUrl,
  });
}


