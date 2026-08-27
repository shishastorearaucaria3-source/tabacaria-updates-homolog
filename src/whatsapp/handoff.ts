import { STATES, resetConversation, type ConversationContext } from './state.js';
import type { DatabaseSync } from 'node:sqlite';
import { getTexts } from './menus.js';

export const HANDOFF_STATE = STATES.HUMAN_HANDOFF;

export function enterHandoff(db: DatabaseSync): string {
  return getTexts(db).handoff;
}

export function releaseToBot(db: DatabaseSync, phone: string): void {
  resetConversation(db, phone);
}
