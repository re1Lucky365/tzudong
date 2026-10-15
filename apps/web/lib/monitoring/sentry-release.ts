/** Only a complete immutable Git commit may identify the deployed application release. */
export function sentryBuildRelease(value: string | undefined): string | undefined {
  return value && /^[a-f0-9]{40}$/.test(value) ? value : undefined;
}
