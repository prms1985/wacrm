import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { NextResponse } from 'next/server';
import { requireRole, toErrorResponse } from '@/lib/auth/account';

export async function GET() {
  try {
    // First-time setup cannot depend on the platform role that migration 067
    // creates. Downloading SQL does not execute it or grant any privileges.
    await requireRole('admin');
    const sql = await readFile(
      join(process.cwd(), 'supabase/setup/managed-automation.sql'),
      'utf8'
    );
    return new NextResponse(sql, {
      headers: {
        'Content-Type': 'application/sql; charset=utf-8',
        'Content-Disposition':
          'attachment; filename="managed-automation-setup.sql"',
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}
