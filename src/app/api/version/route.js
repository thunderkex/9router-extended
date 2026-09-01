import pkg from "../../../../package.json" with { type: "json" };
import { checkForUpdate, fetchNpmLatest } from "@/lib/updateCheck.js";

const NPM_PACKAGE_NAME = "9router";

export async function GET() {
  const currentVersion = pkg.version;
  const result = await checkForUpdate(
    "9router",
    currentVersion,
    () => fetchNpmLatest(NPM_PACKAGE_NAME)
  );

  return Response.json(result);
}
