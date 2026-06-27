"use client";

import { useEffect, useState } from "react";
import { listSuppression } from "../../src/api";
import { readAdminToken } from "../../src/session";
import type { PlannedState } from "../../src/types";
import { EmptyState, ErrorState, Shell } from "../../src/ui";

const initial: PlannedState<readonly string[]> = { data: [], planned: false, error: "" };

export default function SuppressionPage() {
  const [state, setState] = useState(initial);

  useEffect(() => {
    listSuppression(readAdminToken()).then(setState);
  }, []);

  return (
    <Shell>
      <div className="grid gap-5">
        <h1 className="text-2xl font-semibold">Suppression</h1>
        {state.planned ? <ErrorState message="Suppression admin API is planned and not available yet." /> : null}
        {state.data.length === 0 ? <EmptyState title="No suppression rows" body="Suppressed emails and domains will appear here." /> : null}
      </div>
    </Shell>
  );
}
