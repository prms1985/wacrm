import { getCurrentAccount } from '@/lib/auth/account';
import { isProductId } from '@/lib/products/validation';
import {
  loadQuotation,
  quotationResponseError,
} from '@/lib/quotations/repository';
import { QuotationError } from '@/lib/quotations/validation';
import { quotationPdf } from '@/lib/quotations/pdf';

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { supabase, accountId } = await getCurrentAccount();
    const { id } = await context.params;
    if (!isProductId(id)) throw new QuotationError('notFound', 404);
    const quote = await loadQuotation(supabase, accountId, id),
      bytes = await quotationPdf(quote);
    return new Response(new Uint8Array(bytes), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `inline; filename="${quote.reference}.pdf"`,
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch (error) {
    return quotationResponseError(error);
  }
}
