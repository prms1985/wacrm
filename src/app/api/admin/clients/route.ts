import { NextResponse } from 'next/server';
import { toErrorResponse } from '@/lib/auth/account';
import { requirePlatformAdmin, assertSameOrigin } from '@/lib/managed/access';
import { parseAmountMinor } from '@/lib/managed/catalog';

export async function GET(request: Request) {
  try {
    const { supabase } = await requirePlatformAdmin();
    const url = new URL(request.url);
    const page = Math.max(
      0,
      Math.min(10000, Number(url.searchParams.get('page')) || 0)
    );
    let query = supabase
      .from('accounts')
      .select('id,name,created_at', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(page * 50, page * 50 + 49);
    const search = url.searchParams.get('q')?.trim().slice(0, 120);
    if (search) query = query.ilike('name', `%${search.replace(/[%_]/g, '')}%`);
    const [accounts, plans, industries, settings] = await Promise.all([
      query,
      supabase
        .from('subscription_plans')
        .select('*')
        .order('monthly_price_minor'),
      supabase.from('industry_packages').select('*'),
      supabase
        .from('managed_platform_settings')
        .select('managed_signup')
        .single(),
    ]);
    for (const result of [accounts, plans, industries, settings])
      if (result.error)
        throw new Error(
          'Apply migration 067 before opening the managed platform'
        );
    const ids = (accounts.data ?? []).map((a) => a.id);
    const subscriptions = ids.length
      ? await supabase
          .from('managed_subscriptions')
          .select('*')
          .in('account_id', ids)
      : { data: [], error: null };
    if (subscriptions.error)
      throw new Error('Could not load client subscriptions');
    return NextResponse.json(
      {
        accounts: accounts.data ?? [],
        total: accounts.count ?? 0,
        subscriptions: subscriptions.data ?? [],
        plans: plans.data ?? [],
        industries: industries.data ?? [],
        managed_signup: settings.data?.managed_signup ?? false,
      },
      { headers: { 'Cache-Control': 'private, no-store' } }
    );
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function PATCH(request: Request) {
  try {
    assertSameOrigin(request);
    const { supabase } = await requirePlatformAdmin();
    const body = await request.json();
    if (typeof body.managed_signup !== 'boolean')
      return NextResponse.json(
        { error: 'Choose whether new registrations need approval' },
        { status: 400 }
      );
    const { error } = await supabase
      .from('managed_platform_settings')
      .update({ managed_signup: body.managed_signup })
      .eq('id', true);
    if (error) throw new Error('Could not update registration settings');
    return NextResponse.json({ success: true });
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const { supabase } = await requirePlatformAdmin();
    const body = await request.json();
    const counts = [
      body.seat_limit,
      body.ai_generation_limit,
      body.outbound_attempt_limit,
    ].map(Number);
    if (
      counts.some((n) => !Number.isSafeInteger(n) || n < 0 || n > 100000000) ||
      counts[0] < 1
    )
      return NextResponse.json(
        { error: 'Enter valid whole-number allowances' },
        { status: 400 }
      );
    const { error } = await supabase.rpc('managed_update_plan', {
      p_id: body.id,
      p_monthly: parseAmountMinor(body.monthly_price),
      p_setup: parseAmountMinor(body.setup_price),
      p_seats: counts[0],
      p_ai: counts[1],
      p_outbound: counts[2],
    });
    if (error)
      return NextResponse.json({ error: error.message }, { status: 400 });
    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof Error && /valid amount/.test(error.message))
      return NextResponse.json({ error: error.message }, { status: 400 });
    return toErrorResponse(error);
  }
}
