import {
  MODULE_KEYS,
  type ModuleKey,
  type ModuleManifest,
} from "@cdp-us/contracts";
import { automationManifest } from "@cdp-us/automation";
import { consentManifest } from "@cdp-us/consent";
import { emailManifest } from "@cdp-us/email";
import { socialIntelManifest } from "@cdp-us/social-intel";
import { youtubeManifest } from "@cdp-us/youtube";

const manifests: ModuleManifest[] = [
  consentManifest,
  emailManifest,
  socialIntelManifest,
  youtubeManifest,
  automationManifest,
];

export function listModuleManifests(): ModuleManifest[] {
  return manifests.map((manifest) => ({ ...manifest }));
}

export function isModuleKey(value: string): value is ModuleKey {
  return MODULE_KEYS.includes(value as ModuleKey);
}

export function getModuleManifest(key: ModuleKey): ModuleManifest {
  return manifests.find((manifest) => manifest.key === key)!;
}
