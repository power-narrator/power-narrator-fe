export function getProviderLabel(providerId: string): string {
  return providerId === "gcp" ? "Google Cloud" : providerId;
}
