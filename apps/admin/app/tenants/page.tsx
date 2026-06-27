"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { listAdminTenants } from "../../src/api";
import { readAdminToken } from "../../src/session";
import type { AdminTenant, PlannedState } from "../../src/types";
import { EmptyState, ErrorState, Shell } from "../../src/ui";

const initial: PlannedState<readonly AdminTenant[]> = { data: [], planned: false, error: "" };

export default function TenantsPage() {
  const [state, setState] = useState(initial);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    listAdminTenants(readAdminToken()).then(setState).finally(() => setLoading(false));
  }, []);

  return (
    <Shell>
      <div className="grid gap-5">
        <h1 className="text-2xl font-semibold">Tenants</h1>
        {loading ? <section className="panel">Loading tenants...</section> : null}
        {state.planned ? <ErrorState message="Admin tenant listing is planned and not available yet." /> : null}
        {!loading && state.data.length === 0 ? (
          <EmptyState title="No tenant data" body="Cross-tenant admin endpoints will populate this table when the API lands." />
        ) : null}
        <div className="grid gap-2">
          {state.data.map((tenant) => (
            <Link className="panel hover:border-accent" href={`/tenants/${tenant.id}`} key={tenant.id}>
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="font-semibold">{tenant.name}</p>
                  <p className="text-sm text-ink/70">{tenant.id}</p>
                </div>
                <p className="text-sm text-ink/70">{tenant.modules.join(", ") || "No modules"}</p>
              </div>
            </Link>
          ))}
        </div>
      </div>
    </Shell>
  );
}
