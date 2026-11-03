import { timingSafeEqual } from 'node:crypto';
import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/ai/admin-client';
import { drainCoexistenceEvents } from '@/lib/whatsapp/coexistence/service';

export const maxDuration = 120;

export async function GET(request: Request) {
  const secret = process.env.AUTOMATION_CRON_SECRET;
  if (!secret)
    return NextResponse.json(
      { error: 'Cron is not configured.' },
      { status: 503 }
    );
  const supplied = Buffer.from(request.headers.get('x-cron-secret') || ''),
    expected = Buffer.from(secret);
  if (
    supplied.length !== expected.length ||
    !timingSafeEqual(supplied, expected)
  )
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    return NextResponse.json(await drainCoexistenceEvents(supabaseAdmin()));
  } catch {
    return NextResponse.json(
      { error: 'Synchronization storage is unavailable.' },
      { status: 503 }
    );
  }
}
