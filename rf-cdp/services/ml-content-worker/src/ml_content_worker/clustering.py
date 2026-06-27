"""Micro-segmentation: group users by trait similarity so the LLM fleet generates one content
variant per cluster instead of per user — bounding fleet calls on large audiences (the cost lever)."""
from collections import Counter

import numpy as np
from sklearn.cluster import KMeans
from sklearn.preprocessing import OneHotEncoder


def _traits(user):
    # Accept either {"traits": {...}} or a flat trait dict.
    return user.get("traits", user) if isinstance(user, dict) else {}


def _featurize(users, fields):
    """One-hot encode the selected categorical trait fields into a numeric matrix."""
    rows = [[str(_traits(u).get(f, "")) for f in fields] for u in users]
    try:
        enc = OneHotEncoder(handle_unknown="ignore", sparse_output=False)
    except TypeError:  # older scikit-learn
        enc = OneHotEncoder(handle_unknown="ignore", sparse=False)
    return enc.fit_transform(np.array(rows, dtype=object))


def cluster_users(users, max_clusters, fields):
    """Cluster users by `fields`. Returns a list of clusters, each:
    {indices, members, representative_traits} — the representative is the per-field mode,
    used as the brief for a single LLM generation that covers the whole cluster."""
    n = len(users)
    if n == 0:
        return []
    k = max(1, min(int(max_clusters), n))
    if k == 1:
        labels = [0] * n
    else:
        labels = list(KMeans(n_clusters=k, n_init=10, random_state=42).fit_predict(_featurize(users, fields)))

    clusters = []
    for c in range(max(labels) + 1):
        idx = [i for i, lab in enumerate(labels) if lab == c]
        if not idx:
            continue
        members = [users[i] for i in idx]
        rep = {}
        for f in fields:
            vals = [str(_traits(m).get(f)) for m in members if _traits(m).get(f)]
            if vals:
                rep[f] = Counter(vals).most_common(1)[0][0]
        clusters.append({"indices": idx, "members": members, "representative_traits": rep})
    return clusters
