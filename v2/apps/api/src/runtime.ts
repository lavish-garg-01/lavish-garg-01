export const REQUIRED_NODE_MAJOR = 24;

export function assertSupportedNodeRuntime(version = process.versions.node): void {
  const major = Number.parseInt(version.split(".")[0] ?? "", 10);
  if (major !== REQUIRED_NODE_MAJOR) {
    throw new Error(
      `Job Hunter V2 requires Node ${REQUIRED_NODE_MAJOR}.x; the API was started with Node ${version}. Run nvm use 24 before npm run dev:api.`
    );
  }
}
