import {
  generateDescription as generateDescriptionOnDevice,
  suggestRoomNames as suggestRoomNamesOnDevice,
  type DescriptionInput,
  type FloorDoc,
  type NameSuggestion,
} from '@floorplan/core';
import { getSupabaseClient } from './supabase';

/**
 * Cloud-upgraded assistant: calls the `assistant` Supabase Edge Function
 * (Claude-backed) when a project is configured and the user is signed in,
 * and transparently falls back to the on-device heuristic otherwise — no
 * credentials, signed out, offline, or the function erroring all land on
 * the same safe default. Callers never need to know which one ran.
 */
async function hasSession(): Promise<boolean> {
  const client = getSupabaseClient();
  if (!client) return false;
  const {
    data: { session },
  } = await client.auth.getSession();
  return session !== null;
}

export async function suggestRoomNamesSmart(
  doc: FloorDoc,
  floorIndex = 0,
): Promise<NameSuggestion[]> {
  const client = getSupabaseClient();
  if (client && (await hasSession())) {
    try {
      const { data, error } = await client.functions.invoke('assistant', {
        body: { action: 'suggestRoomNames', doc, floorIndex },
      });
      if (!error && Array.isArray(data?.suggestions)) {
        return data.suggestions as NameSuggestion[];
      }
    } catch {
      // fall through to on-device heuristic
    }
  }
  return suggestRoomNamesOnDevice(doc, floorIndex);
}

export async function generateDescriptionSmart(input: DescriptionInput): Promise<string> {
  const client = getSupabaseClient();
  if (client && (await hasSession())) {
    try {
      const { data, error } = await client.functions.invoke('assistant', {
        body: { action: 'generateDescription', ...input },
      });
      if (!error && typeof data?.text === 'string' && data.text.length > 0) {
        return data.text as string;
      }
    } catch {
      // fall through to on-device heuristic
    }
  }
  return generateDescriptionOnDevice(input);
}

export function isAssistantCloudBacked(): boolean {
  return getSupabaseClient() !== null;
}
