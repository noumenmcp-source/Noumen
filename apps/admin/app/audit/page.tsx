"use client";

import { useEffect, useState } from "react";
import { listAudit } from "../../src/api";
import { readAdminToken } from "../../src/session";
import type { PlannedState } from "../../src/types";
import { EmptyState, ErrorState, Shell } from "../../src/ui";

const initial: PlannedState<readonly string[]> = { data: [], planned: false, error: "" };

export default function AuditPage() {
  const [state, setState] = useState(initial);

  useEffect(() => {
    listAudit(readAdminToken()).then(setState);
  }, []);

  return (
    <Shell>
      <div className="grid gap-5">
        <h1 className="text-2xl font-semibold">Audit log</h1>
        {state.planned ? <ErrorState message="Audit admin API is planned and not available yet." /> : null}
        {state.data.length === 0 ? <EmptyState title="No audit entries" body="Operator actions and support reads will appear here." /> : null}
      </div>
    </Shell>
  );
}
