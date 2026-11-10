"use client";
// Session scope for /neo2: workspace identity (from the existing v1 session),
// v2 capabilities, and the selected snapshot pair (current + baseline).
// Snapshot ids live in the URL when present, otherwise in localStorage per workspace.

import {createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode} from 'react';
import {v2get, withBusiness, errorMessage} from './api';
import type {BusinessesResponse, CapabilitiesResponse} from './types';

type SnapshotPair = {current: string | null; baseline: string | null};

type SessionValue = {
    ready: boolean;
    error: string;
    businesses: BusinessesResponse['businesses'];
    businessId: string;
    workspaceName: string;
    role: string;
    capabilities: CapabilitiesResponse | null;
    snapshots: SnapshotPair;
    setBusiness: (id: string) => void;
    setSnapshots: (next: SnapshotPair) => void;
    clearError: () => void;
};

const SessionContext = createContext<SessionValue | null>(null);

function storageKey(businessId: string): string {
    return `neo2.snapshots.${businessId}`;
}

function readStoredSnapshots(businessId: string): SnapshotPair {
    try {
        const raw = window.localStorage.getItem(storageKey(businessId));
        if (raw) {
            const parsed = JSON.parse(raw) as Partial<SnapshotPair>;
            return {current: typeof parsed.current === 'string' ? parsed.current : null, baseline: typeof parsed.baseline === 'string' ? parsed.baseline : null};
        }
    } catch {
        // Corrupted storage is treated as no selection.
    }
    return {current: null, baseline: null};
}

export function Neo2SessionProvider({children}: {children: ReactNode}) {
    const [businesses, setBusinesses] = useState<BusinessesResponse['businesses']>([]);
    const [businessId, setBusinessId] = useState('');
    const [capabilities, setCapabilities] = useState<CapabilitiesResponse | null>(null);
    const [snapshots, setSnapshotsState] = useState<SnapshotPair>({current: null, baseline: null});
    const [error, setError] = useState('');
    const [ready, setReady] = useState(false);

    // Resolve identity through the existing session endpoint (v1 semantics untouched).
    useEffect(() => {
        let cancelled = false;
        fetch('/api/v1/businesses/current', {cache: 'no-store'})
            .then((r) => r.json())
            .then((d: BusinessesResponse) => {
                if (cancelled) return;
                setBusinesses(d.businesses ?? []);
                const url = new URL(window.location.href);
                const fromUrl = url.searchParams.get('businessId');
                setBusinessId(fromUrl && d.businesses.some((b) => b.id === fromUrl) ? fromUrl : d.current.id);
                setReady(true);
            })
            .catch((e) => {
                if (!cancelled) {
                    setError(errorMessage(e));
                    setReady(true);
                }
            });
        return () => {
            cancelled = true;
        };
    }, []);

    // Load capabilities for the selected workspace.
    useEffect(() => {
        if (!businessId) return;
        let cancelled = false;
        setError('');
        v2get<CapabilitiesResponse>(withBusiness('/api/v2/store/capabilities', businessId))
            .then((d) => {
                if (!cancelled) setCapabilities(d);
            })
            .catch((e) => {
                if (!cancelled) {
                    setCapabilities(null);
                    setError(errorMessage(e));
                }
            });
        return () => {
            cancelled = true;
        };
    }, [businessId]);

    // Restore snapshot selection when the workspace changes.
    useEffect(() => {
        if (!businessId) return;
        setSnapshotsState(readStoredSnapshots(businessId));
    }, [businessId]);

    const setBusiness = useCallback((id: string) => {
        const url = new URL(window.location.href);
        url.searchParams.set('businessId', id);
        url.searchParams.delete('snapshot_id');
        url.searchParams.delete('baseline_snapshot_id');
        window.history.replaceState(window.history.state, '', url.href);
        setBusinessId(id);
    }, []);

    const setSnapshots = useCallback((next: SnapshotPair) => {
        setSnapshotsState(next);
        try {
            window.localStorage.setItem(storageKey(businessId), JSON.stringify(next));
        } catch {
            // Storage may be unavailable (private mode); URL params still carry the ids per request.
        }
    }, [businessId]);

    const value = useMemo<SessionValue>(() => ({
        ready,
        error,
        businesses,
        businessId,
        workspaceName: capabilities?.workspace_name ?? '',
        role: capabilities?.role ?? '',
        capabilities,
        snapshots,
        setBusiness,
        setSnapshots,
        clearError: () => setError(''),
    }), [ready, error, businesses, businessId, capabilities, snapshots, setBusiness, setSnapshots]);

    return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useNeo2Session(): SessionValue {
    const value = useContext(SessionContext);
    if (!value) throw new Error('useNeo2Session 必须在 Neo2SessionProvider 内使用');
    return value;
}
