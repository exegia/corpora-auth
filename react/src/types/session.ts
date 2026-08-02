import { Session, User } from "@exegia/plugin-supabase-auth";


 type SessionStatus = "loading" | "signedIn" | "signedOut";

interface UseSessionResult {
  session: Session | null;
  user: User | null;
  status: SessionStatus;
}

interface SessionState {
  session: Session | null;
  status: SessionStatus;
}

export type { SessionStatus, UseSessionResult, SessionState };