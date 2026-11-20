import type { AxiosInstance } from 'axios';
import type { Session, SessionStore } from '../../core/session';
import type { createRealtime } from '../../core/realtime';

/** What the server exposes for the shared tablet: no PIN length, no credentials. */
export interface RosterUser {
    id: number;
    name: string;
    initials: string;
    color: string | null;
}

export interface PinApi {
    roster(): Promise<RosterUser[]>;
    login(userId: number, pin: string): Promise<Session>;
    logout(): Promise<void>;
}

type RealtimeControl = Pick<ReturnType<typeof createRealtime>, 'close' | 'reconnect'>;

export function createPinApi(deps: { http: AxiosInstance; sessions: SessionStore; realtime: RealtimeControl }): PinApi {
    const { http, sessions, realtime } = deps;
    return {
        async roster() {
            const res = await http.get('/auth/device-roster');
            return res.data.data as RosterUser[];
        },

        async login(userId, pin) {
            const res = await http.post('/auth/pin-login', { userId, pin });
            const { token, user } = res.data.data;
            const session: Session = { token, user, issuedAt: Date.now() };
            // Save first: the realtime AUTH reads the stored token, so reconnecting earlier
            // would re-authenticate the socket as the previous user.
            await sessions.save(session);
            await realtime.reconnect();
            return session;
        },

        async logout() {
            // Close first: revoking the session while the socket is open makes the server
            // push a 4001 that a late reconnect could attribute to the next user.
            realtime.close();
            try {
                await http.post('/auth/logout');
            } catch {
                // Offline or already revoked: the local session must go regardless.
            } finally {
                await sessions.clear();
            }
        },
    };
}
