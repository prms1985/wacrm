import { NextResponse } from 'next/server';
import { getCurrentAccount, toErrorResponse } from '@/lib/auth/account';
import { assertSameOrigin } from '@/lib/managed/access';
import { managedSnapshot } from '@/lib/managed/snapshot';
import { throwManagedDatabaseError } from '@/lib/managed/errors';

export async function GET() {
  try {
    const ctx = await getCurrentAccount();
    const [snapshot, platform] = await Promise.all([
      managedSnapshot(ctx.accountId),
      ctx.supabase.rpc('is_platform_admin'),
    ]);
    if (platform.error)
      throwManagedDatabaseError(platform.error, 'check platform access');
    const permissions = await ctx.supabase.rpc('managed_permissions', {
      p_account_id: ctx.accountId,
    });
    if (permissions.error)
      throwManagedDatabaseError(
        permissions.error,
        'check workspace permissions'
      );
    return NextResponse.json(
      {
        ...snapshot,
        account: ctx.account,
        userId: ctx.userId,
        role: ctx.role,
        platformAdmin: platform.data === true,
        capabilities: permissions.data,
      },
      { headers: { 'Cache-Control': 'private, no-store' } }
    );
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const ctx = await getCurrentAccount();
    const body = await request.json();
    const { error } = await ctx.supabase.rpc('managed_save_business', {
      p_account_id: ctx.accountId,
      p_name: body.business_name,
      p_description: body.description ?? '',
      p_support: body.support_contact,
      p_hours: body.operating_hours ?? '',
    });
    if (error)
      return NextResponse.json(
        { error: error.message },
        { status: error.code === '42501' ? 403 : 400 }
      );
    return NextResponse.json({ success: true });
  } catch (error) {
    return toErrorResponse(error);
  }
}
