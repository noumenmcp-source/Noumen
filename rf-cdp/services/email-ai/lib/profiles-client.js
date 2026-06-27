'use strict';
/** Reads materialized profiles for a site from the profile-engine read API. */
async function listProfiles(deps, site) {
  const headers = {};
  if (deps.profileToken) headers.authorization = `Bearer ${deps.profileToken}`;
  const url = `${trim(deps.profilesUrl)}/v1/profiles?site=${encodeURIComponent(site)}`;
  const res = await deps.fetchImpl(url, { headers });
  if (!res.ok) return [];
  const b = await res.json();
  return Array.isArray(b.profiles) ? b.profiles : [];
}

function trim(u) { return String(u).replace(/\/+$/, ''); }

module.exports = { listProfiles };
