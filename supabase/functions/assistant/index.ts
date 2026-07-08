// Supabase Edge Function (Deno) — Claude-powered upgrade of the on-device
// assistant heuristics in packages/core/src/assistant.ts. Same two actions,
// same input/output shapes, so apps/web/src/lib/assistant.ts can call
// whichever is available and the rest of the app never knows the
// difference. Requires the ANTHROPIC_API_KEY secret to be set on the
// Supabase project (`supabase secrets set ANTHROPIC_API_KEY=...`) — with no
// key configured this function 500s and the client falls back to the
// on-device heuristic.
import { createClient } from 'npm:@supabase/supabase-js@2.45.4';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

// Kept in sync by hand with packages/core/src/types.ts ROOM_TYPES — the
// Deno edge runtime can't import the workspace TS package directly.
const ROOM_TYPES = [
  'Living Room',
  'Kitchen / Diner',
  'Bedroom',
  'Bathroom',
  'WC',
  'Hallway',
  'Stairs',
  'Utility',
  'Other',
] as const;
type RoomType = (typeof ROOM_TYPES)[number];

interface RoomRect {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  name: string;
  type: RoomType;
  ceilingHeightM: number;
  includeInGia: boolean;
}
interface FloorDoc {
  rooms: RoomRect[];
  [key: string]: unknown;
}

interface SuggestRoomNamesBody {
  action: 'suggestRoomNames';
  doc: FloorDoc;
  floorIndex: number;
}
interface GenerateDescriptionBody {
  action: 'generateDescription';
  address: string;
  floors: { name: string; doc: FloorDoc }[];
}
type RequestBody = SuggestRoomNamesBody | GenerateDescriptionBody;

const ANTHROPIC_MODEL = Deno.env.get('ANTHROPIC_MODEL') ?? 'claude-haiku-4-5-20251001';

async function callClaude(system: string, user: string): Promise<string> {
  const apiKey = Deno.env.get('ANTHROPIC_API_KEY');
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY is not configured on this project');

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: ANTHROPIC_MODEL,
      max_tokens: 1024,
      system,
      messages: [{ role: 'user', content: user }],
    }),
  });
  if (!res.ok) {
    throw new Error(`Anthropic API error ${res.status}: ${await res.text()}`);
  }
  const json = await res.json();
  const text = json.content?.find((b: { type: string }) => b.type === 'text')?.text;
  if (typeof text !== 'string') throw new Error('Anthropic response had no text content');
  return text;
}

function roomAreaM2(r: RoomRect): number {
  return (r.w * r.h) / 1_000_000;
}

function extractJson(text: string): unknown {
  const match = text.match(/\{[\s\S]*\}/);
  return JSON.parse(match ? match[0] : text);
}

async function suggestRoomNames(body: SuggestRoomNamesBody) {
  const rooms = body.doc.rooms.filter((r) => r.type !== 'Stairs');
  if (rooms.length === 0) return { suggestions: [] };

  const roomSummaries = rooms.map((r) => ({
    roomId: r.id,
    widthM: (r.w / 1000).toFixed(2),
    heightM: (r.h / 1000).toFixed(2),
    areaM2: roomAreaM2(r).toFixed(1),
    currentName: r.name,
  }));

  const text = await callClaude(
    `You are a UK residential floor plan assistant. Given a list of rooms on one ` +
      `floor (dimensions in metres), suggest a sensible name and type for each. ` +
      `This is floor index ${body.floorIndex} (0 = ground floor). Valid types: ` +
      `${ROOM_TYPES.filter((t) => t !== 'Stairs').join(', ')}. ` +
      `Respond with ONLY a JSON object: {"suggestions":[{"roomId":"...","name":"...","type":"..."}]}. ` +
      `No prose, no markdown fences.`,
    JSON.stringify(roomSummaries),
  );

  const parsed = extractJson(text) as { suggestions?: { roomId: string; name: string; type: string }[] };
  const validRoomIds = new Set(rooms.map((r) => r.id));
  const validTypes = new Set<string>(ROOM_TYPES);
  const suggestions = (parsed.suggestions ?? []).filter(
    (s) => validRoomIds.has(s.roomId) && validTypes.has(s.type) && typeof s.name === 'string' && s.name.length > 0,
  );
  return { suggestions };
}

async function generateDescription(body: GenerateDescriptionBody) {
  const floorSummaries = body.floors.map((f) => ({
    name: f.name,
    rooms: f.doc.rooms
      .filter((r) => r.type !== 'Stairs')
      .map((r) => ({ name: r.name, type: r.type, areaM2: roomAreaM2(r).toFixed(1) })),
  }));

  const text = await callClaude(
    'You are a UK estate agent copywriter. Write a concise, factual property listing ' +
      'paragraph (120-180 words) from the given address and per-floor room list. ' +
      'Mention bedroom count and approximate total area. End with a one-sentence ' +
      'disclaimer that measurements are approximate and should be verified on site. ' +
      'Respond with plain text only — no markdown, no headings.',
    JSON.stringify({ address: body.address, floors: floorSummaries }),
  );
  return { text: text.trim() };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS_HEADERS });

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Missing Authorization header' }), {
        status: 401,
        headers: { ...CORS_HEADERS, 'content-type': 'application/json' },
      });
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();
    if (authError || !user) {
      return new Response(JSON.stringify({ error: 'Not authenticated' }), {
        status: 401,
        headers: { ...CORS_HEADERS, 'content-type': 'application/json' },
      });
    }

    const body = (await req.json()) as RequestBody;
    const result =
      body.action === 'suggestRoomNames' ? await suggestRoomNames(body) : await generateDescription(body);

    return new Response(JSON.stringify(result), {
      headers: { ...CORS_HEADERS, 'content-type': 'application/json' },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err instanceof Error ? err.message : 'Unknown error' }), {
      status: 500,
      headers: { ...CORS_HEADERS, 'content-type': 'application/json' },
    });
  }
});
