import type { ApiUser } from "../lib/api.js";

export type ParticipantRole = "lawyer" | "judge" | "other";

export const PARTICIPANT_ROLE_LABELS: Record<ParticipantRole, string> = {
  lawyer: "Юрист",
  judge: "Судья",
  other: "Пользователь",
};

const ROLE_CHANGE_MS = 1000 * 60 * 60 * 24 * 30;

export function participantRoleChangeInfo(profile?: ApiUser["profile"]): {
  canChange: boolean;
  nextChangeAt?: string;
} {
  const at = profile?.participantRoleChangedAt;
  if (!at) return { canChange: true };
  const next = Date.parse(at) + ROLE_CHANGE_MS;
  if (Date.now() >= next) return { canChange: true };
  return { canChange: false, nextChangeAt: new Date(next).toISOString() };
}

export function formatParticipantRole(role?: ParticipantRole): string {
  return PARTICIPANT_ROLE_LABELS[role ?? "other"];
}
