import { NextResponse } from 'next/server';
import { getCurrentAccount, toErrorResponse } from '@/lib/auth/account';
import { configurationContext, assertSameOrigin } from '@/lib/managed/access';
import { credentialStore } from '@/lib/managed/credentials';

export async function GET(request: Request) {
  try {
    const ctx = new URL(request.url).searchParams.has('account_id')
      ? await configurationContext(request, 'whatsapp.manage')
      : await getCurrentAccount();
    const { data, error } = await credentialStore()
      .from('whatsapp_config')
      .select(
        'id,account_id,user_id,phone_number_id,waba_id,status,connection_mode,registered_at,last_registration_error,mirror_inbound_media,created_at,updated_at,access_token,verify_token'
      )
      .eq('account_id', ctx.accountId)
      .maybeSingle();
    if (error) throw new Error('Could not load connection details');
    if (!data) return NextResponse.json({ config: null });
    const { access_token, verify_token, ...safe } = data;
    return NextResponse.json(
      {
        config: {
          ...safe,
          has_access_token: !!access_token,
          has_verify_token: !!verify_token,
        },
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
    const ctx = await configurationContext(request, 'whatsapp.manage');
    const body = await request.json();
    if (typeof body.mirror_inbound_media !== 'boolean')
      return NextResponse.json(
        { error: 'Invalid media setting' },
        { status: 400 }
      );
    const { error } = await ctx.supabase
      .from('whatsapp_config')
      .update({ mirror_inbound_media: body.mirror_inbound_media })
      .eq('account_id', ctx.accountId);
    if (error) throw new Error('Could not update media setting');
    return NextResponse.json({ success: true });
  } catch (error) {
    return toErrorResponse(error);
  }
}
