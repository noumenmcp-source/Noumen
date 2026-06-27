export function readGpc(): boolean {
  if (typeof navigator === "undefined") return false;
  const candidate = navigator as Navigator & Readonly<{ globalPrivacyControl?: unknown }>;
  return candidate.globalPrivacyControl === true;
}
